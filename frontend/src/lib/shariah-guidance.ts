/**
 * Plain-language guidance for each Shariah issue the engine can raise.
 *
 * One source of truth for two surfaces: the Islamic Banking reference page and
 * the "why was this flagged" detail on a meeting. Every `reference` string
 * mirrors the one the matching detection rule cites in
 * backend/src/shariah/rules.ts, so the lesson and the finding point at the same
 * authority and never drift apart.
 *
 * This is education, not a ruling. Every entry ends where the rule set does — a
 * qualified Shariah reviewer decides, and counsel confirms the references before
 * any of this governs a real facility.
 */

export interface ShariahGuidance {
  /** Short human title, e.g. "Riba — interest". */
  readonly title: string;
  /** What the concept is, in one short paragraph. */
  readonly whatItIs: string;
  /** Why it makes a facility non-compliant. */
  readonly whyItViolates: string;
  /** Mirrors ShariahFlag.reference for this issue type (see rules.ts). */
  readonly reference: string;
  /** What it tends to look like in a captured meeting. */
  readonly example: string;
}

export const SHARIAH_GUIDANCE: Record<string, ShariahGuidance> = {
  RIBA: {
    title: 'Riba — interest',
    whatItIs:
      'Riba is any predetermined return on money that is lent — interest. A conventional loan charges the borrower a percentage for the use of the money itself, whether the venture it funds succeeds or fails.',
    whyItViolates:
      'Islamic finance treats money as a measure of value, not a commodity that earns more of itself. Profit has to be earned by sharing the risk of a real asset or venture. A fixed interest rate hands all the risk to the borrower while guaranteeing the lender a return — which is what is prohibited. An Islamic facility instead prices a profit rate under a trade or lease contract such as Murabahah.',
    reference: 'BNM Shariah Governance Policy — requires legal confirmation',
    example:
      'A facility proposed as Islamic that quotes "a fixed interest rate of 8% per annum" — the rate is riba; the contract should price a Murabahah profit margin instead.',
  },
  LATE_PAYMENT_PENALTY: {
    title: 'Late-payment penalty as income',
    whatItIs:
      "A charge applied when a customer pays late. Shariah separates ta'widh — compensation for a proven, actual loss — from gharamah, a penalty taken as income for the bank.",
    whyItViolates:
      'A penalty kept as income is riba by another name: the bank earns more simply because time passed, with no matching cost. Compensation is permitted only up to the actual loss, and any excess is typically given to charity rather than booked as profit.',
    reference:
      'BNM policy on late payment charges for Islamic banking — requires legal confirmation',
    example:
      'A term such as "1% penalty interest per month on arrears" booked as income — it needs to be recast as compensation limited to the actual loss.',
  },
  GHARAR: {
    title: 'Gharar — excessive uncertainty',
    whatItIs:
      'Gharar is avoidable uncertainty in the essential terms of a contract — the price, the subject matter, the delivery date, or whether the thing being sold even exists yet.',
    whyItViolates:
      'A contract whose fundamentals are left open invites dispute and lets one party gain through ambiguity rather than agreement. Shariah requires the object, the price and the timing to be known and specified when the contract is struck.',
    reference: 'Gharar prohibition — contractual certainty; requires legal confirmation',
    example:
      'Recording "pricing to be determined later" or "tenure not yet fixed" as an agreed term — the uncertainty has to be resolved before the contract is concluded.',
  },
  MAYSIR: {
    title: 'Maysir — speculation or gambling',
    whatItIs:
      'Maysir is gaining wealth by chance — betting, wagering, or a structure whose outcome turns on speculation rather than genuine economic activity.',
    whyItViolates:
      'A gambling-like structure produces winners and losers from chance, not from creating or exchanging real value. Islamic finance requires the return to come from a real asset or enterprise whose risk both parties genuinely share.',
    reference: 'Maysir prohibition — requires legal confirmation',
    example:
      'A proposal to "structure it as a bet on the index" or a payout described as "purely speculative" — the return is detached from any real underlying activity.',
  },
  HARAM_SECTOR: {
    title: 'Prohibited business sector',
    whatItIs:
      'Financing whose proceeds fund an activity Islam prohibits — alcohol, pork, gambling, tobacco, or conventional interest-based insurance among them.',
    whyItViolates:
      'Even a faultlessly structured contract cannot make permissible the thing it funds. Shariah screening looks through the financing to the underlying business, so a facility for a prohibited activity is non-compliant whatever its terms.',
    reference: 'Shariah screening of business activity — requires legal confirmation',
    example:
      'A stated purpose such as "working capital for the brewery expansion" or "financing the casino floor" — the sector itself fails screening.',
  },
  CONTRACT_MISMATCH: {
    title: 'Contract named does not match the terms',
    whatItIs:
      'The facility is labelled with an Islamic contract — Murabahah, Ijarah, Tawarruq — while the terms described are those of a conventional interest loan.',
    whyItViolates:
      'Naming a contract does not make it compliant; the mechanics have to match the name. A Murabahah that simply charges interest is a conventional loan wearing an Islamic label, and the substance rather than the label governs. FinTalk refuses to store an Islamic facility that carries an interest rate at all.',
    reference: 'BNM Islamic contract policy documents — requires legal confirmation',
    example:
      'A facility called "Murabahah" that also quotes an 8% interest rate — the label and the terms contradict each other, and one of them has to change.',
  },
};

/** Render order for the reference page: the rate-related issues lead. */
export const SHARIAH_ISSUE_ORDER: readonly string[] = [
  'RIBA',
  'LATE_PAYMENT_PENALTY',
  'GHARAR',
  'MAYSIR',
  'HARAM_SECTOR',
  'CONTRACT_MISMATCH',
];

/** The guidance for an issue type, or null for one this build has no entry for. */
export function guidanceFor(issueType: string): ShariahGuidance | null {
  return SHARIAH_GUIDANCE[issueType] ?? null;
}
