import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';
import { redact } from '../pdpa/redactor.js';

/**
 * Redacts one caption line from the browser's own speech recognition before
 * it is shown on screen.
 *
 * This is deliberately not a transcription call: the caption text already
 * exists client-side (the browser's Web Speech API produced it locally), so
 * there is nothing for a provider to transcribe. Nothing here is persisted —
 * no TranscriptSegment, no RedactionRecord, no audit-chain entry — because
 * live captions never are; the real, stored transcript still comes from the
 * upload pipeline afterwards. Consent for turning captions on at all is
 * enforced client-side, since the sensitive transfer (microphone audio to
 * the browser vendor's own speech service) already happens before this
 * route is ever called.
 */

const CaptionBody = z.object({
  text: z.string().min(1),
});

export interface LiveCaptionRouteDeps {
  readonly vaultKey: Buffer;
}

export function registerLiveCaptionRoutes(app: FastifyInstance, deps: LiveCaptionRouteDeps): void {
  const { vaultKey } = deps;

  app.post(
    '/meetings/redact-live-caption',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const body = CaptionBody.safeParse(request.body);
      if (!body.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          body.error.issues[0]?.message ?? 'Invalid input.',
        );
      }

      const result = redact(body.data.text, vaultKey);
      return reply.send({ textRedacted: result.text });
    },
  );
}
