'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Card, CardHeader, DataRow } from '@/components/card';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { SegmentReview, TranscriptConfidence } from '@/components/segment-review';
import { TransferRecord } from '@/components/transfer-notice';
import {
  Button,
  Disclosure,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
  SuccessNote,
  Textarea,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import {
  api,
  can,
  type FacilityKind,
  type MeetingStatus,
  type Session,
  type ShariahFlagRow,
  type ShariahStatus,
  timecode,
  WHITEBOARD_KIND_LABEL,
} from '@/lib/api';
import { formatDuration } from '@/lib/duration';
import { formatDateTime } from '@/lib/format';
import { computeParticipation, participationNudge } from '@/lib/participation';
import { guidanceFor, SHARIAH_ISSUE_ORDER } from '@/lib/shariah-guidance';
import { applySuggestion, type TermSheetSuggestedField } from '@/lib/term-sheet-suggestion';

const FLAG_TONE: Record<ShariahStatus, Tone> = {
  FLAGGED: 'warn',
  UNDER_REVIEW: 'brand',
  CLEARED: 'ok',
  CONFIRMED_VIOLATION: 'danger',
};

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
/** Additive box-shadow, not a border color — CONTROL already owns border-color. */
const SUGGESTED_RING = 'ring-2 ring-brand/40';

/** Renders redaction placeholders as visible chips, so masking is evident. */
function RedactedText({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Z_]+_\d+\])/g);
  return (
    <>
      {parts.map((part, index) =>
        /^\[[A-Z_]+_\d+\]$/.test(part) ? (
          <span
            key={`${part}-${String(index)}`}
            title="Personal data, redacted before storage"
            className="mx-0.5 rounded border border-brand/40 bg-brand-soft px-1 font-mono text-xs text-brand"
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Renders a Shariah excerpt with two independent overlays: PII placeholders
 * get the same redaction chip as RedactedText, and phrases the engine
 * actually matched (`highlights`) get a highlight mark — so a reviewer sees,
 * at a glance, which words in the quote are what tripped the rule.
 */
function ShariahExcerpt({ text, highlights }: { text: string; highlights: readonly string[] }) {
  const highlightPatterns = highlights.filter((phrase) => phrase.length > 0).map(escapeRegExp);
  const patterns = ['\\[[A-Z_]+_\\d+\\]', ...highlightPatterns];
  const splitter = new RegExp(`(${patterns.join('|')})`, 'g');
  const placeholderTest = /^\[[A-Z_]+_\d+\]$/;
  const highlightSet = new Set(highlights);

  return (
    <>
      {text.split(splitter).map((part, index) => {
        if (placeholderTest.test(part)) {
          return (
            <span
              key={`${part}-${String(index)}`}
              title="Personal data, redacted before storage"
              className="mx-0.5 rounded border border-brand/40 bg-brand-soft px-1 font-mono text-xs text-brand"
            >
              {part}
            </span>
          );
        }
        if (highlightSet.has(part)) {
          return (
            <mark key={`${part}-${String(index)}`} className="rounded bg-warn-soft px-0.5 text-inherit">
              {part}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

/** Safely formats structured whiteboard JSON values for display without raw [object Object]. */
function renderStructuredValue(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    if (value === '[object Object]') {
      return <span className="text-faint italic font-normal">(Details extracted in diagram above)</span>;
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return (
          <pre className="overflow-x-auto rounded-lg border border-line bg-raised p-2 text-xs leading-relaxed font-mono">
            <code>
              <RedactedText text={JSON.stringify(parsed, null, 2)} />
            </code>
          </pre>
        );
      }
    } catch {
      // Plain text
    }
    return <RedactedText text={value} />;
  }
  if (typeof value === 'object') {
    return (
      <pre className="overflow-x-auto rounded-lg border border-line bg-raised p-2 text-xs leading-relaxed font-mono">
        <code>
          <RedactedText text={JSON.stringify(value, null, 2)} />
        </code>
      </pre>
    );
  }
  return <RedactedText text={String(value)} />;
}

/**
 * Plain-language names for what each rule looked for.
 *
 * The reviewer is answering a question about a concept, not about an enum. RIBA
 * on a screen tells a qualified officer something; it tells everyone else
 * nothing, and a decision made from a label nobody parsed is not a review.
 */
const ISSUE_LABEL: Record<string, string> = {
  RIBA: 'riba — interest, or a charge that functions as interest',
  GHARAR: 'gharar — excessive uncertainty in the contract terms',
  MAYSIR: 'maysir — a speculative or gambling element',
  HARAM_SECTOR: 'a prohibited business sector',
  CONTRACT_MISMATCH: 'a mismatch between the contract named and the terms described',
  LATE_PAYMENT_PENALTY: 'a late-payment penalty that may function as interest',
};

/**
 * The Shariah decision, asked as a question rather than offered as a dropdown.
 *
 * Item 7: the human answers yes or no; the system does not decide. The three
 * outcomes are the same enum values as before — the change is that they are
 * phrased as answers a person can actually give, and each button states what it
 * commits to. "Confirmed violation" as a select option asked the reviewer to
 * translate their judgement into the schema's vocabulary before recording it.
 *
 * Yes and no are equally prominent and neither is preselected. A default answer
 * to a compliance question is an answer nobody gave.
 */
function ReviewForm({ flags, onDone }: { flags: ShariahFlagRow[]; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ShariahStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(status: ShariahStatus): Promise<void> {
    setBusy(status);
    setError(null);
    try {
      // Every occurrence gets the same verdict and reasoning in one action —
      // they are the same rule's reading of the same issue type, repeated
      // across sentences, not N separate judgement calls for one reviewer.
      await Promise.all(flags.map((flag) => api.reviewFlag(flag.id, status, note)));
      onDone();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  const primary = flags[0]!;
  const described = ISSUE_LABEL[primary.issueType] ?? primary.issueType;
  const noteRequired = note.trim() === '';
  const multiple = flags.length > 1;

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="rounded-lg border border-line bg-raised p-4">
        <p className="text-sm font-medium">
          Is this a genuine Shariah concern?
        </p>
        <p className="mt-1 text-sm text-muted">
          The <span className="font-mono text-xs">{primary.detectedBy}</span> rule flagged
          what may be {described}
          {multiple ? `, at ${String(flags.length)} places in this transcript` : ''}. That is
          a machine reading of the transcript, not a ruling. Your answer is the ruling
          {multiple ? ' for all of them' : ''}.
        </p>
      </div>

      <Field
        label="Your reasoning"
        htmlFor={`note-${primary.id}`}
        hint="Required for yes or no. Cite the placeholder, e.g. [NRIC_1] — a note containing personal data is rejected."
      >
        <Textarea
          id={`note-${primary.id}`}
          rows={3}
          value={note}
          disabled={busy !== null}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        {/*
          Yes is the danger variant because confirming a violation blocks the
          facility — the visual weight matches the consequence, not the sentiment.
        */}
        <Button
          variant="danger"
          disabled={busy !== null || noteRequired}
          onClick={() => {
            void record('CONFIRMED_VIOLATION');
          }}
        >
          {busy === 'CONFIRMED_VIOLATION' ? 'Recording…' : 'Yes — this is a violation'}
        </Button>
        <Button
          disabled={busy !== null || noteRequired}
          onClick={() => {
            void record('CLEARED');
          }}
        >
          {busy === 'CLEARED' ? 'Recording…' : 'No — not an issue'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => {
            void record('UNDER_REVIEW');
          }}
        >
          {busy === 'UNDER_REVIEW' ? 'Recording…' : 'Needs more review'}
        </Button>
      </div>

      {noteRequired && (
        <p className="text-xs text-faint">
          A yes or no answer must record your reasoning. &ldquo;Needs more
          review&rdquo; does not.
        </p>
      )}

      <p className="text-xs text-faint">
        Either answer is recorded against the rule that raised it
        {multiple ? ', for every occurrence shown here,' : ''} so how often the
        system was right can be measured later. A facility cannot be submitted while
        any finding is still open.
      </p>
    </div>
  );
}

function TermSheetForm({
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

  /** Clears a field's AI-suggested marker the moment a person edits it directly. */
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

  /**
   * Fills the form from the meeting's own transcript and whiteboards. A
   * maker reviews and can edit every field before Draft and submit does
   * anything real — this never drafts or submits on its own.
   */
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
          ? `Filled ${String(applied.suggested.length)} field(s) from the meeting. Review `
            + 'each before submitting.'
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

    /**
     * Refused here rather than at the server.
     *
     * This drafts and then submits, so a submission the compliance gate was
     * always going to refuse still left a DRAFT term sheet behind. A tester hit
     * it eleven times: eleven orphaned drafts, eleven termsheet.drafted audit
     * entries, no submission, and no obvious reason why the checker never saw
     * anything. Nothing is written unless the submission can actually proceed.
     */
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
        // Major units in, minor units out, by string concatenation rather than
        // multiplication — no float touches the amount.
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
        /**
         * The draft committed and the submission did not. Saying so is the
         * point: a maker cannot otherwise tell a refused submission from a lost
         * one, and the difference decides whether they retry or go find a
         * reviewer.
         */
        setError(
          `${describeError(cause)} The term sheet was drafted but NOT submitted, so no `
          + 'checker will see it.',
        );
        return;
      }

      setResult(
        `Term sheet drafted at ${sheet.currency} ${sheet.principalFormatted} and `
        + `submitted for checking (${submitted.decision}). It is now on the `
        + 'Approvals page for a checker.',
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
      className="space-y-4 px-5 py-4"
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && <SuccessNote>{result}</SuccessNote>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3.5 py-2.5">
        <p className="text-xs text-faint">
          Fill these fields from what the meeting and any whiteboard captures actually said.
        </p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void suggest();
          }}
          disabled={busy || suggesting}
        >
          {suggesting ? 'Reading meeting…' : 'Suggest from meeting'}
        </Button>
      </div>

      <Field
        label="Applicant"
        htmlFor="applicant"
        hint={withSuggestedHint('applicantName')}
      >
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
          hint={withSuggestedHint('amount', 'Whole ringgit.')}
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
        <Field label="Facility kind" htmlFor="kind" hint={withSuggestedHint('facilityKind')}>
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
          label={islamic ? 'Profit rate (bps)' : 'Interest rate (bps)'}
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
        <Field label="Shariah contract" htmlFor="contract" hint={withSuggestedHint('contract')}>
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

      <p className="text-xs text-faint">
        An Islamic facility carries a profit rate under a named contract and never an
        interest rate. The database refuses the combination outright.
      </p>

      {/*
        Disabled while findings are open, so the gate is visible before the click
        rather than discovered after it. The guard in submit() is still the one
        that decides — a disabled button is a courtesy, not an invariant.
      */}
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

/** How long "usually 2 to 3 minutes" gets to run before the copy admits it's running late. */
const SOFT_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Stands in for the transcript while the pipeline is still running or has
 * already failed. This only animates the wait — the actual polling lives in
 * MeetingDetailPage's effect below, since that is what owns the fetch.
 */
function ProcessingStatus({
  status,
  failureReason,
}: {
  status: MeetingStatus;
  failureReason: string | null;
}) {
  const router = useRouter();
  const startedAt = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const failed = status === 'FAILED' || failureReason !== null;

  useEffect(() => {
    if (failed) return undefined;
    const tick = setInterval(() => {
      setElapsedMs(Date.now() - startedAt.current);
    }, 1000);
    return () => clearInterval(tick);
  }, [failed]);

  if (failed) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Transcription could not be completed</p>
            <p className="mt-1 text-sm text-muted">
              {failureReason === null
                ? 'The AI service did not respond.'
                : `The pipeline failed during ${failureReason}.`}{' '}
              Your audio was not stored, so there is nothing to resume. You can try
              again.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => router.push('/record')}>Try again</Button>
              <Button variant="secondary" onClick={() => router.push('/meetings')}>
                Back
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const overdue = elapsedMs > SOFT_TIMEOUT_MS;
  // Never reaches 100 on its own — only a real status flip does that, once
  // polling picks it up. Capped short of full so there is always somewhere
  // left for it to go while it waits.
  const pct = Math.min(92, (elapsedMs / (3 * 60 * 1000)) * 100);

  return (
    <div className="rounded-lg border border-line bg-raised px-5 py-4">
      <Button variant="secondary" disabled>
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-line-strong border-t-brand"
        />
        Transcribing…
      </Button>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="Transcription progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
          style={{ width: `${String(pct)}%` }}
        />
      </div>

      <p className="mt-3 text-sm font-medium">
        {overdue
          ? 'Still transcribing — this is taking longer than usual.'
          : 'Transcribing audio — usually 2 to 3 minutes.'}
      </p>
      <p className="mt-0.5 text-xs text-faint">
        Step 1 of 3 · then redaction, then Shariah screening
      </p>
    </div>
  );
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const session = useAsync<Session>(() => api.me(), 'session');
  const meeting = useAsync(() => api.meeting(id), `meeting:${id}`);
  const whiteboards = useAsync(() => api.whiteboards(id), `whiteboards:${id}`);
  /** Keyed by issue type ("group-RIBA"), not a single flag id — one review covers every occurrence of that issue. */
  const [openReview, setOpenReview] = useState<string | null>(null);
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);

  /** Scrolls a transcript segment into view and briefly highlights it. */
  function jumpToSegment(segmentId: string): void {
    document.getElementById(segmentId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedSegmentId(segmentId);
    window.setTimeout(() => {
      setHighlightedSegmentId((current) => (current === segmentId ? null : current));
    }, 2000);
  }

  const maySubmit = can(session.data, 'termsheet:submit');
  const mayReview = can(session.data, 'shariah:review');
  /**
   * Segment review, not Shariah review — a different capability entirely.
   *
   * Gated on `transcript:read` but excluding VIEWER, which is read-only: a
   * viewer sees transcripts (and corrections others made) but cannot confirm
   * or correct segments. The backend rejects them too (segment-review.ts),
   * so this hides controls that would 403 rather than work.
   */
  const mayReviewTranscript =
    can(session.data, 'transcript:read') &&
    session.data?.role !== 'VIEWER' &&
    session.data?.role !== 'OVERSIGHT';

  /**
   * Transcription runs for minutes after the upload request already
   * returned (api.uploadMeeting's own doc comment), so this is the one
   * place that finds out when it lands. Silent, so a tick updates the page
   * in place rather than flashing it back to the top-level loading spinner
   * every 5 seconds. Stops itself once status leaves CAPTURED/PROCESSING —
   * a READY or FAILED meeting has nothing left to poll for.
   */
  const meetingStatus = meeting.data?.status;
  useEffect(() => {
    if (meetingStatus !== 'CAPTURED' && meetingStatus !== 'PROCESSING') return undefined;
    const poll = setInterval(() => {
      meeting.reload({ silent: true });
    }, 5000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meeting.reload is useCallback-stable; meeting itself is a fresh object every render and would restart the interval on every tick.
  }, [meetingStatus]);

  if (meeting.loading) return <Spinner label="Loading meeting" />;
  if (meeting.error !== null) return <ErrorNote>{meeting.error}</ErrorNote>;
  if (meeting.data === null) return <EmptyState title="Not found" body="No such meeting." />;

  const data = meeting.data;
  const unresolved = data.shariahFlags.filter((flag) => flag.status !== 'CLEARED');

  /**
   * One card per issue type, not per raw finding — a sentence quoting an
   * interest figure and the words "interest rate" in the same breath is one
   * occurrence of riba to a reviewer, even though the engine's dedup fix
   * still emits every genuinely distinct sentence as its own row. Known
   * types render in SHARIAH_ISSUE_ORDER; anything outside that static list
   * still renders (appended at the end) rather than silently dropping a
   * raised finding.
   */
  const knownIssueTypes = new Set(SHARIAH_ISSUE_ORDER);
  const otherIssueTypes = [...new Set(data.shariahFlags.map((flag) => flag.issueType))].filter(
    (issueType) => !knownIssueTypes.has(issueType),
  );
  const shariahGroups = [...SHARIAH_ISSUE_ORDER, ...otherIssueTypes]
    .map((issueType) => ({
      issueType,
      flags: data.shariahFlags
        .filter((flag) => flag.issueType === issueType)
        .sort((a, b) => b.confidence - a.confidence),
    }))
    .filter((group) => group.flags.length > 0);

  const segmentsById = new Map(
    (data.transcript?.segments ?? []).map((segment) => [segment.id, segment] as const),
  );

  /**
   * Built once and reused from two places: standalone (below) when there is
   * no transcript yet — a whiteboard can finish extracting before audio
   * finishes transcribing, since the two pipelines are independent — and
   * folded into the populated/empty grouping once there is one.
   */
  const whiteboardsHasData = (whiteboards.data?.whiteboards.length ?? 0) > 0;
  const whiteboardsContent = (
    <>
      {whiteboards.loading && <Spinner label="Loading attachments" />}
      {whiteboards.error !== null && <ErrorNote>{whiteboards.error}</ErrorNote>}

      {whiteboards.data?.whiteboards.length === 0 && (
        <EmptyState
          title="No attachments captured"
          body="Attach a whiteboard photo, a slide, a PDF or a document when you capture a meeting, and it's extracted and redacted alongside the transcript."
        />
      )}

      {whiteboards.data?.whiteboards.map((board) => (
        <Card key={board.id}>
          <CardHeader
            title={board.mermaid !== null ? 'Extracted diagram' : 'Extracted text'}
            description={`Model ${board.modelId} · prompt ${board.promptVersion}`}
            action={<Badge>{WHITEBOARD_KIND_LABEL[board.kind]}</Badge>}
          />
          <div className="space-y-4 px-5 py-4">
            {board.mermaid !== null ? (
              <>
                <MermaidDiagram source={board.mermaid} />

                {/*
                  The source stays reachable, collapsed. The drawing is what a
                  reviewer wants to look at; the source is what was actually
                  stored, and an auditor reconciling a redaction offset needs the
                  text rather than a picture of it.
                */}
                <details>
                  <summary className="cursor-pointer text-xs text-faint underline underline-offset-2">
                    View stored source
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-raised p-4 text-xs leading-relaxed">
                    <code>
                      <RedactedText text={board.mermaid} />
                    </code>
                  </pre>
                </details>
              </>
            ) : (
              // A DOCUMENT capture has no diagram — its own extracted text is
              // the thing to show, so it renders open rather than collapsed.
              <details open>
                <summary className="cursor-pointer text-xs text-faint underline underline-offset-2">
                  Extracted text
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-raised p-4 text-xs leading-relaxed">
                  <code>
                    <RedactedText text={board.rawRedacted} />
                  </code>
                </pre>
              </details>
            )}

            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
              {Object.entries(board.structuredJson as Record<string, unknown>).map(
                ([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-faint">{key}</dt>
                    <dd className="font-medium">{renderStructuredValue(value)}</dd>
                  </div>
                ),
              )}
            </dl>

            {board.redactions.length > 0 && (
              <p className="text-xs text-faint">
                {board.redactions.length} identifier
                {board.redactions.length === 1 ? '' : 's'} masked before storage.
              </p>
            )}
          </div>
        </Card>
      ))}
    </>
  );
  const whiteboardsSection = (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
        Attachments
      </h2>
      {whiteboardsContent}
    </section>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-bold tracking-[-0.02em] sm:text-3xl">{data.title}</h1>
          <p className="mt-1.5 text-sm text-muted">
            {formatDateTime(data.occurredAt)}
            {data.transcript && ` · ${data.transcript.languages.join(', ')}`}
            {data.transcript?.processingMs != null
              && ` · processed in ${formatDuration(data.transcript.processingMs)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.consentConfirmed && <Badge tone="ok">Consent confirmed</Badge>}
          {data.transferAcknowledged && <Badge tone="ok">Transfer acknowledged</Badge>}
          <Badge
            tone={data.status === 'READY' ? 'ok' : data.status === 'FAILED' ? 'danger' : 'warn'}
            dot
          >
            {data.status}
          </Badge>
        </div>
      </div>

      {/*
        The cross-border transfer, stated on the record rather than only at the
        moment it was agreed to. A meeting captured before this gate existed says
        so plainly — its audio still went to Google, and an empty space here would
        imply it had not.
      */}
      {data.description !== null && data.description !== '' && (
        <p className="max-w-2xl text-sm leading-relaxed text-muted">{data.description}</p>
      )}

      {data.participants.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
            Who was there
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.participants.map((participant) => (
              <li
                key={participant.id}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
              >
                {/*
                  A placeholder, never a name. The name is sealed in the vault,
                  and reading it back is a separate, separately-audited action
                  this page deliberately does not offer.
                */}
                <span className="font-mono text-xs text-brand">
                  {participant.nameRedacted}
                </span>
                {participant.role !== null && participant.role !== '' && (
                  <span className="ml-2 text-muted">{participant.role}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.transcript === null && (
        <>
          <ProcessingStatus status={data.status} failureReason={data.failureReason} />
          {whiteboardsSection}
        </>
      )}

      <div className="rounded-lg border border-line bg-raised px-4 py-3">
        <TransferRecord
          consentConfirmed={data.consentConfirmed}
          transferAcknowledged={data.transferAcknowledged}
        />
      </div>

      {/*
        Participation, Shariah findings and the term sheet sit here, ahead of
        the transcript, deliberately. A long recording's segment list can run
        to hundreds of entries, and these three are exactly what a reviewer
        opens the meeting to check — burying them below that list meant
        scrolling past the transcript in full every time. Participation and
        Shariah findings both need a transcript to say anything real (Shariah
        screening only runs after transcript storage, so flags are always
        empty before that), so both guard on data.transcript !== null. The
        term sheet stays visible throughout — a reviewer may want to start
        drafting early — but its description says so rather than claiming
        findings are clear before screening has run.
      */}
      {data.transcript !== null && (() => {
        const participation = computeParticipation(data.transcript.segments);
        return participation.length === 0 ? null : (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              Participation
            </h2>
            <Card className="px-5 py-4">
              <p className="text-xs text-faint">
                Talk share by speaker label. Labels are per-transcript tags and may
                not map to named participants.
              </p>
              <ul className="mt-3 space-y-3">
                {participation.map((speaker) => {
                  const nudge = participationNudge(speaker);
                  const pct = Math.round(speaker.share * 100);
                  return (
                    <li key={speaker.speakerLabel}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-brand">
                          {speaker.speakerLabel}
                        </span>
                        <span className="text-xs text-muted">
                          {pct}% · {formatDuration(speaker.totalMs)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-raised">
                        <div
                          className={`h-full rounded-full ${speaker.quiet ? 'bg-warn' : 'bg-brand'}`}
                          style={{ width: `${String(pct)}%` }}
                        />
                      </div>
                      {nudge !== null && (
                        <p className="mt-1.5 text-xs text-warn">{nudge}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        );
      })()}

      {data.transcript !== null && (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
            Shariah findings
          </h2>
          {unresolved.length > 0 && (
            <Badge tone="warn" dot>
              {unresolved.length} issue{unresolved.length === 1 ? '' : 's'} blocking approval
            </Badge>
          )}
        </div>

        {data.shariahFlags.length === 0 ? (
          <EmptyState title="No findings" body="The rule set raised nothing on this transcript." />
        ) : (
          <>
            <Card className="px-5 py-4">
              <p className="text-sm text-muted">
                Screened against {data.shariahRuleCount} rule{data.shariahRuleCount === 1 ? '' : 's'}{' '}
                across {SHARIAH_ISSUE_ORDER.length} issue types · {data.shariahFlags.length} raised
                finding{data.shariahFlags.length === 1 ? '' : 's'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {SHARIAH_ISSUE_ORDER.map((issueType) => {
                  const count = shariahGroups.find((g) => g.issueType === issueType)?.flags.length ?? 0;
                  const label = guidanceFor(issueType)?.shortLabel ?? issueType;
                  return (
                    <span
                      key={issueType}
                      className={
                        count > 0
                          ? 'rounded-full border border-warn/40 bg-warn-soft px-3 py-1 text-xs font-medium text-warn'
                          : 'rounded-full border border-line bg-raised px-3 py-1 text-xs text-faint'
                      }
                    >
                      {label} · {count > 0 ? count : 'none raised'}
                    </span>
                  );
                })}
              </div>
            </Card>

            <ul className="space-y-3">
              {shariahGroups.map((group) => {
                const guidance = guidanceFor(group.issueType);
                const label = guidance?.shortLabel ?? group.issueType;
                const primary = group.flags[0]!;
                const extra = group.flags.slice(1);
                const needsReview = group.flags.filter(
                  (flag) => flag.status !== 'CLEARED' && flag.status !== 'CONFIRMED_VIOLATION',
                );
                const primarySegment =
                  primary.segmentId === null ? null : segmentsById.get(primary.segmentId) ?? null;
                const groupKey = `group-${group.issueType}`;

                return (
                  <li key={group.issueType}>
                    <Card className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-sm font-semibold">{label}</span>{' '}
                          <span className="text-xs text-faint">
                            {group.flags.length} occurrence{group.flags.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <Badge tone={FLAG_TONE[primary.status]} dot>
                          {primary.status}
                        </Badge>
                      </div>

                      <p className="mt-2 text-sm italic leading-relaxed text-muted">
                        <ShariahExcerpt text={primary.excerpt} highlights={primary.highlights} />
                      </p>

                      {primarySegment !== null && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                          <span className="font-medium text-brand">{primarySegment.speakerLabel}</span>
                          <span className="font-mono">{timecode(primarySegment.startMs)}</span>
                          <button
                            type="button"
                            className="text-brand underline underline-offset-2"
                            onClick={() => jumpToSegment(primarySegment.id)}
                          >
                            Jump to transcript →
                          </button>
                        </div>
                      )}

                      <p className="mt-2 text-xs text-faint">
                        <span className="font-mono">{primary.detectedBy}</span> ·{' '}
                        {(primary.confidence * 100).toFixed(0)}% · {primary.reference}
                      </p>

                      {group.issueType === 'CONTRACT_MISMATCH' && (
                        <p className="mt-3 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted">
                          Raised only because a riba finding is also present. Naming an Islamic
                          contract on its own raises nothing.
                        </p>
                      )}

                      {/*
                        Request 3: a details view that says what was detected and
                        why it flags — drawn from the same guidance module as the
                        Islamic Banking page, so the two never disagree.
                      */}
                      <div className="mt-3">
                        <Disclosure summary="Details — what was detected, and why it flags">
                          <div className="space-y-3 text-sm leading-relaxed">
                            {extra.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                                  Also found at
                                </p>
                                <ul className="mt-1.5 space-y-1.5">
                                  {extra.map((flag) => {
                                    const segment =
                                      flag.segmentId === null
                                        ? null
                                        : segmentsById.get(flag.segmentId) ?? null;
                                    return (
                                      <li key={flag.id} className="text-muted">
                                        {segment !== null && (
                                          <>
                                            <span className="font-mono text-xs text-faint">
                                              {timecode(segment.startMs)}
                                            </span>{' '}
                                            <span className="text-xs font-medium text-brand">
                                              {segment.speakerLabel}
                                            </span>{' '}
                                            —{' '}
                                          </>
                                        )}
                                        <span className="italic">
                                          &ldquo;
                                          <ShariahExcerpt text={flag.excerpt} highlights={flag.highlights} />
                                          &rdquo;
                                        </span>
                                        {segment !== null && (
                                          <button
                                            type="button"
                                            className="ml-2 text-xs text-brand underline underline-offset-2"
                                            onClick={() => jumpToSegment(segment.id)}
                                          >
                                            Jump →
                                          </button>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                                Detected in the transcript
                              </p>
                              <p className="mt-1 italic text-muted">
                                <ShariahExcerpt text={primary.excerpt} highlights={primary.highlights} />
                              </p>
                            </div>
                            {guidance !== null && (
                              <>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                                    What {guidance.title} is
                                  </p>
                                  <p className="mt-1 text-muted">{guidance.whatItIs}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                                    Why it flags
                                  </p>
                                  <p className="mt-1 text-muted">{guidance.whyItViolates}</p>
                                </div>
                              </>
                            )}
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                                Detected by · confidence · reference
                              </p>
                              <p className="mt-1 text-muted">
                                <span className="font-mono text-xs">{primary.detectedBy}</span> ·{' '}
                                {(primary.confidence * 100).toFixed(0)}% · {primary.reference}
                              </p>
                            </div>
                            <p className="text-xs text-faint">
                              A machine reading of the transcript, not a ruling.{' '}
                              <Link href="/islamic-banking" className="underline underline-offset-2">
                                Learn more about Shariah banking
                              </Link>
                              .
                            </p>
                          </div>
                        </Disclosure>
                      </div>

                      {mayReview && needsReview.length > 0 && openReview === groupKey && (
                        <ReviewForm
                          flags={needsReview}
                          onDone={() => {
                            setOpenReview(null);
                            meeting.reload();
                          }}
                        />
                      )}

                      {mayReview && needsReview.length > 0 && openReview !== groupKey && (
                        <div className="mt-3">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setOpenReview(groupKey);
                            }}
                          >
                            Review this finding
                            {needsReview.length > 1 ? ` (${String(needsReview.length)})` : ''}
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      )}

      {maySubmit && (
        <Card>
          <CardHeader
            title="Term sheet"
            description={
              data.transcript === null
                ? 'Shariah screening runs once transcription finishes. You can start drafting below.'
                : unresolved.length > 0
                  ? 'Submission will be refused until every finding above is cleared.'
                  : 'All findings cleared. This can be submitted for checking.'
            }
          />
          <TermSheetForm meetingId={id} blockedBy={unresolved} />
        </Card>
      )}

      {data.transcript !== null && (
        <>
          <Card>
            <CardHeader
              title="Summary"
              description={`Model ${data.transcript.modelId} · prompt ${data.transcript.promptVersion}`}
            />
            <p className="px-5 py-4 text-sm leading-relaxed text-muted">
              <RedactedText text={data.transcript.summaryEn} />
            </p>
          </Card>

          {(() => {
            const hasKickoff =
              data.transcript.projectKickoff !== null || data.transcript.followUps.length > 0;

            /**
             * Request: populated sections lead, empty ones fold into one
             * clickable line at the bottom — decided per meeting from
             * whether each actually has data, never a fixed order. Decisions,
             * action items and kickoff are all new-meetings-only AI outputs
             * (no backfill), so an older or demo meeting can easily have all
             * three empty at once, each previously costing half a screen.
             */
            const extras: { key: string; label: string; hasData: boolean; content: ReactNode }[] = [
              {
                key: 'decisions',
                label: 'Final decisions',
                hasData: data.decisions.length > 0,
                content:
                  data.decisions.length === 0 ? (
                    <EmptyState
                      title="No decisions recorded"
                      body="The arbiter found no debated point to resolve, or this meeting predates the feature."
                    />
                  ) : (
                    <ul className="space-y-3">
                      {data.decisions.map((decision) => (
                        <li key={decision.id}>
                          <Card className="px-5 py-4">
                            <p className="text-sm font-semibold">
                              <RedactedText text={decision.topic} />
                            </p>
                            <p className="mt-1 text-sm text-muted">
                              <RedactedText text={decision.decision} />
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-faint">
                              <RedactedText text={decision.rationale} />
                            </p>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  ),
              },
              {
                key: 'actionItems',
                label: 'Action items',
                hasData: data.actionItems.length > 0,
                content:
                  data.actionItems.length === 0 ? (
                    <EmptyState
                      title="No action items"
                      body="Nothing was extracted as a follow-up task for this meeting."
                    />
                  ) : (
                    <Card>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[36rem] text-left text-sm">
                          <thead className="border-b border-line text-xs uppercase tracking-wide text-faint">
                            <tr>
                              <th scope="col" className="px-5 py-2.5 font-medium">
                                Owner
                              </th>
                              <th scope="col" className="px-5 py-2.5 font-medium">
                                Task
                              </th>
                              <th scope="col" className="px-5 py-2.5 font-medium">
                                Due
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {data.actionItems.map((item) => (
                              <tr key={item.id}>
                                <td className="px-5 py-2.5 text-xs font-medium text-brand">
                                  <RedactedText text={item.owner} />
                                </td>
                                <td className="px-5 py-2.5 text-sm">
                                  <RedactedText text={item.task} />
                                </td>
                                <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">
                                  {item.dueDate === null ? (
                                    '—'
                                  ) : (
                                    <RedactedText text={item.dueDate} />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  ),
              },
              {
                key: 'kickoff',
                label: 'Project kickoff',
                hasData: hasKickoff,
                content: !hasKickoff ? (
                  <EmptyState
                    title="No kickoff draft"
                    body="No project draft was generated for this meeting."
                  />
                ) : (
                  <Card className="px-5 py-4">
                    {data.transcript.projectKickoff !== null && (
                      <p className="text-sm leading-relaxed">
                        <RedactedText text={data.transcript.projectKickoff} />
                      </p>
                    )}
                    {data.transcript.followUps.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                        {data.transcript.followUps.map((line, index) => (
                          <li key={index} className="flex gap-2 text-sm text-muted">
                            <span className="text-faint">·</span>
                            <RedactedText text={line} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ),
              },
              {
                key: 'whiteboards',
                label: 'Attachments',
                hasData: whiteboardsHasData,
                content: whiteboardsContent,
              },
            ];

            const populated = extras.filter((section) => section.hasData);
            const empty = extras.filter((section) => !section.hasData);

            return (
              <>
                {populated.map((section) => (
                  <section key={section.key} className="space-y-3">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
                      {section.label}
                    </h2>
                    {section.content}
                  </section>
                ))}

                {empty.length > 0 && (
                  <details className="rounded-lg border border-line bg-raised">
                    <summary className="cursor-pointer list-none px-4 py-2.5 text-caption font-medium text-muted hover:text-text">
                      ▸ {empty.length} empty section{empty.length === 1 ? '' : 's'} —{' '}
                      {empty.map((section) => section.label).join(', ')}
                    </summary>
                    <div className="space-y-6 border-t border-line px-4 py-4">
                      {empty.map((section) => (
                        <div key={section.key}>
                          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                            {section.label}
                          </h3>
                          <div className="mt-2">{section.content}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            );
          })()}

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader
                title="Transcript"
                description="Mixed-language, with personal data replaced before storage."
              />

              <div className="border-b border-line px-5 py-3">
                <TranscriptConfidence segments={data.transcript.segments} />
              </div>

              <ol className="divide-y divide-line">
                {data.transcript.segments.map((segment) => (
                  <li
                    key={segment.id}
                    id={segment.id}
                    className={`px-5 py-3 transition-colors duration-500 ${
                      highlightedSegmentId === segment.id ? 'bg-warn-soft' : ''
                    }`}
                  >
                    <div className="flex items-baseline gap-2.5">
                      <span className="shrink-0 font-mono text-xs text-faint">
                        {timecode(segment.startMs)}
                      </span>
                      <span className="text-xs font-medium text-brand">
                        {segment.speakerLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed">
                      <RedactedText text={segment.textRedacted} />
                    </p>
                    <SegmentReview
                      segment={segment}
                      mayReview={mayReviewTranscript}
                      onChanged={meeting.reload}
                    />
                  </li>
                ))}
              </ol>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader
                title="Redaction log"
                description="What was masked, by which detector, and how confidently."
              />
              {data.transcript.redactions.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">
                  No personal data was detected in this transcript.
                </p>
              ) : (
                <dl className="divide-y divide-line px-5 py-2">
                  {data.transcript.redactions.map((row) => (
                    <DataRow key={row.id} label={row.placeholder}>
                      <span className="text-xs text-muted">
                        {row.detectedBy} · {(row.confidence * 100).toFixed(0)}%
                      </span>
                    </DataRow>
                  ))}
                </dl>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
