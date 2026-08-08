import { describe, expect, it } from 'vitest';
import { validateFacility } from '../../../src/compliance/termsheet.js';

const ISLAMIC = {
  facilityKind: 'ISLAMIC' as const,
  profitRateBps: 800,
  islamicContract: 'MURABAHAH' as const,
  principalMinor: 5_000_000n,
  tenureMonths: 60,
};

const CONVENTIONAL = {
  facilityKind: 'CONVENTIONAL' as const,
  interestRateBps: 800,
  principalMinor: 5_000_000n,
  tenureMonths: 60,
};

describe('validateFacility — Islamic', () => {
  it('accepts a profit rate under a named contract', () => {
    expect(validateFacility(ISLAMIC)).toBeNull();
  });

  // The deck's slide 6 / slide 7 contradiction, refused before it reaches the DB.
  it('refuses an interest rate', () => {
    expect(validateFacility({ ...ISLAMIC, interestRateBps: 800 }))
      .toMatch(/cannot carry an interest rate/);
  });

  it('refuses a missing profit rate', () => {
    expect(
      validateFacility({
        facilityKind: 'ISLAMIC',
        islamicContract: 'MURABAHAH',
        principalMinor: 5_000_000n,
        tenureMonths: 60,
      }),
    ).toMatch(/requires a profit rate/);
  });

  it('refuses a missing contract', () => {
    expect(
      validateFacility({
        facilityKind: 'ISLAMIC',
        profitRateBps: 800,
        principalMinor: 5_000_000n,
        tenureMonths: 60,
      }),
    ).toMatch(/requires a named contract/);
  });
});

describe('validateFacility — conventional', () => {
  it('accepts an interest rate', () => {
    expect(validateFacility(CONVENTIONAL)).toBeNull();
  });

  it('refuses a profit rate', () => {
    expect(validateFacility({ ...CONVENTIONAL, profitRateBps: 800 }))
      .toMatch(/not a profit rate/);
  });

  it('refuses a named Shariah contract', () => {
    expect(validateFacility({ ...CONVENTIONAL, islamicContract: 'IJARAH' }))
      .toMatch(/cannot name a Shariah contract/);
  });

  it('refuses a missing interest rate', () => {
    expect(
      validateFacility({
        facilityKind: 'CONVENTIONAL',
        principalMinor: 5_000_000n,
        tenureMonths: 60,
      }),
    ).toMatch(/requires an interest rate/);
  });
});

describe('validateFacility — amounts', () => {
  it('refuses a zero or negative principal', () => {
    expect(validateFacility({ ...ISLAMIC, principalMinor: 0n })).toMatch(/greater than zero/);
    expect(validateFacility({ ...ISLAMIC, principalMinor: -1n })).toMatch(/greater than zero/);
  });

  it('refuses a zero or fractional tenure', () => {
    expect(validateFacility({ ...ISLAMIC, tenureMonths: 0 })).toMatch(/whole number/);
    expect(validateFacility({ ...ISLAMIC, tenureMonths: 12.5 })).toMatch(/whole number/);
  });

  it('refuses a negative rate', () => {
    expect(validateFacility({ ...ISLAMIC, profitRateBps: -1 })).toMatch(/cannot be negative/);
  });

  it('accepts a principal beyond Number.MAX_SAFE_INTEGER', () => {
    expect(validateFacility({ ...ISLAMIC, principalMinor: 9_007_199_254_740_993n }))
      .toBeNull();
  });

  it('treats an explicit null the same as an absent field', () => {
    expect(validateFacility({ ...ISLAMIC, interestRateBps: null })).toBeNull();
    expect(validateFacility({ ...CONVENTIONAL, profitRateBps: null })).toBeNull();
  });
});
