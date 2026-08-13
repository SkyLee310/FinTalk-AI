import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditWithin } from '../audit/chain.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  requireAuth,
  sessionCookieOptions,
  ttlToSeconds,
} from '../auth/middleware.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { capabilitiesOf } from '../auth/rbac.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../auth/tokens.js';
import { getEnv } from '../config/env.js';
import { sendProblem } from '../http/problem.js';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterBody = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().email(),
  // 8 is this endpoint's own floor — there is no shared password policy
  // elsewhere in backend/src/ to reuse; login only enforces z.string().min(1).
  password: z.string().min(8).max(200),
  username: z.string().min(3).max(60),
  staffId: z.string().min(1).max(60),
});

/**
 * A password verification runs even when the email is unknown, against a
 * throwaway hash minted on first use. Skipping it would make a miss return
 * measurably faster than a wrong password, turning login into a
 * user-enumeration oracle.
 */
let decoyHash: Promise<string> | undefined;
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return decoyHash;
}

const UNAUTHENTICATED = 'A valid session is required.';

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  // The one public, unauthenticated mutation in this file: no preHandler.
  app.post('/auth/register', async (request, reply) => {
    const body = RegisterBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(
        reply,
        400,
        'Invalid registration',
        body.error.issues[0]?.message ?? 'Invalid input.',
      );
    }

    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findFirst({ where: { email: body.data.email } }),
      prisma.user.findFirst({ where: { username: body.data.username } }),
    ]);
    if (existingEmail !== null) {
      return sendProblem(
        reply,
        409,
        'Email already registered',
        'An account with this email already exists.',
      );
    }
    if (existingUsername !== null) {
      return sendProblem(
        reply,
        409,
        'Username already taken',
        'This username is already in use.',
      );
    }

    const passwordHash = await hashPassword(body.data.password);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName: body.data.displayName,
          email: body.data.email,
          passwordHash,
          username: body.data.username,
          staffId: body.data.staffId,
          role: null,
          accountStatus: 'PENDING',
        },
      });

      // No display name and no password: the same exclusion POST /users
      // already applies to user.created, extended to this public path for
      // the same reason.
      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: null,
        actorRole: null,
        action: 'user.registered',
        entityType: 'User',
        entityId: user.id,
        payload: {
          email: body.data.email,
          username: body.data.username,
          staffId: body.data.staffId,
        },
      });
    });

    return reply.status(201).send({ accountStatus: 'PENDING' });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      return sendProblem(
        reply,
        400,
        'Invalid request',
        'An email address and password are required.',
      );
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });

    const matches =
      user === null
        ? await verifyPassword(await decoy(), password)
        : await verifyPassword(user.passwordHash, password);

    // One message for both causes. Saying which was wrong reveals whether the
    // address is registered.
    if (user === null || !matches) {
      return sendProblem(
        reply,
        401,
        'Invalid credentials',
        'That email address and password combination was not recognised.',
      );
    }

    /**
     * A deactivated account cannot sign in.
     *
     * Checked *after* the password comparison, deliberately. Refusing earlier
     * would answer faster for a deactivated account than for a wrong password,
     * and that timing difference reveals which addresses are registered — the
     * same leak the shared message above exists to prevent.
     *
     * This is what makes deactivation real rather than decorative: without it an
     * administrator could revoke access in the UI while the revoked user carried
     * on logging in. A user deactivated mid-session still holds a valid access
     * token until it expires, which the 15-minute default TTL bounds.
     */
    if (user.deactivatedAt !== null) {
      return sendProblem(
        reply,
        403,
        'Account deactivated',
        'This account has been deactivated. Contact an administrator.',
      );
    }

    // Same placement as the deactivated check, for the same reason: it runs
    // after password verification so it cannot become a timing oracle for
    // account existence. Unlike a wrong password, this state is safe to
    // name — the person needs to know they are waiting on an admin, not
    // retrying their password.
    if (user.accountStatus === 'PENDING') {
      return sendProblem(
        reply,
        403,
        'Awaiting approval',
        'Your account is awaiting administrator approval.',
      );
    }

    // Structurally unreachable: PENDING is refused above, and every other
    // path assigns a role before flipping accountStatus to ACTIVE (see
    // PATCH /users/:id/approve). This exists purely to satisfy TypeScript's
    // Role | null narrowing.
    if (user.role === null) {
      return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
    }

    if (user.role === 'VIEWER' || user.role === 'SUPERVISOR') {
      return sendProblem(
        reply,
        403,
        'Role retired',
        'The Viewer and Supervisor roles have been retired. Contact an administrator to migrate your account to the Oversight role.',
      );
    }

    const env = getEnv();
    const subject = {
      sub: user.id,
      role: user.role,
      canViewMeetings: user.canViewMeetings,
      canViewAuditTrail: user.canViewAuditTrail,
    };
    const [access, refresh] = await Promise.all([
      signAccessToken(subject, env.JWT_ACCESS_SECRET, env.JWT_ACCESS_TTL),
      signRefreshToken(subject, env.JWT_REFRESH_SECRET, env.JWT_REFRESH_TTL),
    ]);

    return reply
      .setCookie(
        ACCESS_COOKIE,
        access,
        sessionCookieOptions(ttlToSeconds(env.JWT_ACCESS_TTL)),
      )
      .setCookie(
        REFRESH_COOKIE,
        refresh,
        sessionCookieOptions(ttlToSeconds(env.JWT_REFRESH_TTL)),
      )
      .send({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        capabilities: capabilitiesOf({
          role: user.role,
          canViewMeetings: user.canViewMeetings,
          canViewAuditTrail: user.canViewAuditTrail,
        }),
      });
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const authUser = request.authUser;
    if (authUser === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
    }

    const user = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (user === null) {
      // Well-formed token whose subject no longer exists.
      return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
    }

    // Structurally unreachable: a PENDING account is never issued a token to
    // present here. Present purely to satisfy TypeScript's Role | null
    // narrowing.
    if (user.role === null) {
      return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
    }

    return reply.send({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      capabilities: capabilitiesOf({
        role: user.role,
        canViewMeetings: user.canViewMeetings,
        canViewAuditTrail: user.canViewAuditTrail,
      }),
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token === undefined || token === '') {
      return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
    }

    const env = getEnv();
    try {
      const payload = await verifyRefreshToken(token, env.JWT_REFRESH_SECRET);

      // The role is re-read from the database rather than carried over from the
      // refresh token. A token minted before a demotion must not keep granting
      // the role its holder used to have.
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user === null) {
        return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
      }

      // Structurally unreachable: a PENDING account never holds a refresh
      // token to present here. Present purely to satisfy TypeScript's
      // Role | null narrowing.
      if (user.role === null) {
        return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
      }

      const access = await signAccessToken(
        {
          sub: user.id,
          role: user.role,
          canViewMeetings: user.canViewMeetings,
          canViewAuditTrail: user.canViewAuditTrail,
        },
        env.JWT_ACCESS_SECRET,
        env.JWT_ACCESS_TTL,
      );

      return reply
        .setCookie(
          ACCESS_COOKIE,
          access,
          sessionCookieOptions(ttlToSeconds(env.JWT_ACCESS_TTL)),
        )
        .send({ role: user.role });
    } catch {
      return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
    }
  });

  app.post('/auth/logout', async (_request, reply) => {
    const cleared = { ...sessionCookieOptions(0), maxAge: 0 };
    return reply
      .clearCookie(ACCESS_COOKIE, cleared)
      .clearCookie(REFRESH_COOKIE, cleared)
      .send({ ok: true });
  });
}
