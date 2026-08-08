import cors from '@fastify/cors';
import Fastify from 'fastify';
import { getEnv } from './config/env.js';

export function buildServer() {
  const env = getEnv();
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

  // Reports the active provider so a deploy can be verified at a glance.
  // Never echoes a secret.
  app.get('/health', async () => ({
    status: 'ok',
    provider: env.TRANSCRIPTION_PROVIDER,
  }));

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
