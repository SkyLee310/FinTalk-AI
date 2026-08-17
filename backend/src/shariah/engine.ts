import type { ShariahIssueType } from '@prisma/client';
import type { RedactedText } from '../pdpa/redacted-text.js';
import { SHARIAH_RULES, type ShariahRule } from './rules.js';

/**
 * Runs the rule set over a transcript and returns findings.
 *
 * The input is RedactedText, which is what makes the excerpts safe to store: an
 * excerpt is a window cut from text that has already passed the redaction
 * barrier, so a flag shown to a reviewer cannot carry an identifier.
 *
 * Findings are advisory. This function has no way to clear anything, and the
 * word "violation" appears nowhere in its output — that judgement belongs to a
 * qualified reviewer holding the SHARIAH role.
 */

export interface ShariahFinding {
  readonly issueType: ShariahIssueType;
  /** A window of surrounding redacted text, for the reviewer's context. */
  readonly excerpt: string;
  readonly detectedBy: string;
  readonly confidence: number;
  readonly reference: string;
  /**
   * Offset of the finding's anchor match within the transcript passed in.
   * The caller holds that same transcript's segment boundaries, so this is
   * what lets a finding point at the segment that raised it.
   */
  readonly matchStart: number;
  /**
   * The distinct phrases matched within this finding's sentence, in the
   * order first matched — what a reviewer should see picked out inside
   * `excerpt`. A match outside the excerpt's padding window is left out,
   * since there is nothing in the rendered text for it to highlight.
   */
  readonly highlights: readonly string[];
}

export interface FacilityContext {
  /**
   * Whether the discussion concerns an Islamic facility. Undefined means
   * unknown, and unknown is treated as Islamic: failing to flag a facility that
   * turns out to be Islamic is the more expensive mistake.
   */
  readonly isIslamic?: boolean;
}

const EXCERPT_PADDING = 60;
const MAX_FINDINGS_PER_RULE = 5;

/** Cuts a readable window around a match. */
function excerptAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - EXCERPT_PADDING);
  const to = Math.min(text.length, end + EXCERPT_PADDING);
  const window = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${window}${to < text.length ? '…' : ''}`;
}

function applies(rule: ShariahRule, context: FacilityContext): boolean {
  if (!rule.islamicOnly) return true;
  // Unknown counts as Islamic: see FacilityContext.isIslamic.
  return context.isIslamic !== false;
}

/**
 * Question or definition framing immediately around a match — "what is
 * riba", "riba means an unjust gain" — as opposed to a claim about this
 * facility's actual terms — "riba is charged on this loan", "the interest
 * rate is 8%". The two read alike around the word "is"; what's checked here
 * is not "is" but the words either side of it, which is the part that
 * differs between teaching a term and using one.
 *
 * The window is one transcribed segment: scanning stops at the nearest
 * sentence punctuation or '\n' (segments are joined with '\n' — see
 * SEGMENT_SEPARATOR in process-meeting.ts), so a definition given in one
 * utterance can never suppress a real figure quoted three sentences later.
 */
const EXPLANATORY_BEFORE =
  /\b(?:what\s+(?:is|are|does|do)|explain|define|definition\s+of|meaning\s+of|apa\s+itu|apa\s+maksud)\b/i;
const EXPLANATORY_AFTER =
  /^[\s,]*(?:means|refers?\s+to|is\s+defined\s+as|is\s+basically|is\s+essentially|bermaksud|maksudnya)\b/i;
const SENTENCE_BOUNDARY = /[.?!\n]/;

/**
 * Sentence-like bounds around [start, end): walks outward to the nearest
 * SENTENCE_BOUNDARY on each side. Segments are joined with '\n' (see
 * SEGMENT_SEPARATOR in process-meeting.ts), so this never crosses a segment
 * boundary either. Two matches that resolve to the same `start` here are, by
 * construction, in the same sentence — there is no boundary between them.
 */
function sentenceBounds(transcript: string, start: number, end: number): { start: number; end: number } {
  let boundsStart = 0;
  for (let i = start - 1; i >= 0; i -= 1) {
    if (SENTENCE_BOUNDARY.test(transcript[i]!)) {
      boundsStart = i + 1;
      break;
    }
  }

  let boundsEnd = transcript.length;
  for (let i = end; i < transcript.length; i += 1) {
    if (SENTENCE_BOUNDARY.test(transcript[i]!)) {
      boundsEnd = i;
      break;
    }
  }

  return { start: boundsStart, end: boundsEnd };
}

function isExplanatoryMention(transcript: string, start: number, end: number): boolean {
  const { start: beforeFrom, end: afterTo } = sentenceBounds(transcript, start, end);
  return (
    EXPLANATORY_BEFORE.test(transcript.slice(beforeFrom, start))
    || EXPLANATORY_AFTER.test(transcript.slice(end, afterTo))
  );
}

interface RawMatch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export function analyseTranscript(
  transcript: RedactedText,
  context: FacilityContext = {},
): ShariahFinding[] {
  const findings: ShariahFinding[] = [];

  for (const rule of SHARIAH_RULES) {
    if (!applies(rule, context)) continue;

    // Fresh RegExp per rule: the shared literals carry /g, and reusing one
    // across calls would leak lastIndex between transcripts.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const rawMatches: RawMatch[] = [];
    let match = pattern.exec(transcript);
    while (match !== null) {
      rawMatches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      match = pattern.exec(transcript);
    }

    /**
     * Group by sentence rather than emitting one finding per raw match: a
     * single utterance can trip a rule's alternation twice (e.g. both
     * "interest rate" and a "6% per annum" figure matching
     * riba.interest-rate-mention in the same breath), which a reviewer reads
     * as one occurrence, not two. The group's first match anchors
     * suppression and the excerpt window, same as the lone match did before.
     */
    const groups = new Map<number, RawMatch[]>();
    for (const raw of rawMatches) {
      const { start: sentenceStart } = sentenceBounds(transcript, raw.start, raw.end);
      const group = groups.get(sentenceStart);
      if (group) {
        group.push(raw);
      } else {
        groups.set(sentenceStart, [raw]);
      }
    }

    let seen = 0;
    for (const group of groups.values()) {
      if (seen >= MAX_FINDINGS_PER_RULE) break;

      const anchor = group[0]!;
      const suppressed = rule.suppressWhenExplanatory === true
        && isExplanatoryMention(transcript, anchor.start, anchor.end);
      if (suppressed) continue;

      const from = Math.max(0, anchor.start - EXCERPT_PADDING);
      const to = Math.min(transcript.length, anchor.end + EXCERPT_PADDING);
      const highlights = [...new Set(
        group.filter((raw) => raw.start >= from && raw.end <= to).map((raw) => raw.text),
      )];

      findings.push({
        issueType: rule.issueType,
        excerpt: excerptAround(transcript, anchor.start, anchor.end),
        detectedBy: rule.id,
        confidence: rule.confidence,
        reference: rule.reference,
        matchStart: anchor.start,
        highlights,
      });
      seen += 1;
    }
  }

  /**
   * CONTRACT_MISMATCH means "an Islamic contract was named alongside a
   * rate-bearing term". Naming Murabahah on its own is ordinary Islamic banking
   * and must not raise a flag, so the finding is dropped unless a RIBA finding
   * is also present. Raising it every time a contract is mentioned would train
   * reviewers to dismiss the flag, which is worse than not having it.
   */
  const hasRiba = findings.some((f) => f.issueType === 'RIBA');
  const filtered = hasRiba
    ? findings
    : findings.filter((f) => f.issueType !== 'CONTRACT_MISMATCH');

  return filtered.sort(
    (a, b) => b.confidence - a.confidence || a.detectedBy.localeCompare(b.detectedBy),
  );
}
