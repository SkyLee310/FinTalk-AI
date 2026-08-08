import { describe, expect, it } from 'vitest';
import * as pain001Module from '../../../src/export/pain001.js';
import {
  buildPain001,
  buildPaymentCsv,
  minorToDecimal,
  TO_BE_COMPLETED,
} from '../../../src/export/pain001.js';

const INPUT = {
  messageId: 'FT-20260809-0001',
  createdAt: new Date('2026-08-09T01:00:00.000Z'),
  requestedExecutionDate: new Date('2026-08-11T00:00:00.000Z'),
  initiatingParty: 'Demo Bank Berhad',
  debtorName: 'Demo Bank Berhad',
  creditorName: 'Tech Solutions Sdn Bhd',
  currency: 'MYR',
  amountMinor: 5_000_000n,
  endToEndId: 'TS-0001',
  remittanceInfo: 'SME working capital facility',
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

describe('buildPain001', () => {
  it('produces a pain.001.001.09 document with the amount and currency', () => {
    const xml = buildPain001(INPUT);
    expect(xml).toContain('urn:iso:std:iso:20022:tech:xsd:pain.001.001.09');
    expect(xml).toContain('<InstdAmt Ccy="MYR">50000.00</InstdAmt>');
    expect(xml).toContain('<CtrlSum>50000.00</CtrlSum>');
    expect(xml).toContain('<EndToEndId>TS-0001</EndToEndId>');
  });

  it('uses a date-only requested execution date', () => {
    expect(buildPain001(INPUT)).toContain('<Dt>2026-08-11</Dt>');
  });

  /**
   * A bank account is personal data. This system holds only ciphertext for one,
   * so the payload cannot carry a real account number even though the format
   * expects it — the maker fills those in their own banking channel.
   */
  it('emits account fields as to-be-completed markers, never values', () => {
    const xml = buildPain001(INPUT);
    expect(xml).toContain(`<Id>${TO_BE_COMPLETED}</Id>`);
    expect(xml).not.toMatch(/\b\d{10,16}\b/);
  });

  it('escapes operator-supplied names', () => {
    const xml = buildPain001({
      ...INPUT,
      creditorName: 'Ampersand & <Angle> "Quote" Sdn Bhd',
    });
    expect(xml).toContain('Ampersand &amp; &lt;Angle&gt; &quot;Quote&quot; Sdn Bhd');
    expect(xml).not.toContain('<Angle>');
  });

  it('states exactly one transaction in both places it is declared', () => {
    const xml = buildPain001(INPUT);
    expect(xml.match(/<NbOfTxs>1<\/NbOfTxs>/g)).toHaveLength(2);
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

  it('leaves both account columns to the maker', () => {
    expect(buildPaymentCsv(INPUT).split('\n')[1]).toContain(`"${TO_BE_COMPLETED}"`);
  });
});

/**
 * Spec §2.3: no auto-submit path exists in the codebase. This asserts the absence
 * rather than trusting the comment that claims it, so a future export helper that
 * posts somewhere fails the build here.
 */
describe('the export module cannot transmit', () => {
  it('exports no name suggesting a send, submit, or post', () => {
    const suspicious = Object.keys(pain001Module).filter((name) =>
      /send|submit|post|transmit|dispatch|upload/i.test(name),
    );
    expect(suspicious).toEqual([]);
  });

  it('exports only builders and one constant', () => {
    expect(Object.keys(pain001Module).sort()).toEqual([
      'TO_BE_COMPLETED',
      'buildPain001',
      'buildPaymentCsv',
      'minorToDecimal',
    ]);
  });
});
