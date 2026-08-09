import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
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
 * Whiteboard capture.
 *
 * The image is held in memory for the request and never written to disk, for the
 * same reason audio is not: spec §2, and a temp file is storage — one that
 * survives a crash and lands in a backup.
 *
 * Unlike audio this runs inside the request. Vision extraction on one still
 * image takes seconds, not the minutes transcription takes, so it stays well
 * inside the platform's 300-second ceiling and the caller gets the result
 * directly instead of an id to poll.
 */

export interface WhiteboardRouteDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
  readonly vaultKey: Buffer;
}

const SEPARATOR = '\n';

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

      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }

      let image: ImageInput | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'image') {
              // Drain unexpected files rather than leaving the stream stalled.
              part.file.resume();
              continue;
            }
            image = { bytes: await part.toBuffer(), mimeType: part.mimetype };
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

      if (image === undefined || image.bytes.byteLength === 0) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'An image file is required in the "image" field.',
        );
      }

      const extraction = await extract(image);

      /**
       * One context across both fields, so an identifier written once on the
       * board gets one placeholder whether it surfaces in the diagram, the
       * structured fields, or both.
       */
      const context = createRedactionContext();
      const mermaid = redact(extraction.mermaid, vaultKey, context);
      const structured = redact(JSON.stringify(extraction.structured), vaultKey, context);

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
        rawRedacted: joinRedacted([mermaid.text, structured.text], SEPARATOR),
        mermaid: mermaid.text,
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
