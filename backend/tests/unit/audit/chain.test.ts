import { describe, expect, it } from 'vitest';
import { canonicalJson, entryHash, GENESIS_HASH } from '../../../src/audit/chain.js';

const BASE = {
  at: new Date('2026-08-07T02:30:00.000Z'),
  actorId: 'user_1',
  actorRole: 'MAKER' as const,
  action: 'meeting.uploaded',
  entityType: 'Meeting',
  entityId: 'm_1',
  payload: { segmentCount: 6 },
};

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } }))
      .toBe(canonicalJson({ outer: { a: 2, z: 1 } }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('drops undefined so an absent key and an undefined one agree', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  /** Money is BigInt. JSON.stringify throws on it, so it must be handled. */
  it('serialises a BigInt rather than throwing', () => {
    expect(canonicalJson({ principalMinor: 5_000_000n }))
      .toBe('{"principalMinor":"5000000"}');
  });
});

describe('entryHash', () => {
  it('is deterministic', () => {
    expect(entryHash(GENESIS_HASH, BASE)).toBe(entryHash(GENESIS_HASH, BASE));
  });

  it('returns a sha256 hex digest', () => {
    expect(entryHash(GENESIS_HASH, BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['action', { action: 'meeting.deleted' }],
    ['actorId', { actorId: 'user_2' }],
    ['actorRole', { actorRole: 'ADMIN' as const }],
    ['entityId', { entityId: 'm_2' }],
    ['entityType', { entityType: 'TermSheet' }],
    ['payload', { payload: { segmentCount: 7 } }],
    ['at', { at: new Date('2026-08-07T02:30:01.000Z') }],
  ])('changes when %s changes', (_field, override) => {
    expect(entryHash(GENESIS_HASH, { ...BASE, ...override }))
      .not.toBe(entryHash(GENESIS_HASH, BASE));
  });

  it('changes when the predecessor changes, which is what links the chain', () => {
    expect(entryHash('abc', BASE)).not.toBe(entryHash('abd', BASE));
  });

  it('is unaffected by payload key order', () => {
    const a = { ...BASE, payload: { x: 1, y: 2 } };
    const b = { ...BASE, payload: { y: 2, x: 1 } };
    expect(entryHash(GENESIS_HASH, a)).toBe(entryHash(GENESIS_HASH, b));
  });

  /**
   * Without a separator between the previous hash and the body, shifting a
   * character across the boundary would leave the digest unchanged, and a row
   * could be rewritten while keeping its hash.
   */
  it('separates the previous hash from the body unambiguously', () => {
    expect(entryHash('ab', BASE)).not.toBe(entryHash('a', BASE));
    expect(entryHash('a b', BASE)).not.toBe(entryHash('a', { ...BASE, actorId: 'b' }));
  });
});
