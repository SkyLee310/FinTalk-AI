import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditWithin } from '../audit/chain.js';
import { requireAuth } from '../auth/middleware.js';
import {
  exchangeCode,
  getAuthUrl,
  GoogleOAuthError,
  revokeGoogleToken,
} from '../auth/google-oauth.js';
import type { Env } from '../config/env.js';
import { sendProblem } from '../http/problem.js';

export function registerGoogleAuthRoutes(
  app: FastifyInstance,
  env: Env,
  prisma: PrismaClient,
) {
  /**
   * Returns the Google OAuth authorization URL for the user.
   */
  app.get('/auth/google/url', { preHandler: [requireAuth] }, async (req, reply) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
      return sendProblem(
        reply,
        501,
        'Google Meet Integration Not Configured',
        'Google OAuth is not configured on this server.',
      );
    }

    try {
      const state = Buffer.from(
        JSON.stringify({ userId: req.authUser!.id, ts: Date.now() }),
      ).toString('base64url');

      const url = getAuthUrl(env, state);
      return reply.send({ url, state });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return sendProblem(reply, 500, 'OAuth Error', message);
    }
  });

  /**
   * OAuth redirect callback from Google.
   */
  app.get('/auth/google/callback', async (req, reply) => {
    const QuerySchema = z.object({
      code: z.string().min(1),
      state: z.string().min(1),
      error: z.string().optional(),
    });

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      if ((req.query as Record<string, unknown>)?.error) {
        const errorReason = String((req.query as Record<string, unknown>).error);
        return reply.redirect(`${env.CORS_ORIGIN}/settings?google_error=${encodeURIComponent(errorReason)}`);
      }
      return reply.redirect(`${env.CORS_ORIGIN}/settings?google_error=invalid_callback_params`);
    }

    const { code, state } = parsed.data;

    let userId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
        userId: string;
        ts: number;
      };
      if (!decoded.userId) {
        throw new Error('Missing userId in OAuth state');
      }
      userId = decoded.userId;
    } catch {
      return reply.redirect(`${env.CORS_ORIGIN}/settings?google_error=invalid_state`);
    }

    try {
      const tokens = await exchangeCode(env, code);

      await prisma.$transaction(async (tx) => {
        await tx.googleToken.upsert({
          where: { userId },
          create: {
            userId,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiryDate: tokens.expiryDate ? BigInt(tokens.expiryDate) : null,
            scope: tokens.scope ?? null,
          },
          update: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiryDate: tokens.expiryDate ? BigInt(tokens.expiryDate) : null,
            scope: tokens.scope ?? null,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { googleLinked: true },
        });

        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: userId,
          actorRole: 'MAKER',
          action: 'user.google.linked',
          entityType: 'User',
          entityId: userId,
          payload: { scope: tokens.scope },
        });
      });

      return reply.redirect(`${env.CORS_ORIGIN}/settings?google=linked`);
    } catch (error) {
      const message = error instanceof GoogleOAuthError ? error.message : 'Failed to connect Google account';
      req.log.error({ err: error }, 'Google OAuth callback exchange failed');
      return reply.redirect(`${env.CORS_ORIGIN}/settings?google_error=${encodeURIComponent(message)}`);
    }
  });

  /**
   * Revokes and removes Google link for the authenticated user.
   */
  app.delete('/auth/google/link', { preHandler: [requireAuth] }, async (req, reply) => {
    const existing = await prisma.googleToken.findUnique({
      where: { userId: req.authUser!.id },
    });

    if (!existing) {
      return reply.send({ success: true, message: 'Google account was not linked' });
    }

    // Try revoking token remotely
    if (existing.refreshToken || existing.accessToken) {
      await revokeGoogleToken(env, existing.refreshToken || existing.accessToken);
    }

    await prisma.$transaction(async (tx) => {
      await tx.googleToken.delete({
        where: { userId: req.authUser!.id },
      });

      await tx.user.update({
        where: { id: req.authUser!.id },
        data: { googleLinked: false },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: req.authUser!.id,
        actorRole: req.authUser!.role ?? 'VIEWER',
        action: 'user.google.unlinked',
        entityType: 'User',
        entityId: req.authUser!.id,
        payload: {},
      });
    });

    return reply.send({ success: true });
  });

  /**
   * Returns current Google account connection status for the authenticated user.
   */
  app.get('/auth/google/status', { preHandler: [requireAuth] }, async (req, reply) => {
    const token = await prisma.googleToken.findUnique({
      where: { userId: req.authUser!.id },
      select: { createdAt: true, scope: true },
    });

    return reply.send({
      linked: token !== null,
      scope: token?.scope ?? null,
      linkedAt: token?.createdAt ?? null,
    });
  });
}
