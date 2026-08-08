import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/auth/password.js';

const PASSWORD = 'Demo!2345';

describe('hashPassword', () => {
  it('never returns the password itself', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
  });

  it('produces an argon2id hash', async () => {
    expect(await hashPassword(PASSWORD)).toMatch(/^\$argon2id\$/);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, 'Demo!2346')).toBe(false);
  });

  it('rejects an empty password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  /**
   * A malformed stored hash must read as "does not match", not as an exception
   * a caller might treat as transient and retry past.
   */
  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
    expect(await verifyPassword('', PASSWORD)).toBe(false);
  });
});
