import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { createTranscriptionProvider } from './ai/factory.js';
import type { TranscriptionProvider } from './ai/provider.js';
import { getEnv } from './config/env.js';
import { vaultKeyFromBase64 } from './pdpa/vault.js';
import { BackgroundJobs } from './pipeline/background-jobs.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerComplianceRoutes } from './routes/compliance.routes.js';
import { registerKnowledgeRoutes } from './routes/knowledge.routes.js';
import { registerMeetingRoutes } from './routes/meetings.routes.js';
import { registerUserRoutes } from './routes/users.routes.js';
import { registerWhiteboardRoutes } from './routes/whiteboards.routes.js';

/**
 * Gemini accepts audio inline up to roughly 20 MB per request. Recordings
 * longer than that need the Files API, which is a separate upload flow; until
 * it exists, refusing at the edge is honest, and a request that would fail
 * upstream anyway should not be read into memory first.
 */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export interface ServerDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
}

export function buildServer(deps?: Partial<ServerDeps>) {
  const env = getEnv();
  const prisma = deps?.prisma ?? new PrismaClient();
  const provider = deps?.provider ?? createTranscriptionProvider(env);
  const vaultKey = vaultKeyFromBase64(env.PII_VAULT_KEY);
  const jobs = new BackgroundJobs();

  const app = Fastify({ logger: env.NODE_ENV !== 'test' });
  app.decorate('backgroundJobs', jobs);

  /**
   * Capture processing outlives its request, so closing the server has to wait
   * for it. Without this a redeploy kills a transcription mid-transaction and
   * the meeting stays PROCESSING for ever, because the only code that would
   * have marked it FAILED died with it.
   */
  app.addHook('onClose', async () => {
    if (jobs.size > 0) app.log.info({ inFlight: jobs.size }, 'draining capture work');
    await jobs.drain();
  });

  // credentials:true is required for the session cookies to cross from the
  // Vercel frontend to this API.
  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  app.register(cookie);
  app.register(multipart, {
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 10 },
  });

  // Reports the active provider so a deploy can be verified at a glance.
  // Never echoes a secret.
  app.get('/health', async () => ({
    status: 'ok',
    provider: env.TRANSCRIPTION_PROVIDER,
  }));

  registerAuthRoutes(app, prisma);
  registerMeetingRoutes(app, { prisma, provider, vaultKey, jobs });
  registerWhiteboardRoutes(app, { prisma, provider, vaultKey });
  registerComplianceRoutes(app, prisma);
  registerUserRoutes(app, prisma);
  registerKnowledgeRoutes(app, { prisma, provider });

  /**
   * A restart kills in-flight capture, and the code that would have marked the
   * meeting FAILED dies with it. Anything still PROCESSING at boot therefore has
   * nothing working on it, so it is failed rather than left looking busy for
   * ever — which is what a stranded row looked like in the deployed list.
   *
   * This assumes one instance, which is how the service is deployed. With
   * replicas a booting instance would fail another instance's live work.
   */
  if (env.NODE_ENV !== 'test') {
    app.addHook('onReady', async () => {
      const stranded = await prisma.meeting.updateMany({
        where: { status: 'PROCESSING' },
        data: { status: 'FAILED', failureReason: 'interrupted:Restart' },
      });

      if (stranded.count > 0) {
        app.log.warn({ count: stranded.count }, 'failed meetings stranded by a restart');
      }
    });
  }

  return app;
}

// Only auto-start outside tests, so tests can import buildServer freely.
if (process.env.NODE_ENV !== 'test') {
  const env = getEnv();
  const app = buildServer();

  /**
   * Railway sends SIGTERM on every redeploy. Closing the app runs the onClose
   * hook, which waits for in-flight capture work; exiting without it is what
   * strands a meeting in PROCESSING.
   *
   * The grace period is finite, so a long transcription can still be cut off.
   * That is what the PROCESSING sweep in buildServer is for.
   */
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(
        () => process.exit(0),
        (err: unknown) => {
          app.log.error(err);
          process.exit(1);
        },
      );
    });
  }

  app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
}
