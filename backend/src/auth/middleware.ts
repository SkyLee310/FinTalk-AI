import type { Role } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getEnv } from '../config/env.js';
import { sendProblem } from '../http/problem.js';
import { type Capability, can } from './rbac.js';
import { verifyAccessToken } from './tokens.js';

export const ACCESS_COOKIE = 'fintalk_access';
export const REFRESH_COOKIE = 'fintalk_refresh';

export interface AuthenticatedUser {
  readonly id: string;
  readonly role: Role;
  readonly canViewMeetings: boolean;
  readonly canViewAuditTrail: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

/**
 * Establishes identity from the access cookie.
 *
 * Sending a reply from a preHandler short-circuits the route, so an
 * unauthenticated request never reaches a handler. The failure detail is
 * identical for a missing and an invalid token: distinguishing them would tell
 * an attacker whether a token was ever valid.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[ACCESS_COOKIE];
  if (token === undefined || token === '') {
    await sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    return;
  }

  try {
    const payload = await verifyAccessToken(token, getEnv().JWT_ACCESS_SECRET);
    request.authUser = {
      id: payload.sub,
      role: payload.role,
      canViewMeetings: payload.canViewMeetings,
      canViewAuditTrail: payload.canViewAuditTrail,
    };
  } catch {
    await sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
  }
}

/**
 * Gates a route on one capability. Runs after requireAuth, and denies when
 * identity is absent rather than assuming the earlier hook ran.
 */
export function requireCapability(capability: Capability) {
  return async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const user = request.authUser;
    if (user === undefined) {
      await sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      return;
    }

    if (!can(user, capability)) {
      await sendProblem(
        reply,
        403,
        'Forbidden',
        `The ${user.role} role does not hold ${capability}.`,
      );
    }
  };
}

/**
 * Cookie attributes.
 *
 * sameSite is 'none' in production because the frontend is served from Vercel
 * and this API from Railway — a cross-site pair, where 'lax' would withhold the
 * cookie on every fetch. 'none' requires Secure, which production has and local
 * http does not, so development uses 'lax'.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  const isProduction = getEnv().NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

const TTL_UNITS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
};

/** Converts a JWT-style TTL such as "15m" into seconds for a cookie maxAge. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (match === null) {
    throw new Error(`Unsupported TTL format: ${ttl}. Expected a value like "15m".`);
  }
  return Number(match[1]) * TTL_UNITS[match[2]!]!;
}
