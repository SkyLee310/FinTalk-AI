import { describe, expect, it, vi } from 'vitest';
import { requireCapability, ttlToSeconds } from '../../../src/auth/middleware.js';

/** Minimal stand-ins for the two Fastify objects the guard touches. */
function fakeReply() {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    code(status: number) {
      sent.status = status;
      return reply;
    },
    type() {
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  return { reply, sent };
}

describe('requireCapability', () => {
  it('passes a role that holds the capability', async () => {
    const { reply, sent } = fakeReply();
    const request = { authUser: { id: 'u1', role: 'MAKER' as const } };

    await requireCapability('termsheet:submit')(request as never, reply as never);

    expect(sent.status).toBeUndefined();
  });

  it('answers 403 for a role that does not hold it', async () => {
    const { reply, sent } = fakeReply();
    const request = { authUser: { id: 'u1', role: 'MAKER' as const } };

    await requireCapability('termsheet:approve')(request as never, reply as never);

    expect(sent.status).toBe(403);
  });

  /**
   * The guard must not assume requireAuth ran. A route registered with the
   * capability check but not the auth check would otherwise read an undefined
   * user and fall through as allowed.
   */
  it('answers 401 when no identity was established', async () => {
    const { reply, sent } = fakeReply();

    await requireCapability('meeting:read')({} as never, reply as never);

    expect(sent.status).toBe(401);
  });

  it('denies an administrator the Shariah review capability', async () => {
    const { reply, sent } = fakeReply();
    const request = { authUser: { id: 'admin', role: 'ADMIN' as const } };

    await requireCapability('shariah:review')(request as never, reply as never);

    expect(sent.status).toBe(403);
  });
});

describe('ttlToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7_200],
    ['7d', 604_800],
  ])('converts %s to %i seconds', (ttl, expected) => {
    expect(ttlToSeconds(ttl as string)).toBe(expected);
  });

  it('throws on an unsupported format rather than silently returning zero', () => {
    expect(() => ttlToSeconds('15 minutes')).toThrow(/Unsupported TTL/);
    expect(() => ttlToSeconds('')).toThrow(/Unsupported TTL/);
    expect(() => ttlToSeconds('15w')).toThrow(/Unsupported TTL/);
  });

  it('is not affected by the system clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(ttlToSeconds('15m')).toBe(900);
    vi.useRealTimers();
  });
});
