'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  isFullyAcknowledged,
  NO_ACKNOWLEDGEMENT,
  type TransferAcknowledgement,
  TransferNotice,
} from '@/components/transfer-notice';
import {
  Button,
  Disclosure,
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
 *
 * The three steps below are an accordion, not three independent cards: each
 * one gates the next, so the compliance order above is something the screen
 * enforces rather than only asks for.
 */

interface Participant {
  readonly name: string;
  readonly role: string;
}

const EMPTY_PARTICIPANT: Participant = { name: '', role: '' };

/** How the audio for this capture is being obtained. */
type CaptureMode = 'record' | 'upload';

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

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
    </svg>
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

  /**
   * Upload is the fallback for a browser that cannot record, or a recording
   * made elsewhere (a phone, a Zoom call). It lives here rather than on the
   * Review page because both are ways to do the same one thing — capture a
   * meeting — and Review is where a meeting is read, not where it starts.
   */
  const [mode, setMode] = useState<CaptureMode>('record');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [boardFile, setBoardFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  /**
   * Which step is open, and whether each of the first two is satisfied.
   * Continue only advances past a step once it is complete, and onToggle
   * (below) only ever acts on *opening* a step — never on closing the one
   * that is currently open — so a step never self-closes out from under
   * the person filling it in. Every step stays reachable to reopen and
   * edit, but only once its own predecessor is currently satisfied: this
   * is what stops jumping straight to step 3 by clicking its (collapsed,
   * not-yet-unlocked) summary before step 1 or 2 is done.
   */
  const [openStep, setOpenStep] = useState<1 | 2 | 3>(1);
  const [submitted, setSubmitted] = useState(false);
  const step1Complete = title.trim() !== '';
  const step2Complete = isFullyAcknowledged(ack);
  const mayCreate = can(session.data, 'meeting:create');
  const armed = step1Complete && step2Complete;

  function requestOpenStep(step: 1 | 2 | 3): void {
    if (step === 1) setOpenStep(1);
    else if (step === 2 && step1Complete) setOpenStep(2);
    else if (step === 3 && armed) setOpenStep(3);
  }

  const step1Summary = step1Complete && openStep !== 1 ? `1. ${title}` : '1. What is this meeting?';
  const step2Summary = step2Complete && openStep !== 2 ? '2. Consent confirmed' : '2. Permission to record';
  const step3Summary = submitted ? '3. Submitted' : '3. Capture the audio';

  /** The take to submit, whichever way it was obtained. */
  const readyBlob: Blob | null = mode === 'record' ? recorder.blob : audioFile;

  /** An object URL, so the take can be heard before it is committed. */
  const previewUrl = useMemo(
    () => (readyBlob === null ? null : URL.createObjectURL(readyBlob)),
    [readyBlob],
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
    // Only the recorded take is irreplaceable. A chosen upload file still
    // exists on disk, so re-selecting it after a reload loses nothing.
    || (mode === 'record' && recorder.blob !== null && !busy);

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
    if (readyBlob === null) return;

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
    form.set(
      'audio',
      readyBlob,
      mode === 'record' ? recordingFilename(readyBlob) : audioFile?.name,
    );

    try {
      const { meetingId } = await api.uploadMeeting(form);
      setSubmitted(true);

      /**
       * A separate request, because extraction is synchronous and takes
       * seconds where transcription takes minutes. Its failure is reported
       * rather than thrown: the recording has already been accepted and is
       * already being processed, and discarding that because a photograph
       * failed would lose the more valuable half of the capture.
       */
      let boardNote = '';
      if (boardFile !== null) {
        setProgress('Recording accepted. Extracting the whiteboard…');
        const boardForm = new FormData();
        boardForm.set('image', boardFile);
        try {
          const extracted = await api.uploadWhiteboard(meetingId, boardForm);
          boardNote = ` Whiteboard extracted, ${String(extracted.redactionCount)} identifier(s) masked.`;
        } catch (cause) {
          boardNote = ` The recording was accepted, but the whiteboard failed: ${describeError(cause)}`;
        }
      }

      setProgress(`Uploaded. Transcribing now — this takes a few minutes.${boardNote}`);
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

      <Disclosure
        summary={step1Summary}
        open={openStep === 1}
        onToggle={(open) => {
          if (open) requestOpenStep(1);
        }}
      >
        <div className="space-y-4">
          <p className="text-xs text-faint">
            Stored with the transcript, so the record can be found again later.
          </p>

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

          <Button disabled={!step1Complete} onClick={() => requestOpenStep(2)}>
            Continue
          </Button>
        </div>
      </Disclosure>

      <Disclosure
        summary={step2Summary}
        open={openStep === 2}
        onToggle={(open) => {
          if (open) requestOpenStep(2);
        }}
      >
        <div className="space-y-4">
          <p className="text-xs text-faint">Both are required before the microphone will open.</p>

          <TransferNotice value={ack} onChange={setAck} idPrefix="record" />

          {/*
            Gated on `armed`, which is what requestOpenStep(3) actually
            enforces — not on step2Complete alone. Those two disagreeing is
            what made this button appear enabled and do nothing: both boxes
            ticked with no title left it clickable and inert. A control's
            disabled state and its precondition have to be the same
            condition, or the button lies about what it will do.
          */}
          <Button disabled={!armed} onClick={() => requestOpenStep(3)}>
            Continue
          </Button>
          {step2Complete && !step1Complete && (
            <p className="text-xs text-faint">
              Give the meeting a title in step 1 first.
            </p>
          )}
        </div>
      </Disclosure>

      <Disclosure
        summary={step3Summary}
        open={openStep === 3 && !submitted}
        onToggle={(open) => {
          if (open) requestOpenStep(3);
        }}
      >
        <div className="space-y-4">
          <p className="text-xs text-faint">
            Record here, or upload a file captured elsewhere — a phone, a Zoom export.
          </p>

          <fieldset className="flex flex-wrap gap-4" disabled={busy}>
            <legend className="sr-only">How was this meeting recorded</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="captureMode"
                className="accent-brand"
                checked={mode === 'record'}
                onChange={() => setMode('record')}
              />
              Record here
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="captureMode"
                className="accent-brand"
                checked={mode === 'upload'}
                onChange={() => setMode('upload')}
              />
              Upload a file
            </label>
          </fieldset>

          {mode === 'record' ? (
            <div className="rounded-xl border border-line bg-raised/60 p-6">
              <div className="mb-6 flex items-center justify-between border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    <MicIcon />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Audio capture</p>
                    <p className="font-mono text-xs text-faint">Real-time secure recording</p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border border-danger/20 bg-danger-soft px-2.5 py-1 text-xs font-bold tracking-wide text-danger ${
                    recorder.state === 'recording' ? '' : 'invisible'
                  }`}
                >
                  <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-danger" />
                  REC
                </span>
              </div>

              {!recorder.supported && (
                <ErrorNote>
                  This browser cannot record audio. Switch to &ldquo;Upload a
                  file&rdquo; above instead.
                </ErrorNote>
              )}
              {recorder.error !== null && <ErrorNote>{recorder.error}</ErrorNote>}

              <div className="flex flex-col items-center gap-5">
                {(recorder.state === 'idle' || recorder.state === 'requesting') && (
                  <button
                    type="button"
                    disabled={!armed || !recorder.supported || recorder.state === 'requesting'}
                    onClick={() => {
                      void recorder.start();
                    }}
                    aria-label={
                      recorder.state === 'requesting' ? 'Opening microphone' : 'Start recording'
                    }
                    className="grid size-[90px] place-items-center rounded-full border-4 border-danger/25 bg-danger/10 transition hover:scale-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="size-[22px] rounded-full bg-danger" />
                  </button>
                )}

                {(recorder.state === 'recording' || recorder.state === 'paused') && (
                  <button
                    type="button"
                    onClick={recorder.stop}
                    aria-label="Stop recording"
                    className="grid size-[90px] place-items-center rounded-full border-4 border-danger/25 bg-danger/10 transition hover:scale-[1.04] active:scale-[0.98]"
                  >
                    <span aria-hidden="true" className="size-5 rounded bg-danger" />
                  </button>
                )}

                <LevelMeter level={recorder.level} active={recorder.state === 'recording'} />

                <p
                  className="font-mono text-[2.2rem] font-bold tabular-nums tracking-tight"
                  aria-label={`Elapsed ${formatElapsed(recorder.elapsedMs)}`}
                >
                  {formatElapsed(recorder.elapsedMs)}
                </p>

                {recorder.state === 'recording' && (
                  <Button variant="secondary" onClick={recorder.pause}>
                    Pause
                  </Button>
                )}
                {recorder.state === 'paused' && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-warn">Paused</span>
                    <Button variant="secondary" onClick={recorder.resume}>
                      Resume
                    </Button>
                  </div>
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

              {(recorder.state === 'recording' || recorder.state === 'paused') && (
                <p className="mt-4 text-center text-xs text-faint">
                  Keep this tab open. The audio is only in this browser until you
                  upload it, so closing the tab loses the recording.
                </p>
              )}
            </div>
          ) : (
            audioFile === null && (
              <Field label="Audio file" htmlFor="audioFile">
                <Input
                  id="audioFile"
                  type="file"
                  accept="audio/*"
                  disabled={busy || !armed}
                  onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
                />
              </Field>
            )
          )}

          {boardFile === null ? (
            <Field
              label="Whiteboard photo"
              htmlFor="boardFile"
              hint="Optional. A photo of any whiteboard or flipchart used."
            >
              <Input
                id="boardFile"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(event) => setBoardFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-raised px-3 py-2">
              <p className="truncate text-sm">{boardFile.name}</p>
              <Button variant="secondary" disabled={busy} onClick={() => setBoardFile(null)}>
                Remove
              </Button>
            </div>
          )}

          {readyBlob !== null && previewUrl !== null && (
            <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
              <p className="text-sm font-medium">
                {mode === 'record' ? `${formatElapsed(recorder.elapsedMs)} recorded` : audioFile?.name}
                <span className="ml-2 font-normal text-faint">
                  {(readyBlob.size / 1_048_576).toFixed(1)} MB
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
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (mode === 'record') {
                      recorder.reset();
                    } else {
                      setAudioFile(null);
                    }
                  }}
                >
                  {mode === 'record' ? 'Discard and re-record' : 'Choose a different file'}
                </Button>
              </div>
              {progress !== null && <p className="text-sm text-muted">{progress}</p>}
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
