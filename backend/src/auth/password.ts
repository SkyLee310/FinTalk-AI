import argon2 from 'argon2';

/**
 * Password hashing.
 *
 * argon2id is the variant recommended for password storage: it resists both GPU
 * and side-channel attack, unlike argon2i or argon2d alone. The library
 * generates and embeds a per-hash salt, so callers never handle one.
 */

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/**
 * Returns false rather than throwing when the stored hash is unreadable.
 *
 * A corrupted or empty hash column means "this credential cannot be verified",
 * which is a failed login. Throwing would let a caller mistake it for a
 * transient fault and treat a retry as more likely to succeed.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
