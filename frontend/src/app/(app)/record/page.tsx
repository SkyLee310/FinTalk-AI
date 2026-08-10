'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader } from '@/components/card';
import {
  isFullyAcknowledged,
  NO_ACKNOWLEDGEMENT,
  type TransferAcknowledgement,
  TransferNotice,
} from '@/components/transfer-notice';
import {
  Button,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { formatElapsed, recordingFilename, useRecorder } from '@/hooks/use-recorder';
import { api, can, type Session } from '@/lib/api';

/**
 * Record a meeting in the browser.
 *
 * The order of this screen is the compliance argument. Details and both
 * acknowledgements come first, and the record button stays disabled until they
 * are given — consent obtained after the microphone opened would be consent to a
 * recording that already existed.
 */

interface Participant {
  readonly name: string;
  readonly role: string;
}

const EMPTY_PARTICIPANT: Participant = { name: '', role: '' };

/** Local time in the format a datetime-local input expects. */
function localDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 24;
  const lit = active ? Math.round(level * bars) : 0;

  return (
    <div
      className="flex items-end gap-[3px]"
      role="meter"
      aria-label="Microphone input level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
    >
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`w-[3px] rounded-full transition-[background-color] duration-75 ${
            index < lit ? 'bg-brand' : 'bg-line-strong'
          }`}
          style={{ height: `${String(6 + (index / bars) * 22)}px` }}
        />
      ))}
    </div>
  );
}

export default function RecordPage() {
  const router = useRouter();
  const session = useAsync<Session>(() => api.me(), 'session');
  const recorder = useRecorder();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue(new Date()));
  const [participants, setParticipants] = useState<Participant[]>([EMPTY_PARTICIPANT]);
  const [ack, setAck] = useState<TransferAcknowledgement>(NO_ACKNOWLEDGEMENT);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const mayCreate = can(session.data, 'meeting:create');
  const armed = title.trim() !== '' && isFullyAcknowledged(ack);

  /** An object URL, so the take can be heard before it is committed. */
  const previewUrl = useMemo(
    () => (recorder.blob === null ? null : URL.createObjectURL(recorder.blob)),
    [recorder.blob],
  );
  useEffect(() => {
    if (previewUrl === null) return undefined;
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /**
   * Warns on close or reload while a recording is live or held unsent.
   *
   * The audio exists only in memory, so leaving loses it. A confirmation prompt
   * is a poor substitute for durability, but it is honest about the risk where
   * silence would not be.
   */
  const atRisk = recorder.state === 'recording'
    || recorder.state === 'paused'
    || (recorder.blob !== null && !busy);

  useEffect(() => {
    if (!atRisk) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [atRisk]);

  function updateParticipant(index: number, patch: Partial<Participant>): void {
    setParticipants((current) =>
      current.map((participant, i) => (i === index ? { ...participant, ...patch } : participant)),
    );
  }

  async function submit(): Promise<void> {
    if (recorder.blob === null) return;

    setBusy(true);
    setError(null);
    setProgress('Uploading the recording…');

    const named = participants
      .map((p) => ({ name: p.name.trim(), role: p.role.trim() }))
      .filter((p) => p.name !== '');

    const form = new FormData();
    form.set('title', title.trim());
    if (description.trim() !== '') form.set('description', description.trim());
    form.set('occurredAt', new Date(occurredAt).toISOString());
    form.set('consentConfirmed', String(ack.consentConfirmed));
    form.set('transferAcknowledged', String(ack.transferAcknowledged));
    if (named.length > 0) form.set('participants', JSON.stringify(named));
    form.set('audio', recorder.blob, recordingFilename(recorder.blob));

    try {
      const { meetingId } = await api.uploadMeeting(form);
      setProgress('Uploaded. Transcribing now — this takes a few minutes.');
      // Straight to the meeting, which already polls its own status and reveals
      // the transcript, redactions and Shariah findings as they land.
      router.push(`/meetings/${meetingId}`);
    } catch (cause) {
      setError(describeError(cause));
      setProgress(null);
      setBusy(false);
    }
  }

  if (session.loading) return <Spinner label="Checking your session" />;

  if (!mayCreate) {
    return (
      <ErrorNote>
        Your role cannot capture meetings. A maker records and uploads them.
      </ErrorNote>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capture"
        title="Record a meeting"
        lead="Capture the discussion here in the browser. It is transcribed across English, Malay and Chinese, then masked and screened before anything is stored."
      />

      {error !== null && <ErrorNote>{error}</ErrorNote>}

      <Card>
        <CardHeader
          title="1. What is this meeting?"
          description="Stored with the transcript, so the record can be found again later."
        />
        <div className="space-y-4 px-5 py-4">
          <Field label="Title" htmlFor="title">
            <Input
              id="title"
              required
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="SME facility — credit committee"
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            hint="Optional. Avoid anyone's personal details here — this field is stored exactly as typed."
          >
            <Textarea
              id="description"
              rows={2}
              value={description}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <Field label="When it took place" htmlFor="occurredAt">
            <Input
              id="occurredAt"
              type="datetime-local"
              required
              value={occurredAt}
              disabled={busy}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Who was there</legend>
            <p className="text-xs text-faint">
              Optional. Names are masked before they are stored — the record keeps a
              placeholder, and the name itself is encrypted.
            </p>

            {participants.map((participant, index) => (
              <div key={index} className="flex flex-wrap gap-2">
                <Input
                  aria-label={`Participant ${String(index + 1)} name`}
                  className="min-w-40 flex-1"
                  value={participant.name}
                  disabled={busy}
                  onChange={(event) => updateParticipant(index, { name: event.target.value })}
                  placeholder="Name"
                />
                <Input
                  aria-label={`Participant ${String(index + 1)} role`}
                  className="min-w-40 flex-1"
                  value={participant.role}
                  disabled={busy}
                  onChange={(event) => updateParticipant(index, { role: event.target.value })}
                  placeholder="Role, e.g. Credit Manager"
                />
                {participants.length > 1 && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setParticipants((current) => current.filter((_, i) => i !== index));
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}

            <Button
              variant="secondary"
              disabled={busy || participants.length >= 40}
              onClick={() => {
                setParticipants((current) => [...current, EMPTY_PARTICIPANT]);
              }}
            >
              Add another
            </Button>
          </fieldset>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="2. Permission to record"
          description="Both are required before the microphone will open."
        />
        <div className="px-5 py-4">
          <TransferNotice value={ack} onChange={setAck} idPrefix="record" />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="3. Record"
          description="Audio is held in this browser tab until you upload it."
        />
        <div className="space-y-4 px-5 py-4">
          {!recorder.supported && (
            <ErrorNote>
              This browser cannot record audio. Use the upload form on the Meetings
              page instead.
            </ErrorNote>
          )}

          {recorder.error !== null && <ErrorNote>{recorder.error}</ErrorNote>}

          {!armed && recorder.state === 'idle' && (
            <p className="text-sm text-muted">
              Give the meeting a title and tick both boxes above to enable recording.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <p
              className="font-mono text-3xl tabular-nums"
              aria-label={`Elapsed ${formatElapsed(recorder.elapsedMs)}`}
            >
              {formatElapsed(recorder.elapsedMs)}
            </p>
            <LevelMeter level={recorder.level} active={recorder.state === 'recording'} />
            {recorder.state === 'recording' && (
              <span className="flex items-center gap-2 text-sm font-medium text-danger">
                <span
                  aria-hidden="true"
                  className="size-2.5 animate-pulse rounded-full bg-danger"
                />
                Recording
              </span>
            )}
            {recorder.state === 'paused' && (
              <span className="text-sm font-medium text-warn">Paused</span>
            )}
          </div>

          {/*
            aria-live lives on its own node, away from the timer. Announcing
            every tick would make a screen reader unusable; announcing state
            changes is what a listener actually needs.
          */}
          <p className="sr-only" aria-live="polite">
            {recorder.state === 'recording'
              ? 'Recording'
              : recorder.state === 'paused'
                ? 'Paused'
                : recorder.state === 'stopped'
                  ? 'Recording finished'
                  : ''}
          </p>

          <div className="flex flex-wrap gap-2">
            {(recorder.state === 'idle' || recorder.state === 'requesting') && (
              <Button
                disabled={!armed || !recorder.supported || recorder.state === 'requesting'}
                onClick={() => {
                  void recorder.start();
                }}
              >
                {recorder.state === 'requesting' ? 'Opening microphone…' : 'Start recording'}
              </Button>
            )}

            {recorder.state === 'recording' && (
              <>
                <Button variant="secondary" onClick={recorder.pause}>
                  Pause
                </Button>
                <Button variant="danger" onClick={recorder.stop}>
                  Stop
                </Button>
              </>
            )}

            {recorder.state === 'paused' && (
              <>
                <Button onClick={recorder.resume}>Resume</Button>
                <Button variant="danger" onClick={recorder.stop}>
                  Stop
                </Button>
              </>
            )}
          </div>

          {(recorder.state === 'recording' || recorder.state === 'paused') && (
            <p className="text-xs text-faint">
              Keep this tab open. The audio is only in this browser until you upload
              it, so closing the tab loses the recording.
            </p>
          )}

          {recorder.blob !== null && previewUrl !== null && (
            <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
              <p className="text-sm font-medium">
                {formatElapsed(recorder.elapsedMs)} recorded
                <span className="ml-2 font-normal text-faint">
                  {(recorder.blob.size / 1_048_576).toFixed(1)} MB
                </span>
              </p>
              {/* Heard before it is committed. A silent take should be discovered
                  here, not after transcription returns nothing. */}
              <audio controls src={previewUrl} className="w-full">
                <track kind="captions" />
              </audio>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    void submit();
                  }}
                >
                  {busy ? 'Uploading…' : 'Upload and transcribe'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={recorder.reset}>
                  Discard and re-record
                </Button>
              </div>
              {progress !== null && <p className="text-sm text-muted">{progress}</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
