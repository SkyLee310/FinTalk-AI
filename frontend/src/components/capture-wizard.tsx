'use client';

import { useRef } from 'react';
import type { CaptureWizardState } from '@/lib/capture-wizard-state';
import { isFullyAcknowledged, TransferNotice, type TransferAcknowledgement } from './transfer-notice';
import { Button } from './ui';

const AUDIO_ACCEPT = 'audio/*';
const BOARD_ACCEPT = 'image/*,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function CancelLink({ onCancel }: { onCancel: () => void }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      className="text-caption text-faint underline underline-offset-2 hover:text-muted"
    >
      Cancel setup
    </button>
  );
}

/**
 * Renders the capture wizard's active step, given its state from
 * capture-wizard-state.ts. Rendered by ask-fintalk-ai.tsx as the last item
 * in the message list, in place of (steps 2-6) or alongside (step 1) the
 * panel's ordinary Textarea + Send row — see that file for which.
 *
 * Every control here is real: the same TransferNotice checkboxes Record's
 * page renders, real file inputs. Nothing here interprets free text.
 * `guessAttachmentKind` tagging of a chosen whiteboard file happens in the
 * caller's `onAddBoardFile`, not here — this component only ever hands back
 * the raw `File` it was given.
 */
export function CaptureWizardStep({
  state,
  onCancel,
  onConsentChange,
  onConsentContinue,
  onChooseImport,
  onChooseRealTime,
  onChooseAudioFile,
  onAddBoardFile,
  onWhiteboardDone,
  onConfirm,
}: {
  state: CaptureWizardState;
  onCancel: () => void;
  onConsentChange: (ack: TransferAcknowledgement) => void;
  onConsentContinue: () => void;
  onChooseImport: () => void;
  onChooseRealTime: () => void;
  onChooseAudioFile: (file: File) => void;
  onAddBoardFile: (file: File) => void;
  onWhiteboardDone: () => void;
  onConfirm: () => void;
}) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const boardInputRef = useRef<HTMLInputElement>(null);

  if (state.step === 'title') {
    return (
      <div className="flex justify-start">
        <CancelLink onCancel={onCancel} />
      </div>
    );
  }

  if (state.step === 'consent') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <TransferNotice value={state.ack} onChange={onConsentChange} idPrefix="chat-capture" />
        <div className="flex items-center gap-3">
          <Button disabled={!isFullyAcknowledged(state.ack)} onClick={onConsentContinue}>
            Continue
          </Button>
          <CancelLink onCancel={onCancel} />
        </div>
      </div>
    );
  }

  if (state.step === 'mode') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={onChooseImport}>Import audio</Button>
          <Button variant="secondary" onClick={onChooseRealTime}>
            Record in real time
          </Button>
        </div>
        <CancelLink onCancel={onCancel} />
      </div>
    );
  }

  if (state.step === 'audio') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <input
          ref={audioInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) onChooseAudioFile(file);
          }}
        />
        <Button onClick={() => audioInputRef.current?.click()}>Choose audio file</Button>
        <CancelLink onCancel={onCancel} />
      </div>
    );
  }

  if (state.step === 'whiteboard') {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-raised p-4">
        <p className="text-caption text-muted">Audio: {state.audio.name}</p>
        <input
          ref={boardInputRef}
          type="file"
          accept={BOARD_ACCEPT}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) onAddBoardFile(file);
          }}
        />
        {state.boardFiles.length > 0 && (
          <ul className="space-y-1 text-caption text-muted">
            {state.boardFiles.map((attachment, index) => (
              <li key={`${attachment.file.name}-${String(index)}`}>{attachment.file.name}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => boardInputRef.current?.click()}>
            Add a photo
          </Button>
          <Button onClick={onWhiteboardDone}>
            {state.boardFiles.length > 0 ? 'Done' : 'Skip'}
          </Button>
          <CancelLink onCancel={onCancel} />
        </div>
      </div>
    );
  }

  if (state.step === 'confirm') {
    return (
      <div className="space-y-2 rounded-lg border border-line bg-raised p-4">
        <dl className="space-y-1 text-body">
          <div className="flex gap-2">
            <dt className="font-medium">Title</dt>
            <dd className="text-muted">{state.title}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Consent</dt>
            <dd className="text-muted">Both confirmed</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Audio</dt>
            <dd className="text-muted">{state.audio.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Whiteboard</dt>
            <dd className="text-muted">
              {state.boardFiles.length === 0 ? 'None' : `${String(state.boardFiles.length)} file(s)`}
            </dd>
          </div>
        </dl>
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={onConfirm}>Create meeting</Button>
          <CancelLink onCancel={onCancel} />
        </div>
      </div>
    );
  }

  return <p className="text-caption text-muted">Creating the meeting…</p>;
}
