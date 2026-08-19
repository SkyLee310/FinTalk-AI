import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/config/env.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '8080',
  CORS_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/fintalk',
  TRANSCRIPTION_PROVIDER: 'fake',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PII_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'),
} as NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('accepts a valid environment and coerces PORT to a number', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('applies defaults for optional values', () => {
    // `valid` deliberately omits MEETING_RETENTION_DAYS, JWT_ACCESS_TTL and
    // JWT_REFRESH_TTL, so parsing it asserts the schema's declared defaults.
    const env = parseEnv(valid);
    expect(env.MEETING_RETENTION_DAYS).toBe(90);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('7d');
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' }))
      .toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a PII_VAULT_KEY that is not exactly 32 bytes', () => {
    expect(() => parseEnv({ ...valid, PII_VAULT_KEY: Buffer.alloc(16).toString('base64') }))
      .toThrow(/PII_VAULT_KEY/);
  });

  it('requires GEMINI_API_KEY when the provider is gemini', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'gemini', GEMINI_API_KEY: '' }))
      .toThrow(/GEMINI_API_KEY/);
  });

  it('accepts valid Google Meet OAuth and webhook configuration', () => {
    const env = parseEnv({
      ...valid,
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:8080/auth/google/callback',
      GOOGLE_WEBHOOK_SECRET: 'webhook-secret-123',
    });
    expect(env.GOOGLE_CLIENT_ID).toBe('test-client-id.apps.googleusercontent.com');
    expect(env.GOOGLE_CLIENT_SECRET).toBe('test-client-secret');
    expect(env.GOOGLE_REDIRECT_URI).toBe('http://localhost:8080/auth/google/callback');
    expect(env.GOOGLE_WEBHOOK_SECRET).toBe('webhook-secret-123');
  });

  it('rejects an invalid GOOGLE_REDIRECT_URI format', () => {
    expect(() =>
      parseEnv({
        ...valid,
        GOOGLE_REDIRECT_URI: 'not-a-valid-url',
      }),
    ).toThrow(/GOOGLE_REDIRECT_URI/);
  });

  it('does NOT require GEMINI_API_KEY when the provider is fake', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'fake' })).not.toThrow();
  });

  /**
   * The withdrawn `local` provider must fail loudly, not fall through.
   *
   * A deployment still carrying TRANSCRIPTION_PROVIDER=local has to stop and say
   * so. Were the value merely unrecognised and defaulted away, that operator
   * would get Gemini — a cross-border transfer they had explicitly configured
   * against. This asserts the refusal, and that the message names the variable.
   */
  it('rejects the withdrawn local provider by name', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'local' }))
      .toThrow(/TRANSCRIPTION_PROVIDER/);
  });

  it('accepts gemini, vertex and fake as providers', () => {
    for (const provider of ['gemini', 'vertex', 'fake']) {
      const raw = {
        ...valid,
        TRANSCRIPTION_PROVIDER: provider,
        GEMINI_API_KEY: 'key',
        GEMINI_MODEL_TRANSCRIBE: 'model-id',
        GEMINI_MODEL_VISION: 'model-id',
        GEMINI_MODEL_TEXT: 'model-id',
        VERTEX_PROJECT_ID: 'project',
        VERTEX_LOCATION: 'us-central1',
        GCP_SERVICE_ACCOUNT_KEY: '{"project_id":"project"}',
        VERTEX_MODEL_TRANSCRIBE: 'model-id',
        VERTEX_MODEL_VISION: 'model-id',
        VERTEX_MODEL_TEXT: 'model-id',
      };
      expect(parseEnv(raw).TRANSCRIPTION_PROVIDER).toBe(provider);
    }
  });

  it('requires the three model IDs when the provider is gemini', () => {
    expect(() => parseEnv({
      ...valid,
      TRANSCRIPTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    })).toThrow(/GEMINI_MODEL_TRANSCRIBE/);
  });

  it('requires the Vertex fields when the provider is vertex', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'vertex' }))
      .toThrow(/VERTEX_PROJECT_ID/);
  });

  it('does NOT require Vertex fields when the provider is gemini', () => {
    expect(() => parseEnv({
      ...valid,
      TRANSCRIPTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
      GEMINI_MODEL_TRANSCRIBE: 'model-id',
      GEMINI_MODEL_VISION: 'model-id',
      GEMINI_MODEL_TEXT: 'model-id',
    })).not.toThrow();
  });

  /**
   * Caught here, at boot, rather than surfacing as an opaque JSON.parse
   * crash the first time factory.ts builds the Vertex client.
   */
  it('rejects a GCP_SERVICE_ACCOUNT_KEY that is not valid JSON', () => {
    expect(() => parseEnv({
      ...valid,
      TRANSCRIPTION_PROVIDER: 'vertex',
      VERTEX_PROJECT_ID: 'project',
      VERTEX_LOCATION: 'us-central1',
      GCP_SERVICE_ACCOUNT_KEY: '/path/to/key.json',
      VERTEX_MODEL_TRANSCRIBE: 'model-id',
      VERTEX_MODEL_VISION: 'model-id',
      VERTEX_MODEL_TEXT: 'model-id',
    })).toThrow(/GCP_SERVICE_ACCOUNT_KEY/);
  });

  it('names every offending variable in one error', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'x', CORS_ORIGIN: 'not-a-url' }))
      .toThrow(/CORS_ORIGIN[\s\S]*JWT_ACCESS_SECRET|JWT_ACCESS_SECRET[\s\S]*CORS_ORIGIN/);
  });
});
