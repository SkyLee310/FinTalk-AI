import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { createTranscriptionProvider } from './ai/factory.js';
import type { TranscriptionProvider } from './ai/provider.js';
import { getEnv } from './config/env.js';
import { vaultKeyFromBase64 } from './pdpa/vault.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerComplianceRoutes } from './routes/compliance.routes.js';
import { registerMeetingRoutes } from './routes/meetings.routes.js';

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

  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

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
  registerMeetingRoutes(app, { prisma, provider, vaultKey });
  registerComplianceRoutes(app, prisma);

  return app;
}

// Only auto-start outside tests, so tests can import buildServer freely.
if (process.env.NODE_ENV !== 'test') {
  const env = getEnv();
  const app = buildServer();
  app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
}
