/**
 * Human-readable durations for how long something took.
 *
 * Formats a millisecond span as "Xm Ys", dropping the minutes below a minute
 * ("Ys"). Whole seconds only — a processing time is an estimate, and "2m 34s"
 * is what a person wants to read, not "154.219s". Negative inputs clamp to 0s.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
