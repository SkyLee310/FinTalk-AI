import type { WhiteboardKind } from './api';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * True for a .docx, and only a .docx — mammoth extracts its text server-side
 * regardless of any tag, so there is nothing for a person to override.
 */
export function isKindFixed(file: { name: string; type: string }): boolean {
  return file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx');
}

/**
 * A first guess at what an attachment is, from its filename and type alone —
 * before anything has looked at its contents. The capture screen shows this
 * as an editable tag rather than a final answer: a wrong guess costs one
 * click to correct, not a wrong label carried silently into the record.
 */
export function guessAttachmentKind(file: { name: string; type: string }): WhiteboardKind {
  if (isKindFixed(file)) return 'DOCUMENT';
  if (file.type === 'application/pdf') return 'DOCUMENT';
  if (/slide|deck|presentation/i.test(file.name)) return 'SLIDE';
  return 'WHITEBOARD';
}
