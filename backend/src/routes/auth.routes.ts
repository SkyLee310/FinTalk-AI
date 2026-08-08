import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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

    const env = getEnv();
    const subject = { sub: user.id, role: user.role };
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
        capabilities: capabilitiesOf(user.role),
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

    return reply.send({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      capabilities: capabilitiesOf(user.role),
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

      const access = await signAccessToken(
        { sub: user.id, role: user.role },
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
