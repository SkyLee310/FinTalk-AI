import { describe, expect, it } from 'vitest';
import { redact } from '../../../src/pdpa/redactor.js';
import { open } from '../../../src/pdpa/vault.js';

const KEY = Buffer.alloc(32, 3);

// Synthetic, generated to format. Not a real identifier or account.
const SOURCE = 'Director punya IC is 880101-14-5678, account 1234567890 at Maybank.';

describe('redact', () => {
  it('replaces every detected value with a placeholder', () => {
    const { text } = redact(SOURCE, KEY);
    expect(text).toContain('[NRIC_1]');
    expect(text).toContain('[BANK_ACCOUNT_1]');
  });

  it('leaves no detected value anywhere in the output', () => {
    const { text } = redact(SOURCE, KEY);
    expect(text).not.toContain('880101-14-5678');
    expect(text).not.toContain('1234567890');
    expect(text).not.toMatch(/\d{6}-\d{2}-\d{4}/);
  });

  it('preserves the surrounding text exactly', () => {
    const { text } = redact(SOURCE, KEY);
    expect(text).toBe(
      'Director punya IC is [NRIC_1], account [BANK_ACCOUNT_1] at Maybank.',
    );
  });

  it('numbers placeholders per kind, starting at 1', () => {
    const { text } = redact('IC 880101-14-5678 and IC 770202-08-1234', KEY);
    expect(text).toBe('IC [NRIC_1] and IC [NRIC_2]');
  });

  it('gives the same value the same placeholder', () => {
    const { text } = redact('IC 880101-14-5678 again 880101-14-5678', KEY);
    expect(text).toBe('IC [NRIC_1] again [NRIC_1]');
  });

  it('records offsets that point at the placeholder in the redacted text', () => {
    const { text, records } = redact(SOURCE, KEY);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(text.slice(r.startOffset, r.endOffset)).toBe(r.placeholder);
    }
  });

  it('seals the original value so a reviewer with the key can recover it', () => {
    const { records } = redact(SOURCE, KEY);
    const nric = records.find((r) => r.piiType === 'NRIC');
    expect(nric).toBeDefined();
    expect(open(nric!.sealed, KEY)).toBe('880101-14-5678');
  });

  it('emits one record per occurrence, sharing the placeholder', () => {
    const { records } = redact('IC 880101-14-5678 again 880101-14-5678', KEY);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.placeholder)).toEqual(['[NRIC_1]', '[NRIC_1]']);
  });

  it('seals each occurrence under its own iv', () => {
    const { records } = redact('IC 880101-14-5678 again 880101-14-5678', KEY);
    expect(records[0]!.sealed.iv.equals(records[1]!.sealed.iv)).toBe(false);
  });

  it('carries detector provenance and confidence into the record', () => {
    const { records } = redact('IC 880101-14-5678', KEY);
    expect(records[0]?.detectedBy).toBe('regex:nric');
    expect(records[0]?.confidence).toBeGreaterThan(0.9);
    expect(records[0]?.confidence).toBeLessThanOrEqual(1);
  });

  it('returns the text unchanged and no records when there is nothing to redact', () => {
    const clean = 'Pricing basis is unresolved pending Shariah review.';
    const { text, records } = redact(clean, KEY);
    expect(text).toBe(clean);
    expect(records).toEqual([]);
  });

  // Fail-closed: a bad key must abort, never degrade to returning the source.
  it('refuses to run with an invalid vault key rather than returning unredacted text', () => {
    expect(() => redact(SOURCE, Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  /**
   * Redacting twice would emit a second [NRIC_1] beside the first, leaving the
   * redaction log with two candidate spans per token. That log is audit
   * evidence, so ambiguity in it is a defect, not a cosmetic issue.
   */
  it('refuses text that already contains a redaction placeholder', () => {
    expect(() => redact('IC [NRIC_1] was already masked', KEY))
      .toThrow(/already contains a redaction placeholder/i);
  });

  it('does not echo the source text in that error', () => {
    try {
      redact('IC [NRIC_1] and 880101-14-5678', KEY);
      throw new Error('expected redact to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('880101');
    }
  });
});
