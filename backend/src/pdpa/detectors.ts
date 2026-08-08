/**
 * Deterministic personal-data detectors for Malaysian financial text.
 *
 * These cover the shapes a regex can decide with confidence: NRIC, payment
 * card, bank account, Malaysian mobile number, and email. PERSON_NAME and
 * ADDRESS are deliberately absent — they need a model pass, which arrives
 * with the capture pipeline. A regex that guessed at names would produce
 * false confidence in a redaction log an auditor is meant to trust.
 *
 * Every numeric pattern tolerates single spaces and hyphens between digits.
 * The input to this module is transcription output, which writes spoken
 * identifiers in groups — "4111 1111 1111 1111", "880101 14 5678". Matching
 * only contiguous runs would pass all of that through to storage.
 *
 * Where a shape is ambiguous the broader, more sensitive classification wins:
 * a 12-digit number whose leading six cannot be a date is reported as a bank
 * account rather than discarded. Over-redaction costs readability; the other
 * direction costs a PDPA breach.
 */

export type PiiKind = 'NRIC' | 'BANK_ACCOUNT' | 'PHONE' | 'EMAIL' | 'CARD';

export interface Detection {
  readonly kind: PiiKind;
  /** The matched substring, exactly as it appeared, separators included. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
  /** Provenance for the redaction log, e.g. "regex:nric". */
  readonly detectedBy: string;
  readonly confidence: number;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** YYMMDD PB NNNN — 12 digits, optional single separator between groups. */
const NRIC = /\b(\d{2})(\d{2})(\d{2})[ -]?\d{2}[ -]?\d{4}\b/g;

/** 13–19 digits; Luhn decides whether it is really a card. */
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

const PHONE_MY = /(?:\+?60|0)1\d[-\s]?\d{3,4}[-\s]?\d{4}\b/g;

/** 10–16 digits. Broadest numeric shape, so it runs last. */
const ACCOUNT = /\b\d(?:[ -]?\d){9,15}\b/g;

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

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function passesLuhn(value: string): boolean {
  const digits = digitsOnly(value);
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
 * email's local part is never also a phone number, and a Luhn-valid run is a
 * card rather than an account.
 *
 * Card is tested before NRIC deliberately. A grouped 16-digit card contains a
 * 12-digit prefix ending at a space, which the NRIC pattern would otherwise
 * claim — leaving the last group of the card in the clear.
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

  for (const m of execAll(text, CARD_CANDIDATE)) {
    if (passesLuhn(m[0])) add('CARD', m, 'regex:card+luhn', 0.9);
  }

  for (const m of execAll(text, NRIC)) {
    if (isPlausibleDob(Number(m[2]), Number(m[3]))) {
      add('NRIC', m, 'regex:nric', 0.97);
    }
  }

  for (const m of execAll(text, PHONE_MY)) add('PHONE', m, 'regex:phone-my', 0.9);

  // Broadest pattern last, so it only takes what nothing else claimed.
  for (const m of execAll(text, ACCOUNT)) {
    add('BANK_ACCOUNT', m, 'regex:bank-account', 0.7);
  }

  return accepted.sort((a, b) => a.start - b.start);
}
