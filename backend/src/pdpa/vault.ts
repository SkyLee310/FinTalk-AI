import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM sealing for the personal-data vault.
 *
 * GCM is authenticated, so a tampered ciphertext or auth tag fails to open
 * rather than returning plausible garbage. There is deliberately no function
 * that returns a value without verifying its tag.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface SealedValue {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
}

/** Exported so callers can fail before doing partial work. */
export function assertVaultKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PII vault key must be exactly 32 bytes, received ${String(key.length)}`,
    );
  }
}

/** Decodes and validates PII_VAULT_KEY. Throws rather than padding a short key. */
export function vaultKeyFromBase64(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  assertVaultKey(key);
  return key;
}

export function seal(plaintext: string, key: Buffer): SealedValue {
  assertVaultKey(key);
  // A fresh IV per value: reusing one under the same key would leak equality
  // between records, which for identifiers is most of the secret.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function open(sealed: SealedValue, key: Buffer): string {
  assertVaultKey(key);
  const decipher = createDecipheriv(ALGORITHM, key, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([
    decipher.update(sealed.ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
