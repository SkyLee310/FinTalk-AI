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

// Assignable roles. VIEWER and SUPERVISOR are superseded by OVERSIGHT (see
// auth/rbac.ts): create, role-change and approve all validate against this
// list, so the API refuses to assign either directly. The Role enum still
// defines all seven for audit history — this is only the write-side subset.
const ROLES = ['MAKER', 'CHECKER', 'SHARIAH', 'ADMIN', 'OVERSIGHT'] as const;

// Meaningful only when role is OVERSIGHT (capabilitiesOf in auth/rbac.ts is
// the only reader). Optional with a false default so a request for any other
// role need not mention them; normalizeOversightFlags below zeroes them out
// defensively regardless of what a caller sends for a non-OVERSIGHT role.
const OversightFlags = z.object({
  canViewMeetings: z.boolean().optional().default(false),
  canViewAuditTrail: z.boolean().optional().default(false),
});

const CreateBody = z
  .object({
    email: z.string().email().max(200),
    displayName: z.string().min(1).max(120),
    role: z.enum(ROLES),
  })
  .merge(OversightFlags);

const RoleBody = z.object({ role: z.enum(ROLES) }).merge(OversightFlags);

const ActiveBody = z.object({ active: z.boolean() });

const ApproveBody = z.object({ role: z.enum(ROLES) }).merge(OversightFlags);

/**
 * Zeroes both flags for every role but OVERSIGHT, so a client cannot leave
 * inert-but-misleading `true` values sitting on a MAKER or ADMIN row. The two
 * columns exist only for capabilitiesOf to read when role is OVERSIGHT.
 */
function normalizeOversightFlags(
  role: (typeof ROLES)[number],
  flags: { canViewMeetings: boolean; canViewAuditTrail: boolean },
): { canViewMeetings: boolean; canViewAuditTrail: boolean } {
  if (role !== 'OVERSIGHT') return { canViewMeetings: false, canViewAuditTrail: false };
  return flags;
}

export function registerUserRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const readGate = { preHandler: [requireAuth, requireCapability('user:read')] };
  const writeGate = { preHandler: [requireAuth, requireCapability('user:manage')] };

  app.get('/users', readGate, async (_request, reply) => {
    const users = await prisma.user.findMany({
      orderBy: [{ deactivatedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        accountStatus: true,
        username: true,
        staffId: true,
        createdAt: true,
        deactivatedAt: true,
        canViewMeetings: true,
        canViewAuditTrail: true,
      },
    });

    return reply.send({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        accountStatus: user.accountStatus,
        username: user.username,
        staffId: user.staffId,
        createdAt: user.createdAt.toISOString(),
        deactivatedAt: user.deactivatedAt?.toISOString() ?? null,
        canViewMeetings: user.canViewMeetings,
        canViewAuditTrail: user.canViewAuditTrail,
        // Sent so the UI can show what a role actually permits, rather than
        // asking an administrator to remember the matrix. A PENDING row has
        // no role yet, so it gets no capabilities rather than a crash.
        capabilities:
          user.role === null
            ? []
            : capabilitiesOf({
                role: user.role,
                canViewMeetings: user.canViewMeetings,
                canViewAuditTrail: user.canViewAuditTrail,
              }),
      })),
    });
  });

  app.post('/users', writeGate, async (request, reply) => {
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

    const oversight = normalizeOversightFlags(body.data.role, body.data);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          displayName: body.data.displayName,
          role: body.data.role,
          passwordHash,
          canViewMeetings: oversight.canViewMeetings,
          canViewAuditTrail: oversight.canViewAuditTrail,
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
          canViewMeetings: oversight.canViewMeetings,
          canViewAuditTrail: oversight.canViewAuditTrail,
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
      canViewMeetings: oversight.canViewMeetings,
      canViewAuditTrail: oversight.canViewAuditTrail,
      // body.data.role, not created.role: same reasoning as PATCH
      // /users/:id/role below — equal at runtime (we just created the row
      // with it), non-null at the type level because zod already validated
      // it, whereas created.role stays Role | null per the schema.
      capabilities: capabilitiesOf({ role: body.data.role, ...oversight }),
    });
  });

  app.patch<{ Params: { id: string } }>('/users/:id/role', writeGate, async (request, reply) => {
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

    // This route is for changing an already-active user's role. A still-PENDING
    // registration has no role to "change" — approving it via PATCH
    // /users/:id/approve is the dedicated path, and letting this route also
    // assign a role would leave accountStatus stuck at PENDING with a role
    // already set, a state approve/reject never produce and shouldn't have to
    // reason about.
    if (user.accountStatus === 'PENDING') {
      return sendProblem(
        reply,
        409,
        'Not active',
        'This account is still awaiting approval. Approve it instead of changing its role.',
      );
    }

    const oversight = normalizeOversightFlags(body.data.role, body.data);

    // "No change" covers role AND, for OVERSIGHT, the two flags — this route
    // doubles as how an administrator adjusts an existing OVERSIGHT account's
    // grants without changing its role, and a role-only comparison would
    // reject that as a false no-op.
    const roleUnchanged = user.role === body.data.role;
    const flagsUnchanged =
      user.canViewMeetings === oversight.canViewMeetings
      && user.canViewAuditTrail === oversight.canViewAuditTrail;
    if (roleUnchanged && (user.role !== 'OVERSIGHT' || flagsUnchanged)) {
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
        data: {
          role: body.data.role,
          canViewMeetings: oversight.canViewMeetings,
          canViewAuditTrail: oversight.canViewAuditTrail,
        },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'user.role.changed',
        entityType: 'User',
        entityId: user.id,
        payload: {
          email: user.email,
          from: user.role,
          to: body.data.role,
          canViewMeetings: oversight.canViewMeetings,
          canViewAuditTrail: oversight.canViewAuditTrail,
        },
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
      canViewMeetings: updated.canViewMeetings,
      canViewAuditTrail: updated.canViewAuditTrail,
      // body.data.role, not updated.role: they're equal at runtime (we just
      // set it), but body.data.role is the non-null value zod already
      // validated, and the PENDING guard above is what makes that equality
      // hold — updated.role stays typed Role | null at the schema level.
      capabilities: capabilitiesOf({ role: body.data.role, ...oversight }),
    });
  });

  /**
   * Revokes or restores access. Never deletes.
   *
   * A deactivated user keeps every row that names them — their approvals, their
   * Shariah rulings, their audit entries. Deletion would orphan all of it, and an
   * audit trail that cannot say who did something is not an audit trail.
   */
  app.patch<{ Params: { id: string } }>('/users/:id/active', writeGate, async (request, reply) => {
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
      canViewMeetings: updated.canViewMeetings,
      canViewAuditTrail: updated.canViewAuditTrail,
      // Role is untouched by this route, so a still-PENDING row (role null)
      // is possible here in principle — same null-tolerant treatment as
      // GET /users, rather than assuming this route only ever sees active
      // accounts.
      capabilities:
        updated.role === null
          ? []
          : capabilitiesOf({
              role: updated.role,
              canViewMeetings: updated.canViewMeetings,
              canViewAuditTrail: updated.canViewAuditTrail,
            }),
    });
  });

  /**
   * Grants a role and activates a self-registered account in one step. A
   * PENDING row has no role and no capability, so it cannot yet be referenced
   * by anything else in the system — this is the only route that turns one
   * into a normal, sign-in-able User.
   */
  app.patch<{ Params: { id: string } }>('/users/:id/approve', writeGate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const body = ApproveBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(reply, 400, 'Invalid request', 'A valid role is required.');
    }

    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (target === null) {
      return sendProblem(reply, 404, 'Not found', 'No user exists with that id.');
    }
    if (target.accountStatus !== 'PENDING') {
      return sendProblem(
        reply,
        409,
        'Not pending',
        'This account is not awaiting approval.',
      );
    }

    const oversight = normalizeOversightFlags(body.data.role, body.data);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          role: body.data.role,
          accountStatus: 'ACTIVE',
          canViewMeetings: oversight.canViewMeetings,
          canViewAuditTrail: oversight.canViewAuditTrail,
        },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'user.approved',
        entityType: 'User',
        entityId: target.id,
        payload: {
          role: body.data.role,
          canViewMeetings: oversight.canViewMeetings,
          canViewAuditTrail: oversight.canViewAuditTrail,
        },
      });
    });

    return reply.status(200).send({ ok: true });
  });

  /**
   * Deletes a still-PENDING registration — the one entity in this system that
   * a hard delete is safe for, because nothing else can yet reference it (no
   * role, no capability, no session ever issued). The audit entry snapshots
   * every submitted field first, since after the delete it is the only
   * surviving record of the submission.
   */
  app.patch<{ Params: { id: string } }>('/users/:id/reject', writeGate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const target = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (target === null) {
      return sendProblem(reply, 404, 'Not found', 'No user exists with that id.');
    }
    if (target.accountStatus !== 'PENDING') {
      return sendProblem(
        reply,
        409,
        'Not pending',
        'This account is not awaiting approval.',
      );
    }

    await prisma.$transaction(async (tx) => {
      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'user.registration.rejected',
        entityType: 'User',
        entityId: target.id,
        payload: {
          displayName: target.displayName,
          email: target.email,
          username: target.username,
          staffId: target.staffId,
        },
      });

      await tx.user.delete({ where: { id: target.id } });
    });

    return reply.status(200).send({ ok: true });
  });
}
