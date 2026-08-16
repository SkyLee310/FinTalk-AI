'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Button, EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { api, can, type MeetingStatus, type MeetingSummary, type Session } from '@/lib/api';

const STATUS_TONE: Record<MeetingStatus, Tone> = {
  CAPTURED: 'neutral',
  PROCESSING: 'warn',
  READY: 'ok',
  FAILED: 'danger',
};

/**
 * One row. The position number is this list's own index, not a stored
 * identifier — it exists so a person can say "the third one" out loud, and
 * it reflows correctly when a row above it is removed.
 *
 * canDelete is decided by the caller from meeting.createdById, because
 * showing this control to someone the server would 403 is worse than not
 * showing it at all.
 */
function MeetingRow({
  meeting,
  position,
  canDelete,
  onDeleted,
}: {
  meeting: MeetingSummary;
  position: number;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMeeting(meeting.id);
      onDeleted();
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li>
      <div className="grid grid-cols-[2rem_1fr] items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-surface px-5 py-4 transition hover:border-line-strong sm:grid-cols-[2rem_1fr_auto_auto]">
        <span className="text-center text-sm font-bold tabular-nums text-faint">{position}</span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{meeting.title}</p>
          <p className="mt-0.5 text-xs text-faint">
            {new Date(meeting.occurredAt).toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-self-end">
          {meeting.shariahFlagCount > 0 && (
            <Badge tone="warn" dot>
              {meeting.shariahFlagCount} Shariah finding
              {meeting.shariahFlagCount === 1 ? '' : 's'}
            </Badge>
          )}
          {meeting.termSheetCount > 0 && (
            <Badge tone="neutral">
              {meeting.termSheetCount} term sheet
              {meeting.termSheetCount === 1 ? '' : 's'}
            </Badge>
          )}
          <Badge tone={STATUS_TONE[meeting.status]} dot>
            {meeting.status}
          </Badge>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-self-end">
          <Link
            href={`/meetings/${meeting.id}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium tracking-tight text-text transition hover:bg-raised active:scale-[0.98]"
          >
            More Details
          </Link>
          {canDelete && !confirming && (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>

        {error !== null && (
          <div className="col-span-2 sm:col-span-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        {canDelete && confirming && (
          <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-line pt-3 sm:col-span-4">
            <span className="text-sm text-danger">
              Delete permanently? This can&apos;t be undone.
            </span>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void remove();
              }}
            >
              {busy ? 'Deleting…' : 'Yes, delete'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Review only. Capturing a meeting — recording, uploading, the whiteboard
 * photo — lives entirely on /record: this page reads what capture produced,
 * it does not also produce it.
 */
export default function MeetingsPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const meetings = useAsync(() => api.meetings(), 'meetings');

  const mayCreate = can(session.data, 'meeting:create');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Review"
        title="Meetings"
        lead="Recordings are transcribed, masked and screened for Shariah issues before anything is stored. Open one to read its transcript and act on what was found."
        action={
          mayCreate ? (
            <Link
              href="/record"
              className="inline-flex items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-canvas transition hover:opacity-90"
            >
              Record a meeting
            </Link>
          ) : undefined
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
          Captured meetings
        </h2>

        {meetings.loading && <Spinner label="Loading meetings" />}
        {meetings.error !== null && <ErrorNote>{meetings.error}</ErrorNote>}

        {meetings.data?.meetings.length === 0 && (
          <EmptyState
            title="No meetings yet"
            body={
              mayCreate
                ? 'Record or upload one from Capture, or run the seed script in backend/ to load the demo scenario.'
                : 'Nothing has been captured yet. A maker can record or upload one.'
            }
          />
        )}

        <ul className="space-y-3">
          {meetings.data?.meetings.map((meeting, index) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              position={index + 1}
              canDelete={mayCreate && meeting.createdById === session.data?.id}
              onDeleted={() => meetings.reload()}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
