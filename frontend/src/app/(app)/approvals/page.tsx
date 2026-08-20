'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Card, DataRow } from '@/components/card';
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
import { formatDateTime } from '@/lib/format';

const DECISION_TONE: Record<ApprovalStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_CHECKER: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

const DECISION_LABEL: Record<ApprovalStatus, string> = {
  DRAFT: 'DRAFT',
  PENDING_CHECKER: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
};

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
      className="mt-4 space-y-3 rounded-lg border border-line bg-raised/50 p-4"
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
          placeholder="Add review notes, rationale or conditions…"
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2.5 pt-1">
        <Button
          disabled={busy !== null}
          onClick={() => {
            void decide('APPROVED');
          }}
        >
          {busy === 'APPROVED' ? 'Approving…' : 'Approve facility'}
        </Button>
        <Button
          variant="danger"
          disabled={busy !== null}
          onClick={() => {
            void decide('REJECTED');
          }}
        >
          {busy === 'REJECTED' ? 'Rejecting…' : 'Reject facility'}
        </Button>
      </div>
    </form>
  );
}

const RAIL_LABEL: Record<SettlementRail, string> = {
  DUITNOW: 'DuitNow Business',
  RENTAS: 'RENTAS',
};

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

function SettleForm({ approval, onDone }: { approval: ApprovalRow; onDone: () => void }) {
  const options = validRails(approval.termSheet.currency, approval.termSheet.principalMinor);
  const [rail, setRail] = useState<SettlementRail>(options[0] ?? 'DUITNOW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settlement = approval.settlement;

  if (settlement !== null) {
    return (
      <div className="mt-4 space-y-3 rounded-lg border border-line bg-raised/50 p-4">
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
          No funds moved and no bank was contacted. This is a simulated record for demonstration.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-line bg-raised/50 p-4">
      {error !== null && <ErrorNote>{error}</ErrorNote>}

      <Field
        label="Record a simulated transfer"
        htmlFor={`rail-${approval.id}`}
        hint={
          options.length === 1
            ? `Only ${RAIL_LABEL[options[0] ?? rail]} applies at this facility size.`
            : 'Select settlement rail for simulated disbursement.'
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
 * Compact Box with expandable "More details" for decision terms.
 */
function ApprovalBox({
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
  const [expanded, setExpanded] = useState(false);
  const sheet = approval.termSheet;
  const pending = approval.decision === 'PENDING_CHECKER';
  const rateBps = sheet.profitRateBps ?? sheet.interestRateBps ?? 0;

  return (
    <li className="list-none">
      <Card className="overflow-hidden transition shadow-xs hover:shadow-md border-line">
        {/* Compact Essential Box Header (Always Visible) */}
        <div className="px-4 py-3.5 sm:px-5">
          <div className="flex items-stretch justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              {/* Facility type badge on top of company name, smaller */}
              <div className="pb-0.5">
                <span
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider border ${
                    sheet.facilityKind === 'ISLAMIC'
                      ? 'border-brand/30 bg-brand/10 text-brand'
                      : 'border-line-strong bg-raised text-muted'
                  }`}
                >
                  {sheet.facilityKind}
                  {sheet.islamicContract === null ? '' : ` · ${sheet.islamicContract}`}
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-text tracking-tight truncate">
                {sheet.applicantName}
              </h3>
              <p className="text-xs text-muted">
                Submitted by <span className="font-medium text-text">{approval.makerName}</span> on{' '}
                {formatDateTime(approval.submittedAt)}
              </p>
            </div>

            {/* Status at top, More Details at bottom for equal distance to borders */}
            <div className="flex flex-col items-end justify-between self-stretch shrink-0 gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={DECISION_TONE[approval.decision]} dot>
                  {DECISION_LABEL[approval.decision]}
                </Badge>
                {approval.settlement !== null && (
                  <Badge tone="ok" dot>
                    Settled
                  </Badge>
                )}
              </div>

              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-text transition hover:bg-raised active:scale-[0.98]"
              >
                <span>{expanded ? 'Hide details' : 'More details'}</span>
                <span
                  className="text-[10px] transition-transform duration-200"
                  style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
                >
                  ▼
                </span>
              </button>
            </div>
          </div>

          {/* Action Notices (if applicable) */}
          {(pending && mayDecide) ||
          (!pending && approval.decision === 'APPROVED' && approval.settlement === null && maySettle) ? (
            <div className="mt-2 pt-1 border-t border-line/50">
              {pending && mayDecide && (
                <span className="text-xs font-medium text-warn">
                  Action required: Checker approval pending
                </span>
              )}
              {!pending && approval.decision === 'APPROVED' && approval.settlement === null && maySettle && (
                <span className="text-xs font-medium text-brand">
                  Ready for simulated settlement
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* Expanded Detailed Section */}
        {expanded && (
          <div
            className="border-t border-line bg-raised/20 px-4 py-4 sm:px-5 space-y-4"
            style={{ animation: 'decideExpand 0.2s ease-out' }}
          >
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-line bg-raised/40 p-3.5">
              <div>
                <span className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted">
                  Principal Amount
                </span>
                <span className="mt-0.5 block font-mono text-sm sm:text-base font-bold text-text">
                  {sheet.currency} {sheet.principalFormatted}
                </span>
              </div>
              <div>
                <span className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted">
                  Tenure
                </span>
                <span className="mt-0.5 block font-mono text-sm sm:text-base font-bold text-text">
                  {sheet.tenureMonths} Months
                </span>
              </div>
              <div>
                <span className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted">
                  {sheet.facilityKind === 'ISLAMIC' ? 'Profit Rate' : 'Interest Rate'}
                </span>
                <span className="mt-0.5 block font-mono text-sm sm:text-base font-bold text-text">
                  {(rateBps / 100).toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted">
                  Meeting Reference
                </span>
                <Link
                  href={`/meetings/${sheet.meetingId}`}
                  className="mt-0.5 inline-flex items-center text-xs font-semibold text-brand hover:underline"
                >
                  View transcript →
                </Link>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Facility Breakdown & Details
              </h4>
              <dl className="divide-y divide-line rounded-lg border border-line bg-surface px-4 py-1">
                <DataRow label="Facility Kind">
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
                <DataRow label="Meeting Transcript">
                  <Link
                    href={`/meetings/${sheet.meetingId}`}
                    className="rounded text-brand font-medium underline underline-offset-2"
                  >
                    Open transcript & findings
                  </Link>
                </DataRow>
              </dl>
            </div>

            {approval.note !== null && approval.note !== '' && (
              <div className="rounded-lg border border-line bg-surface p-4 text-xs text-muted">
                <span className="font-medium text-text">Reviewer Note: </span>
                {approval.note}
              </div>
            )}

            {/* Decision Action Form for Checkers */}
            {mayDecide && pending && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Checker Decision
                </h4>
                <DecideForm approval={approval} onDone={onDecided} />
              </div>
            )}

            {/* Settlement Action Form */}
            {maySettle && approval.decision === 'APPROVED' && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-1.5">
                  Simulated Settlement
                </h4>
                <SettleForm approval={approval} onDone={onSettled} />
              </div>
            )}

            {/* CSV Handoff Download */}
            {mayDownload && approval.decision === 'APPROVED' && (
              <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-text">Data Handoff</span>
                  <a
                    href={`${API_BASE}/term-sheets/${sheet.id}/payment-payload`}
                    className="inline-flex items-center rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:bg-raised transition"
                  >
                    Download CSV handoff
                  </a>
                </div>
                <p className="text-[11px] text-faint">
                  Approved figures formatted for core banking entry. This system never submits payment instructions directly.
                </p>
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

type DecideTab = 'approvals' | 'settlement';

export default function ApprovalsPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const approvals = useAsync(() => api.approvals(), 'approvals');
  const [activeTab, setActiveTab] = useState<DecideTab>('approvals');
  const [done, setDone] = useState<string | null>(null);

  const mayDecide = can(session.data, 'termsheet:approve');
  const mayDownload = can(session.data, 'payment:settle');
  const maySettle = can(session.data, 'payment:settle');

  const onDecided = () => {
    setDone('Decision recorded and written to the audit log.');
    approvals.reload();
  };
  const onSettled = () => {
    setDone('Simulated settlement recorded and written to the audit log. No funds moved.');
    approvals.reload();
  };

  const all = approvals.data?.approvals ?? [];
  const pendingApprovals = all.filter((approval) => approval.decision === 'PENDING_CHECKER');
  const awaitingSettlement = all.filter(
    (approval) => approval.decision === 'APPROVED' && approval.settlement === null,
  );
  const recentlySettled = all.filter(
    (approval) => approval.decision === 'APPROVED' && approval.settlement !== null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Decide"
        title="Approvals and settlement"
      />

      {done && <SuccessNote>{done}</SuccessNote>}
      {approvals.loading && <Spinner label="Loading approvals" />}
      {approvals.error !== null && <ErrorNote>{approvals.error}</ErrorNote>}

      {/* Horizontal Tabs Header styled exactly like meeting detail tabs */}
      <div className="border-b border-line bg-surface/50 backdrop-blur-sm sticky top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <nav className="flex space-x-2 sm:space-x-4" aria-label="Decide sections" role="tablist">
          {/* Approvals Tab */}
          <button
            type="button"
            role="tab"
            id="tab-approvals"
            aria-selected={activeTab === 'approvals'}
            onClick={() => setActiveTab('approvals')}
            className={`group relative flex items-center gap-2 py-3 px-3 sm:px-4 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              activeTab === 'approvals'
                ? 'text-brand font-semibold'
                : 'text-muted hover:text-text hover:bg-raised/50'
            }`}
          >
            <span>Approvals</span>
            {pendingApprovals.length > 0 && (
              <span
                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-mono font-medium transition ${
                  activeTab === 'approvals'
                    ? 'bg-brand/15 text-brand border border-brand/30'
                    : 'bg-raised text-muted group-hover:text-text border border-line'
                }`}
              >
                {pendingApprovals.length}
              </span>
            )}
            {pendingApprovals.length > 0 && (
              <span
                title={`${String(pendingApprovals.length)} pending approval(s)`}
                className="inline-flex h-2 w-2 rounded-full bg-warn animate-pulse"
                aria-label={`${String(pendingApprovals.length)} pending approval(s)`}
              />
            )}
            {activeTab === 'approvals' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-brand"
              />
            )}
          </button>

          {/* Settlement Tab */}
          <button
            type="button"
            role="tab"
            id="tab-settlement"
            aria-selected={activeTab === 'settlement'}
            onClick={() => setActiveTab('settlement')}
            className={`group relative flex items-center gap-2 py-3 px-3 sm:px-4 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              activeTab === 'settlement'
                ? 'text-brand font-semibold'
                : 'text-muted hover:text-text hover:bg-raised/50'
            }`}
          >
            <span>Settlement</span>
            {awaitingSettlement.length > 0 && (
              <span
                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-mono font-medium transition ${
                  activeTab === 'settlement'
                    ? 'bg-brand/15 text-brand border border-brand/30'
                    : 'bg-raised text-muted group-hover:text-text border border-line'
                }`}
              >
                {awaitingSettlement.length}
              </span>
            )}
            {activeTab === 'settlement' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-brand"
              />
            )}
          </button>
        </nav>
      </div>

      {/* Tab Panels */}
      <div className="mt-6">
        {/* Approvals Panel */}
        {activeTab === 'approvals' && (
          <div className="space-y-4">
            {!approvals.loading && pendingApprovals.length === 0 && (
              <EmptyState
                title="Nothing awaiting a decision"
                body="A maker submits a term sheet from a meeting once its Shariah findings are cleared."
              />
            )}
            {pendingApprovals.length > 0 && (
              <ul className="space-y-4">
                {pendingApprovals.map((approval) => (
                  <ApprovalBox
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
          </div>
        )}

        {/* Settlement Panel */}
        {activeTab === 'settlement' && (
          <div className="space-y-6">
            {!approvals.loading && awaitingSettlement.length === 0 && recentlySettled.length === 0 && (
              <EmptyState
                title="Nothing to settle yet"
                body="Once you approve a facility, record its simulated settlement here."
              />
            )}

            {awaitingSettlement.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Awaiting Simulated Settlement ({awaitingSettlement.length})
                </h3>
                <ul className="space-y-4">
                  {awaitingSettlement.map((approval) => (
                    <ApprovalBox
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

            {recentlySettled.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Recently Settled ({recentlySettled.length})
                </h3>
                <ul className="space-y-4">
                  {recentlySettled.map((approval) => (
                    <ApprovalBox
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
          </div>
        )}
      </div>
    </div>
  );
}
