import { describe, expect, it } from 'vitest';
import {
  getAuthUrl,
  getGoogleOAuthClient,
  GOOGLE_MEET_SCOPES,
  GoogleOAuthError,
} from '../../../src/auth/google-oauth.js';
import type { Env } from '../../../src/config/env.js';

const mockEnv = {
  NODE_ENV: 'test',
  PORT: 8080,
  CORS_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/fintalk',
  TRANSCRIPTION_PROVIDER: 'fake',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  PII_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'),
  MEETING_RETENTION_DAYS: 90,
  GOOGLE_CLIENT_ID: 'mock-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'mock-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:8080/auth/google/callback',
} as unknown as Env;

describe('google-oauth', () => {
  it('throws GoogleOAuthError when Google credentials are not configured', () => {
    const unconfiguredEnv = {
      ...mockEnv,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_REDIRECT_URI: undefined,
    } as unknown as Env;

    expect(() => getGoogleOAuthClient(unconfiguredEnv)).toThrow(GoogleOAuthError);
  });

  it('creates an OAuth client when properly configured', () => {
    const client = getGoogleOAuthClient(mockEnv);
    expect(client).toBeDefined();
  });

  it('generates a consent URL containing the required Meet scopes', () => {
    const url = getAuthUrl(mockEnv, 'state-csrf-token');
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('state=state-csrf-token');
    for (const scope of GOOGLE_MEET_SCOPES) {
      expect(url).toContain(encodeURIComponent(scope));
    }
  });
});
