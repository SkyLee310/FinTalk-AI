'use client';

import { useState, type FormEvent } from 'react';
import { Card, CardHeader } from '@/components/card';
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Select,
  SuccessNote,
} from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import {
  api,
  can,
  type FacilityKind,
  type MeetingDetail,
  type Session,
  type ShariahFlagRow,
} from '@/lib/api';
import { applySuggestion, type TermSheetSuggestedField } from '@/lib/term-sheet-suggestion';

const CONTRACTS = [
  'MURABAHAH',
  'TAWARRUQ',
  'IJARAH',
  'MUSHARAKAH',
  'MUDHARABAH',
  'ISTISNA',
  'SALAM',
];

const SUGGESTED_HINT = 'Suggested from the meeting — edit to override.';
const SUGGESTED_RING = 'ring-2 ring-brand/40';

function DraftForm({
  meetingId,
  blockedBy,
}: {
  meetingId: string;
  blockedBy: ShariahFlagRow[];
}) {
  const [applicantName, setApplicantName] = useState('');
  const [amount, setAmount] = useState('');
  const [tenureMonths, setTenureMonths] = useState('60');
  const [facilityKind, setFacilityKind] = useState<FacilityKind>('ISLAMIC');
  const [rateBps, setRateBps] = useState('800');
  const [contract, setContract] = useState('MURABAHAH');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedFields, setSuggestedFields] = useState<TermSheetSuggestedField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const islamic = facilityKind === 'ISLAMIC';
  const blocked = blockedBy.length > 0;

  function clearSuggested(field: TermSheetSuggestedField): void {
    setSuggestedFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : prev));
  }

  function withSuggestedHint(field: TermSheetSuggestedField, base?: string): string | undefined {
    if (!suggestedFields.includes(field)) return base;
    return base === undefined ? SUGGESTED_HINT : `${base} ${SUGGESTED_HINT}`;
  }

  function suggestedRing(field: TermSheetSuggestedField): string | undefined {
    return suggestedFields.includes(field) ? SUGGESTED_RING : undefined;
  }

  async function suggest(): Promise<void> {
    setError(null);
    setResult(null);
    setSuggesting(true);
    try {
      const suggestion = await api.suggestTermSheet(meetingId);
      const applied = applySuggestion(
        { applicantName, amount, tenureMonths, facilityKind, rateBps, contract },
        suggestion,
      );
      setApplicantName(applied.fields.applicantName);
      setAmount(applied.fields.amount);
      setTenureMonths(applied.fields.tenureMonths);
      setFacilityKind(applied.fields.facilityKind);
      setRateBps(applied.fields.rateBps);
      setContract(applied.fields.contract);
      setSuggestedFields(applied.suggested);
      setResult(
        applied.suggested.length > 0
          ? `Filled ${String(applied.suggested.length)} field(s) from the meeting. Review each before submitting.`
          : 'The meeting did not clearly state any of these fields, so nothing was filled in.',
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSuggesting(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (blocked) {
      const kinds = [...new Set(blockedBy.map((flag) => flag.issueType))].join(', ');
      setError(
        `Not submitted, and nothing was saved. ${String(blockedBy.length)} Shariah `
        + `finding(s) are still open (${kinds}). A Shariah reviewer must clear them `
        + 'before this meeting can go to a checker.',
      );
      return;
    }

    setBusy(true);
    try {
      const sheet = await api.draftTermSheet(meetingId, {
        applicantName,
        principalMinor: `${amount.replace(/[^0-9]/g, '')}00`,
        tenureMonths: Number(tenureMonths),
        facilityKind,
        interestRateBps: islamic ? null : Number(rateBps),
        profitRateBps: islamic ? Number(rateBps) : null,
        islamicContract: islamic ? contract : null,
      });

      let submitted;
      try {
        submitted = await api.submitTermSheet(sheet.id);
      } catch (cause) {
        setError(
          `${describeError(cause)} The term sheet was drafted but NOT submitted, so no checker will see it.`,
        );
        return;
      }

      setResult(
        `Term sheet drafted at ${sheet.currency} ${sheet.principalFormatted} and `
        + `submitted for checking (${submitted.decision}). It is now on the Approvals page for a checker.`,
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-4 p-4 sm:p-6"
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && <SuccessNote>{result}</SuccessNote>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised px-4 py-3">
        <p className="text-xs text-muted">
          Fill these fields from what the meeting and any whiteboard captures actually discussed.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void suggest();
          }}
          disabled={busy || suggesting}
        >
          {suggesting ? 'Reading meeting…' : 'Suggest from meeting AI'}
        </Button>
      </div>

      <Field label="Applicant Name" htmlFor="applicant" hint={withSuggestedHint('applicantName')}>
        <Input
          id="applicant"
          required
          value={applicantName}
          onChange={(event) => {
            setApplicantName(event.target.value);
            clearSuggested('applicantName');
          }}
          placeholder="Tech Solutions Sdn Bhd"
          className={suggestedRing('applicantName')}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Principal (MYR)"
          htmlFor="amount"
          hint={withSuggestedHint('amount', 'Whole ringgit amount.')}
        >
          <Input
            id="amount"
            required
            inputMode="numeric"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              clearSuggested('amount');
            }}
            placeholder="50000"
            className={suggestedRing('amount')}
          />
        </Field>

        <Field label="Tenure (months)" htmlFor="tenure" hint={withSuggestedHint('tenureMonths')}>
          <Input
            id="tenure"
            required
            inputMode="numeric"
            value={tenureMonths}
            onChange={(event) => {
              setTenureMonths(event.target.value);
              clearSuggested('tenureMonths');
            }}
            className={suggestedRing('tenureMonths')}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Facility Kind" htmlFor="kind" hint={withSuggestedHint('facilityKind')}>
          <Select
            id="kind"
            value={facilityKind}
            onChange={(event) => {
              setFacilityKind(event.target.value as FacilityKind);
              clearSuggested('facilityKind');
            }}
            className={suggestedRing('facilityKind')}
          >
            <option value="ISLAMIC">Islamic</option>
            <option value="CONVENTIONAL">Conventional</option>
          </Select>
        </Field>

        <Field
          label={islamic ? 'Profit Rate (bps)' : 'Interest Rate (bps)'}
          htmlFor="rate"
          hint={withSuggestedHint('rateBps', '800 bps is 8.00%.')}
        >
          <Input
            id="rate"
            required
            inputMode="numeric"
            value={rateBps}
            onChange={(event) => {
              setRateBps(event.target.value);
              clearSuggested('rateBps');
            }}
            className={suggestedRing('rateBps')}
          />
        </Field>
      </div>

      {islamic && (
        <Field label="Shariah Contract" htmlFor="contract" hint={withSuggestedHint('contract')}>
          <Select
            id="contract"
            value={contract}
            onChange={(event) => {
              setContract(event.target.value);
              clearSuggested('contract');
            }}
            className={suggestedRing('contract')}
          >
            {CONTRACTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <p className="text-xs text-muted">
        An Islamic facility carries a profit rate under a named Shariah contract and never an interest rate.
      </p>

      <Button type="submit" disabled={busy || blocked}>
        {busy
          ? 'Submitting…'
          : blocked
            ? `Blocked by ${String(blockedBy.length)} open Shariah finding${blockedBy.length === 1 ? '' : 's'}`
            : 'Draft and submit for checking'}
      </Button>
    </form>
  );
}

export interface TermSheetSectionProps {
  meeting: MeetingDetail;
  session: Session | null;
  onRefresh: () => void;
}

export function TermSheetSection({
  meeting,
  session,
}: TermSheetSectionProps) {
  const isMaker = can(session, 'termsheet:draft') || can(session, 'termsheet:submit');

  const openFlags: ShariahFlagRow[] = (meeting.shariahFlags ?? []).filter(
    (f: ShariahFlagRow) => f.status === 'FLAGGED' || f.status === 'UNDER_REVIEW',
  );

  return (
    <div className="space-y-6">
      {/* Drafting Form for Maker Role */}
      {isMaker ? (
        <Card>
          <CardHeader
            title="Draft Facility Term Sheet"
            description="Draft and route facility terms to the independent checker. Grounded by AI suggestions from the meeting."
          />
          <DraftForm
            meetingId={meeting.id}
            blockedBy={openFlags}
          />
        </Card>
      ) : (
        <EmptyState
          title="Maker Access Required"
          body="Only Maker accounts (termsheet:draft / termsheet:submit) can draft and submit term sheets from this meeting."
        />
      )}
    </div>
  );
}
