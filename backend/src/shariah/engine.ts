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
    let match = pattern.exec(transcript);
    let seen = 0;

    while (match !== null && seen < MAX_FINDINGS_PER_RULE) {
      findings.push({
        issueType: rule.issueType,
        excerpt: excerptAround(transcript, match.index, match.index + match[0].length),
        detectedBy: rule.id,
        confidence: rule.confidence,
        reference: rule.reference,
      });
      seen += 1;
      match = pattern.exec(transcript);
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
