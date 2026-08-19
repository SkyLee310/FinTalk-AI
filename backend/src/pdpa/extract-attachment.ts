import * as mammoth from 'mammoth';
import type { ImageInput, TranscriptionProvider } from '../ai/provider.js';
import { quotePrimitives } from '../routes/whiteboards.routes.js';
import { createRedactionContext, joinRedacted, redact } from './redactor.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LEGACY_DOC_MIME = 'application/msword';
const SEPARATOR = '\n';

/**
 * Reported to the caller as a problem response, never a raw parser/model error —
 * the same reasoning knowledge.routes.ts already applies to a provider failure.
 */
export class AttachmentExtractionError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentExtractionError';
  }
}

/**
 * Extracts redacted text from one Ask FinTalk AI attachment — an image, PDF,
 * or .docx — for a single question's grounding context.
 *
 * A read-only sibling of whiteboards.routes.ts's persisting upload handler,
 * not a refactor of it: this extraction is never stored (no Whiteboard row,
 * no redaction-log rows) and is discarded once the answer is generated, per
 * the Ask FinTalk AI attachment design. It shares that handler's mammoth/
 * vision extraction and its redact-before-anything-else discipline via the
 * same createRedactionContext/redact/joinRedacted and quotePrimitives calls,
 * without pulling in storeWhiteboard.
 */
export async function extractAttachmentText(
  file: ImageInput,
  provider: TranscriptionProvider,
  vaultKey: Buffer,
): Promise<string> {
  if (file.bytes.byteLength === 0) {
    throw new AttachmentExtractionError(400, 'Invalid request', 'The attached file is empty.');
  }

  if (file.mimeType === LEGACY_DOC_MIME) {
    throw new AttachmentExtractionError(
      415,
      'Unsupported file type',
      'Legacy .doc files are not supported — save as .docx, or as PDF, and attach that instead.',
    );
  }

  const isVisual = file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf';
  if (!isVisual && file.mimeType !== DOCX_MIME) {
    throw new AttachmentExtractionError(
      415,
      'Unsupported file type',
      'Attach an image, a PDF, or a .docx document.',
    );
  }

  const context = createRedactionContext();

  if (!isVisual) {
    let extractedText: string;
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) });
      extractedText = result.value.trim();
    } catch {
      throw new AttachmentExtractionError(
        400,
        'Invalid request',
        'The .docx file could not be read — it may be corrupted or password-protected.',
      );
    }

    if (extractedText === '') {
      throw new AttachmentExtractionError(
        400,
        'Invalid request',
        'The document contained no text.',
      );
    }

    return redact(extractedText, vaultKey, context).text;
  }

  const extract = provider.extractWhiteboard?.bind(provider);
  if (extract === undefined) {
    throw new AttachmentExtractionError(
      501,
      'Not supported',
      'The configured transcription provider has no vision model.',
    );
  }

  const extraction = await extract(file);
  const mermaid = redact(extraction.mermaid, vaultKey, context);
  const structured = redact(
    JSON.stringify(quotePrimitives(extraction.structured)),
    vaultKey,
    context,
  );
  return joinRedacted([mermaid.text, structured.text], SEPARATOR);
}
