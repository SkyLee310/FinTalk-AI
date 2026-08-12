import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditWithin } from '../audit/chain.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';
import { detectPii } from '../pdpa/detectors.js';

/**
 * Feedback from the people using the product.
 *
 * Submission needs `requireAuth` and nothing more — every role may say the
 * product is wrong, and gating that on a capability would silence exactly the
 * accounts (a VIEWER, a freshly approved MAKER) whose confusion is most worth
 * hearing. Reading the pile is a different matter: it is other people's words
 * about their own work, so it reuses `user:manage`, which only ADMIN holds. No
 * new capability is introduced.
 */

const SubmitBody = z.object({
  category: z.enum(['BUG', 'IDEA', 'OTHER']),
  /**
   * Ten characters rejects "asdf" without demanding an essay. The 2000 ceiling
   * matches the assistant's per-turn limit and keeps a runaway paste out of
   * the table.
   */
  message: z.string().min(10).max(2000),
});

export function registerFeedbackRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post('/feedback', { preHandler: [requireAuth] }, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const body = SubmitBody.safeParse(request.body);
    if (!body.success) {
      return sendProblem(
        reply,
        400,
        'Invalid request',
        'A category and a message between 10 and 2000 characters are required.',
      );
    }

    /**
     * Personal data is refused, not stored.
     *
     * The assistant already refuses a *transient* question carrying an NRIC
     * (knowledge/assistant.ts). Feedback is kept indefinitely and read by an
     * administrator later, so accepting an identifier here would put the weaker
     * rule in the more sensitive place. Naming the kinds found is what turns
     * the refusal into something the submitter can act on.
     */
    const found = detectPii(body.data.message);
    if (found.length > 0) {
      const kinds = [...new Set(found.map((f) => f.kind))].sort().join(', ');
      return sendProblem(
        reply,
        422,
        'feedback-contains-personal-data',
        `Remove the personal data from your message (${kinds}). Feedback is stored `
        + 'as you typed it and read by an administrator later, so describe the '
        + 'account or the meeting rather than naming the identifier.',
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const feedback = await tx.feedback.create({
        data: {
          authorId: actor.id,
          category: body.data.category,
          message: body.data.message,
        },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'feedback.submitted',
        entityType: 'Feedback',
        entityId: feedback.id,
        // The category only. The message is not copied in: entityId already
        // points at the row holding it, and duplicating free text into an
        // append-only chain means it can never be corrected or withdrawn.
        payload: { category: feedback.category },
      });

      return feedback;
    });

    return reply.code(201).send({
      id: created.id,
      category: created.category,
      createdAt: created.createdAt.toISOString(),
    });
  });

  app.get(
    '/feedback',
    { preHandler: [requireAuth, requireCapability('user:manage')] },
    async (_request, reply) => {
      const rows = await prisma.feedback.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          category: true,
          message: true,
          createdAt: true,
          // Attributed, not anonymous. An administrator who cannot tell which
          // role hit the problem cannot act on it, and the submitter is told
          // this is not an anonymous channel before they type.
          author: { select: { displayName: true, email: true, role: true } },
        },
      });

      return reply.send({
        feedback: rows.map((row) => ({
          id: row.id,
          category: row.category,
          message: row.message,
          createdAt: row.createdAt.toISOString(),
          author: {
            displayName: row.author.displayName,
            email: row.author.email,
            role: row.author.role,
          },
        })),
      });
    },
  );
}
