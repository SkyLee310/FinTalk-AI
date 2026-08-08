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

  it('does NOT require GEMINI_API_KEY when the provider is fake', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'fake' })).not.toThrow();
  });

  it('requires the three model IDs when the provider is gemini', () => {
    expect(() => parseEnv({
      ...valid,
      TRANSCRIPTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    })).toThrow(/GEMINI_MODEL_TRANSCRIBE/);
  });

  it('names every offending variable in one error', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'x', CORS_ORIGIN: 'not-a-url' }))
      .toThrow(/CORS_ORIGIN[\s\S]*JWT_ACCESS_SECRET|JWT_ACCESS_SECRET[\s\S]*CORS_ORIGIN/);
  });
});
