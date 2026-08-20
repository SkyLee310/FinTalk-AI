import { NO_ACKNOWLEDGEMENT, type TransferAcknowledgement } from '@/components/transfer-notice';
import type { CaptureBoardFile } from './submit-capture';

/**
 * The capture wizard's own state, entirely separate from Ask FinTalk AI's
 * `messages` transcript. Every transition below is a pure function — no
 * network call, no interpretation of free text — so a checkbox tick, a file
 * pick, or a button click always maps to exactly one new state. The caller
 * (ask-fintalk-ai.tsx) owns *when* this exists: `null` means no wizard is
 * active, matching the panel's normal question-answering behaviour.
 */
export type CaptureWizardState =
  | { readonly step: 'title' }
  | { readonly step: 'consent'; readonly title: string; readonly ack: TransferAcknowledgement }
  | { readonly step: 'mode'; readonly title: string; readonly ack: TransferAcknowledgement }
  | { readonly step: 'audio'; readonly title: string; readonly ack: TransferAcknowledgement }
  | {
      readonly step: 'whiteboard';
      readonly title: string;
      readonly ack: TransferAcknowledgement;
      readonly audio: File;
      readonly boardFiles: readonly CaptureBoardFile[];
    }
  | {
      readonly step: 'confirm';
      readonly title: string;
      readonly ack: TransferAcknowledgement;
      readonly audio: File;
      readonly boardFiles: readonly CaptureBoardFile[];
    }
  | {
      readonly step: 'submitting';
      readonly title: string;
      readonly ack: TransferAcknowledgement;
      readonly audio: File;
      readonly boardFiles: readonly CaptureBoardFile[];
    };

/** Starts the wizard from intent.ts's extracted title, which may be empty. */
export function startWizard(title: string): CaptureWizardState {
  const trimmed = title.trim();
  return trimmed === ''
    ? { step: 'title' }
    : { step: 'consent', title: trimmed, ack: NO_ACKNOWLEDGEMENT };
}

/** The chat's next message, when the wizard asked for a title in step 1. */
export function submitTitle(rawTitle: string): CaptureWizardState {
  return { step: 'consent', title: rawTitle.trim(), ack: NO_ACKNOWLEDGEMENT };
}

export function advanceFromConsent(
  state: Extract<CaptureWizardState, { step: 'consent' }>,
): CaptureWizardState {
  return { step: 'mode', title: state.title, ack: state.ack };
}

export function chooseImportAudio(
  state: Extract<CaptureWizardState, { step: 'mode' }>,
): CaptureWizardState {
  return { step: 'audio', title: state.title, ack: state.ack };
}

export function chooseAudioFile(
  state: Extract<CaptureWizardState, { step: 'audio' }>,
  audio: File,
): CaptureWizardState {
  return { step: 'whiteboard', title: state.title, ack: state.ack, audio, boardFiles: [] };
}

export function addBoardFile(
  state: Extract<CaptureWizardState, { step: 'whiteboard' }>,
  boardFile: CaptureBoardFile,
): CaptureWizardState {
  return { ...state, boardFiles: [...state.boardFiles, boardFile] };
}

export function finishWhiteboard(
  state: Extract<CaptureWizardState, { step: 'whiteboard' }>,
): CaptureWizardState {
  return { ...state, step: 'confirm' };
}

export function startSubmitting(
  state: Extract<CaptureWizardState, { step: 'confirm' }>,
): CaptureWizardState {
  return { ...state, step: 'submitting' };
}

/** A failed submit returns to `confirm` with everything already collected intact. */
export function backToConfirm(
  state: Extract<CaptureWizardState, { step: 'submitting' }>,
): CaptureWizardState {
  return { ...state, step: 'confirm' };
}
