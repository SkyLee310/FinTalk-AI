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
  PageHeader,
  Spinner,
  SuccessNote,
} from '@/components/ui';
import {
  isFullyAcknowledged,
  NO_ACKNOWLEDGEMENT,
  type TransferAcknowledgement,
  TransferNotice,
} from '@/components/transfer-notice';
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
  const [board, setBoard] = useState<File | null>(null);
  const [ack, setAck] = useState<TransferAcknowledgement>(NO_ACKNOWLEDGEMENT);
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
    form.set('consentConfirmed', String(ack.consentConfirmed));
    form.set('transferAcknowledged', String(ack.transferAcknowledged));
    form.set('audio', file);

    try {
      const { meetingId } = await api.uploadMeeting(form);
      setTitle('');
      setFile(null);
      // Reset both, so the next upload records its own acknowledgement rather
      // than inheriting one given for a different recording.
      setAck(NO_ACKNOWLEDGEMENT);
      meetings.reload();

      /**
       * The board is extracted while the transcript is still being produced.
       *
       * A separate request, because extraction is synchronous and takes seconds
       * where transcription takes minutes. Its failure is reported rather than
       * thrown: the recording has already been accepted and is already being
       * processed, and discarding that because a photograph failed would lose
       * the more valuable half of the capture.
       */
      let boardNote = '';
      if (board !== null) {
        const boardForm = new FormData();
        boardForm.set('image', board);

        try {
          const extracted = await api.uploadWhiteboard(meetingId, boardForm);
          boardNote =
            ` Whiteboard extracted, ${String(extracted.redactionCount)} identifier(s) masked.`;
          setBoard(null);
        } catch (cause) {
          boardNote =
            ` The recording was accepted, but the whiteboard failed: ${describeError(cause)}`;
        }
      }

      /**
       * The upload is accepted before it is processed, so the outcome is polled.
       * Transcribing a real recording takes minutes — longer than any request is
       * allowed to stay open.
       */
      setDone(
        'Uploaded. Transcribing and screening now — this can take a few minutes.'
        + boardNote,
      );

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const detail = await api.meeting(meetingId);

        if (detail.status === 'READY') {
          const redactions = detail.transcript?.redactions.length ?? 0;
          const segments = detail.transcript?.segments.length ?? 0;
          setDone(
            `Ready. ${String(segments)} segments, ${String(redactions)} redactions, `
            + `${String(detail.shariahFlags.length)} Shariah finding(s).`
            // Carried through so the whiteboard outcome is not overwritten by
            // the transcript's.
            + boardNote,
          );
          meetings.reload();
          return;
        }

        if (detail.status === 'FAILED') {
          setDone(null);
          setError(
            `Processing failed at ${detail.failureReason ?? 'an unknown stage'}. `
            + 'No transcript was stored.',
          );
          meetings.reload();
          return;
        }
      }

      setDone('Still processing. Open the meeting from the list to check on it.');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

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
              Optional, and captured in the same step as the audio because that
              is how the meeting actually happened: the board was on the wall
              while people were talking. Uploading it later would mean the
              transcript and the diagram arrive as two unrelated records.
            */}
            <Field
              label="Whiteboard photo (optional)"
              htmlFor="whiteboard"
              hint="Extracted to a diagram and redacted, exactly like the transcript."
            >
              <Input
                id="whiteboard"
                type="file"
                accept="image/*"
                onChange={(event) => setBoard(event.target.files?.[0] ?? null)}
              />
            </Field>

            {/*
              Consent and the cross-border transfer, as two separate agreements.
              The route refuses either one missing, before it looks at the audio.
            */}
            <TransferNotice value={ack} onChange={setAck} idPrefix="upload" />

            <Button
              type="submit"
              disabled={busy || !isFullyAcknowledged(ack) || file === null}
            >
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
