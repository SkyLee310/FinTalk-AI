'use client';

import { Badge } from '@/components/badge';
import { Card, CardHeader } from '@/components/card';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { TransferRecord } from '@/components/transfer-notice';
import { Button } from '@/components/ui';
import {
  can,
  type MeetingDetail,
  type Session,
  type WhiteboardRow,
  WHITEBOARD_KIND_LABEL,
} from '@/lib/api';
import { computeParticipation, participationNudge } from '@/lib/participation';
import { MeetingChat } from './meeting-chat';

export function RedactedText({ text }: { text: string }) {
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

export function ShariahExcerpt({ text, highlights }: { text: string; highlights: readonly string[] }) {
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

export function renderStructuredValue(value: unknown) {
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

export interface SummarySectionProps {
  meeting: MeetingDetail;
  whiteboards: WhiteboardRow[];
  session: Session | null;
  onJumpToShariahTab?: () => void;
  onJumpToTermSheetTab?: () => void;
}

export function SummarySection({
  meeting,
  whiteboards,
  session,
  onJumpToShariahTab,
  onJumpToTermSheetTab,
}: SummarySectionProps) {
  const isShariahReviewer = can(session, 'shariah:review');
  const isMaker = can(session, 'termsheet:draft') || can(session, 'termsheet:submit');

  const participation = computeParticipation(
    meeting.transcript?.segments ?? [],
  );
  const quietSpeakers = participation.filter((p) => p.quiet);
  const nudges = quietSpeakers.map(participationNudge).filter((n): n is string => n !== null);

  const openFlagCount = (meeting.shariahFlags ?? []).filter(
    (f) => f.status === 'FLAGGED' || f.status === 'UNDER_REVIEW',
  ).length;

  return (
    <div className="space-y-6">
      {/* Guided Next Step Recommendation Banner */}
      <div className="rounded-xl border border-brand/20 bg-gradient-to-r from-surface via-raised to-brand-soft/30 px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-[0.65rem] font-mono font-bold uppercase tracking-wider text-brand">
              Next Step
            </span>
            {openFlagCount > 0 ? (
              <p className="text-xs sm:text-sm font-semibold text-text">
                ⚠️ {openFlagCount} Shariah finding{openFlagCount === 1 ? '' : 's'} to review
              </p>
            ) : (
              <p className="text-xs sm:text-sm font-semibold text-text">
                ✨ Shariah clean · Ready for term sheet
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {openFlagCount > 0 && onJumpToShariahTab && (
              <Button
                variant={isShariahReviewer ? 'primary' : 'secondary'}
                onClick={onJumpToShariahTab}
                className="text-xs"
              >
                Review Flags →
              </Button>
            )}
            {openFlagCount === 0 && isMaker && onJumpToTermSheetTab && (
              <Button onClick={onJumpToTermSheetTab} className="text-xs">
                Draft Terms →
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Transfer & Retention Record */}
      <div className="rounded-lg border border-line bg-raised px-4 py-3">
        <TransferRecord
          consentConfirmed={meeting.consentConfirmed}
          transferAcknowledged={meeting.transferAcknowledged}
        />
      </div>

      {/* Embedded Per-Meeting AI Chat */}
      <MeetingChat meetingId={meeting.id} meetingTitle={meeting.title} />

      {/* Meeting Intelligence / Decisions & Action Items */}
      {((meeting.decisions?.length ?? 0) > 0 ||
        (meeting.actionItems?.length ?? 0) > 0 ||
        meeting.transcript?.projectKickoff) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Decisions */}
          {(meeting.decisions?.length ?? 0) > 0 && (
            <Card>
              <CardHeader
                title="Debated Points & Decisions"
                description="Distilled by the arbiter from debate. Resolves who agreed to what, or states what was left open."
              />
              <div className="divide-y divide-line">
                {meeting.decisions.map((decision) => (
                  <div key={decision.id} className="p-4 sm:p-5 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-sm font-semibold text-text">
                        <RedactedText text={decision.topic} />
                      </h4>
                      <Badge
                        tone={decision.decision.toLowerCase().includes('unresolved') ? 'warn' : 'ok'}
                      >
                        {decision.decision.toLowerCase().includes('unresolved')
                          ? 'Unresolved'
                          : 'Decided'}
                      </Badge>
                    </div>
                    <p className="text-sm text-text font-medium">
                      <RedactedText text={decision.decision} />
                    </p>
                    <p className="text-xs text-muted leading-relaxed">
                      <RedactedText text={decision.rationale} />
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Action Items */}
          {(meeting.actionItems?.length ?? 0) > 0 && (
            <Card>
              <CardHeader
                title="Action Items"
                description="Follow-up tasks attributed by role/speaker label. Never personal names."
              />
              <div className="divide-y divide-line">
                {meeting.actionItems.map((item) => (
                  <div key={item.id} className="p-4 sm:p-5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-brand bg-brand-soft px-2 py-0.5 rounded border border-brand/20">
                        {item.owner}
                      </span>
                      {item.dueDate && (
                        <span className="text-xs text-muted font-mono">Due: {item.dueDate}</span>
                      )}
                    </div>
                    <p className="text-sm text-text mt-1">
                      <RedactedText text={item.task} />
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Instant Project Kickoff Draft */}
          {meeting.transcript?.projectKickoff && (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Instant Project Draft"
                description="AI-generated kickoff plan derived from the redacted discussion."
              />
              <div className="p-4 sm:p-6 space-y-4">
                <div className="rounded-lg border border-line bg-raised p-4">
                  <p className="text-sm leading-relaxed text-text">
                    <RedactedText text={meeting.transcript.projectKickoff} />
                  </p>
                </div>

                {(meeting.transcript.followUps?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                      Suggested Next Steps
                    </h4>
                    <ul className="space-y-1.5 list-disc list-inside text-sm text-text">
                      {meeting.transcript.followUps.map((step, i) => (
                        <li key={i}>
                          <RedactedText text={step} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Participation & Speaking Share */}
      {participation.length > 0 && (
        <Card>
          <CardHeader
            title="Meeting Participants & Speaking Share"
            description="Tracking speaking distribution to ensure balanced credit committee participation."
          />
          <div className="p-4 sm:p-6 space-y-4">
            {nudges.length > 0 && (
              <div className="rounded-lg border border-brand/20 bg-brand-soft/30 p-3 text-xs text-brand flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{nudges.join(' ')}</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {participation.map((p) => (
                <div key={p.speakerLabel} className="rounded-lg border border-line bg-raised/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-text">
                      <RedactedText text={p.speakerLabel} />
                    </span>
                    {p.quiet && (
                      <span className="text-[11px] font-medium text-warn">Quiet</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted font-mono">
                      <span>{Math.round(p.totalMs / 1000)}s</span>
                      <span>{Math.round(p.share * 100)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-line overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${Math.round(p.share * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Whiteboards & Artifacts */}
      {whiteboards.length > 0 && (
        <Card>
          <CardHeader
            title="Attached Documents & Visual Artifacts"
            description="Photographs of whiteboards, slides, and credit papers parsed during ingestion."
          />
          <div className="divide-y divide-line">
            {whiteboards.map((board) => (
              <div key={board.id} className="p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-raised px-2 py-0.5 font-mono text-xs font-medium text-text border border-line">
                      {WHITEBOARD_KIND_LABEL[board.kind] ?? board.kind}
                    </span>
                    <span className="text-xs text-muted">
                      Extracted via {board.modelId} ({board.promptVersion})
                    </span>
                  </div>
                </div>

                {board.mermaid && (
                  <div className="rounded-lg border border-line bg-surface p-4 overflow-x-auto">
                    <MermaidDiagram source={board.mermaid} />
                  </div>
                )}

                {board.structuredJson !== null && board.structuredJson !== undefined && (
                  <div className="text-xs text-text">
                    {renderStructuredValue(board.structuredJson)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
