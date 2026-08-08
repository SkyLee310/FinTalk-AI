/**
 * Deterministic personal-data detectors for Malaysian financial text.
 *
 * These cover the shapes a regex can decide with confidence: NRIC, payment
 * card, bank account, Malaysian mobile number, and email. PERSON_NAME and
 * ADDRESS are deliberately absent — they need a model pass, which arrives
 * with the capture pipeline. A regex that guessed at names would produce
 * false confidence in a redaction log an auditor is meant to trust.
 */

export type PiiKind = 'NRIC' | 'BANK_ACCOUNT' | 'PHONE' | 'EMAIL' | 'CARD';

export interface Detection {
  readonly kind: PiiKind;
  /** The matched substring, exactly as it appeared. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
  /** Provenance for the redaction log, e.g. "regex:nric". */
  readonly detectedBy: string;
  readonly confidence: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NRIC_DASHED = /\b(\d{2})(\d{2})(\d{2})-\d{2}-\d{4}\b/g;
const NRIC_PLAIN = /\b(\d{2})(\d{2})(\d{2})\d{6}\b/g;
const CARD_CANDIDATE = /\b\d{13,19}\b/g;
const PHONE_MY = /(?:\+?60|0)1\d[-\s]?\d{3,4}[-\s]?\d{4}\b/g;
const ACCOUNT = /\b\d{10,16}\b/g;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Shape check on an NRIC's leading YYMMDD. February allows 29 unconditionally:
 * the two-digit year cannot tell us the century, so a stricter leap-year test
 * would reject valid identifiers.
 */
function isPlausibleDob(mm: number, dd: number): boolean {
  if (mm < 1 || mm > 12) return false;
  if (dd < 1) return false;
  return dd <= DAYS_IN_MONTH[mm - 1]!;
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function* execAll(text: string, pattern: RegExp): Generator<RegExpExecArray> {
  const rx = new RegExp(pattern.source, pattern.flags);
  let match = rx.exec(text);
  while (match !== null) {
    yield match;
    match = rx.exec(text);
  }
}

/**
 * Returns non-overlapping detections sorted by offset.
 *
 * Patterns are applied most-specific first and each claims its span, so a
 * broad pattern cannot re-report text a precise one already identified: an
 * email's local part is never also reported as a phone number, and a
 * Luhn-valid run is a card rather than an account.
 */
export function detectPii(text: string): Detection[] {
  const accepted: Detection[] = [];

  const overlapsAccepted = (start: number, end: number): boolean =>
    accepted.some((a) => start < a.end && end > a.start);

  const add = (
    kind: PiiKind,
    match: RegExpExecArray,
    detectedBy: string,
    confidence: number,
  ): void => {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;
    if (overlapsAccepted(start, end)) return;
    accepted.push({ kind, value, start, end, detectedBy, confidence });
  };

  // An address can contain a digit run that would otherwise read as a phone
  // number or an account, so email claims its span first.
  for (const m of execAll(text, EMAIL)) add('EMAIL', m, 'regex:email', 0.97);

  // The dashed NRIC is the least ambiguous shape in Malaysian text.
  for (const m of execAll(text, NRIC_DASHED)) {
    if (isPlausibleDob(Number(m[2]), Number(m[3]))) {
      add('NRIC', m, 'regex:nric', 0.99);
    }
  }

  // Card before account: both match a 16-digit run, and Luhn decides which.
  for (const m of execAll(text, CARD_CANDIDATE)) {
    if (passesLuhn(m[0])) add('CARD', m, 'regex:card+luhn', 0.9);
  }

  // Undashed NRIC: exactly 12 digits whose first six are a plausible date.
  for (const m of execAll(text, NRIC_PLAIN)) {
    if (isPlausibleDob(Number(m[2]), Number(m[3]))) {
      add('NRIC', m, 'regex:nric', 0.85);
    }
  }

  for (const m of execAll(text, PHONE_MY)) add('PHONE', m, 'regex:phone-my', 0.9);

  // Broadest pattern last, so it only takes what nothing else claimed.
  for (const m of execAll(text, ACCOUNT)) {
    add('BANK_ACCOUNT', m, 'regex:bank-account', 0.7);
  }

  return accepted.sort((a, b) => a.start - b.start);
}
