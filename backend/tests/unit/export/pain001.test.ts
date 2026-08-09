import { describe, expect, it } from 'vitest';
import * as handoffModule from '../../../src/export/pain001.js';
import {
  buildPaymentCsv,
  minorToDecimal,
  TO_BE_COMPLETED,
} from '../../../src/export/pain001.js';

const INPUT = {
  debtorName: 'Demo Bank Berhad',
  creditorName: 'Tech Solutions Sdn Bhd',
  currency: 'MYR',
  amountMinor: 5_000_000n,
  endToEndId: 'TS-0001',
};

describe('minorToDecimal', () => {
  it('formats a whole amount', () => {
    expect(minorToDecimal(5_000_000n)).toBe('50000.00');
  });

  /**
   * The float trap. Dividing minor units by 100 in floating point is how a
   * facility becomes 49999.999999999 in a payment file, and a payment file is
   * the wrong place to discover it. Integer arithmetic is exact at every
   * magnitude.
   */
  it('keeps the last cent exact', () => {
    expect(minorToDecimal(4_999_999n)).toBe('49999.99');
    expect(minorToDecimal(1n)).toBe('0.01');
    expect(minorToDecimal(99n)).toBe('0.99');
    expect(minorToDecimal(100n)).toBe('1.00');
  });

  it('is exact beyond Number.MAX_SAFE_INTEGER', () => {
    expect(minorToDecimal(9_007_199_254_740_993n)).toBe('90071992547409.93');
  });

  it('handles zero and negatives', () => {
    expect(minorToDecimal(0n)).toBe('0.00');
    expect(minorToDecimal(-1n)).toBe('-0.01');
  });

  it('honours a non-2 exponent', () => {
    expect(minorToDecimal(1_234n, 3)).toBe('1.234');
  });
});

describe('buildPaymentCsv', () => {
  it('emits a header and one row', () => {
    const lines = buildPaymentCsv(INPUT).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('end_to_end_id');
    expect(lines[1]).toContain('"50000.00"');
  });

  it('escapes an embedded quote rather than breaking the row', () => {
    const csv = buildPaymentCsv({ ...INPUT, creditorName: 'The "Best" Sdn Bhd' });
    expect(csv).toContain('"The ""Best"" Sdn Bhd"');
    expect(csv.trimEnd().split('\n')).toHaveLength(2);
  });

  /**
   * A bank account is personal data. This system holds only ciphertext for one,
   * so the handoff cannot carry a real account number — the maker fills those in
   * their own banking channel.
   */
  it('leaves both account columns to the maker, and carries no account-like digits', () => {
    const row = buildPaymentCsv(INPUT).split('\n')[1]!;
    expect(row).toContain(`"${TO_BE_COMPLETED}"`);
    expect(row.match(new RegExp(TO_BE_COMPLETED, 'g'))).toHaveLength(2);
    expect(row).not.toMatch(/\b\d{10,16}\b/);
  });

  /**
   * Regression. The row used to carry the meeting title as remittance info —
   * operator-typed free text that can name a person and is redacted nowhere — and
   * a requested execution date that was always two days out because this system
   * schedules nothing. Both left the system in a downloadable file.
   */
  it('carries no free-text reference and no invented execution date', () => {
    const csv = buildPaymentCsv(INPUT);
    expect(csv).not.toContain('remittance_info');
    expect(csv).not.toContain('requested_execution_date');
    // Nothing date-shaped at all: the handoff makes no claim about when.
    expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

/**
 * Spec §2.3: no auto-submit path exists in the codebase. This asserts the absence
 * rather than trusting the comment that claims it, so a future export helper that
 * posts somewhere fails the build here.
 */
describe('the export module cannot transmit', () => {
  it('exports no name suggesting a send, submit, or post', () => {
    const suspicious = Object.keys(handoffModule).filter((name) =>
      /send|submit|post|transmit|dispatch|upload/i.test(name),
    );
    expect(suspicious).toEqual([]);
  });

  it('exports only the builder, the formatter and one constant', () => {
    expect(Object.keys(handoffModule).sort()).toEqual([
      'TO_BE_COMPLETED',
      'buildPaymentCsv',
      'minorToDecimal',
    ]);
  });

  /**
   * The pain.001 builder is gone on purpose — see the note in the module. This
   * fails the build if anyone reintroduces a payment-message emitter, which for a
   * Murabahah facility would describe a cash advance the product exists to flag.
   */
  it('emits no ISO 20022 payment message', () => {
    expect(Object.keys(handoffModule)).not.toContain('buildPain001');
    expect(buildPaymentCsv(INPUT)).not.toContain('iso:20022');
  });
});
