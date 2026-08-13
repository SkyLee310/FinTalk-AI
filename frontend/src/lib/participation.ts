/**
 * Per-speaker talk share, computed from transcript segments alone.
 *
 * Deterministic and rule-based — no model call, and nothing here is derived
 * text, so there is no redaction concern. speakerLabel is already whatever
 * the transcript stored (a role or a generic "Speaker N" tag), never a name.
 */
export interface SpeakerShare {
  readonly speakerLabel: string;
  readonly totalMs: number;
  /** 0–1. Sums to 1 across every speaker in the same meeting. */
  readonly share: number;
  /** True when this speaker fell below half of an even split of the meeting. */
  readonly quiet: boolean;
}

/**
 * Sums each speaker's segment time and sorts by share, descending.
 *
 * A speaker is "quiet" when their share is under half of what an even split
 * among every speaker in the meeting would have given them — a threshold
 * that scales with the number of speakers instead of a single fixed
 * percentage, so a two-person meeting and an eight-person one are each
 * judged against their own fair split.
 */
export function computeParticipation(
  segments: readonly { speakerLabel: string; startMs: number; endMs: number }[],
): SpeakerShare[] {
  const totals = new Map<string, number>();
  for (const segment of segments) {
    const span = Math.max(0, segment.endMs - segment.startMs);
    totals.set(segment.speakerLabel, (totals.get(segment.speakerLabel) ?? 0) + span);
  }

  const totalAll = [...totals.values()].reduce((sum, ms) => sum + ms, 0);
  const evenSplit = totals.size > 0 ? 1 / totals.size : 0;
  const quietThreshold = evenSplit / 2;

  return [...totals.entries()]
    .map(([speakerLabel, totalMs]) => {
      const share = totalAll > 0 ? totalMs / totalAll : 0;
      return { speakerLabel, totalMs, share, quiet: share < quietThreshold };
    })
    .sort((a, b) => b.share - a.share);
}

/** A templated nudge for a quiet speaker, or null when they were not quiet. */
export function participationNudge(speaker: SpeakerShare): string | null {
  if (!speaker.quiet) return null;
  const pct = Math.round(speaker.share * 100);
  return `${speaker.speakerLabel} spoke ${String(pct)}% of the time; consider inviting their input.`;
}
