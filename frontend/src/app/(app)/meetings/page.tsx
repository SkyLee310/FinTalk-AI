'use client';

import Link from 'next/link';
import { Badge, type Tone } from '@/components/badge';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type MeetingStatus, type Session } from '@/lib/api';

const STATUS_TONE: Record<MeetingStatus, Tone> = {
  CAPTURED: 'neutral',
  PROCESSING: 'warn',
  READY: 'ok',
  FAILED: 'danger',
};

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
          {meetings.data?.meetings.map((meeting) => (
            <li key={meeting.id}>
              <Link
                href={`/meetings/${meeting.id}`}
                className="block rounded-xl border border-line bg-surface px-5 py-4 transition hover:border-line-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{meeting.title}</p>
                    <p className="mt-0.5 text-xs text-faint">
                      {new Date(meeting.occurredAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
