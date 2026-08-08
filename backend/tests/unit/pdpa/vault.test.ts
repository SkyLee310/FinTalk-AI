import { describe, expect, it } from 'vitest';
import { open, seal, vaultKeyFromBase64 } from '../../../src/pdpa/vault.js';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

describe('vaultKeyFromBase64', () => {
  it('accepts exactly 32 bytes', () => {
    expect(vaultKeyFromBase64(KEY.toString('base64'))).toEqual(KEY);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => vaultKeyFromBase64(Buffer.alloc(16).toString('base64')))
      .toThrow(/32 bytes/);
  });
});

describe('seal / open', () => {
  it('round-trips a value', () => {
    const sealed = seal('880101-14-5678', KEY);
    expect(open(sealed, KEY)).toBe('880101-14-5678');
  });

  it('never leaves the plaintext recoverable from the ciphertext alone', () => {
    const sealed = seal('880101-14-5678', KEY);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('880101');
    expect(sealed.ciphertext.toString('base64')).not.toContain('880101');
  });

  it('produces a distinct iv and ciphertext each time', () => {
    const a = seal('880101-14-5678', KEY);
    const b = seal('880101-14-5678', KEY);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('uses a 12-byte iv and a 16-byte auth tag', () => {
    const sealed = seal('x', KEY);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
  });

  it('refuses to open a tampered ciphertext', () => {
    const sealed = seal('880101-14-5678', KEY);
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => open({ ...sealed, ciphertext: tampered }, KEY)).toThrow();
  });

  it('refuses to open a tampered auth tag', () => {
    const sealed = seal('880101-14-5678', KEY);
    const tampered = Buffer.from(sealed.authTag);
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => open({ ...sealed, authTag: tampered }, KEY)).toThrow();
  });

  it('refuses to open under the wrong key', () => {
    const sealed = seal('880101-14-5678', KEY);
    expect(() => open(sealed, OTHER_KEY)).toThrow();
  });

  it('round-trips non-ASCII text', () => {
    const sealed = seal('Encik Ahmad — Jalan Ampang, 50450', KEY);
    expect(open(sealed, KEY)).toBe('Encik Ahmad — Jalan Ampang, 50450');
  });
});
