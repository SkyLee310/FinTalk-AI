/**
 * Corrects a transcription provider's self-reported segment timestamps.
 *
 * Gemini states startMs/endMs for each segment as part of its JSON output —
 * an estimate, not a measurement grounded in the audio it was actually
 * handed. Two failure modes follow from that: a later segment can be placed
 * before an earlier one ends, and the model's sense of elapsed time can
 * drift from the real recording, producing gaps between consecutive
 * utterances (a two-second reply reported ten seconds after the question)
 * that never happened in the audio.
 */

interface Timed {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Reported total duration is allowed to differ from the real one by up to
 * this fraction before the whole segment set is rescaled. Below it, the
 * model's estimate is close enough that rescaling would only add rounding
 * jitter to an already-plausible transcript.
 */
const DRIFT_THRESHOLD = 0.1;

/**
 * Rescales every segment's timestamps proportionally so the last segment's
 * endMs lines up with `actualDurationMs`, then clamps the whole sequence to
 * be non-decreasing.
 *
 * Rescaling only fires when the provider's reported span and the real
 * duration disagree by at least DRIFT_THRESHOLD — see the module doc for
 * why a small disagreement is left alone. Monotonicity is enforced
 * unconditionally regardless of drift: it is a plausibility floor a correct
 * transcript should meet even when no duration was measured at all.
 *
 * `actualDurationMs` is `undefined` when the client could not measure the
 * recording (see AudioInput.durationMs) — rescaling is skipped and only the
 * monotonicity clamp runs.
 */
export function rescaleSegmentTimestamps<T extends Timed>(
  segments: readonly T[],
  actualDurationMs: number | undefined,
): T[] {
  if (segments.length === 0) return [];

  const reportedEnd = segments.at(-1)!.endMs;
  const drift =
    actualDurationMs !== undefined && actualDurationMs > 0 && reportedEnd > 0
      ? Math.abs(reportedEnd - actualDurationMs) / actualDurationMs
      : 0;
  const scale = drift >= DRIFT_THRESHOLD ? actualDurationMs! / reportedEnd : 1;

  let previousEnd = 0;
  return segments.map((segment) => {
    const startMs = Math.max(Math.round(segment.startMs * scale), previousEnd);
    const endMs = Math.max(Math.round(segment.endMs * scale), startMs);
    previousEnd = endMs;
    return { ...segment, startMs, endMs };
  });
}
