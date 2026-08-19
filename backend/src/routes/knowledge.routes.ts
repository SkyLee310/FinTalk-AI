import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ImageInput, TranscriptionProvider } from '../ai/provider.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { ComplianceError } from '../compliance/errors.js';
import { sendProblem } from '../http/problem.js';
import { ask } from '../knowledge/assistant.js';
import { buildGraph } from '../knowledge/graph.js';
import { detectStartCaptureIntent } from '../knowledge/intent.js';
import { AttachmentExtractionError, extractAttachmentText } from '../pdpa/extract-attachment.js';

/**
 * The knowledge surface: the graph, and the assistant.
 *
 * Both are gated on `transcript:read`, because both expose only already-redacted
 * transcript content — the same material the meeting detail page shows. Neither
 * touches the vault, and no new capability is invented for reading a different view
 * of data the caller could already read.
 */

const AskBody = z.object({
  question: z.string().min(3).max(500),
  /**
   * Prior turns, oldest first. Capped at 10 so the composite `withHistory`
   * builds stays within the provider's context bound. Rejecting an
   * over-cap request (zod's default) rather than truncating it is
   * deliberate: a silent truncation would drop the newest turn — the one
   * the user just typed — without telling them.
   */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(10)
    .optional(),
});

export interface KnowledgeRouteDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
  readonly vaultKey: Buffer;
}

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  deps: KnowledgeRouteDeps,
): void {
  const gate = { preHandler: [requireAuth, requireCapability('transcript:read')] };

  app.get('/knowledge/graph', gate, async (_request, reply) => {
    const graph = await buildGraph(deps.prisma);
    return reply.send(graph);
  });

  /**
   * Answers a question from the corpus, optionally grounded by one attached
   * file — or, for exactly one recognized phrase, returns a navigation
   * action instead of answering at all (see intent.ts).
   *
   * Accepts either a plain JSON body (the common case, unchanged from
   * before) or multipart/form-data (only when an attachment is present).
   * `@fastify/multipart` is registered globally in server.ts, so branching
   * on `request.isMultipart()` — which reads the request's own content-type
   * — lets one route serve both shapes rather than adding a second URL for
   * what is still fundamentally "ask a question."
   */
  app.post('/knowledge/ask', gate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    let candidate: unknown = request.body;
    let file: ImageInput | undefined;

    if (request.isMultipart()) {
      let questionField: string | undefined;
      let historyField: string | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'file') {
              // Drain unexpected files rather than leaving the stream stalled.
              part.file.resume();
              continue;
            }
            file = { bytes: await part.toBuffer(), mimeType: part.mimetype };
          } else if (part.type === 'field') {
            if (part.fieldname === 'question') questionField = String(part.value);
            else if (part.fieldname === 'history') historyField = String(part.value);
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

      let history: unknown;
      if (historyField !== undefined) {
        try {
          history = JSON.parse(historyField);
        } catch {
          return sendProblem(
            reply,
            400,
            'Invalid request',
            'The history field must be valid JSON.',
          );
        }
      }
      candidate = { question: questionField, history };
    }

    const body = AskBody.safeParse(candidate);
    if (!body.success) {
      return sendProblem(
        reply,
        400,
        'Invalid request',
        'A question between 3 and 500 characters is required.',
      );
    }

    // Checked before the attachment is ever extracted: a capture-start
    // command doesn't need — and shouldn't wait on — vision/document
    // extraction that its answer will never use.
    const intent = detectStartCaptureIntent(body.data.question);
    if (intent !== null) {
      return reply.send({ type: 'action', ...intent });
    }

    let attachmentExcerpt: string | undefined;
    if (file !== undefined) {
      try {
        attachmentExcerpt = await extractAttachmentText(file, deps.provider, deps.vaultKey);
      } catch (error) {
        if (error instanceof AttachmentExtractionError) {
          return sendProblem(reply, error.status, error.title, error.message);
        }
        throw error;
      }
    }

    try {
      const result = await ask(deps, {
        question: body.data.question,
        actor: { id: actor.id, role: actor.role },
        history: body.data.history,
        attachmentExcerpt,
      });
      return reply.send({ type: 'answer', ...result });
    } catch (error) {
      if (error instanceof ComplianceError) {
        return sendProblem(reply, error.status, error.code, error.message);
      }
      /**
       * A provider failure becomes 503 with a fixed message, never the upstream
       * text. An error from a model can quote the payload it was sent, and that
       * payload is a transcript. The full cause goes to the server log, which is
       * operator-only.
       */
      request.log.error({ err: error }, 'assistant query failed');
      return sendProblem(
        reply,
        503,
        'Assistant unavailable',
        'The assistant could not answer just now. Nothing was stored.',
      );
    }
  });
}
