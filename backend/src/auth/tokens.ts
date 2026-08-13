import type { Role } from '@prisma/client';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Session tokens.
 *
 * Access and refresh tokens are separated two ways: each is signed with its own
 * secret, and each carries a distinct audience claim that its verifier
 * requires. Either separation alone would do; both together mean a
 * misconfiguration that reuses one secret still cannot turn a seven-day refresh
 * token into an access token.
 *
 * The payload carries the subject, role, and the two OVERSIGHT grant flags —
 * canViewMeetings and canViewAuditTrail — and nothing else. Every other role
 * ignores the two flags (see capabilitiesOf in auth/rbac.ts); they ride along
 * for all roles rather than being conditionally included, so the payload shape
 * never depends on what role signed it. A JWT body is readable by anyone
 * holding the token, so it is not a place for anything the bearer should not
 * see — a boolean the bearer already knows about their own account is fine.
 *
 * Like role, these two flags are trusted for the token's TTL once issued.
 * A grant revoked mid-session takes effect on next refresh, when the refresh
 * route re-reads the User row rather than trusting the old token's claims —
 * the same staleness window role changes already accept.
 */

const ALGORITHM = 'HS256';
const ACCESS_AUDIENCE = 'fintalk:access';
const REFRESH_AUDIENCE = 'fintalk:refresh';
const MIN_SECRET_LENGTH = 32;

export interface TokenSubject {
  readonly sub: string;
  readonly role: Role;
  readonly canViewMeetings: boolean;
  readonly canViewAuditTrail: boolean;
}

export interface TokenPayload extends TokenSubject {
  readonly aud: string;
  readonly exp: number;
  readonly iat: number;
}

function keyFrom(secret: string): Uint8Array {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT secret must be at least ${String(MIN_SECRET_LENGTH)} characters`);
  }
  return new TextEncoder().encode(secret);
}

// `async` is deliberate: keyFrom throws on a short secret, and a function
// typed Promise<string> must surface that as a rejection. A synchronous throw
// from an async-looking API slips past every caller using .catch().
async function sign(
  subject: TokenSubject,
  secret: string,
  ttl: string,
  audience: string,
): Promise<string> {
  return new SignJWT({
    role: subject.role,
    canViewMeetings: subject.canViewMeetings,
    canViewAuditTrail: subject.canViewAuditTrail,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(subject.sub)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(keyFrom(secret));
}

async function verify(
  token: string,
  secret: string,
  audience: string,
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, keyFrom(secret), {
    algorithms: [ALGORITHM],
    audience,
  });

  const { sub, role, canViewMeetings, canViewAuditTrail, aud, exp, iat } = payload;
  if (typeof sub !== 'string' || typeof role !== 'string') {
    throw new Error('token payload is missing sub or role');
  }
  if (typeof canViewMeetings !== 'boolean' || typeof canViewAuditTrail !== 'boolean') {
    throw new Error('token payload is missing canViewMeetings or canViewAuditTrail');
  }
  if (typeof aud !== 'string' || typeof exp !== 'number' || typeof iat !== 'number') {
    throw new Error('token payload is missing standard claims');
  }

  return { sub, role: role as Role, canViewMeetings, canViewAuditTrail, aud, exp, iat };
}

export function signAccessToken(
  subject: TokenSubject,
  secret: string,
  ttl: string,
): Promise<string> {
  return sign(subject, secret, ttl, ACCESS_AUDIENCE);
}

export function signRefreshToken(
  subject: TokenSubject,
  secret: string,
  ttl: string,
): Promise<string> {
  return sign(subject, secret, ttl, REFRESH_AUDIENCE);
}

export function verifyAccessToken(token: string, secret: string): Promise<TokenPayload> {
  return verify(token, secret, ACCESS_AUDIENCE);
}

export function verifyRefreshToken(token: string, secret: string): Promise<TokenPayload> {
  return verify(token, secret, REFRESH_AUDIENCE);
}
