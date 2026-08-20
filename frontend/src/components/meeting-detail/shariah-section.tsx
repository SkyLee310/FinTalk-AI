'use client';

import { useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Card, CardHeader } from '@/components/card';
import {
  Button,
  ErrorNote,
  Field,
  Textarea,
} from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import {
  api,
  can,
  type MeetingDetail,
  type Session,
  type ShariahFlagRow,
  type ShariahStatus,
} from '@/lib/api';
import { guidanceFor, SHARIAH_ISSUE_ORDER } from '@/lib/shariah-guidance';
import { ShariahExcerpt } from './summary-section';

const FLAG_TONE: Record<ShariahStatus, Tone> = {
  FLAGGED: 'warn',
  UNDER_REVIEW: 'brand',
  CLEARED: 'ok',
  CONFIRMED_VIOLATION: 'danger',
};

const ISSUE_LABEL: Record<string, string> = {
  RIBA: 'Riba — Interest or charges functioning as interest',
  GHARAR: 'Gharar — Excessive uncertainty or ambiguity in contract terms',
  MAYSIR: 'Maysir — Speculative, gambling or zero-sum elements',
  HARAM_SECTOR: 'Haram Sector — Prohibited business activity or non-halal revenue',
  CONTRACT_MISMATCH: 'Contract Mismatch — Discrepancy between named Islamic contract and actual terms',
  LATE_PAYMENT_PENALTY: 'Late Payment Penalty — Unstructured punitive penalty functioning as interest (Ta’widh / Gharamah violation)',
};

function ReviewForm({
  flags,
  onDone,
}: {
  flags: ShariahFlagRow[];
  onDone: () => Promise<unknown> | void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ShariahStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(status: ShariahStatus): Promise<void> {
    setBusy(status);
    setError(null);
    try {
      await Promise.all(flags.map((flag) => api.reviewFlag(flag.id, status, note)));
      await onDone();
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
    <div className="mt-4 space-y-4 rounded-xl border border-line bg-surface/90 p-4 sm:p-5 shadow-sm">
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">Shariah Governance Rationale & Sign-Off</p>
        <p className="text-xs text-muted leading-relaxed">
          The <span className="font-mono text-brand font-medium">{primary.detectedBy}</span> rule flagged what may be {described}
          {multiple ? `, at ${String(flags.length)} places in this transcript` : ''}. Your determination will be recorded in the audit trail.
        </p>
      </div>

      <Field
        label="Supervisory Reasoning & Notes"
        htmlFor={`shariah-note-${primary.id}`}
        hint="Required for verification. Cite placeholders (e.g. [PERSON_NAME_1]) rather than personal identifiers."
      >
        <Textarea
          id={`shariah-note-${primary.id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="Explain the Shariah board's analysis or required remediation clause..."
          disabled={busy !== null}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-line/60">
        <Button
          variant="secondary"
          disabled={busy !== null || noteRequired}
          onClick={() => {
            void record('UNDER_REVIEW');
          }}
          title={noteRequired ? 'Enter a reasoning note first' : 'Mark for escalation or further review'}
        >
          {busy === 'UNDER_REVIEW' ? 'Saving…' : 'Mark Under Review'}
        </Button>

        <Button
          variant="secondary"
          disabled={busy !== null || noteRequired}
          onClick={() => {
            void record('CLEARED');
          }}
          className="text-ok hover:bg-ok-soft/30 hover:border-ok/40"
          title={noteRequired ? 'Enter a reasoning note first' : 'Clear as compliant or acceptable'}
        >
          {busy === 'CLEARED' ? 'Saving…' : 'Clear — No Violation'}
        </Button>

        <Button
          disabled={busy !== null || noteRequired}
          onClick={() => {
            void record('CONFIRMED_VIOLATION');
          }}
          className="bg-danger hover:bg-danger/90 text-white border-danger"
          title={noteRequired ? 'Enter a reasoning note first' : 'Confirm as prohibited violation'}
        >
          {busy === 'CONFIRMED_VIOLATION' ? 'Saving…' : 'Confirm Violation'}
        </Button>
      </div>
    </div>
  );
}

interface ShariahSectionProps {
  meeting: MeetingDetail;
  session: Session | null;
  onRefresh: () => void | Promise<unknown>;
  onJumpToTranscriptSegment?: (segmentId: string) => void;
}

export function ShariahSection({
  meeting,
  session,
  onRefresh,
  onJumpToTranscriptSegment,
}: ShariahSectionProps) {
  const isShariahReviewer = can(session, 'shariah:review');
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'CLEARED' | 'VIOLATION'>('ALL');

  const allFlags = meeting.shariahFlags ?? [];
  const openFlags = allFlags.filter((f) => f.status === 'FLAGGED' || f.status === 'UNDER_REVIEW');
  const clearedFlags = allFlags.filter((f) => f.status === 'CLEARED');
  const violationFlags = allFlags.filter((f) => f.status === 'CONFIRMED_VIOLATION');

  const filteredFlags = allFlags.filter((f) => {
    if (filter === 'OPEN') return f.status === 'FLAGGED' || f.status === 'UNDER_REVIEW';
    if (filter === 'CLEARED') return f.status === 'CLEARED';
    if (filter === 'VIOLATION') return f.status === 'CONFIRMED_VIOLATION';
    return true;
  });

  // Group filtered flags by issueType
  const groupedFlags = filteredFlags.reduce(
    (acc: Record<string, ShariahFlagRow[]>, flag: ShariahFlagRow) => {
      const list = acc[flag.issueType] ?? [];
      return { ...acc, [flag.issueType]: [...list, flag] };
    },
    {},
  );

  const flagEntries = Object.entries(groupedFlags).sort(([a], [b]) => {
    const aOrder = SHARIAH_ISSUE_ORDER.indexOf(a);
    const bOrder = SHARIAH_ISSUE_ORDER.indexOf(b);
    return (aOrder === -1 ? 99 : aOrder) - (bOrder === -1 ? 99 : bOrder);
  });

  return (
    <div className="space-y-6">
      {/* Header Overview Banner & Metrics */}
      <div className="rounded-2xl border border-line bg-gradient-to-br from-raised/80 via-surface to-raised/50 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 font-bold text-xs">
                SC
              </span>
              <h3 className="text-base sm:text-lg font-bold text-text">
                Shariah Compliance & Islamic Banking Governance
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-muted">
              Continuous automated screening against BNM Shariah Governance Framework (SGF) and AAOIFI Shariah Standards.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {openFlags.length === 0 && violationFlags.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 px-3 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                Fully Compliant
              </span>
            ) : violationFlags.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 dark:bg-rose-950/80 px-3 py-1 text-xs font-semibold text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                <span className="size-2 rounded-full bg-rose-500" />
                {violationFlags.length} Violation{violationFlags.length > 1 ? 's' : ''} Confirmed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950/80 px-3 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                <span className="size-2 rounded-full bg-amber-500 animate-ping" />
                {openFlags.length} Concern{openFlags.length > 1 ? 's' : ''} Require Review
              </span>
            )}
          </div>
        </div>

        {/* 4 Metric Cards */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface/80 p-3.5 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-faint">Total Scanned</p>
            <p className="text-xl font-bold text-text font-mono">{allFlags.length}</p>
            <p className="text-[11px] text-muted">Across 6 core rule engines</p>
          </div>

          <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-3.5 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400">Needs Review</p>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-400 font-mono">{openFlags.length}</p>
            <p className="text-[11px] text-muted">Flagged or Under Review</p>
          </div>

          <div className="rounded-xl border border-rose-200/60 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 p-3.5 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-rose-700 dark:text-rose-400">Violations</p>
            <p className="text-xl font-bold text-rose-700 dark:text-rose-400 font-mono">{violationFlags.length}</p>
            <p className="text-[11px] text-muted">Actionable non-compliance</p>
          </div>

          <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 space-y-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Cleared</p>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400 font-mono">{clearedFlags.length}</p>
            <p className="text-[11px] text-muted">Signed off by officer</p>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      {allFlags.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-line bg-raised/70 p-1 text-xs">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                filter === 'ALL' ? 'bg-surface text-text shadow-sm font-semibold' : 'text-muted hover:text-text'
              }`}
            >
              All Findings ({allFlags.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('OPEN')}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                filter === 'OPEN' ? 'bg-surface text-text shadow-sm font-semibold' : 'text-muted hover:text-text'
              }`}
            >
              Needs Review ({openFlags.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('VIOLATION')}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                filter === 'VIOLATION' ? 'bg-surface text-text shadow-sm font-semibold' : 'text-muted hover:text-text'
              }`}
            >
              Violations ({violationFlags.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('CLEARED')}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                filter === 'CLEARED' ? 'bg-surface text-text shadow-sm font-semibold' : 'text-muted hover:text-text'
              }`}
            >
              Cleared ({clearedFlags.length})
            </button>
          </div>
        </div>
      )}

      {/* Findings Breakdown */}
      {flagEntries.length === 0 ? (
        <Card>
          <div className="p-8 text-center space-y-2">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-ok-soft text-ok font-bold">
              ✓
            </div>
            <h4 className="text-base font-semibold text-text">
              {filter === 'ALL'
                ? 'No Shariah Non-Compliance Flags Detected'
                : `No findings matching filter "${filter}"`}
            </h4>
            <p className="text-xs text-muted max-w-md mx-auto">
              {filter === 'ALL'
                ? 'The meeting discussion, structured whiteboards, and extracted contracts conform to Islamic banking standards without flagged riba, gharar, or prohibited clauses.'
                : 'Switch filters or view all findings to see other entries.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {flagEntries.map(([issueType, flags]) => {
            const primary = flags[0]!;
            const guidance = guidanceFor(issueType);

            return (
              <Card key={issueType} className="overflow-hidden">
                <CardHeader
                  title={ISSUE_LABEL[issueType] ?? issueType}
                  description={
                    primary.reference
                      ? `Screening Reference: ${primary.reference}`
                      : 'Screened by automated rule engine'
                  }
                  action={
                    <Badge tone={FLAG_TONE[primary.status]}>
                      {primary.status.replace('_', ' ')}
                    </Badge>
                  }
                />

                <div className="p-4 sm:p-6 space-y-4">
                  {/* Flag Excerpts */}
                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
                      Flagged Excerpts ({flags.length})
                    </p>
                    {flags.map((flag) => (
                      <div
                        key={flag.id}
                        className="rounded-xl border border-line bg-surface p-3.5 sm:p-4 text-xs leading-relaxed text-text space-y-2"
                      >
                        <p>
                          <ShariahExcerpt text={flag.excerpt} highlights={flag.highlights ?? []} />
                        </p>
                        {flag.segmentId && onJumpToTranscriptSegment && (
                          <button
                            type="button"
                            onClick={() => onJumpToTranscriptSegment(flag.segmentId!)}
                            className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-mono font-medium"
                          >
                            Jump to audio transcript line →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Standard Guidance & Remediation */}
                  {guidance && (
                    <div className="rounded-xl border border-line bg-raised/70 p-4 text-xs space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-text">{guidance.title}</span>
                        {primary.reference && (
                          <span className="font-mono text-[0.68rem] text-faint">({primary.reference})</span>
                        )}
                      </div>
                      <p className="text-muted leading-relaxed">{guidance.whyItViolates}</p>
                    </div>
                  )}

                  {/* Officer Sign-Off & Review Form */}
                  {isShariahReviewer && (
                    <ReviewForm flags={flags} onDone={onRefresh} />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
