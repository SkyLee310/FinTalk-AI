import type { ShariahIssueType } from '@prisma/client';

/**
 * The starter rule set: six named issues, each detected by explicit patterns.
 *
 * Deterministic rules rather than a model, on purpose. A rule can be shown to a
 * Shariah committee, argued with, and versioned; "the model thought so" cannot.
 * Every reference below still requires confirmation by counsel before
 * production use — the citations name where to look, not a settled reading.
 *
 * Patterns cover English and Malay because the transcripts are Bahasa Rojak:
 * "kena guna profit rate" and "we quote 8% interest" appear in one meeting.
 *
 * These rules only ever raise a flag. Nothing here clears one, and no rule
 * output is a ruling — spec §7. Clearing requires a human holding the SHARIAH
 * role, enforced separately by the capability matrix and a DB constraint.
 */

export interface ShariahRule {
  /** Stable id, recorded as ShariahFlag.detectedBy. */
  readonly id: string;
  readonly issueType: ShariahIssueType;
  readonly pattern: RegExp;
  readonly confidence: number;
  readonly reference: string;
  /** Only fires when the facility is, or is proposed as, Islamic. */
  readonly islamicOnly: boolean;
}

const REQUIRES_CONFIRMATION = 'requires legal confirmation';

export const SHARIAH_RULES: readonly ShariahRule[] = Object.freeze([
  {
    id: 'rule:riba.interest-rate-mention',
    issueType: 'RIBA',
    pattern:
      /\b(?:interest\s+rate|rate\s+of\s+interest|faedah|riba)\b|\b\d+(?:\.\d+)?\s*%\s*(?:p\.?\s?a\.?|per\s+annum|setahun)/gi,
    confidence: 0.93,
    reference: `BNM Shariah Governance Policy — ${REQUIRES_CONFIRMATION}`,
    islamicOnly: true,
  },
  {
    id: 'rule:riba.compounding',
    issueType: 'RIBA',
    pattern: /\b(?:compound(?:ed|ing)?\s+interest|bunga\s+berganda)\b/gi,
    confidence: 0.9,
    reference: `BNM Shariah Governance Policy — ${REQUIRES_CONFIRMATION}`,
    islamicOnly: true,
  },
  {
    id: 'rule:late-payment.penalty-as-income',
    issueType: 'LATE_PAYMENT_PENALTY',
    /**
     * Ta'widh (compensation for actual loss) is treated differently from
     * gharamah (a penalty taken as income). A transcript mentioning a late
     * payment charge needs a reviewer to establish which was meant.
     */
    pattern:
      /\b(?:late\s+payment\s+(?:charge|penalty|interest)|penalty\s+interest|denda|gharamah|ta'?widh)\b/gi,
    confidence: 0.85,
    reference: `BNM policy on late payment charges for Islamic banking — ${REQUIRES_CONFIRMATION}`,
    islamicOnly: true,
  },
  {
    id: 'rule:gharar.unspecified-term',
    issueType: 'GHARAR',
    pattern:
      /\b(?:to\s+be\s+determined|tbd|not\s+yet\s+(?:decided|agreed|fixed)|belum\s+pasti|tidak\s+pasti|gharar)\b/gi,
    confidence: 0.7,
    reference: `Gharar prohibition — contractual certainty; ${REQUIRES_CONFIRMATION}`,
    islamicOnly: true,
  },
  {
    id: 'rule:maysir.speculative-structure',
    issueType: 'MAYSIR',
    pattern:
      /\b(?:speculat(?:e|ion|ive)|gambl(?:e|ing)|judi|spekulasi|betting|wager)\b/gi,
    confidence: 0.8,
    reference: `Maysir prohibition — ${REQUIRES_CONFIRMATION}`,
    islamicOnly: false,
  },
  {
    id: 'rule:haram-sector.prohibited-activity',
    issueType: 'HARAM_SECTOR',
    pattern:
      /\b(?:alcohol|liquor|brewery|arak|casino|pork|pig\s+farm(?:ing)?|tobacco|cigarette|conventional\s+insurance|nightclub)\b/gi,
    confidence: 0.88,
    reference: `Shariah screening of business activity — ${REQUIRES_CONFIRMATION}`,
    islamicOnly: false,
  },
  {
    id: 'rule:contract-mismatch.islamic-contract-named',
    issueType: 'CONTRACT_MISMATCH',
    /**
     * A named Islamic contract. On its own this is not a problem; paired with a
     * RIBA finding it is the exact contradiction the deck's slides 6 and 7
     * contained, and the one the TermSheet CHECK constraint makes unstorable.
     * The engine only raises it when a rate-bearing finding is also present.
     */
    pattern:
      /\b(?:murabahah|tawarruq|ijarah|musharakah|mudharabah|istisna|salam)\b/gi,
    confidence: 0.6,
    reference: `BNM Islamic contract policy documents — ${REQUIRES_CONFIRMATION}`,
    islamicOnly: false,
  },
]);
