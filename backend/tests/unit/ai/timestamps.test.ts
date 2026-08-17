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

  it('leaves timestamps alone when the reported and real durations are close', () => {
    // Reported end 100_000ms vs a measured 105_000ms — 5% drift, under the
    // 10% threshold, so the model's estimate stands.
    const segments = [
      { startMs: 0, endMs: 40_000 },
      { startMs: 40_000, endMs: 100_000 },
    ];
    expect(rescaleSegmentTimestamps(segments, 105_000)).toEqual(segments);
  });

  it('rescales proportionally when the reported end drifts far from the real duration', () => {
    // Reported end 200_000ms ("3:20") against a real 100_000ms ("1:40")
    // recording — exactly the symptom reported: segments placed far later
    // than the audio actually runs.
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
