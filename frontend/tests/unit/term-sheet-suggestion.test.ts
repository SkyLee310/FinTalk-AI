import { describe, expect, it } from 'vitest';
import type { TermSheetFormFields } from '../../src/lib/term-sheet-suggestion';
import { applySuggestion } from '../../src/lib/term-sheet-suggestion';

const EMPTY: TermSheetFormFields = {
  applicantName: '',
  amount: '',
  tenureMonths: '60',
  facilityKind: 'ISLAMIC',
  rateBps: '800',
  contract: 'MURABAHAH',
};

describe('applySuggestion', () => {
  it('fills every field the suggestion provides', () => {
    const result = applySuggestion(EMPTY, {
      applicantName: 'Tech Solutions Sdn Bhd',
      principalMyr: '50000',
      tenureMonths: 60,
      facilityKind: 'ISLAMIC',
      rateBps: 800,
      islamicContract: 'MURABAHAH',
      modelId: 'm',
      promptVersion: 'v1',
    });

    expect(result.fields).toEqual({
      applicantName: 'Tech Solutions Sdn Bhd',
      amount: '50000',
      tenureMonths: '60',
      facilityKind: 'ISLAMIC',
      rateBps: '800',
      contract: 'MURABAHAH',
    });
    expect(result.suggested).toEqual([
      'applicantName',
      'amount',
      'tenureMonths',
      'facilityKind',
      'rateBps',
      'contract',
    ]);
  });

  it('overwrites a field the maker already typed', () => {
    const typed: TermSheetFormFields = { ...EMPTY, applicantName: 'A typo-ridden guess' };
    const result = applySuggestion(typed, {
      applicantName: 'Tech Solutions Sdn Bhd',
      modelId: 'm',
      promptVersion: 'v1',
    });

    expect(result.fields.applicantName).toBe('Tech Solutions Sdn Bhd');
    expect(result.suggested).toEqual(['applicantName']);
  });

  it('leaves a field the meeting never settled untouched and unmarked', () => {
    const result = applySuggestion(EMPTY, {
      applicantName: 'Tech Solutions Sdn Bhd',
      modelId: 'm',
      promptVersion: 'v1',
    });

    expect(result.fields.amount).toBe('');
    expect(result.fields.tenureMonths).toBe('60');
    expect(result.suggested).toEqual(['applicantName']);
  });

  it('applies a suggested Shariah contract when the facility is Islamic', () => {
    const result = applySuggestion(EMPTY, {
      facilityKind: 'ISLAMIC',
      islamicContract: 'TAWARRUQ',
      modelId: 'm',
      promptVersion: 'v1',
    });

    expect(result.fields.contract).toBe('TAWARRUQ');
    expect(result.suggested).toContain('contract');
  });

  it('drops a suggested contract when the suggested facility is conventional', () => {
    const result = applySuggestion(EMPTY, {
      facilityKind: 'CONVENTIONAL',
      islamicContract: 'TAWARRUQ',
      modelId: 'm',
      promptVersion: 'v1',
    });

    expect(result.fields.contract).toBe(EMPTY.contract);
    expect(result.suggested).not.toContain('contract');
  });

  it('drops a suggested contract when the form is already conventional and the suggestion is silent on facility kind', () => {
    const conventional: TermSheetFormFields = { ...EMPTY, facilityKind: 'CONVENTIONAL' };
    const result = applySuggestion(conventional, {
      islamicContract: 'TAWARRUQ',
      modelId: 'm',
      promptVersion: 'v1',
    });

    expect(result.fields.contract).toBe(conventional.contract);
    expect(result.suggested).not.toContain('contract');
  });

  it('returns the fields unchanged and nothing suggested for an empty suggestion', () => {
    const result = applySuggestion(EMPTY, { modelId: 'none', promptVersion: 'none' });

    expect(result.fields).toEqual(EMPTY);
    expect(result.suggested).toEqual([]);
  });
});
