import { describeError } from '@/hooks/use-async';
import { api, type WhiteboardKind } from './api';

export interface CaptureBoardFile {
  readonly file: File;
  readonly kind: WhiteboardKind;
}

export interface CaptureUpload {
  readonly title: string;
  readonly description?: string;
  readonly occurredAt: string;
  readonly consentConfirmed: boolean;
  readonly transferAcknowledged: boolean;
  readonly participants?: readonly { readonly name: string; readonly role: string }[];
  readonly audio: Blob;
  readonly audioFilename?: string;
  readonly durationMs?: number;
  readonly boardFiles?: readonly CaptureBoardFile[];
  /**
   * Fired once, right after the meeting is accepted and before the
   * whiteboard-extraction loop (if any) begins — the seam a caller may want
   * to show as a distinct progress step, since extraction is a second,
   * synchronous request after the (already-accepted) upload.
   */
  readonly onAccepted?: () => void;
}

export interface CaptureUploadResult {
  readonly meetingId: string;
  readonly boardExtractedCount: number;
  readonly boardMaskedCount: number;
  readonly boardFailures: readonly string[];
}

/**
 * Creates a meeting from an already-obtained audio take — a live recording's
 * blob or a picked file, this does not need to know which — then
 * best-effort-extracts any whiteboard attachments. Record's page and the Ask
 * FinTalk AI capture wizard both call this so the two never drift apart on
 * field names or on whiteboard-failure handling.
 */
export async function submitCapture(upload: CaptureUpload): Promise<CaptureUploadResult> {
  const form = new FormData();
  form.set('title', upload.title);
  if (upload.description !== undefined && upload.description !== '') {
    form.set('description', upload.description);
  }
  form.set('occurredAt', upload.occurredAt);
  form.set('consentConfirmed', String(upload.consentConfirmed));
  form.set('transferAcknowledged', String(upload.transferAcknowledged));
  if (upload.participants !== undefined && upload.participants.length > 0) {
    form.set('participants', JSON.stringify(upload.participants));
  }
  form.set('audio', upload.audio, upload.audioFilename);
  if (upload.durationMs !== undefined) {
    form.set('durationMs', String(Math.round(upload.durationMs)));
  }

  const { meetingId } = await api.uploadMeeting(form);
  upload.onAccepted?.();

  let boardExtractedCount = 0;
  let boardMaskedCount = 0;
  const boardFailures: string[] = [];
  for (const attachment of upload.boardFiles ?? []) {
    const boardForm = new FormData();
    boardForm.set('file', attachment.file);
    boardForm.set('kind', attachment.kind);
    try {
      const extracted = await api.uploadWhiteboard(meetingId, boardForm);
      boardExtractedCount += 1;
      boardMaskedCount += extracted.redactionCount;
    } catch (cause) {
      boardFailures.push(`${attachment.file.name} (${describeError(cause)})`);
    }
  }

  return { meetingId, boardExtractedCount, boardMaskedCount, boardFailures };
}
