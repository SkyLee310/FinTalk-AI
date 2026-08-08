import { describe, expect, it } from 'vitest';
import { redact } from '../../../src/pdpa/redactor.js';
import { analyseTranscript } from '../../../src/shariah/engine.js';
import { SHARIAH_RULES } from '../../../src/shariah/rules.js';

const KEY = Buffer.alloc(32, 13);

/** The engine only accepts redacted text, so tests go through the real barrier. */
function redacted(text: string) {
  return redact(text, KEY).text;
}

function kindsOf(text: string, isIslamic?: boolean) {
  const context = isIslamic === undefined ? {} : { isIslamic };
  return analyseTranscript(redacted(text), context).map((f) => f.issueType);
}

describe('riba detection', () => {
  it('flags an interest rate quoted for an Islamic facility', () => {
    expect(kindsOf('we quote fixed interest rate of 8% per annum lah')).toContain('RIBA');
  });

  it('flags the Malay term faedah', () => {
    expect(kindsOf('kadar faedah untuk pembiayaan ini')).toContain('RIBA');
  });

  it('flags a bare annual percentage', () => {
    expect(kindsOf('pricing is 7.5% p.a. on the outstanding')).toContain('RIBA');
  });

  it('flags compounding', () => {
    expect(kindsOf('with compounded interest on arrears')).toContain('RIBA');
  });

  /**
   * A conventional facility quoting interest is doing its job. Flagging it would
   * bury the findings that matter under noise nobody can act on.
   */
  it('does not flag interest on a facility known to be conventional', () => {
    expect(kindsOf('we quote fixed interest rate of 8% per annum', false))
      .not.toContain('RIBA');
  });

  it('treats an unknown facility kind as Islamic', () => {
    expect(kindsOf('we quote fixed interest rate of 8% per annum', undefined))
      .toContain('RIBA');
  });
});

describe('other issue types', () => {
  it('flags a late payment charge for a reviewer to classify', () => {
    expect(kindsOf('kalau lambat bayar, we charge denda')).toContain('LATE_PAYMENT_PENALTY');
    expect(kindsOf('a late payment charge applies')).toContain('LATE_PAYMENT_PENALTY');
  });

  it('flags speculation regardless of facility kind', () => {
    expect(kindsOf('the client wants spekulasi on the currency', false)).toContain('MAYSIR');
  });

  it('flags a prohibited sector regardless of facility kind', () => {
    expect(kindsOf('borrower operates a brewery in Shah Alam', false))
      .toContain('HARAM_SECTOR');
  });

  it('flags an unspecified term as gharar', () => {
    expect(kindsOf('the profit rate is still to be determined')).toContain('GHARAR');
  });
});

describe('contract mismatch', () => {
  /**
   * Naming Murabahah is ordinary Islamic banking. A flag on every mention would
   * train reviewers to dismiss the flag, which is worse than not raising it.
   */
  it('does not flag an Islamic contract mentioned on its own', () => {
    expect(kindsOf('kena guna Murabahah profit rate for this facility'))
      .not.toContain('CONTRACT_MISMATCH');
  });

  // The contradiction the pitch deck's own slides 6 and 7 contained.
  it('flags an Islamic contract named alongside an interest rate', () => {
    const kinds = kindsOf(
      'Islamic facility under Murabahah, but we quote fixed interest rate of 8% per annum',
    );
    expect(kinds).toContain('RIBA');
    expect(kinds).toContain('CONTRACT_MISMATCH');
  });
});

describe('findings are advisory, never rulings', () => {
  it('carries a reference marked as needing confirmation', () => {
    for (const finding of analyseTranscript(redacted('interest rate of 8% per annum'))) {
      expect(finding.reference).toMatch(/requires legal confirmation/);
    }
  });

  it('reports no status, so nothing in the output can read as resolved', () => {
    const findings = analyseTranscript(redacted('interest rate of 8% per annum'));
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        'confidence',
        'detectedBy',
        'excerpt',
        'issueType',
        'reference',
      ]);
    }
  });

  it('names the rule that fired, so a committee can review the rule itself', () => {
    const ids = new Set(SHARIAH_RULES.map((r) => r.id));
    for (const finding of analyseTranscript(redacted('brewery and interest rate'))) {
      expect(ids.has(finding.detectedBy)).toBe(true);
    }
  });

  it('keeps every confidence within the range the DB constraint allows', () => {
    for (const finding of analyseTranscript(
      redacted('interest rate, denda, brewery, judi'),
    )) {
      expect(finding.confidence).toBeGreaterThan(0);
      expect(finding.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('excerpts and hygiene', () => {
  it('never puts an identifier in an excerpt', () => {
    const source = 'Director IC 880101-14-5678 agreed the interest rate of 8% per annum.';
    const findings = analyseTranscript(redacted(source));
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.excerpt).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    }
    expect(findings.some((f) => f.excerpt.includes('[NRIC_1]'))).toBe(true);
  });

  it('returns nothing for a clean Islamic discussion', () => {
    expect(
      analyseTranscript(
        redacted('Facility structured as Murabahah with an agreed profit rate of 500 bps.'),
      ),
    ).toEqual([]);
  });

  it('sorts the most confident finding first', () => {
    const findings = analyseTranscript(
      redacted('interest rate of 8% per annum, and gharar'),
    );
    for (let i = 1; i < findings.length; i += 1) {
      expect(findings[i - 1]!.confidence).toBeGreaterThanOrEqual(findings[i]!.confidence);
    }
  });

  /**
   * The rule patterns are module-level literals carrying /g. If the engine reused
   * them, lastIndex would persist and a second call on the same text would
   * silently return fewer findings.
   */
  it('gives identical results when called twice with the same text', () => {
    const text = redacted('interest rate of 8% per annum, denda, brewery, Murabahah');
    expect(analyseTranscript(text)).toEqual(analyseTranscript(text));
  });

  it('caps repeated matches so one noisy transcript cannot flood the review queue', () => {
    const text = redacted(Array.from({ length: 40 }, () => 'interest rate').join(' '));
    const riba = analyseTranscript(text).filter((f) => f.issueType === 'RIBA');
    expect(riba.length).toBeLessThanOrEqual(5);
  });
});
