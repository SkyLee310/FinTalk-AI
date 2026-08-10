import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  isStorableTopicLabel,
  rankBySimilarity,
} from '../../../src/knowledge/graph.js';

/**
 * The graph's arithmetic, and the guard that keeps people out of it.
 *
 * `isStorableTopicLabel` is the load-bearing one. Redaction contexts are
 * per-meeting, so [NRIC_1] refers to a different person in every meeting — a
 * placeholder that became a topic node would link records having nothing to do with
 * each other, asserting a relationship rather than merely over-sharing.
 */

describe('isStorableTopicLabel', () => {
  it('accepts an ordinary topic', () => {
    expect(isStorableTopicLabel('murabahah')).toBe(true);
    expect(isStorableTopicLabel('working capital')).toBe(true);
    expect(isStorableTopicLabel('late payment penalty')).toBe(true);
  });

  it('rejects every redaction placeholder the redactor can mint', () => {
    for (const type of [
      'NRIC',
      'BANK_ACCOUNT',
      'PHONE',
      'EMAIL',
      'PERSON_NAME',
      'ADDRESS',
      'CARD',
    ]) {
      expect(isStorableTopicLabel(`[${type}_1]`)).toBe(false);
      expect(isStorableTopicLabel(`[${type}_12]`)).toBe(false);
    }
  });

  it('rejects a placeholder embedded in a longer label', () => {
    // A model asked for topics can return a phrase rather than a bare token.
    expect(isStorableTopicLabel('facility for [NRIC_1]')).toBe(false);
    expect(isStorableTopicLabel('[PERSON_NAME_2] guarantee')).toBe(false);
  });

  /**
   * A model can invent a bracketed token this codebase never mints. It must not
   * become a node either — the shape is what makes it unsafe, not the type name.
   */
  it('rejects a bracketed token of an unknown type', () => {
    expect(isStorableTopicLabel('[CUSTOMER_1]')).toBe(false);
    expect(isStorableTopicLabel('[redacted]')).toBe(false);
  });

  it('rejects blank and oversized labels', () => {
    expect(isStorableTopicLabel('')).toBe(false);
    expect(isStorableTopicLabel('   ')).toBe(false);
    expect(isStorableTopicLabel('x'.repeat(61))).toBe(false);
    expect(isStorableTopicLabel('x'.repeat(60))).toBe(true);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('ignores magnitude', () => {
    expect(cosineSimilarity([1, 1], [10, 10])).toBeCloseTo(1);
  });

  /**
   * A transcript embedded by an older model has a different dimensionality. That is
   * a reason to skip the pair, not to fail the whole graph — so this returns 0
   * rather than throwing.
   */
  it('returns 0 for mismatched dimensions rather than throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 for empty or zero vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('never returns NaN', () => {
    const pairs: readonly (readonly [readonly number[], readonly number[]])[] = [
      [[0, 0], [0, 0]],
      [[], [1]],
      [[1], []],
    ];
    for (const [a, b] of pairs) {
      expect(Number.isNaN(cosineSimilarity(a, b))).toBe(false);
    }
  });
});

describe('rankBySimilarity', () => {
  const candidates = [
    { meetingId: 'far', embedding: [0, 1] },
    { meetingId: 'exact', embedding: [1, 0] },
    { meetingId: 'near', embedding: [0.9, 0.1] },
  ];

  it('orders by descending similarity', () => {
    const ranked = rankBySimilarity([1, 0], candidates, 3);
    expect(ranked.map((r) => r.meetingId)).toEqual(['exact', 'near']);
  });

  it('respects the limit', () => {
    expect(rankBySimilarity([1, 0], candidates, 1)).toHaveLength(1);
  });

  /**
   * An unembedded transcript is an unknown match rather than a poor one, so it is
   * excluded instead of being included at an invented score.
   */
  it('excludes candidates with no embedding', () => {
    const ranked = rankBySimilarity(
      [1, 0],
      [
        { meetingId: 'unembedded', embedding: [] },
        { meetingId: 'embedded', embedding: [1, 0] },
      ],
      5,
    );

    expect(ranked.map((r) => r.meetingId)).toEqual(['embedded']);
  });

  it('returns nothing when the query itself could not be embedded', () => {
    expect(rankBySimilarity([], candidates, 5)).toHaveLength(0);
  });
});
