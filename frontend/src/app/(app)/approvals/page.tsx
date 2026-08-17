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
  Section,
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
import { formatDateTime } from '@/lib/format';

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

const RAIL_LABEL: Record<SettlementRail, string> = {
  DUITNOW: 'DuitNow Business',
  RENTAS: 'RENTAS',
};

/**
 * Mirrors the backend's settlement_duitnow_business_ceiling /
 * settlement_rentas_floor CHECK constraints (see mock-settlement.ts), so the
 * checker is never offered a rail the server is going to reject. DuitNow
 * Business and RENTAS each have their own real limit, not a shared size
 * cutoff — a facility between RM10,000 and RM10,000,000 is valid on either.
 * MYR only: any other currency leaves both rails open.
 */
const DUITNOW_BUSINESS_CEILING_MINOR = 1_000_000_000n; // RM10,000,000
const RENTAS_FLOOR_MINOR = 1_000_000n; // RM10,000

function validRails(currency: string, principalMinor: string): SettlementRail[] {
  if (currency !== 'MYR') return ['DUITNOW', 'RENTAS'];
  const principal = BigInt(principalMinor);
  const rails: SettlementRail[] = [];
  if (principal <= DUITNOW_BUSINESS_CEILING_MINOR) rails.push('DUITNOW');
  if (principal >= RENTAS_FLOOR_MINOR) rails.push('RENTAS');
  return rails;
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
  const options = validRails(approval.termSheet.currency, approval.termSheet.principalMinor);
  const [rail, setRail] = useState<SettlementRail>(options[0] ?? 'DUITNOW');
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
          <Badge tone="neutral">{RAIL_LABEL[settlement.rail]}</Badge>
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
            {formatDateTime(settlement.settledAt)}
          </DataRow>
        </dl>
        <p className="text-xs text-faint">
          No funds moved and no bank was contacted. This is a simulated record for
          demonstration, and the reference is not a real DuitNow Business or RENTAS reference.
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
        hint={
          options.length === 1
            ? `Only ${RAIL_LABEL[options[0] ?? rail]} applies at this facility's size. Nothing `
              + 'is sent to any bank.'
            : 'Nothing is sent to any bank. The amount is taken from the approved figures, not '
              + 'from this form.'
        }
      >
        <Select
          id={`rail-${approval.id}`}
          value={rail}
          onChange={(event) => setRail(event.target.value as SettlementRail)}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {RAIL_LABEL[value]}
            </option>
          ))}
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

/**
 * One facility. Reused across both sections below unchanged — DecideForm
 * only ever shows for a PENDING_CHECKER row and SettleForm already branches
 * on whether it is settled, so the same card is correct whichever section
 * (or sub-list) renders it.
 */
function ApprovalCard({
  approval,
  mayDecide,
  maySettle,
  mayDownload,
  onDecided,
  onSettled,
}: {
  approval: ApprovalRow;
  mayDecide: boolean;
  maySettle: boolean;
  mayDownload: boolean;
  onDecided: () => void;
  onSettled: () => void;
}) {
  const sheet = approval.termSheet;
  const pending = approval.decision === 'PENDING_CHECKER';
  const rateBps = sheet.profitRateBps ?? sheet.interestRateBps ?? 0;

  return (
    <li>
      <Card>
        <CardHeader
          title={sheet.applicantName}
          description={`Submitted by ${approval.makerName} on ${formatDateTime(
            approval.submittedAt,
          )}`}
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
          <DataRow label={sheet.facilityKind === 'ISLAMIC' ? 'Profit rate' : 'Interest rate'}>
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
          {mayDecide && pending && <DecideForm approval={approval} onDone={onDecided} />}

          {maySettle && approval.decision === 'APPROVED' && (
            <SettleForm approval={approval} onDone={onSettled} />
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
}

export default function ApprovalsPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const approvals = useAsync(() => api.approvals(), 'approvals');
  const [done, setDone] = useState<string | null>(null);

  const mayDecide = can(session.data, 'termsheet:approve');
  const mayDownload = can(session.data, 'payment:settle');
  /**
   * CHECKER only, and the server narrows it further to the checker who actually
   * approved that facility — so this button appearing is not the same as the
   * settlement being permitted, and the 403 message says which checker it wants.
   */
  const maySettle = can(session.data, 'payment:settle');

  const onDecided = () => {
    setDone('Decision recorded and written to the audit log.');
    approvals.reload();
  };
  const onSettled = () => {
    setDone('Simulated settlement recorded and written to the audit log. No funds moved.');
    approvals.reload();
  };

  /**
   * Three groups, not five: a decided-and-rejected, withdrawn, or still-draft
   * term sheet is finished, and this page is about what still needs doing.
   * All three read the same /approvals payload — no new endpoint.
   */
  const all = approvals.data?.approvals ?? [];
  const pendingApprovals = all.filter((approval) => approval.decision === 'PENDING_CHECKER');
  const awaitingSettlement = all.filter(
    (approval) => approval.decision === 'APPROVED' && approval.settlement === null,
  );
  const recentlySettled = all.filter(
    (approval) => approval.decision === 'APPROVED' && approval.settlement !== null,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Decide"
        title="Approvals and settlement"
        lead="A term sheet is submitted by a maker and decided by a different person — one account can never do both. The checker who approves a facility then records its settlement, which is always simulated."
      />

      {done && <SuccessNote>{done}</SuccessNote>}
      {approvals.loading && <Spinner label="Loading approvals" />}
      {approvals.error !== null && <ErrorNote>{approvals.error}</ErrorNote>}

      <Section
        title="Approvals"
        description="Submitted term sheets waiting for a decision."
        action={
          <Badge tone={pendingApprovals.length > 0 ? 'warn' : 'neutral'}>
            {pendingApprovals.length}
          </Badge>
        }
      >
        {!approvals.loading && pendingApprovals.length === 0 && (
          <EmptyState
            title="Nothing awaiting a decision"
            body="A maker submits a term sheet from a meeting once its Shariah findings are cleared."
          />
        )}
        {pendingApprovals.length > 0 && (
          <ul className="space-y-4">
            {pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                mayDecide={mayDecide}
                maySettle={maySettle}
                mayDownload={mayDownload}
                onDecided={onDecided}
                onSettled={onSettled}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Settlement"
        description="Once approved, record how the transfer was completed elsewhere. Every settlement here is simulated."
        action={
          <Badge tone={awaitingSettlement.length > 0 ? 'warn' : 'neutral'}>
            {awaitingSettlement.length}
          </Badge>
        }
      >
        {!approvals.loading && awaitingSettlement.length === 0 && recentlySettled.length === 0 && (
          <EmptyState
            title="Nothing to settle yet"
            body="Once you approve a facility above, record its settlement here."
          />
        )}

        {awaitingSettlement.length > 0 && (
          <ul className="space-y-4">
            {awaitingSettlement.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                mayDecide={mayDecide}
                maySettle={maySettle}
                mayDownload={mayDownload}
                onDecided={onDecided}
                onSettled={onSettled}
              />
            ))}
          </ul>
        )}

        {recentlySettled.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              Recently settled
            </h3>
            <ul className="space-y-4">
              {recentlySettled.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  mayDecide={mayDecide}
                  maySettle={maySettle}
                  mayDownload={mayDownload}
                  onDecided={onDecided}
                  onSettled={onSettled}
                />
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}
