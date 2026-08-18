/**
 * Corrects a transcription provider's self-reported segment timestamps.
 *
 * Gemini states startMs/endMs for each segment as part of its JSON output —
 * an estimate, not a measurement grounded in the audio it was actually
 * handed. Measured against a synthetic clip with known ground truth (four
 * sentences separated by exact 2-second silences): the model's sense of how
 * *long* each utterance took was accurate to within a few hundred
 * milliseconds, but it consistently under-counted the *silence* between
 * them (2000ms gaps came back as 500-1000ms) — the error compounds with
 * every segment because each one inherits the previous one's shortfall. A
 * single proportional rescale of the whole timeline can't correct that: it
 * stretches speech and silence by the same factor, when only the silence
 * was wrong.
 */

interface Timed {
  readonly startMs: number;
  readonly endMs: number;
}

function clampMonotonic<T extends Timed>(segments: readonly T[]): T[] {
  let previousEnd = 0;
  return segments.map((segment) => {
    const startMs = Math.max(segment.startMs, previousEnd);
    const endMs = Math.max(segment.endMs, startMs);
    previousEnd = endMs;
    return { ...segment, startMs, endMs };
  });
}

/**
 * Rescales every segment's timestamps proportionally so the last segment's
 * endMs lines up with `actualDurationMs`, then clamps to non-decreasing.
 *
 * Used only as a fallback by rescaleSegmentTimestamps, for the case where
 * the segments' own reported durations don't even fit inside the real
 * recording — a sign the model's sense of pacing broke down broadly, not
 * just its sense of silence, so there is no gap budget left to trust or
 * redistribute.
 */
function proportionalRescale<T extends Timed>(
  segments: readonly T[],
  actualDurationMs: number,
): T[] {
  const reportedEnd = segments.at(-1)!.endMs;
  const scale = reportedEnd > 0 ? actualDurationMs / reportedEnd : 1;

  let previousEnd = 0;
  return segments.map((segment) => {
    const startMs = Math.max(Math.round(segment.startMs * scale), previousEnd);
    const endMs = Math.max(Math.round(segment.endMs * scale), startMs);
    previousEnd = endMs;
    return { ...segment, startMs, endMs };
  });
}

/**
 * Keeps every segment's own reported duration (endMs - startMs) exactly as
 * the model gave it — the part it gets right — and rescales only the gaps
 * between segments (and before the first one) to absorb the difference
 * between the reported total span and the real duration. A segment reported
 * with no pause before it is not stretched; the whole correction lands on
 * segments that already reported one, in proportion to how long each was.
 *
 * `actualDurationMs` is `undefined` when the client could not measure the
 * recording (see AudioInput.durationMs) — only the monotonicity clamp runs.
 * When the reported durations alone exceed the real duration, there is no
 * gap budget to redistribute, so this falls back to proportionalRescale.
 */
export function rescaleSegmentTimestamps<T extends Timed>(
  segments: readonly T[],
  actualDurationMs: number | undefined,
): T[] {
  if (segments.length === 0) return [];
  if (actualDurationMs === undefined || actualDurationMs <= 0) {
    return clampMonotonic(segments);
  }

  const durations = segments.map((segment) => Math.max(0, segment.endMs - segment.startMs));
  const sumDurations = durations.reduce((sum, d) => sum + d, 0);
  if (sumDurations > actualDurationMs) {
    return proportionalRescale(segments, actualDurationMs);
  }

  const silenceBudget = actualDurationMs - sumDurations;
  const reportedGaps = segments.map((segment, i) =>
    Math.max(0, i === 0 ? segment.startMs : segment.startMs - segments[i - 1]!.endMs),
  );
  const sumReportedGaps = reportedGaps.reduce((sum, g) => sum + g, 0);
  const gapScale = sumReportedGaps > 0 ? silenceBudget / sumReportedGaps : 0;

  let cursor = 0;
  return segments.map((segment, i) => {
    const startMs = Math.round(cursor + reportedGaps[i]! * gapScale);
    const endMs = Math.round(startMs + durations[i]!);
    cursor = endMs;
    return { ...segment, startMs, endMs };
  });
}
