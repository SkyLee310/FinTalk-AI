import { describe, expect, it } from 'vitest';
import { keywordQuery, rankByKeyword } from '../../../src/knowledge/keyword.js';

/**
 * Keyword retrieval is the fallback that keeps Ask FinTalk AI usable when no
 * embedding model is configured, and the only way a meeting transcribed
 * before embeddings existed can be retrieved at all.
 *
 * It scores over `Transcript.rawRedacted`, so every case below uses
 * already-redacted text — placeholders and all.
 */

const MURABAHAH = {
  meetingId: 'm1',
  text: 'The committee discussed Murabahah pricing for [PERSON_NAME_1] and the '
    + 'markup on the asset purchase.',
};

const PENALTY = {
  meetingId: 'm2',
  text: 'Late payment penalties were raised. Ta widh is compensation for actual loss.',
};

const UNRELATED = {
  meetingId: 'm3',
  text: 'Branch renovation budget and the car park lease.',
};

const CORPUS = [MURABAHAH, PENALTY, UNRELATED];

describe('rankByKeyword', () => {
  it('returns nothing for a query with no usable terms', () => {
    // Every token is a stopword or under three characters, so there is
    // nothing to match on — and matching everything would be worse.
    expect(rankByKeyword('is it the a', CORPUS, 5)).toEqual([]);
  });

  it('ranks a meeting whose text carries the query term', () => {
    const ranked = rankByKeyword('Murabahah pricing', CORPUS, 5);
    expect(ranked.map((r) => r.meetingId)).toEqual(['m1']);
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it('orders by how many distinct query terms matched', () => {
    // "penalties compensation" hits m2 twice; "Murabahah" hits m1 once.
    const ranked = rankByKeyword('penalties compensation Murabahah', CORPUS, 5);
    expect(ranked.map((r) => r.meetingId)).toEqual(['m2', 'm1']);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('never matches on a redaction placeholder', () => {
    /**
     * The same reasoning that keeps placeholders out of the graph: redaction
     * contexts are per-meeting, so [PERSON_NAME_1] here and in another
     * transcript are different people. Matching one would assert a
     * relationship that does not exist.
     */
    expect(rankByKeyword('[PERSON_NAME_1]', CORPUS, 5)).toEqual([]);
    expect(rankByKeyword('PERSON_NAME_1', CORPUS, 5)).toEqual([]);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(rankByKeyword('MURABAHAH, pricing!', CORPUS, 5).map((r) => r.meetingId))
      .toEqual(['m1']);
  });

  it('respects the limit', () => {
    const ranked = rankByKeyword('discussed penalties', CORPUS, 1);
    expect(ranked).toHaveLength(1);
  });

  it('scores a single-term query that matches one meeting as a full hit', () => {
    expect(rankByKeyword('renovation', CORPUS, 5)).toEqual([{ meetingId: 'm3', score: 1 }]);
  });
});

describe('keywordQuery', () => {
  it('returns the question unchanged when there is no history', () => {
    expect(keywordQuery('Murabahah pricing', undefined)).toBe('Murabahah pricing');
    expect(keywordQuery('Murabahah pricing', [])).toBe('Murabahah pricing');
  });

  it('keeps earlier questions, so a follow-up inherits their topic', () => {
    const query = keywordQuery('What about the penalties?', [
      { role: 'user', content: 'Which meetings discussed Murabahah pricing?' },
      { role: 'assistant', content: 'The committee reviewed the markup.' },
    ]);

    expect(query).toContain('Murabahah');
    expect(query).toContain('penalties');
  });

  it('drops the assistant turns', () => {
    /**
     * The composite `withHistory` builds is written for a language model and
     * carries the assistant's own prose. Term overlap cannot discount that, so
     * including it would rank meetings by how much they echo the previous
     * answer rather than by what was just asked — and the effect compounds
     * with every turn.
     */
    const query = keywordQuery('What about the penalties?', [
      { role: 'assistant', content: 'Ta widh is compensation for actual loss.' },
    ]);

    expect(query).not.toContain('compensation');
    expect(query).toBe('What about the penalties?');
  });

  it('adds no framing words of its own', () => {
    // "Earlier in this conversation" and friends are terms too, and every one
    // of them dilutes the score of the terms that actually came from a person.
    const query = keywordQuery('penalties', [{ role: 'user', content: 'Murabahah' }]);

    expect(query.toLowerCase()).not.toContain('conversation');
    expect(query.toLowerCase()).not.toContain('assistant');
    expect(query).toBe('Murabahah penalties');
  });
});
