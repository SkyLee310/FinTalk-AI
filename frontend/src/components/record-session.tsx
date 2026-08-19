'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { formatElapsed, type Recorder } from '@/hooks/use-recorder';
import type { LiveCaptions } from '@/hooks/use-live-captions';
import { formatTime } from '@/lib/format';
import { Button, ErrorNote, Field, Select } from './ui';
import { WhiteboardCanvas } from './whiteboard-canvas';

/** BCP-47 tags for SpeechRecognition, matching the app's transcription languages. */
export const CAPTION_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en-US', label: 'English' },
  { value: 'ms-MY', label: 'Malay' },
  { value: 'zh-CN', label: 'Chinese' },
];

/** Exported for reuse as the icon on record/page.tsx's mode-selector card. */
export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
    </svg>
  );
}

function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 20;
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
          style={{ height: `${String(5 + (index / bars) * 18)}px` }}
        />
      ))}
    </div>
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

/**
 * The dedicated "Record here" view — a chat-like session, not a small card.
 *
 * Owns exactly the record→pause→stop flow (via the `recorder` prop from
 * use-recorder.ts, unchanged) and the live-caption conversation. It does
 * NOT own what happens after stopping: record/page.tsx's existing
 * preview-and-submit block (the audio player, "Upload and transcribe")
 * stays where it was, shared with upload mode, and simply appears below
 * this component once `recorder.blob` is set.
 */
export function RecordSession({
  title,
  participants,
  recorder,
  armed,
  busy,
  liveCaptionsConsent,
  liveCaptions,
  captionLanguage,
  onCaptionLanguageChange,
  onAddWhiteboard,
}: {
  title: string;
  participants: readonly { readonly name: string; readonly role: string }[];
  recorder: Recorder;
  armed: boolean;
  busy: boolean;
  liveCaptionsConsent: boolean;
  liveCaptions: LiveCaptions;
  captionLanguage: string;
  onCaptionLanguageChange: (value: string) => void;
  onAddWhiteboard: (file: File) => void;
}) {
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const canEditLanguage = recorder.state !== 'recording' && recorder.state !== 'paused';
  const hasConversation = liveCaptions.lines.length > 0 || liveCaptions.interimText !== '';
  // The step-1 form always keeps at least one blank participant row, so an
  // empty name must not count as "1 participant" in this header.
  const namedCount = participants.filter((participant) => participant.name.trim() !== '').length;

  return (
    <div className="flex h-[30rem] flex-col overflow-hidden rounded-lg border border-line bg-raised/60">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
            <MicIcon />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {title.trim() === '' ? 'Untitled meeting' : title}
            </p>
            <p className="font-mono text-xs text-faint">
              {namedCount > 0
                ? `${String(namedCount)} participant${namedCount === 1 ? '' : 's'}`
                : 'Real-time secure recording'}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-danger/20 bg-danger-soft px-2.5 py-1 text-xs font-bold tracking-wide text-danger ${
            recorder.state === 'recording' ? '' : 'invisible'
          }`}
        >
          <span aria-hidden="true" className="size-1.5 animate-pulse-ring rounded-full bg-danger" />
          REC
        </span>
      </div>

      {!recorder.supported && (
        <div className="shrink-0 px-5 pt-4">
          <ErrorNote>
            This browser cannot record audio. Switch to &ldquo;Upload a file&rdquo; above instead.
          </ErrorNote>
        </div>
      )}
      {recorder.error !== null && (
        <div className="shrink-0 px-5 pt-4">
          <ErrorNote>{recorder.error}</ErrorNote>
        </div>
      )}

      {/*
        The primary content of this view — relaid-out from a small nested
        box (the old inline card) into the main scrollable area, per the
        approved plan. Falls back to a calm status line when there is
        nothing to show yet, rather than an empty void.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!liveCaptionsConsent ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-sm font-medium text-muted">Live captions are off</p>
            <p className="max-w-xs text-xs text-faint">
              The full transcript, with speakers and all three languages, is generated after
              you finish recording.
            </p>
          </div>
        ) : !liveCaptions.supported ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-sm font-medium text-muted">No live preview in this browser</p>
            <p className="max-w-xs text-xs text-faint">
              This browser has no built-in speech recognition. The full transcript is still
              generated after you finish recording.
            </p>
          </div>
        ) : !hasConversation ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-sm font-medium text-muted">
              {recorder.state === 'recording'
                ? 'Listening…'
                : recorder.state === 'paused'
                  ? 'Paused'
                  : 'Ready to record'}
            </p>
            <p className="max-w-xs text-xs text-faint">
              A rough guide only — no speaker labels, one language at a time.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {liveCaptions.lines.map((line) => (
              <div key={line.id} className="flex gap-2 text-sm leading-relaxed">
                <span className="mt-0.5 shrink-0 font-mono text-[0.65rem] tabular-nums text-faint">
                  {formatTime(new Date(line.timestampMs))}
                </span>
                <p>
                  <RedactedText text={line.textRedacted} />
                </p>
              </div>
            ))}
            {liveCaptions.interimText !== '' && (
              <div className="flex gap-2 text-sm italic leading-relaxed text-muted">
                <span className="mt-0.5 shrink-0 font-mono text-[0.65rem] tabular-nums text-faint">
                  now
                </span>
                <p>{liveCaptions.interimText}</p>
              </div>
            )}
          </div>
        )}
        {liveCaptions.error !== null && (
          <p className="mt-3 text-xs text-warn">{liveCaptions.error}</p>
        )}
      </div>

      {/* Announces state changes only — not every tick, which would make a screen reader unusable. */}
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
        <p className="shrink-0 border-t border-line px-5 py-2 text-center text-xs text-faint">
          Keep this tab open. The audio is only in this browser until you upload it, so closing
          the tab loses the recording.
        </p>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-line bg-raised px-5 py-3">
        <div className="flex items-center gap-4">
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
              className="grid size-14 shrink-0 place-items-center rounded-full border-4 border-danger/25 bg-danger/10 transition hover:scale-[1.04] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true" className="size-3.5 rounded-full bg-danger" />
            </button>
          )}

          {(recorder.state === 'recording' || recorder.state === 'paused') && (
            <button
              type="button"
              onClick={recorder.stop}
              aria-label="Stop recording"
              className="grid size-14 shrink-0 place-items-center rounded-full border-4 border-danger/25 bg-danger/10 transition hover:scale-[1.04] active:scale-[0.98]"
            >
              <span aria-hidden="true" className="size-4 rounded bg-danger" />
            </button>
          )}

          <div className="flex flex-col gap-1.5">
            <p
              className="font-mono text-lg font-bold tabular-nums leading-none tracking-tight"
              aria-label={`Elapsed ${formatElapsed(recorder.elapsedMs)}`}
            >
              {formatElapsed(recorder.elapsedMs)}
            </p>
            <LevelMeter level={recorder.level} active={recorder.state === 'recording'} />
          </div>

          {recorder.state === 'recording' && (
            <Button variant="secondary" onClick={recorder.pause}>
              Pause
            </Button>
          )}
          {recorder.state === 'paused' && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-warn">Paused</span>
              <Button variant="secondary" onClick={recorder.resume}>
                Resume
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {liveCaptionsConsent && (
            <Field label="Captions" htmlFor="captionLanguage">
              <Select
                id="captionLanguage"
                value={captionLanguage}
                disabled={!canEditLanguage}
                onChange={(event) => onCaptionLanguageChange(event.target.value)}
              >
                {CAPTION_LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button variant="secondary" disabled={busy} onClick={() => setWhiteboardOpen(true)}>
            <Pencil aria-hidden="true" className="size-4" />
            Draw whiteboard
          </Button>
        </div>
      </div>

      {whiteboardOpen && (
        <WhiteboardCanvas
          onSave={(file) => {
            onAddWhiteboard(file);
            setWhiteboardOpen(false);
          }}
          onClose={() => setWhiteboardOpen(false)}
        />
      )}
    </div>
  );
}
