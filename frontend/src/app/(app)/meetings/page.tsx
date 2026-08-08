'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Badge, type Tone } from '@/components/badge';
import { Card, CardHeader } from '@/components/card';
import {
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Spinner,
  SuccessNote,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { api, can, type MeetingStatus, type Session } from '@/lib/api';

const STATUS_TONE: Record<MeetingStatus, Tone> = {
  CAPTURED: 'neutral',
  PROCESSING: 'warn',
  READY: 'ok',
  FAILED: 'danger',
};

export default function MeetingsPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const meetings = useAsync(() => api.meetings(), 'meetings');

  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mayCreate = can(session.data, 'meeting:create');

  async function upload(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (file === null) return;

    setBusy(true);
    setError(null);
    setDone(null);

    const form = new FormData();
    form.set('title', title);
    form.set('occurredAt', new Date().toISOString());
    form.set('consentConfirmed', String(consent));
    form.set('audio', file);

    try {
      const result = await api.uploadMeeting(form);
      setDone(
        `Processed ${String(result.segmentCount)} segments and recorded `
        + `${String(result.redactionCount)} redactions.`,
      );
      setTitle('');
      setFile(null);
      setConsent(false);
      meetings.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="mt-1 text-sm text-muted">
          Recordings are transcribed, redacted and screened for Shariah issues before
          anything is stored.
        </p>
      </div>

      {mayCreate && (
        <Card>
          <CardHeader
            title="Capture a meeting"
            description="Audio is held in memory for the request only. It is never written to disk."
          />
          <form
            onSubmit={(event) => {
              void upload(event);
            }}
            className="space-y-4 px-5 py-4"
          >
            {error && <ErrorNote>{error}</ErrorNote>}
            {done && <SuccessNote>{done}</SuccessNote>}

            <Field label="Meeting title" htmlFor="title">
              <Input
                id="title"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="SME Loan Approval Meeting"
              />
            </Field>

            <Field
              label="Recording"
              htmlFor="audio"
              hint="Up to 20 MB, which is the provider's inline limit."
            >
              <Input
                id="audio"
                type="file"
                accept="audio/*"
                required
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>

            {/*
              The consent gate. The backend refuses to process without it, before
              looking at the audio — this checkbox is the operator's record of
              having asked, not a formality the UI can skip.
            */}
            <div className="flex gap-2.5 rounded-lg border border-line bg-raised px-4 py-3">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <label htmlFor="consent" className="text-sm text-muted">
                Every participant was informed the meeting is recorded and processed, and
                consented. Processing is refused without this.
              </label>
            </div>

            <Button type="submit" disabled={busy || !consent || file === null}>
              {busy ? 'Processing…' : 'Upload and process'}
            </Button>
          </form>
        </Card>
      )}

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
                ? 'Upload a recording above, or run the seed script in backend/ to load the demo scenario.'
                : 'Nothing has been captured yet. A maker can upload a recording.'
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
