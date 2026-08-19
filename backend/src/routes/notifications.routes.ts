import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';

/**
 * Self-scoped notification inbox — see prisma/schema.prisma's Notification
 * model and notifications/service.ts for how rows get created. No
 * capability gate beyond being authenticated: a caller only ever sees or
 * marks their own rows, so there is nothing here a capability would
 * additionally restrict.
 */

const MAX_LISTED = 50;

const ReadParams = z.object({ id: z.string().min(1) });

export function registerNotificationRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get('/notifications', { preHandler: [requireAuth] }, async (request, reply) => {
    const actor = request.authUser;
    if (actor === undefined) {
      return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
    }

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: actor.id },
        orderBy: [{ read: 'asc' }, { createdAt: 'desc' }],
        take: MAX_LISTED,
      }),
      prisma.notification.count({ where: { userId: actor.id, read: false } }),
    ]);

    return reply.send({
      unreadCount,
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        message: row.message,
        relatedMeetingId: row.relatedMeetingId,
        read: row.read,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });

  app.patch(
    '/notifications/:id/read',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const params = ReadParams.safeParse(request.params);
      if (!params.success) {
        return sendProblem(reply, 400, 'Invalid request', 'A notification id is required.');
      }

      // updateMany rather than update: the where clause enforces ownership
      // and existence in the same atomic statement, so there is no window
      // where a caller could probe whether another user's id exists.
      const { count } = await prisma.notification.updateMany({
        where: { id: params.data.id, userId: actor.id },
        data: { read: true },
      });

      if (count === 0) {
        return sendProblem(reply, 404, 'Not found', 'No notification exists with that id.');
      }

      return reply.send({ id: params.data.id, read: true });
    },
  );
}
