import { describe, expect, it } from 'vitest';
import { computeParticipation, participationNudge } from '../../src/lib/participation';

describe('computeParticipation', () => {
  it('returns nothing for a transcript with no segments', () => {
    expect(computeParticipation([])).toEqual([]);
  });

  it('sums a speaker split across multiple segments, and sorts by share descending', () => {
    const shares = computeParticipation([
      { speakerLabel: 'A', startMs: 0, endMs: 6_000 },
      { speakerLabel: 'B', startMs: 6_000, endMs: 8_000 },
      { speakerLabel: 'C', startMs: 8_000, endMs: 9_000 },
      { speakerLabel: 'C', startMs: 9_000, endMs: 9_500 },
    ]);

    expect(shares.map((s) => s.speakerLabel)).toEqual(['A', 'B', 'C']);
    expect(shares[0]!.totalMs).toBe(6_000);
    expect(shares[0]!.share).toBeCloseTo(6_000 / 9_500, 5);
    expect(shares[2]!.totalMs).toBe(1_500);
    expect(shares[2]!.share).toBeCloseTo(1_500 / 9_500, 5);
  });

  /**
   * A three-speaker meeting where the quietest speaker sits just under half
   * of an even three-way split (16.7%) and the next-quietest sits just over
   * it — proving the threshold is the exact fraction, not a rounded guess.
   */
  it('flags a speaker under half of an even split as quiet, and no one else', () => {
    const shares = computeParticipation([
      { speakerLabel: 'A', startMs: 0, endMs: 6_000 },
      { speakerLabel: 'B', startMs: 6_000, endMs: 8_000 },
      { speakerLabel: 'C', startMs: 8_000, endMs: 9_500 },
    ]);

    const byLabel = Object.fromEntries(shares.map((s) => [s.speakerLabel, s]));
    expect(byLabel.A!.quiet).toBe(false);
    expect(byLabel.B!.quiet).toBe(false);
    expect(byLabel.C!.quiet).toBe(true);
  });

  it('never flags the only speaker in a solo recording', () => {
    const [solo] = computeParticipation([{ speakerLabel: 'A', startMs: 0, endMs: 1_000 }]);
    expect(solo!.quiet).toBe(false);
    expect(solo!.share).toBe(1);
  });

  it('does not flag either speaker in an even two-way split', () => {
    const shares = computeParticipation([
      { speakerLabel: 'A', startMs: 0, endMs: 5_000 },
      { speakerLabel: 'B', startMs: 5_000, endMs: 10_000 },
    ]);
    expect(shares.every((s) => !s.quiet)).toBe(true);
  });

  /** Every segment has zero duration, so there is no meeting length to divide by. */
  it('reports a zero share instead of NaN when every segment is zero-length', () => {
    const shares = computeParticipation([{ speakerLabel: 'A', startMs: 0, endMs: 0 }]);
    expect(shares[0]!.share).toBe(0);
    expect(Number.isNaN(shares[0]!.share)).toBe(false);
  });
});

describe('participationNudge', () => {
  it('returns null for a speaker who was not quiet', () => {
    const [speaker] = computeParticipation([{ speakerLabel: 'A', startMs: 0, endMs: 1_000 }]);
    expect(participationNudge(speaker!)).toBeNull();
  });

  it('names the speaker and their share for a quiet speaker', () => {
    const shares = computeParticipation([
      { speakerLabel: 'Credit Officer', startMs: 0, endMs: 9_500 },
      { speakerLabel: 'Shariah Officer', startMs: 9_500, endMs: 10_000 },
    ]);
    const quiet = shares.find((s) => s.speakerLabel === 'Shariah Officer')!;

    expect(quiet.quiet).toBe(true);
    expect(participationNudge(quiet)).toBe(
      'Shariah Officer spoke 5% of the time; consider inviting their input.',
    );
  });
});
