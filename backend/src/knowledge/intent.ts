/**
 * Detects exactly one scoped agent action — "start a capture" — before a
 * question falls through to the corpus-search assistant in assistant.ts.
 *
 * A full model-classification round trip is overkill for a one-action
 * vocabulary, so this is a plain heuristic: a small set of trigger phrases
 * anchored to the start of the message (biasing toward precision — a real
 * finance question essentially never opens with "start a capture..."), plus
 * a title pulled from a quoted phrase or a trailing "called/titled/for/
 * about" clause. This only ever produces a navigation hint: the caller
 * still opens /record, still walks through consent, and still presses
 * record themselves — nothing here performs a mutation.
 */

export interface StartCaptureIntent {
  readonly action: 'start_capture';
  readonly title: string;
}

const TRIGGERS = [
  /^(?:please\s+)?start (?:a |an |another )?(?:new )?(?:recording|capture|meeting)\b/i,
  /^(?:please\s+)?record (?:a |an )?(?:new )?meeting\b/i,
  /^(?:please\s+)?capture (?:a |an )?(?:new )?meeting\b/i,
  /^(?:please\s+)?create (?:a |an |another )?(?:new )?(?:recording|capture|meeting)\b/i,
  /^(?:please\s+)?set\s?up (?:a |an |another )?(?:new )?(?:recording|capture|meeting)\b/i,
];

/** A quoted title — "Credit committee review" — wins over anything else. */
const QUOTED = /["“]([^"”]{2,120})["”]/;

/** "start a capture called X" / "...titled X" / "...for X" / "...about X". */
const NAMED = /\b(?:called|titled|for|about)\s+(.{2,120})$/i;

export function detectStartCaptureIntent(question: string): StartCaptureIntent | null {
  const trimmed = question.trim();
  if (!TRIGGERS.some((pattern) => pattern.test(trimmed))) return null;

  const quoted = QUOTED.exec(trimmed);
  if (quoted?.[1] !== undefined) {
    return { action: 'start_capture', title: quoted[1].trim() };
  }

  const named = NAMED.exec(trimmed);
  if (named?.[1] !== undefined) {
    return { action: 'start_capture', title: named[1].trim().replace(/[.?!]+$/, '') };
  }

  return { action: 'start_capture', title: '' };
}
