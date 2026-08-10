import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditWithin } from '../audit/chain.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { hashPassword } from '../auth/password.js';
import { capabilitiesOf } from '../auth/rbac.js';
import { sendProblem } from '../http/problem.js';

/**
 * User administration. Gated on `user:manage`, which only ADMIN holds.
 *
 * ADMIN governs *access* and reads the record. It cannot capture a meeting, clear
 * a Shariah finding, approve a facility or settle one — the capability matrix
 * withholds all four, and that is the shape of the role rather than an oversight.
 * Someone who can grant themselves a role must not also be able to use it to move
 * money.
 *
 * **No administrator ever types another person's password.** Creating a user mints
 * a random one nobody reads back, so the account is unusable until its owner sets
 * their own. An admin-chosen password would let the admin sign in as that user,
 * and every action attributed to them afterwards would be deniable — which
 * destroys the attribution the entire audit chain rests on.
 *
 * Self-protection: an administrator cannot change their own role or deactivate
 * themselves. Both are how a system ends up with no administrator, and both read
 * as configuration mistakes rather than decisions.
 */

const ROLES = ['VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN'] as const;

const CreateBody = z.object({
  email: z.string().email().max(200),
  displayName: z.string().min(1).max(120),
  role: z.enum(ROLES),
});

const RoleBody = z.object({ role: z.enum(ROLES) });

const ActiveBody = z.object({ active: z.boolean() });

export function registerUserRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const gate = { preHandler: [requireAuth, requireCapability('user:manage')] };

  app.get('/users', gate, async (_request, reply) => {
    const users = await prisma.user.findMany({
      orderBy: [{ deactivatedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
        deactivatedAt: true,
      },
    });

    return reply.send({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
        // Sent so the UI can show what a role actually permits, rather than
        // asking an administrator to remember the matrix.
        capabilities: capabilitiesOf(user.role),
      })),
    });
  });

  app.post('/users', gate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const body = CreateBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(
        reply,
        400,
        'Invalid request',
        'An email, a display name and a valid role are required.',
      );
    }

    const email = body.data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing !== null) {
      return sendProblem(
        reply,
        409,
        'Email already in use',
        'An account with that email already exists. Change its role instead, or '
        + 'reactivate it if it was deactivated.',
      );
    }

    /**
     * A random password nobody reads.
     *
     * Hashed and discarded — not returned, not logged, not shown to the
     * administrator. The account is deliberately unusable until its owner sets
     * their own credential. There is no reset flow yet; that is a real gap and the
     * UI says so, because inventing one where an admin hands over a password would
     * be worse than the gap.
     */
    const unusable = randomBytes(32).toString('base64');
    const passwordHash = await hashPassword(unusable);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          displayName: body.data.displayName,
          role: body.data.role,
          passwordHash,
        },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'user.created',
        entityType: 'User',
        entityId: user.id,
        payload: {
          // The email identifies the account and is the subject of the action, so
          // it belongs here. The display name is a person's name and is not copied
          // in — Meeting.title is kept out of payloads for the same reason.
          email: user.email,
          role: user.role,
        },
      });

      return user;
    });

    return reply.code(201).send({
      id: created.id,
      email: created.email,
      displayName: created.displayName,
      role: created.role,
      createdAt: created.createdAt.toISOString(),
      deactivatedAt: null,
      capabilities: capabilitiesOf(created.role),
    });
  });

  app.patch<{ Params: { id: string } }>('/users/:id/role', gate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const body = RoleBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(reply, 400, 'Invalid request', 'A valid role is required.');
    }

    if (request.params.id === actor.id) {
      return sendProblem(
        reply,
        409,
        'Cannot change your own role',
        'Ask another administrator to change your role. Changing it yourself is how '
        + 'the last administrator loses access.',
      );
    }

    const user = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (user === null) {
      return sendProblem(reply, 404, 'Not found', 'No user exists with that id.');
    }

    if (user.role === body.data.role) {
      return sendProblem(
        reply,
        409,
        'No change',
        `That user already holds the ${user.role} role.`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: user.id },
        data: { role: body.data.role },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'user.role.changed',
        entityType: 'User',
        entityId: user.id,
        payload: { email: user.email, from: user.role, to: body.data.role },
      });

      return next;
    });

    return reply.send({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      deactivatedAt: updated.deactivatedAt?.toISOString() ?? null,
      capabilities: capabilitiesOf(updated.role),
    });
  });

  /**
   * Revokes or restores access. Never deletes.
   *
   * A deactivated user keeps every row that names them — their approvals, their
   * Shariah rulings, their audit entries. Deletion would orphan all of it, and an
   * audit trail that cannot say who did something is not an audit trail.
   */
  app.patch<{ Params: { id: string } }>('/users/:id/active', gate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const body = ActiveBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(
        reply,
        400,
        'Invalid request',
        'A boolean "active" field is required.',
      );
    }

    if (request.params.id === actor.id) {
      return sendProblem(
        reply,
        409,
        'Cannot deactivate yourself',
        'Ask another administrator to do this. Deactivating your own account is how '
        + 'a system ends up with no administrator at all.',
      );
    }

    const user = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (user === null) {
      return sendProblem(reply, 404, 'Not found', 'No user exists with that id.');
    }

    if (body.data.active === (user.deactivatedAt === null)) {
      return sendProblem(
        reply,
        409,
        'No change',
        `That account is already ${body.data.active ? 'active' : 'deactivated'}.`,
      );
    }

    const at = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: user.id },
        data: { deactivatedAt: body.data.active ? null : at },
      });

      await appendAuditWithin(tx, {
        at,
        actorId: actor.id,
        actorRole: actor.role,
        action: body.data.active ? 'user.reactivated' : 'user.deactivated',
        entityType: 'User',
        entityId: user.id,
        payload: { email: user.email, role: user.role },
      });

      return next;
    });

    return reply.send({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      deactivatedAt: updated.deactivatedAt?.toISOString() ?? null,
      capabilities: capabilitiesOf(updated.role),
    });
  });
}
