import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../../../src/auth/tokens.js';

const ACCESS_SECRET = 'a'.repeat(32);
const REFRESH_SECRET = 'b'.repeat(32);
const SUBJECT = {
  sub: 'user_123',
  role: 'MAKER',
  canViewMeetings: false,
  canViewAuditTrail: false,
} as const;

afterEach(() => { vi.useRealTimers(); });

describe('access tokens', () => {
  it('round-trips the subject and role', async () => {
    const token = await signAccessToken(SUBJECT, ACCESS_SECRET, '15m');
    const payload = await verifyAccessToken(token, ACCESS_SECRET);
    expect(payload.sub).toBe('user_123');
    expect(payload.role).toBe('MAKER');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(SUBJECT, ACCESS_SECRET, '15m');
    await expect(verifyAccessToken(token, REFRESH_SECRET)).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    const token = await signAccessToken(SUBJECT, ACCESS_SECRET, '15m');
    const [header, , signature] = token.split('.');
    const forgedBody = Buffer.from('{"sub":"user_999","role":"ADMIN"}').toString('base64url');
    await expect(
      verifyAccessToken(`${header!}.${forgedBody}.${signature!}`, ACCESS_SECRET),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken(SUBJECT, ACCESS_SECRET, '1s');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);
    await expect(verifyAccessToken(token, ACCESS_SECRET)).rejects.toThrow();
  });
});

/**
 * The two kinds are separated by audience as well as secret. A refresh token
 * accepted as an access token would grant a seven-day session to an endpoint
 * that expects a fifteen-minute one.
 */
describe('token kinds are not interchangeable', () => {
  it('will not verify a refresh token as an access token', async () => {
    const refresh = await signRefreshToken(SUBJECT, REFRESH_SECRET, '7d');
    await expect(verifyAccessToken(refresh, REFRESH_SECRET)).rejects.toThrow();
  });

  it('will not verify an access token as a refresh token', async () => {
    const access = await signAccessToken(SUBJECT, ACCESS_SECRET, '15m');
    await expect(verifyRefreshToken(access, ACCESS_SECRET)).rejects.toThrow();
  });

  it('round-trips a refresh token under its own verifier', async () => {
    const refresh = await signRefreshToken(SUBJECT, REFRESH_SECRET, '7d');
    expect((await verifyRefreshToken(refresh, REFRESH_SECRET)).sub).toBe('user_123');
  });
});

describe('payload hygiene', () => {
  it('carries no field beyond sub, role, the two oversight flags and the standard claims', async () => {
    const token = await signAccessToken(SUBJECT, ACCESS_SECRET, '15m');
    const body = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'aud',
      'canViewAuditTrail',
      'canViewMeetings',
      'exp',
      'iat',
      'role',
      'sub',
    ]);
  });

  it('rejects a secret shorter than 32 characters', async () => {
    await expect(signAccessToken(SUBJECT, 'short', '15m')).rejects.toThrow(/32/);
  });
});
