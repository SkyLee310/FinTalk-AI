'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Card, CardHeader, DataRow } from '@/components/card';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { SegmentReview, TranscriptConfidence } from '@/components/segment-review';
import { TransferRecord } from '@/components/transfer-notice';
import {
  Button,
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
  type Session,
  type ShariahFlagRow,
  type ShariahStatus,
  timecode,
} from '@/lib/api';

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

function ReviewForm({ flag, onDone }: { flag: ShariahFlagRow; onDone: () => void }) {
  const [status, setStatus] = useState<ShariahStatus>('CLEARED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.reviewFlag(flag.id, status, note);
      onDone();
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
      className="mt-4 space-y-3 border-t border-line pt-4"
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field label="Decision" htmlFor={`status-${flag.id}`}>
        <Select
          id={`status-${flag.id}`}
          value={status}
          onChange={(event) => setStatus(event.target.value as ShariahStatus)}
        >
          <option value="UNDER_REVIEW">Under review</option>
          <option value="CLEARED">Cleared</option>
          <option value="CONFIRMED_VIOLATION">Confirmed violation</option>
        </Select>
      </Field>

      <Field
        label="Reasoning"
        htmlFor={`note-${flag.id}`}
        hint="Cite the placeholder, e.g. [NRIC_1]. A note containing personal data is rejected."
      >
        <Textarea
          id={`note-${flag.id}`}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <Button type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Record decision'}
      </Button>
    </form>
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
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const islamic = facilityKind === 'ISLAMIC';
  const blocked = blockedBy.length > 0;

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

      <Field label="Applicant" htmlFor="applicant">
        <Input
          id="applicant"
          required
          value={applicantName}
          onChange={(event) => setApplicantName(event.target.value)}
          placeholder="Tech Solutions Sdn Bhd"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Principal (MYR)" htmlFor="amount" hint="Whole ringgit.">
          <Input
            id="amount"
            required
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="50000"
          />
        </Field>

        <Field label="Tenure (months)" htmlFor="tenure">
          <Input
            id="tenure"
            required
            inputMode="numeric"
            value={tenureMonths}
            onChange={(event) => setTenureMonths(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Facility kind" htmlFor="kind">
          <Select
            id="kind"
            value={facilityKind}
            onChange={(event) => setFacilityKind(event.target.value as FacilityKind)}
          >
            <option value="ISLAMIC">Islamic</option>
            <option value="CONVENTIONAL">Conventional</option>
          </Select>
        </Field>

        <Field
          label={islamic ? 'Profit rate (bps)' : 'Interest rate (bps)'}
          htmlFor="rate"
          hint="800 bps is 8.00%."
        >
          <Input
            id="rate"
            required
            inputMode="numeric"
            value={rateBps}
            onChange={(event) => setRateBps(event.target.value)}
          />
        </Field>
      </div>

      {islamic && (
        <Field label="Shariah contract" htmlFor="contract">
          <Select
            id="contract"
            value={contract}
            onChange={(event) => setContract(event.target.value)}
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

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const session = useAsync<Session>(() => api.me(), 'session');
  const meeting = useAsync(() => api.meeting(id), `meeting:${id}`);
  const whiteboards = useAsync(() => api.whiteboards(id), `whiteboards:${id}`);
  const [openFlag, setOpenFlag] = useState<string | null>(null);

  const maySubmit = can(session.data, 'termsheet:submit');
  const mayReview = can(session.data, 'shariah:review');
  /**
   * Segment review, not Shariah review — a different capability entirely.
   *
   * Gated on `transcript:read` to match the route: correcting a transcription
   * discloses nothing the reader could not already see. Naming it separately so
   * it cannot be confused with `mayReview` above, which guards the one action
   * only a Shariah officer may take.
   */
  const mayReviewTranscript = can(session.data, 'transcript:read');

  if (meeting.loading) return <Spinner label="Loading meeting" />;
  if (meeting.error !== null) return <ErrorNote>{meeting.error}</ErrorNote>;
  if (meeting.data === null) return <EmptyState title="Not found" body="No such meeting." />;

  const data = meeting.data;
  const unresolved = data.shariahFlags.filter((flag) => flag.status !== 'CLEARED');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {new Date(data.occurredAt).toLocaleString()}
            {data.transcript && ` · ${data.transcript.languages.join(', ')}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.consentConfirmed && <Badge tone="ok">Consent confirmed</Badge>}
          {data.transferAcknowledged && <Badge tone="ok">Transfer acknowledged</Badge>}
          <Badge tone={data.status === 'READY' ? 'ok' : 'warn'} dot>
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

      <div className="rounded-lg border border-line bg-raised px-4 py-3">
        <TransferRecord
          consentConfirmed={data.consentConfirmed}
          transferAcknowledged={data.transferAcknowledged}
        />
      </div>

      {data.failureReason !== null && (
        <ErrorNote>
          Processing failed at <code className="font-mono">{data.failureReason}</code>. No
          transcript was stored.
        </ErrorNote>
      )}

      {data.transcript === null ? (
        <EmptyState title="No transcript" body="This meeting has no stored transcript." />
      ) : (
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
                  <li key={segment.id} className="px-5 py-3">
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
          Whiteboards
        </h2>

        {whiteboards.loading && <Spinner label="Loading whiteboards" />}
        {whiteboards.error !== null && <ErrorNote>{whiteboards.error}</ErrorNote>}

        {whiteboards.data?.whiteboards.length === 0 && (
          <EmptyState
            title="No whiteboard captured"
            body="Attach a whiteboard photo when you capture a meeting and its diagram is extracted and redacted alongside the transcript."
          />
        )}

        {whiteboards.data?.whiteboards.map((board) => (
          <Card key={board.id}>
            <CardHeader
              title="Extracted diagram"
              description={`Model ${board.modelId} · prompt ${board.promptVersion}`}
            />
            <div className="space-y-4 px-5 py-4">
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

              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                {Object.entries(board.structuredJson as Record<string, unknown>).map(
                  ([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-faint">{key}</dt>
                      <dd className="font-medium">
                        <RedactedText text={String(value)} />
                      </dd>
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
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
            Shariah findings
          </h2>
          {unresolved.length > 0 && (
            <Badge tone="warn" dot>
              {unresolved.length} blocking approval
            </Badge>
          )}
        </div>

        {data.shariahFlags.length === 0 ? (
          <EmptyState title="No findings" body="The rule set raised nothing on this transcript." />
        ) : (
          <ul className="space-y-3">
            {data.shariahFlags.map((flag) => {
              const resolved =
                flag.status === 'CLEARED' || flag.status === 'CONFIRMED_VIOLATION';
              return (
                <li key={flag.id}>
                  <Card className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{flag.issueType}</p>
                        <p className="mt-1 text-sm italic text-muted">
                          <RedactedText text={flag.excerpt} />
                        </p>
                        <p className="mt-2 text-xs text-faint">
                          {flag.detectedBy} · {(flag.confidence * 100).toFixed(0)}% ·{' '}
                          {flag.reference}
                        </p>
                      </div>
                      <Badge tone={FLAG_TONE[flag.status]} dot>
                        {flag.status}
                      </Badge>
                    </div>

                    {mayReview && !resolved && openFlag === flag.id && (
                      <ReviewForm
                        flag={flag}
                        onDone={() => {
                          setOpenFlag(null);
                          meeting.reload();
                        }}
                      />
                    )}

                    {mayReview && !resolved && openFlag !== flag.id && (
                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setOpenFlag(flag.id);
                          }}
                        >
                          Review this finding
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {maySubmit && (
        <Card>
          <CardHeader
            title="Term sheet"
            description={
              unresolved.length > 0
                ? 'Submission will be refused until every finding above is cleared.'
                : 'All findings cleared. This can be submitted for checking.'
            }
          />
          <TermSheetForm meetingId={id} blockedBy={unresolved} />
        </Card>
      )}
    </div>
  );
}
