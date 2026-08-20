import { describe, expect, it } from 'vitest';
import { createTranscriptionProvider } from '../../../src/ai/factory.js';
import { FakeTranscriptionProvider } from '../../../src/ai/fake.provider.js';
import { FallbackTranscriptionProvider } from '../../../src/ai/fallback.provider.js';
import { GeminiTranscriptionProvider } from '../../../src/ai/gemini.provider.js';
import type { Env } from '../../../src/config/env.js';

const mockBaseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 8080,
  CORS_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  TRANSCRIPTION_PROVIDER: 'fake',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  PII_VAULT_KEY: Buffer.alloc(32, 1).toString('base64'),
  MEETING_RETENTION_DAYS: 90,
  OPENROUTER_MODEL: 'openai/gpt-4o',
  OPENROUTER_MODEL_TRANSCRIBE: 'openai/whisper-large-v3',
  AI_REQUEST_TIMEOUT_MS: 30_000,
};

describe('createTranscriptionProvider', () => {
  it('returns FakeTranscriptionProvider when TRANSCRIPTION_PROVIDER=fake', () => {
    const provider = createTranscriptionProvider(mockBaseEnv);
    expect(provider).toBeInstanceOf(FakeTranscriptionProvider);
  });

  it('creates a standalone Gemini provider when TRANSCRIPTION_PROVIDER=gemini without fallback', () => {
    const env: Env = {
      ...mockBaseEnv,
      TRANSCRIPTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL_TRANSCRIBE: 'gemini-3.5-flash',
      GEMINI_MODEL_TEXT: 'gemini-3.5-flash',
      GEMINI_MODEL_VISION: 'gemini-3.5-flash',
    };
    const provider = createTranscriptionProvider(env);
    expect(provider).toBeInstanceOf(GeminiTranscriptionProvider);
  });

  it('wraps with FallbackTranscriptionProvider when TRANSCRIPTION_PROVIDER=vertex and GEMINI_API_KEY is provided', () => {
    const env: Env = {
      ...mockBaseEnv,
      TRANSCRIPTION_PROVIDER: 'vertex',
      VERTEX_PROJECT_ID: 'test-project',
      VERTEX_LOCATION: 'asia-southeast1',
      GCP_SERVICE_ACCOUNT_KEY: JSON.stringify({
        type: 'service_account',
        project_id: 'test-project',
        private_key: 'mock-private-key',
        client_email: 'test@test-project.iam.gserviceaccount.com',
      }),
      VERTEX_MODEL_TRANSCRIBE: 'gemini-3.5-flash',
      VERTEX_MODEL_TEXT: 'gemini-3.5-flash',
      VERTEX_MODEL_VISION: 'gemini-3.5-flash',
      GEMINI_API_KEY: 'test-gemini-key',
    };
    const provider = createTranscriptionProvider(env);
    expect(provider).toBeInstanceOf(FallbackTranscriptionProvider);
  });
});
