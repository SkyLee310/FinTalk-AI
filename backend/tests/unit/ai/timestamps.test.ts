import { describe, expect, it } from 'vitest';
import { rescaleSegmentTimestamps } from '../../../src/ai/timestamps.js';

describe('rescaleSegmentTimestamps', () => {
  it('returns an empty array unchanged', () => {
    expect(rescaleSegmentTimestamps([], 60_000)).toEqual([]);
  });

  it('leaves already-monotonic segments alone when no duration was measured', () => {
    const segments = [
      { startMs: 0, endMs: 1000 },
      { startMs: 1000, endMs: 2500 },
    ];
    expect(rescaleSegmentTimestamps(segments, undefined)).toEqual(segments);
  });

  it('leaves timestamps alone when there is no reported gap to redistribute into', () => {
    // Back-to-back segments (no pause reported anywhere) with a 5000ms
    // shortfall against the real duration — there is no gap budget to
    // absorb it, so positions are left as reported rather than invented.
    const segments = [
      { startMs: 0, endMs: 40_000 },
      { startMs: 40_000, endMs: 100_000 },
    ];
    expect(rescaleSegmentTimestamps(segments, 105_000)).toEqual(segments);
  });

  it('falls back to a proportional rescale when reported durations alone exceed the real duration', () => {
    // Reported end 200_000ms ("3:20") against a real 100_000ms ("1:40")
    // recording, and the segments' own durations (185_000ms combined)
    // already don't fit — there is no gap budget to trust, so the whole
    // span is squeezed proportionally instead.
    const segments = [
      { startMs: 0, endMs: 40_000 },
      { startMs: 55_000, endMs: 100_000 },
      { startMs: 100_000, endMs: 200_000 },
    ];
    const rescaled = rescaleSegmentTimestamps(segments, 100_000);
    expect(rescaled).toEqual([
      { startMs: 0, endMs: 20_000 },
      { startMs: 27_500, endMs: 50_000 },
      { startMs: 50_000, endMs: 100_000 },
    ]);
    expect(rescaled.at(-1)!.endMs).toBe(100_000);
  });

  it('stretches a reported gap to absorb the shortfall, keeping each duration exact', () => {
    // Two 1000ms utterances with a reported 500ms gap between them, against
    // a real 4000ms recording — a 2000ms shortfall with only one gap to
    // carry it.
    const segments = [
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_500, endMs: 2_500 },
    ];
    const rescaled = rescaleSegmentTimestamps(segments, 4_000);
    expect(rescaled).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 3_000, endMs: 4_000 },
    ]);
    // Each segment's own reported length survives untouched.
    expect(rescaled[0]!.endMs - rescaled[0]!.startMs).toBe(1_000);
    expect(rescaled[1]!.endMs - rescaled[1]!.startMs).toBe(1_000);
  });

  it('only stretches segments that reported a pause, leaving back-to-back ones touching', () => {
    // Segment 2 follows segment 1 immediately (no gap); segment 3 follows a
    // 500ms gap. The whole 2000ms shortfall lands on that one real gap.
    const segments = [
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 2_500, endMs: 3_500 },
    ];
    const rescaled = rescaleSegmentTimestamps(segments, 5_000);
    expect(rescaled).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 4_000, endMs: 5_000 },
    ]);
  });

  it('clamps a later segment reported to start before an earlier one ends', () => {
    const segments = [
      { startMs: 0, endMs: 5000 },
      // Reported as starting before the previous segment finished.
      { startMs: 3000, endMs: 8000 },
    ];
    const rescaled = rescaleSegmentTimestamps(segments, undefined);
    expect(rescaled[1]!.startMs).toBeGreaterThanOrEqual(rescaled[0]!.endMs);
    expect(rescaled[1]!.endMs).toBeGreaterThanOrEqual(rescaled[1]!.startMs);
  });

  it('does not divide by zero when the reported span is zero-length', () => {
    const segments = [{ startMs: 0, endMs: 0 }];
    const rescaled = rescaleSegmentTimestamps(segments, 60_000);
    expect(rescaled).toEqual([{ startMs: 0, endMs: 0 }]);
  });

  it('preserves every other field on the segment', () => {
    const segments = [{ startMs: 0, endMs: 40_000, speakerLabel: 'Speaker 1', text: 'hi' }];
    const rescaled = rescaleSegmentTimestamps(segments, 20_000);
    expect(rescaled[0]!.speakerLabel).toBe('Speaker 1');
    expect(rescaled[0]!.text).toBe('hi');
  });
});
