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
 * The payload carries the subject and role and nothing else. A JWT body is
 * readable by anyone holding the token, so it is not a place for anything the
 * bearer should not see.
 */

const ALGORITHM = 'HS256';
const ACCESS_AUDIENCE = 'fintalk:access';
const REFRESH_AUDIENCE = 'fintalk:refresh';
const MIN_SECRET_LENGTH = 32;

export interface TokenSubject {
  readonly sub: string;
  readonly role: Role;
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
  return new SignJWT({ role: subject.role })
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

  const { sub, role, aud, exp, iat } = payload;
  if (typeof sub !== 'string' || typeof role !== 'string') {
    throw new Error('token payload is missing sub or role');
  }
  if (typeof aud !== 'string' || typeof exp !== 'number' || typeof iat !== 'number') {
    throw new Error('token payload is missing standard claims');
  }

  return { sub, role: role as Role, aud, exp, iat };
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
