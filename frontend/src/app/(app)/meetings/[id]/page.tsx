'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/badge';
import { Button, EmptyState, ErrorNote, Spinner } from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import {
  api,
  can,
  type MeetingStatus,
  type Session,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { formatDuration } from '@/lib/duration';
import { MeetingDetailTabs, type MeetingDetailTab } from '@/components/meeting-detail/tabs';
import { SummarySection } from '@/components/meeting-detail/summary-section';
import { TranscriptSection } from '@/components/meeting-detail/transcript-section';
import { ShariahSection } from '@/components/meeting-detail/shariah-section';
import { TermSheetSection } from '@/components/meeting-detail/term-sheet-section';

const SOFT_TIMEOUT_MS = 4 * 60 * 1000;

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
            <p className="text-sm font-semibold text-text">Transcription could not be completed</p>
            <p className="mt-1 text-sm text-muted">
              {failureReason === null
                ? 'The AI service did not respond.'
                : `The pipeline failed during ${failureReason}.`}{' '}
              Your audio was not stored, so there is nothing to resume. You can try again.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => router.push('/capture')}>Try again</Button>
              <Button variant="secondary" onClick={() => router.push('/meetings')}>
                Back to Meetings
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const overdue = elapsedMs > SOFT_TIMEOUT_MS;
  const pct = Math.min(92, (elapsedMs / (3 * 60 * 1000)) * 100);

  return (
    <div className="rounded-lg border border-line bg-raised px-5 py-6 text-center space-y-4">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Spinner label="Transcribing audio…" />
      </div>

      <div className="max-w-md mx-auto space-y-1.5">
        <h3 className="text-base font-semibold text-text">
          {overdue
            ? 'Still transcribing — this is taking longer than usual'
            : 'Transcribing & analyzing credit discussion…'}
        </h3>
        <p className="text-xs text-muted">
          Step 1 of 3: Speech recognition · Step 2: PDPA Redaction · Step 3: Shariah Rule Screening
        </p>
      </div>

      <div className="max-w-md mx-auto">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-line"
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
        <p className="mt-2 text-[11px] text-faint font-mono">
          Estimated: 1-2 minutes depending on audio duration
        </p>
      </div>
    </div>
  );
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const session = useAsync<Session>(() => api.me(), 'session');
  const meeting = useAsync(() => api.meeting(id), `meeting:${id}`);
  const whiteboards = useAsync(() => api.whiteboards(id), `whiteboards:${id}`);

  const [activeTab, setActiveTab] = useState<MeetingDetailTab>('summary');
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<'archive' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncingMeet, setSyncingMeet] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handleSyncMeet() {
    setSyncingMeet(true);
    setSyncError(null);
    try {
      await api.syncMeet(id);
      meeting.reload();
    } catch (err) {
      setSyncError(describeError(err));
    } finally {
      setSyncingMeet(false);
    }
  }

  const meetingStatus = meeting.data?.status;
  useEffect(() => {
    if (meetingStatus !== 'CAPTURED' && meetingStatus !== 'PROCESSING') return undefined;
    const poll = setInterval(() => {
      meeting.reload({ silent: true });
      whiteboards.reload({ silent: true });
    }, 3000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meeting.reload and whiteboards.reload are stable
  }, [meetingStatus]);

  if (meeting.loading) return <Spinner label="Loading meeting details..." />;
  if (meeting.error !== null) return <ErrorNote>{meeting.error}</ErrorNote>;
  if (meeting.data === null) return <EmptyState title="Not found" body="Meeting does not exist." />;

  const data = meeting.data;
  const boards = whiteboards.data?.whiteboards ?? [];

  const canManage = can(session.data, 'meeting:create') && (session.data?.id === data.createdById || session.data?.role === 'ADMIN');

  const flagCount = data.shariahFlags?.filter((f) => f.status === 'FLAGGED' || f.status === 'UNDER_REVIEW').length ?? 0;

  async function handleArchive() {
    if (!window.confirm('Are you sure you want to archive this meeting? It will be hidden from the active list.')) return;
    setActionBusy('archive');
    setActionError(null);
    try {
      await api.archiveMeeting(id);
      router.push('/meetings');
    } catch (err) {
      setActionError(describeError(err));
      setActionBusy(null);
    }
  }

  async function handleDelete() {
    if (!window.confirm('WARNING: Hard delete will permanently remove this meeting and all transcripts. Continue?')) return;
    setActionBusy('delete');
    setActionError(null);
    try {
      await api.deleteMeeting(id);
      router.push('/meetings');
    } catch (err) {
      setActionError(describeError(err));
      setActionBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-brand transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Meetings
        </Link>

        {canManage && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleArchive}
              disabled={actionBusy !== null}
            >
              {actionBusy === 'archive' ? 'Archiving…' : 'Archive'}
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={actionBusy !== null}
            >
              {actionBusy === 'delete' ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        )}
      </div>

      {actionError && <ErrorNote>{actionError}</ErrorNote>}

      {/* Header Info */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">
              {data.title}
            </h1>
            <Badge
              tone={data.status === 'READY' ? 'ok' : data.status === 'FAILED' ? 'danger' : 'warn'}
              dot
            >
              {data.status}
            </Badge>
          </div>
          <p className="text-xs text-muted font-mono">
            {formatDateTime(data.occurredAt)}
            {data.transcript && ` · ${data.transcript.languages.join(', ')}`}
            {data.transcript?.processingMs != null &&
              ` · processed in ${formatDuration(data.transcript.processingMs)}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {data.consentConfirmed && <Badge tone="ok">Consent confirmed</Badge>}
          {data.transferAcknowledged && <Badge tone="ok">Cross-border transfer acknowledged</Badge>}
        </div>
      </div>

      {/* Google Meet Ingestion Card */}
      {data.captureSource === 'GOOGLE_MEET' && data.status !== 'READY' && (
        <div className="rounded-xl border border-brand/30 bg-raised/80 p-5 space-y-3 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Google Meet Connected</span>
                {data.meetLink && (
                  <a
                    href={data.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-brand hover:underline"
                  >
                    {data.meetLink}
                  </a>
                )}
              </div>
              <p className="text-xs text-muted">
                Google automatically finalizes transcript entries after your call concludes with transcription enabled.
              </p>
            </div>

            <Button
              variant="primary"
              disabled={syncingMeet || data.status === 'PROCESSING'}
              onClick={handleSyncMeet}
            >
              {syncingMeet ? 'Checking Google Meet…' : 'Sync Transcript Now'}
            </Button>
          </div>

          {syncError && <ErrorNote>{syncError}</ErrorNote>}
        </div>
      )}

      {/* Pipeline Status if still processing or failed */}
      {data.status !== 'READY' && (
        <ProcessingStatus status={data.status} failureReason={data.failureReason} />
      )}

      {/* Main Tabs */}
      {data.status === 'READY' && (
        <>
          <MeetingDetailTabs
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            flagCount={flagCount}
          />

          {/* Tab Content Panels */}
          <div className="mt-6">
            {activeTab === 'summary' && (
              <SummarySection
                meeting={data}
                whiteboards={boards}
                session={session.data}
                onRefresh={() => {
                  meeting.reload({ silent: true });
                  whiteboards.reload({ silent: true });
                }}
                onJumpToTranscriptSegment={(segId) => {
                  setActiveTab('transcript');
                  setHighlightedSegmentId(segId);
                }}
                onJumpToShariahTab={() => setActiveTab('shariah')}
              />
            )}

            {activeTab === 'transcript' && (
              <TranscriptSection
                meeting={data}
                session={session.data}
                highlightedSegmentId={highlightedSegmentId}
                onRefresh={() => meeting.reload({ silent: true })}
              />
            )}

            {activeTab === 'shariah' && (
              <ShariahSection
                meeting={data}
                session={session.data}
                onRefresh={() => meeting.reload({ silent: true })}
                onJumpToTranscriptSegment={(segId) => {
                  setActiveTab('transcript');
                  setHighlightedSegmentId(segId);
                }}
              />
            )}

            {activeTab === 'term-sheet' && (
              <TermSheetSection
                meeting={data}
                session={session.data}
                onRefresh={() => meeting.reload({ silent: true })}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
