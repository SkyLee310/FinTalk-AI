import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { getEnv } from './config/env.js';
import { registerAuthRoutes } from './routes/auth.routes.js';

export interface ServerDeps {
  readonly prisma: PrismaClient;
}

export function buildServer(deps?: Partial<ServerDeps>) {
  const env = getEnv();
  const prisma = deps?.prisma ?? new PrismaClient();
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  // credentials:true is required for the session cookies to cross from the
  // Vercel frontend to this API.
  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  app.register(cookie);

  // Reports the active provider so a deploy can be verified at a glance.
  // Never echoes a secret.
  app.get('/health', async () => ({
    status: 'ok',
    provider: env.TRANSCRIPTION_PROVIDER,
  }));

  registerAuthRoutes(app, prisma);

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
