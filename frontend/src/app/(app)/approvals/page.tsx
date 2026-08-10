'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Card, CardHeader, DataRow } from '@/components/card';
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Select,
  Spinner,
  SuccessNote,
  Textarea,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import {
  api,
  type ApprovalRow,
  type ApprovalStatus,
  can,
  type Session,
  type SettlementRail,
} from '@/lib/api';

const DECISION_TONE: Record<ApprovalStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_CHECKER: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

/**
 * Same-origin, and that is the whole point.
 *
 * These are real <a href> downloads, so clicking one is a top-level navigation.
 * Pointed at the backend's own origin it was a cross-site navigation carrying no
 * cookie in Safari, so the browser rendered the API's raw 401 JSON at the user
 * instead of a file. /api is rewritten to the backend by next.config.ts, which
 * makes the session cookie first-party and the download just work.
 */
const API_BASE = '/api';

function DecideForm({ approval, onDone }: { approval: ApprovalRow; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'REJECTED'): Promise<void> {
    setBusy(decision);
    setError(null);
    try {
      await api.decide(approval.id, decision, note);
      onDone();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
      }}
      className="mt-4 space-y-3 border-t border-line pt-4"
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Field
        label="Decision note"
        htmlFor={`note-${approval.id}`}
        hint="Required to reject. A note containing personal data is rejected."
      >
        <Textarea
          id={`note-${approval.id}`}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy !== null}
          onClick={() => {
            void decide('APPROVED');
          }}
        >
          {busy === 'APPROVED' ? 'Approving…' : 'Approve'}
        </Button>
        <Button
          variant="danger"
          disabled={busy !== null}
          onClick={() => {
            void decide('REJECTED');
          }}
        >
          {busy === 'REJECTED' ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Simulated settlement.
 *
 * Every surface here says so, and that repetition is deliberate rather than
 * clumsy: the reference itself carries MOCK-, the badge says Simulated, and the
 * copy states plainly that no funds moved and no bank was contacted. Someone
 * screenshotting this for a demo must not be able to crop it into looking like a
 * real payment confirmation.
 */
function SettleForm({ approval, onDone }: { approval: ApprovalRow; onDone: () => void }) {
  const [rail, setRail] = useState<SettlementRail>('DUITNOW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settlement = approval.settlement;

  if (settlement !== null) {
    return (
      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok" dot>
            Settled
          </Badge>
          <Badge tone="warn">{settlement.simulated ? 'Simulated' : 'NOT SIMULATED'}</Badge>
          <Badge tone="neutral">{settlement.rail}</Badge>
        </div>
        <dl className="divide-y divide-line">
          <DataRow label="Reference">
            <span className="font-mono text-xs">{settlement.mockReference}</span>
          </DataRow>
          <DataRow label="Amount">
            <span className="font-mono">
              {settlement.currency} {settlement.amountFormatted}
            </span>
          </DataRow>
          <DataRow label="Recorded">
            {new Date(settlement.settledAt).toLocaleString()}
          </DataRow>
        </dl>
        <p className="text-xs text-faint">
          No funds moved and no bank was contacted. This is a simulated record for
          demonstration, and the reference is not a real DuitNow or FPX reference.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      {error !== null && <ErrorNote>{error}</ErrorNote>}

      <Field
        label="Record a simulated transfer"
        htmlFor={`rail-${approval.id}`}
        hint="Nothing is sent to any bank. The amount is taken from the approved figures, not from this form."
      >
        <Select
          id={`rail-${approval.id}`}
          value={rail}
          onChange={(event) => setRail(event.target.value as SettlementRail)}
        >
          <option value="DUITNOW">DuitNow</option>
          <option value="FPX">FPX</option>
        </Select>
      </Field>

      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          api
            .settle(approval.termSheet.id, rail)
            .then(onDone)
            .catch((cause: unknown) => {
              setError(describeError(cause));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? 'Recording…' : 'Record simulated settlement'}
      </Button>
    </div>
  );
}

export default function ApprovalsPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const approvals = useAsync(() => api.approvals(), 'approvals');
  const [done, setDone] = useState<string | null>(null);

  const mayDecide = can(session.data, 'termsheet:approve');
  const mayDownload = can(session.data, 'termsheet:submit');
  /**
   * CHECKER only, and the server narrows it further to the checker who actually
   * approved that facility — so this button appearing is not the same as the
   * settlement being permitted, and the 403 message says which checker it wants.
   */
  const maySettle = can(session.data, 'payment:settle');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Decide"
        title="Approvals and settlement"
        lead="A term sheet is submitted by a maker and decided by a different person — one account can never do both. The checker who approves a facility then records its settlement, which is always simulated."
      />

      {done && <SuccessNote>{done}</SuccessNote>}
      {approvals.loading && <Spinner label="Loading approvals" />}
      {approvals.error !== null && <ErrorNote>{approvals.error}</ErrorNote>}

      {approvals.data?.approvals.length === 0 && (
        <EmptyState
          title="Nothing awaiting a decision"
          body="A maker submits a term sheet from a meeting once its Shariah findings are cleared."
        />
      )}

      <ul className="space-y-4">
        {approvals.data?.approvals.map((approval) => {
          const sheet = approval.termSheet;
          const pending = approval.decision === 'PENDING_CHECKER';
          const rateBps = sheet.profitRateBps ?? sheet.interestRateBps ?? 0;

          return (
            <li key={approval.id}>
              <Card>
                <CardHeader
                  title={sheet.applicantName}
                  description={`Submitted by ${approval.makerName} on ${new Date(
                    approval.submittedAt,
                  ).toLocaleString()}`}
                  action={
                    <Badge tone={DECISION_TONE[approval.decision]} dot>
                      {approval.decision}
                    </Badge>
                  }
                />

                <dl className="divide-y divide-line px-5 py-2">
                  <DataRow label="Facility">
                    <Badge tone={sheet.facilityKind === 'ISLAMIC' ? 'brand' : 'neutral'}>
                      {sheet.facilityKind}
                      {sheet.islamicContract === null ? '' : ` · ${sheet.islamicContract}`}
                    </Badge>
                  </DataRow>
                  <DataRow label="Principal">
                    <span className="font-mono">
                      {sheet.currency} {sheet.principalFormatted}
                    </span>
                  </DataRow>
                  <DataRow label="Tenure">{sheet.tenureMonths} months</DataRow>
                  <DataRow
                    label={sheet.facilityKind === 'ISLAMIC' ? 'Profit rate' : 'Interest rate'}
                  >
                    <span className="font-mono">{(rateBps / 100).toFixed(2)}%</span>
                  </DataRow>
                  <DataRow label="Meeting">
                    <Link
                      href={`/meetings/${sheet.meetingId}`}
                      className="rounded text-brand underline underline-offset-2"
                    >
                      View transcript
                    </Link>
                  </DataRow>
                </dl>

                {approval.note !== null && approval.note !== '' && (
                  <p className="border-t border-line px-5 py-3 text-sm text-muted">
                    <span className="font-medium text-text">Note. </span>
                    {approval.note}
                  </p>
                )}

                <div className="px-5 pb-5">
                  {mayDecide && pending && (
                    <DecideForm
                      approval={approval}
                      onDone={() => {
                        setDone('Decision recorded and written to the audit log.');
                        approvals.reload();
                      }}
                    />
                  )}

                  {maySettle && approval.decision === 'APPROVED' && (
                    <SettleForm
                      approval={approval}
                      onDone={() => {
                        setDone(
                          'Simulated settlement recorded and written to the audit log. '
                          + 'No funds moved.',
                        );
                        approvals.reload();
                      }}
                    />
                  )}

                  {mayDownload && approval.decision === 'APPROVED' && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                      {/*
                        CSV only. The ISO 20022 pain.001 XML was removed: it is a
                        payment instruction, and an approved term sheet is a credit
                        decision. For a Murabahah facility the money moves
                        bank-to-vendor for an asset purchase, so a transfer crediting
                        the applicant described a cash advance with a markup — the
                        structure this product exists to flag.
                      */}
                      <a
                        href={`${API_BASE}/term-sheets/${sheet.id}/payment-payload`}
                        className="inline-flex items-center rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium hover:bg-raised"
                      >
                        Download CSV handoff
                      </a>
                      <p className="w-full pt-1 text-xs text-faint">
                        The approved figures, for you to complete with account details in
                        your own banking channel. Not a payment instruction: this system
                        never submits one, and makes no claim about when money moves.
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
