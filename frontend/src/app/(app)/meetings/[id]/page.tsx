'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
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
  type Session,
  type ShariahFlagRow,
  type ShariahStatus,
  timecode,
} from '@/lib/api';
import { formatDuration } from '@/lib/duration';
import { computeParticipation, participationNudge } from '@/lib/participation';
import { guidanceFor } from '@/lib/shariah-guidance';

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
function ReviewForm({ flag, onDone }: { flag: ShariahFlagRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ShariahStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(status: ShariahStatus): Promise<void> {
    setBusy(status);
    setError(null);
    try {
      await api.reviewFlag(flag.id, status, note);
      onDone();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  const described = ISSUE_LABEL[flag.issueType] ?? flag.issueType;
  const noteRequired = note.trim() === '';

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="rounded-lg border border-line bg-raised p-4">
        <p className="text-sm font-medium">
          Is this a genuine Shariah concern?
        </p>
        <p className="mt-1 text-sm text-muted">
          The <span className="font-mono text-xs">{flag.detectedBy}</span> rule flagged
          what may be {described}. That is a machine reading of the transcript, not a
          ruling. Your answer is the ruling.
        </p>
      </div>

      <Field
        label="Your reasoning"
        htmlFor={`note-${flag.id}`}
        hint="Required for yes or no. Cite the placeholder, e.g. [NRIC_1] — a note containing personal data is rejected."
      >
        <Textarea
          id={`note-${flag.id}`}
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
        Either answer is recorded against the rule that raised it, so how often the
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
   * Gated on `transcript:read` but excluding VIEWER, which is read-only: a
   * viewer sees transcripts (and corrections others made) but cannot confirm
   * or correct segments. The backend rejects them too (segment-review.ts),
   * so this hides controls that would 403 rather than work.
   */
  const mayReviewTranscript =
    can(session.data, 'transcript:read') && session.data?.role !== 'VIEWER';

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
            {data.transcript?.processingMs != null
              && ` · processed in ${formatDuration(data.transcript.processingMs)}`}
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

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              Final decisions
            </h2>
            {data.decisions.length === 0 ? (
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
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              Action items
            </h2>
            {data.actionItems.length === 0 ? (
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
                            {item.dueDate === null ? '—' : <RedactedText text={item.dueDate} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              Project kickoff
            </h2>
            {data.transcript.projectKickoff === null && data.transcript.followUps.length === 0 ? (
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
            )}
          </section>

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

          {(() => {
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
                  ([key, value]) => {
                    // A nested object or array under String() prints the
                    // literal text "[object Object]" — pretty-print it as
                    // JSON instead, the same <pre><code> treatment the
                    // stored source view above already gives board.mermaid.
                    const isNested = typeof value === 'object' && value !== null;
                    return (
                      <div key={key} className="contents">
                        <dt className="text-faint">{key}</dt>
                        <dd className="font-medium">
                          {isNested ? (
                            <pre className="overflow-x-auto rounded-lg border border-line bg-raised p-2 text-xs leading-relaxed">
                              <code>
                                <RedactedText text={JSON.stringify(value, null, 2)} />
                              </code>
                            </pre>
                          ) : (
                            <RedactedText text={String(value)} />
                          )}
                        </dd>
                      </div>
                    );
                  },
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
              const guidance = guidanceFor(flag.issueType);
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

                    {/*
                      Request 3: a details view that says what was detected and
                      why it flags — drawn from the same guidance module as the
                      Islamic Banking page, so the two never disagree.
                    */}
                    <div className="mt-3">
                      <Disclosure summary="Details — what was detected, and why it flags">
                        <div className="space-y-3 text-sm leading-relaxed">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                              Detected in the transcript
                            </p>
                            <p className="mt-1 italic text-muted">
                              <RedactedText text={flag.excerpt} />
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
                              <span className="font-mono text-xs">{flag.detectedBy}</span> ·{' '}
                              {(flag.confidence * 100).toFixed(0)}% · {flag.reference}
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
