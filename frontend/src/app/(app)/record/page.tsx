'use client';

import { FileText, Image as ImageIcon, type LucideIcon, Presentation, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/badge';
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
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { useLiveCaptions } from '@/hooks/use-live-captions';
import { formatElapsed, recordingFilename, useRecorder } from '@/hooks/use-recorder';
import { guessAttachmentKind, isKindFixed } from '@/lib/attachment-kind';
import { api, can, type Session, type WhiteboardKind, WHITEBOARD_KIND_LABEL } from '@/lib/api';
import { measureDurationMs } from '@/lib/audio-duration';
import { formatTime } from '@/lib/format';

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
type CaptureMode = 'record' | 'upload' | 'meet';

/** A chosen attachment, tagged with the kind shown on its clickable badge. */
interface Attachment {
  readonly file: File;
  readonly kind: WhiteboardKind;
}

const KIND_ICON: Record<WhiteboardKind, LucideIcon> = {
  WHITEBOARD: ImageIcon,
  SLIDE: Presentation,
  DOCUMENT: FileText,
};

/** The order a click on a tag cycles through. */
const KIND_CYCLE: readonly WhiteboardKind[] = ['WHITEBOARD', 'SLIDE', 'DOCUMENT'];

/** BCP-47 tags for SpeechRecognition, matching the app's transcription languages. */
const CAPTION_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en-US', label: 'English' },
  { value: 'ms-MY', label: 'Malay' },
  { value: 'zh-CN', label: 'Chinese' },
];

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

/** Renders redaction placeholders as visible chips, matching the meeting detail page. */
function RedactedText({ text }: { text: string }) {
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
  const [meetLink, setMeetLink] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [boardFiles, setBoardFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [captionLanguage, setCaptionLanguage] = useState(CAPTION_LANGUAGES[0]!.value);

  const googleStatus = useAsync(() => api.googleAuthStatus(), 'googleStatus');

  /**
   * Live captions via the browser's own speech recognition — separate from,
   * and much faster than, the real transcript Vertex/Gemini still produces
   * after upload. Gated on the third, optional checkbox: declining it must
   * not block recording, so this simply never turns on rather than blocking
   * anything. Also gated on `recorder.state === 'recording'`, not just
   * `mode === 'record'`, so a paused recording does not keep listening while
   * the user believes nothing is happening.
   */
  const liveCaptions = useLiveCaptions({
    enabled: mode === 'record' && recorder.state === 'recording' && ack.liveCaptionsConsent,
    language: captionLanguage,
  });

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

  /** Tags each new file with a first guess, which the person can correct below. */
  function addFiles(chosen: readonly File[]): void {
    if (chosen.length === 0) return;
    setBoardFiles((prev) => [
      ...prev,
      ...chosen.map((file) => ({ file, kind: guessAttachmentKind(file) })),
    ]);
  }

  /** Steps one attachment's tag to the next kind. A .docx has nothing to cycle to. */
  function cycleKind(index: number): void {
    setBoardFiles((prev) =>
      prev.map((attachment, i) => {
        if (i !== index || isKindFixed(attachment.file)) return attachment;
        const next = KIND_CYCLE[(KIND_CYCLE.indexOf(attachment.kind) + 1) % KIND_CYCLE.length]!;
        return { ...attachment, kind: next };
      }),
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

    /**
     * Ground truth for the server's timestamp correction (see
     * backend/src/ai/timestamps.ts) — a MediaRecorder capture in particular
     * self-reports no duration in its container, so the transcription
     * provider has no real length to check its own segment timestamps
     * against without this. Best-effort: an unmeasurable blob just omits
     * the field rather than blocking the upload.
     */
    const durationMs = await measureDurationMs(readyBlob);
    if (durationMs !== undefined) form.set('durationMs', String(Math.round(durationMs)));

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
      if (boardFiles.length > 0) {
        setProgress(
          boardFiles.length === 1
            ? 'Recording accepted. Extracting the attachment…'
            : `Recording accepted. Extracting ${String(boardFiles.length)} attachments…`,
        );
        let extractedCount = 0;
        let maskedCount = 0;
        const failures: string[] = [];
        for (const attachment of boardFiles) {
          const boardForm = new FormData();
          boardForm.set('file', attachment.file);
          boardForm.set('kind', attachment.kind);
          try {
            const extracted = await api.uploadWhiteboard(meetingId, boardForm);
            extractedCount += 1;
            maskedCount += extracted.redactionCount;
          } catch (cause) {
            failures.push(`${attachment.file.name} (${describeError(cause)})`);
          }
        }
        if (extractedCount > 0) {
          boardNote = ` ${String(extractedCount)} attachment${extractedCount === 1 ? '' : 's'}`
            + ` extracted, ${String(maskedCount)} identifier(s) masked.`;
        }
        if (failures.length > 0) {
          boardNote += ` ${String(failures.length)} failed: ${failures.join('; ')}.`;
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

  async function submitMeet(): Promise<void> {
    if (!armed || !meetLink.trim()) return;

    setBusy(true);
    setError(null);
    setProgress('Connecting Google Meet session…');

    const named = participants
      .map((p) => ({ name: p.name.trim(), role: p.role.trim() }))
      .filter((p) => p.name !== '');

    try {
      const { meetingId } = await api.connectMeet({
        meetLink: meetLink.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        occurredAt: new Date(occurredAt).toISOString(),
        consentConfirmed: ack.consentConfirmed,
        transferAcknowledged: ack.transferAcknowledged,
        participants: named.length > 0 ? named : undefined,
      });

      if (boardFiles.length > 0) {
        for (const attachment of boardFiles) {
          const boardForm = new FormData();
          boardForm.set('file', attachment.file);
          boardForm.set('kind', attachment.kind);
          try {
            await api.uploadWhiteboard(meetingId, boardForm);
          } catch {
            // Best effort
          }
        }
      }

      setSubmitted(true);
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="captureMode"
                className="accent-brand"
                checked={mode === 'meet'}
                onChange={() => setMode('meet')}
              />
              Google Meet (Auto-Import)
            </label>
          </fieldset>

          {mode === 'record' ? (
            <div className="rounded-lg border border-line bg-raised/60 p-6">
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
                  <span aria-hidden="true" className="size-1.5 animate-pulse-ring rounded-full bg-danger" />
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
                      liveCaptions.reset();
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

              {ack.liveCaptionsConsent && (
                <div className="mt-4 rounded-lg border border-line bg-raised/60 p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <p className="text-xs font-semibold text-muted">Live captions</p>
                    <Field label="Caption language" htmlFor="captionLanguage">
                      <Select
                        id="captionLanguage"
                        value={captionLanguage}
                        disabled={recorder.state === 'recording' || recorder.state === 'paused'}
                        onChange={(event) => setCaptionLanguage(event.target.value)}
                      >
                        {CAPTION_LANGUAGES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  {(recorder.state === 'recording' || recorder.state === 'paused') && (
                    <>
                      {!liveCaptions.supported ? (
                        <p className="mt-3 text-xs text-faint">
                          This browser has no built-in speech recognition, so live captions
                          are unavailable here. The full transcript is still generated after
                          you finish recording.
                        </p>
                      ) : (
                        <>
                          {/*
                            Two separate slots, not one shared list: the current
                            sentence rewrites several times a second until it is
                            final, so it needs a fixed place rather than jittering
                            a growing list. Finalized lines below never disappear —
                            recognition stopping and restarting under the hood
                            (see use-live-captions.ts) doesn't clear them, and
                            neither does pausing.
                          */}
                          <div className="mt-3 rounded-md border border-line-strong bg-base/60 px-3 py-2">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-faint">
                              Live preview
                            </p>
                            <p className="mt-1 min-h-[1.25rem] text-sm italic leading-relaxed text-muted">
                              {liveCaptions.interimText !== ''
                                ? liveCaptions.interimText
                                : recorder.state === 'recording'
                                  ? 'Listening…'
                                  : 'Paused'}
                            </p>
                          </div>

                          {liveCaptions.lines.length > 0 && (
                            <div className="mt-3 max-h-48 space-y-3 overflow-y-auto pr-1">
                              {[...liveCaptions.lines].reverse().map((line) => (
                                <div key={line.id} className="flex gap-2 text-sm leading-relaxed">
                                  <span className="mt-0.5 shrink-0 font-mono text-[0.65rem] tabular-nums text-faint">
                                    {formatTime(new Date(line.timestampMs))}
                                  </span>
                                  <p><RedactedText text={line.textRedacted} /></p>
                                </div>
                              ))}
                            </div>
                          )}

                          {liveCaptions.error !== null && (
                            <p className="mt-2 text-xs text-warn">{liveCaptions.error}</p>
                          )}
                        </>
                      )}
                      <p className="mt-3 text-xs text-faint">
                        A rough guide only — no speaker labels, one language at a time, and
                        not the final transcript. The full transcript, with speakers and all
                        three languages, is generated after you finish recording.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : mode === 'meet' ? (
            <div className="rounded-lg border border-line bg-raised/60 p-6 space-y-4">
              <div className="flex items-center gap-3 border-b border-line pb-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand font-bold text-sm">
                  GM
                </span>
                <div>
                  <p className="text-sm font-semibold">Google Meet Integration</p>
                  <p className="font-mono text-xs text-faint">Automatic post-meeting transcript ingestion</p>
                </div>
              </div>

              {googleStatus.loading && <Spinner label="Checking Google account status..." />}

              {googleStatus.data && !googleStatus.data.linked && (
                <div className="rounded-md border border-warn/30 bg-warn-soft p-4 space-y-2">
                  <p className="text-sm font-medium text-warn">Google Account Not Connected</p>
                  <p className="text-xs text-muted">
                    To automatically import transcripts from Google Meet, you need to connect your Google Workspace account first.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => router.push('/settings')}
                  >
                    Go to Settings to Connect
                  </Button>
                </div>
              )}

              {googleStatus.data?.linked && (
                <div className="space-y-3">
                  <Field
                    label="Google Meet Link or Code"
                    htmlFor="meetLink"
                    hint="Paste your meet.google.com link (e.g. https://meet.google.com/abc-defg-hij)"
                  >
                    <Input
                      id="meetLink"
                      type="text"
                      placeholder="https://meet.google.com/abc-defg-hij"
                      value={meetLink}
                      disabled={busy || !armed}
                      onChange={(event) => setMeetLink(event.target.value)}
                    />
                  </Field>
                  <p className="text-xs text-faint">
                    Ensure &ldquo;Transcripts&rdquo; or &ldquo;Recording&rdquo; is enabled in your Google Meet call. Once the meeting finishes, FinTalk AI will process the transcript and apply PDPA masking and Shariah screening.
                  </p>
                </div>
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

          <div>
            <label
              htmlFor="boardFile"
              className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
                dragging
                  ? 'border-brand bg-brand-soft/40'
                  : 'border-line-strong bg-raised/40 hover:bg-raised/60'
              } ${busy ? 'pointer-events-none opacity-60' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <Upload aria-hidden="true" className="size-6 text-faint" />
              <span className="text-sm font-medium">
                Drop whiteboards, slides, PDFs or documents
              </span>
              <span className="text-xs text-faint">Or click to browse. Optional, any number.</span>
              <input
                id="boardFile"
                type="file"
                className="sr-only"
                accept="image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                disabled={busy}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  // Cleared so picking the same file again (after removing it
                  // below) still fires onChange — a file input does not fire
                  // on a value it already holds.
                  event.target.value = '';
                }}
              />
            </label>

            {boardFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                <ul className="space-y-2">
                  {boardFiles.map((attachment, index) => {
                    const Icon = KIND_ICON[attachment.kind];
                    const fixed = isKindFixed(attachment.file);
                    return (
                      <li
                        key={`${attachment.file.name}-${String(index)}`}
                        className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2"
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-faint" />
                        <p className="min-w-0 flex-1 truncate text-sm">{attachment.file.name}</p>
                        <button
                          type="button"
                          disabled={busy || fixed}
                          onClick={() => cycleKind(index)}
                          title={fixed ? 'Always a document' : 'Click to change'}
                          className="disabled:cursor-default"
                        >
                          <Badge tone="brand">{WHITEBOARD_KIND_LABEL[attachment.kind]}</Badge>
                        </button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setBoardFiles((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-faint">
                  Type auto-detected — click a tag to change it. Images, PDFs and .docx
                  documents are all read and redacted the same way.
                </p>
              </div>
            )}
          </div>

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
                      liveCaptions.reset();
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

          {mode === 'meet' && googleStatus.data?.linked && meetLink.trim() !== '' && (
            <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
              <p className="text-sm font-medium">Ready to Connect Meet</p>
              <p className="text-xs text-muted">
                FinTalk AI will register this Google Meet session and monitor for completed transcripts.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !armed}
                  onClick={() => {
                    void submitMeet();
                  }}
                >
                  {busy ? 'Connecting…' : 'Connect Google Meet'}
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
