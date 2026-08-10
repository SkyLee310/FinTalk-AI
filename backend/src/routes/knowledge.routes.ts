import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TranscriptionProvider } from '../ai/provider.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { ComplianceError } from '../compliance/errors.js';
import { sendProblem } from '../http/problem.js';
import { ask } from '../knowledge/assistant.js';
import { buildGraph } from '../knowledge/graph.js';

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

  app.post('/knowledge/ask', gate, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const body = AskBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(
        reply,
        400,
        'Invalid request',
        'A question between 3 and 500 characters is required.',
      );
    }

    try {
      const result = await ask(deps, {
        question: body.data.question,
        actor: { id: actor.id, role: actor.role },
        history: body.data.history,
      });
      return reply.send(result);
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
