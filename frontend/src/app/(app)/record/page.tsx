'use client';

import { FileText, Image as ImageIcon, type LucideIcon, Mic, Presentation, Upload, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/badge';
import { CAPTION_LANGUAGES, RecordSession } from '@/components/record-session';
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
import { useLiveCaptions } from '@/hooks/use-live-captions';
import { formatElapsed, recordingFilename, useRecorder } from '@/hooks/use-recorder';
import { guessAttachmentKind, isKindFixed } from '@/lib/attachment-kind';
import { api, can, type Session, type WhiteboardKind, WHITEBOARD_KIND_LABEL } from '@/lib/api';
import { measureDurationMs } from '@/lib/audio-duration';

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

const CAPTURE_MODES: readonly { value: CaptureMode; label: string; icon: LucideIcon }[] = [
  { value: 'record', label: 'Record here', icon: Mic },
  { value: 'upload', label: 'Upload a file', icon: Upload },
  { value: 'meet', label: 'Google Meet', icon: Video },
];

function SegmentedControl({
  value,
  onChange,
  disabled,
}: {
  value: CaptureMode;
  onChange: (mode: CaptureMode) => void;
  disabled?: boolean;
}) {
  const activeIndex = CAPTURE_MODES.findIndex((m) => m.value === value);

  return (
    <div
      className={`relative grid grid-cols-3 max-w-lg rounded-xl bg-raised/90 p-1 border border-line/80 shadow-inner backdrop-blur-sm ${
        disabled ? 'pointer-events-none opacity-60' : ''
      }`}
      role="radiogroup"
      aria-label="Capture mode"
    >
      {/* Apple-style sliding pill indicator */}
      <span
        className="absolute top-1 bottom-1 rounded-lg bg-surface shadow-[0_1px_4px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] border border-line-strong/60 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: 'calc(33.333% - 5.33px)',
          left: '4px',
          transform: `translateX(calc(${String(activeIndex * 100)}% + ${String(activeIndex * 4)}px))`,
        }}
        aria-hidden="true"
      />
      {CAPTURE_MODES.map((option) => {
        const Icon = option.icon;
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold tracking-tight transition-colors duration-200 ${
              isSelected
                ? 'text-foreground'
                : 'text-muted hover:text-foreground'
            }`}
          >
            <Icon
              className={`size-3.5 transition-colors duration-200 ${
                isSelected ? 'text-brand' : 'text-faint'
              }`}
              aria-hidden="true"
            />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

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

/** Local time in the format a datetime-local input expects. */
function localDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
   * Seeds the title from Ask FinTalk AI's "start a capture" action
   * (?title=…), once, on mount — not a live binding to the URL, the same
   * choice login/page.tsx makes for its own `?mode=` param, so typing in
   * the field afterward isn't fighting a query string that never changes
   * again. Read via window.location directly rather than useSearchParams()
   * to avoid that hook's Suspense-boundary requirement on a page this deep
   * in the authenticated app shell.
   */
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('title');
    if (fromQuery !== null && fromQuery.trim() !== '') setTitle(fromQuery);
  }, []);

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
            Record here, upload a file captured elsewhere, or import from Google Meet.
          </p>

          <SegmentedControl value={mode} onChange={setMode} disabled={busy} />

          {mode === 'record' ? (
            <RecordSession
              title={title}
              participants={participants}
              recorder={recorder}
              armed={armed}
              busy={busy}
              liveCaptionsConsent={ack.liveCaptionsConsent}
              liveCaptions={liveCaptions}
              captionLanguage={captionLanguage}
              onCaptionLanguageChange={setCaptionLanguage}
              onAddWhiteboard={(file) => addFiles([file])}
            />
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
            {mode === 'upload' && (
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
                <span className="text-xs text-faint">
                  Or click to browse. Optional, any number.
                </span>
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
            )}

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
