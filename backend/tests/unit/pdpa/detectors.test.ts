import { describe, expect, it } from 'vitest';
import { detectPii } from '../../../src/pdpa/detectors.js';

/**
 * Every value here is synthetic and generated to format. 4111111111111111 is
 * the published Visa test number; the NRICs are shape-valid but arbitrary.
 */
describe('detectPii — Malaysian NRIC', () => {
  it('detects a dashed NRIC and reports its exact offsets', () => {
    const text = 'Director punya IC is 880101-14-5678 ya.';
    const [hit, ...rest] = detectPii(text);
    expect(rest).toHaveLength(0);
    expect(hit?.kind).toBe('NRIC');
    expect(hit?.value).toBe('880101-14-5678');
    expect(text.slice(hit!.start, hit!.end)).toBe('880101-14-5678');
    expect(hit?.detectedBy).toBe('regex:nric');
  });

  it('detects an undashed 12-digit NRIC when the date prefix is valid', () => {
    const hits = detectPii('IC 880101145678 confirmed');
    expect(hits.map((h) => h.kind)).toEqual(['NRIC']);
    expect(hits[0]?.value).toBe('880101145678');
  });

  it('does not treat a 12-digit run with an impossible date as an NRIC', () => {
    // 991345 -> month 13, day 45. Shape matches, calendar does not.
    const hits = detectPii('Account 991345678901 at Maybank');
    expect(hits.map((h) => h.kind)).toEqual(['BANK_ACCOUNT']);
  });

  /**
   * A 12-digit number whose leading six cannot be a date is not an NRIC, but
   * it is still a 12-digit number in a credit discussion. It falls through to
   * BANK_ACCOUNT rather than being discarded: misclassifying costs
   * readability, dropping it costs a disclosure.
   */
  it('does not call a dashed number with an impossible month an NRIC', () => {
    const kinds = detectPii('IC 881301-14-5678').map((h) => h.kind);
    expect(kinds).not.toContain('NRIC');
    expect(kinds).toEqual(['BANK_ACCOUNT']);
  });
});

describe('detectPii — bank accounts and cards', () => {
  it('detects a 10-digit bank account', () => {
    const hits = detectPii('account 1234567890 at Maybank');
    expect(hits.map((h) => h.kind)).toEqual(['BANK_ACCOUNT']);
    expect(hits[0]?.value).toBe('1234567890');
  });

  it('classifies a Luhn-valid 16-digit run as a card, not an account', () => {
    const hits = detectPii('card 4111111111111111 on file');
    expect(hits.map((h) => h.kind)).toEqual(['CARD']);
  });

  it('classifies a Luhn-invalid 16-digit run as an account', () => {
    const hits = detectPii('ref 4111111111111112 recorded');
    expect(hits.map((h) => h.kind)).toEqual(['BANK_ACCOUNT']);
  });

  it('ignores digit runs shorter than an account number', () => {
    expect(detectPii('RM 50,000 over 60 months at 8% p.a.')).toHaveLength(0);
  });

  it('ignores a bare year', () => {
    expect(detectPii('reviewed in 2026 by the committee')).toHaveLength(0);
  });
});

describe('detectPii — phones and email', () => {
  it('detects a Malaysian mobile with separators', () => {
    const hits = detectPii('call me at 012-345 6789 lah');
    expect(hits.map((h) => h.kind)).toEqual(['PHONE']);
    expect(hits[0]?.value).toBe('012-345 6789');
  });

  it('detects an international-format Malaysian mobile', () => {
    const hits = detectPii('whatsapp +60123456789 please');
    expect(hits.map((h) => h.kind)).toEqual(['PHONE']);
  });

  it('detects an email address', () => {
    const hits = detectPii('send to ali@example.test today');
    expect(hits.map((h) => h.kind)).toEqual(['EMAIL']);
    expect(hits[0]?.value).toBe('ali@example.test');
  });

  it('does not report the local part of an email as another type', () => {
    // 0123456789@example.test must yield exactly one detection, not a phone
    // or account nested inside the address.
    const hits = detectPii('mail 0123456789@example.test now');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('EMAIL');
  });
});

describe('detectPii — overlap and ordering', () => {
  it('never returns overlapping ranges', () => {
    const hits = detectPii('IC 880101-14-5678 acct 1234567890 card 4111111111111111');
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i]!.start).toBeGreaterThanOrEqual(hits[i - 1]!.end);
    }
  });

  it('returns detections sorted by start offset', () => {
    const hits = detectPii('acct 1234567890 then IC 880101-14-5678');
    expect(hits.map((h) => h.kind)).toEqual(['BANK_ACCOUNT', 'NRIC']);
  });

  it('detects every occurrence, not just the first', () => {
    const hits = detectPii('IC 880101-14-5678 and IC 770202-08-1234');
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.value)).toEqual(['880101-14-5678', '770202-08-1234']);
  });

  it('reports confidence in the unit interval', () => {
    for (const hit of detectPii('IC 880101-14-5678 acct 1234567890 ali@example.test')) {
      expect(hit.confidence).toBeGreaterThan(0);
      expect(hit.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('returns an empty array for text with no personal data', () => {
    expect(detectPii('Pricing basis is unresolved pending Shariah review.')).toEqual([]);
  });
});

/**
 * Transcription does not emit tidy contiguous digit runs. A model asked to
 * write down a spoken identifier produces grouped digits — "4111 1111 1111
 * 1111", "880101 14 5678" — and a detector that only matches contiguous runs
 * silently passes all of it through to storage.
 */
describe('detectPii — separator-tolerant formats', () => {
  it('detects an NRIC written with spaces', () => {
    const hits = detectPii('IC 880101 14 5678 confirmed');
    expect(hits.map((h) => h.kind)).toEqual(['NRIC']);
    expect(hits[0]?.value).toBe('880101 14 5678');
  });

  it('detects an NRIC with mixed separators', () => {
    expect(detectPii('IC 880101-14 5678 noted').map((h) => h.kind)).toEqual(['NRIC']);
  });

  it('detects a card number written in groups of four', () => {
    const hits = detectPii('card 4111 1111 1111 1111 on file');
    expect(hits.map((h) => h.kind)).toEqual(['CARD']);
    expect(hits[0]?.value).toBe('4111 1111 1111 1111');
  });

  it('detects a bank account written with spaces', () => {
    const hits = detectPii('account 1234 5678 90 at Maybank');
    expect(hits.map((h) => h.kind)).toEqual(['BANK_ACCOUNT']);
    expect(hits[0]?.value).toBe('1234 5678 90');
  });

  it('still ignores an amount carrying a thousands separator', () => {
    expect(detectPii('facility of RM 50,000 approved')).toEqual([]);
  });

  it('still ignores a span of years', () => {
    expect(detectPii('term from 2026 to 2031 inclusive')).toEqual([]);
  });
});
