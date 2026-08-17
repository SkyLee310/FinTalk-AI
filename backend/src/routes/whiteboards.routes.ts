import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import * as mammoth from 'mammoth';
import type { ImageInput, TranscriptionProvider } from '../ai/provider.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';
import {
  createRedactionContext,
  joinRedacted,
  redact,
  type RedactionRecord,
} from '../pdpa/redactor.js';
import { storeWhiteboard } from '../pdpa/whiteboard-store.js';

/**
 * Visual/document capture: a meeting can carry any number of these, each one
 * a whiteboard photo, a slide, a PDF, or a Word document.
 *
 * The file is held in memory for the request and never written to disk, for the
 * same reason audio is not: spec §2, and a temp file is storage — one that
 * survives a crash and lands in a backup.
 *
 * Extraction runs inside the request rather than a background job. Vision
 * extraction on one file, or text extraction from one document, takes seconds,
 * not the minutes transcription takes, so it stays well inside the platform's
 * 300-second ceiling and the caller gets the result directly instead of an id
 * to poll. A meeting with several attachments means several requests — one per
 * file — not one request carrying many; that keeps this endpoint's contract
 * identical to before, and keeps one slow or oversized file from failing every
 * other file alongside it.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LEGACY_DOC_MIME = 'application/msword';

const WHITEBOARD_KINDS = ['WHITEBOARD', 'SLIDE', 'DOCUMENT'] as const;
type WhiteboardKindValue = (typeof WHITEBOARD_KINDS)[number];
function isWhiteboardKind(value: string): value is WhiteboardKindValue {
  return (WHITEBOARD_KINDS as readonly string[]).includes(value);
}

export interface WhiteboardRouteDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
  readonly vaultKey: Buffer;
}

const SEPARATOR = '\n';

/**
 * Recursively quotes primitive numbers/booleans in structured payloads before redaction.
 *
 * Keeps numeric identifiers (like account 1234567890) inside string literals so that
 * redaction replaces "1234567890" with "[ACCOUNT_1]" rather than producing invalid
 * JSON like {"account":[ACCOUNT_1]}. Preserves full nested object/array structure.
 */
function quotePrimitives(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(quotePrimitives);
  if (typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, quotePrimitives(v)]),
    );
  }
  return String(val);
}

export function registerWhiteboardRoutes(
  app: FastifyInstance,
  deps: WhiteboardRouteDeps,
): void {
  const { prisma, provider, vaultKey } = deps;

  app.post<{ Params: { id: string } }>(
    '/meetings/:id/whiteboards',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }

      let file: ImageInput | undefined;
      /**
       * A human's own classification, from the capture UI's editable tag.
       * Only meaningful for the vision path below — a .docx is always a
       * DOCUMENT, and nothing the caller sends can make it otherwise.
       */
      let kindOverride: WhiteboardKindValue | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'file') {
              // Drain unexpected files rather than leaving the stream stalled.
              part.file.resume();
              continue;
            }
            file = { bytes: await part.toBuffer(), mimeType: part.mimetype };
          } else if (part.type === 'field' && part.fieldname === 'kind') {
            const value = String(part.value);
            if (isWhiteboardKind(value)) kindOverride = value;
          }
        }
      } catch {
        return sendProblem(
          reply,
          413,
          'Upload rejected',
          'The upload was malformed or exceeded the size limit.',
        );
      }

      if (file === undefined || file.bytes.byteLength === 0) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'A file is required in the "file" field.',
        );
      }

      if (file.mimeType === LEGACY_DOC_MIME) {
        return sendProblem(
          reply,
          415,
          'Unsupported file type',
          'Legacy .doc files are not supported — save as .docx, or as PDF, and upload that instead.',
        );
      }

      const isVisual = file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf';
      if (!isVisual && file.mimeType !== DOCX_MIME) {
        return sendProblem(
          reply,
          415,
          'Unsupported file type',
          'Upload an image, a PDF, or a .docx document.',
        );
      }

      /**
       * One context per request either way, so an identifier written once in
       * the file gets one placeholder wherever it recurs.
       */
      const context = createRedactionContext();

      if (!isVisual) {
        // .docx: no vision model involved. mammoth reads the document's own
        // paragraph text directly — the same kind of raw, unredacted content
        // a photographed whiteboard's transcription would be, so it goes
        // through the same redact() call before anything is stored.
        let extractedText: string;
        try {
          const result = await mammoth.extractRawText({ buffer: Buffer.from(file.bytes) });
          extractedText = result.value.trim();
        } catch {
          return sendProblem(
            reply,
            400,
            'Invalid request',
            'The .docx file could not be read — it may be corrupted or password-protected.',
          );
        }

        if (extractedText === '') {
          return sendProblem(reply, 400, 'Invalid request', 'The document contained no text.');
        }

        const redacted = redact(extractedText, vaultKey, context);
        const whiteboardId = await storeWhiteboard(prisma, {
          meetingId: meeting.id,
          kind: 'DOCUMENT',
          rawRedacted: redacted.text,
          mermaid: null,
          structuredJson: {},
          modelId: 'local-docx-extract',
          promptVersion: 'docx-extract-v1',
          redactions: redacted.records,
          actor,
        });

        return reply.code(201).send({ whiteboardId, redactionCount: redacted.records.length });
      }

      /**
       * Captured once and bound. A separate `undefined` check on the optional
       * method does not narrow it at the call site, and an unbound reference
       * would lose `this` when invoked.
       */
      const extract = provider.extractWhiteboard?.bind(provider);
      if (extract === undefined) {
        return sendProblem(
          reply,
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

      /**
       * The JSON half's offsets are rebased onto the joined document, because
       * that is what rawRedacted holds and what an auditor resolves against —
       * the same rebasing redactTranscript does across segments.
       */
      const base = mermaid.text.length + SEPARATOR.length;
      const records: RedactionRecord[] = [
        ...mermaid.records,
        ...structured.records.map((record) => ({
          ...record,
          startOffset: record.startOffset + base,
          endOffset: record.endOffset + base,
        })),
      ];

      const whiteboardId = await storeWhiteboard(prisma, {
        meetingId: meeting.id,
        // A human's own tag, chosen before upload, is trusted over the
        // model's guess — the same "AI proposes, a person confirms"
        // pattern as everywhere else a model's read of a capture is used.
        kind: kindOverride ?? extraction.kind,
        rawRedacted: joinRedacted([mermaid.text, structured.text], SEPARATOR),
        // Empty string means the model found no diagram — store that as
        // absent rather than an empty-but-present RedactedText, so the
        // frontend can tell "no diagram" from "diagram not yet loaded".
        mermaid: mermaid.text === '' ? null : mermaid.text,
        // Reparsing the redacted JSON is what guarantees structuredJson holds
        // only redacted values. Placeholders replace digits inside string
        // values, so the document is still valid JSON.
        structuredJson: JSON.parse(structured.text),
        modelId: extraction.modelId,
        promptVersion: extraction.promptVersion,
        redactions: records,
        actor,
      });

      return reply.code(201).send({ whiteboardId, redactionCount: records.length });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/meetings/:id/whiteboards',
    { preHandler: [requireAuth, requireCapability('transcript:read')] },
    async (request, reply) => {
      const boards = await prisma.whiteboard.findMany({
        where: { meetingId: request.params.id },
        orderBy: { createdAt: 'asc' },
        include: {
          // The vault relation is deliberately not included. Recovering a stored
          // identifier is a separate, separately-audited action.
          redactions: {
            select: {
              id: true,
              piiType: true,
              placeholder: true,
              startOffset: true,
              endOffset: true,
              detectedBy: true,
              confidence: true,
            },
          },
        },
      });

      return reply.send({
        whiteboards: boards.map((board) => ({
          id: board.id,
          kind: board.kind,
          rawRedacted: board.rawRedacted,
          mermaid: board.mermaid,
          structuredJson: board.structuredJson,
          modelId: board.modelId,
          promptVersion: board.promptVersion,
          createdAt: board.createdAt.toISOString(),
          redactions: board.redactions,
        })),
      });
    },
  );
}
