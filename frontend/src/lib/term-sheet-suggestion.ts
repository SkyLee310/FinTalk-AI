import type { FacilityKind, TermSheetSuggestion } from './api';

/**
 * The subset of TermSheetForm's state a suggestion can fill, keyed the way
 * the form's own React state already is — `amount`/`contract` rather than
 * the wire names `principalMyr`/`islamicContract` — since Draft-and-submit
 * already speaks in these names.
 */
export interface TermSheetFormFields {
  applicantName: string;
  amount: string;
  tenureMonths: string;
  facilityKind: FacilityKind;
  rateBps: string;
  contract: string;
}

export type TermSheetSuggestedField =
  | 'applicantName'
  | 'amount'
  | 'tenureMonths'
  | 'facilityKind'
  | 'rateBps'
  | 'contract';

export interface AppliedSuggestion {
  fields: TermSheetFormFields;
  /** Which fields the suggestion actually changed, for the caller to mark. */
  suggested: TermSheetSuggestedField[];
}

/**
 * Merges a suggestion into the form's current fields.
 *
 * A field the suggestion provides overwrites whatever is currently typed —
 * the point of clicking "Suggest" is to have the meeting's own words fill
 * the form — and is reported back in `suggested`, so the caller can mark it
 * and clear the mark the moment a person edits it directly. A field the
 * meeting never settled is left exactly as it was: absent in
 * TermSheetSuggestion means "not stated", never "clear this".
 *
 * islamicContract is only ever applied when the *resulting* facilityKind is
 * ISLAMIC. The backend already withholds it otherwise, but a contract name
 * left over from a stale suggestion must not survive a switch to
 * conventional, whether that switch came from this same suggestion or from
 * whatever the form already held.
 */
export function applySuggestion(
  current: TermSheetFormFields,
  suggestion: TermSheetSuggestion,
): AppliedSuggestion {
  const fields = { ...current };
  const suggested: TermSheetSuggestedField[] = [];

  if (suggestion.applicantName !== undefined) {
    fields.applicantName = suggestion.applicantName;
    suggested.push('applicantName');
  }
  if (suggestion.principalMyr !== undefined) {
    fields.amount = suggestion.principalMyr;
    suggested.push('amount');
  }
  if (suggestion.tenureMonths !== undefined) {
    fields.tenureMonths = String(suggestion.tenureMonths);
    suggested.push('tenureMonths');
  }
  if (suggestion.facilityKind !== undefined) {
    fields.facilityKind = suggestion.facilityKind;
    suggested.push('facilityKind');
  }
  if (suggestion.rateBps !== undefined) {
    fields.rateBps = String(suggestion.rateBps);
    suggested.push('rateBps');
  }
  if (suggestion.islamicContract !== undefined && fields.facilityKind === 'ISLAMIC') {
    fields.contract = suggestion.islamicContract;
    suggested.push('contract');
  }

  return { fields, suggested };
}
