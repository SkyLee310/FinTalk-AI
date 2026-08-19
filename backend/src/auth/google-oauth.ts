import { google } from 'googleapis';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.js';

export const GOOGLE_MEET_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.conference.media.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export class GoogleOAuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

/**
 * Creates an OAuth2 client configured with application credentials.
 */
export function getGoogleOAuthClient(env: Env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new GoogleOAuthError(
      'Google Meet integration is not configured. Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI.',
    );
  }

  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

/**
 * Generates the Google OAuth consent URL for user authorization.
 */
export function getAuthUrl(env: Env, state?: string): string {
  const client = getGoogleOAuthClient(env);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GOOGLE_MEET_SCOPES],
    state,
  });
}

export interface GoogleTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiryDate?: number | null;
  readonly scope?: string | null;
}

/**
 * Exchanges an authorization code for access and refresh tokens.
 */
export async function exchangeCode(env: Env, code: string): Promise<GoogleTokens> {
  const client = getGoogleOAuthClient(env);
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) {
      throw new GoogleOAuthError('Google did not return an access token');
    }
    if (!tokens.refresh_token) {
      throw new GoogleOAuthError(
        'Google did not return a refresh token. User may need to re-consent with prompt=consent.',
      );
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
    };
  } catch (error) {
    if (error instanceof GoogleOAuthError) throw error;
    throw new GoogleOAuthError('Failed to exchange authorization code with Google', error);
  }
}

/**
 * Refreshes an expired access token using a stored refresh token.
 */
export async function refreshAccessToken(
  env: Env,
  refreshToken: string,
): Promise<{ accessToken: string; expiryDate?: number | null }> {
  const client = getGoogleOAuthClient(env);
  client.setCredentials({ refresh_token: refreshToken });

  try {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new GoogleOAuthError('Failed to refresh Google access token: no token returned');
    }

    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date ?? null,
    };
  } catch (error) {
    throw new GoogleOAuthError('Failed to refresh access token with Google', error);
  }
}

/**
 * Revokes Google access/refresh token.
 */
export async function revokeGoogleToken(env: Env, token: string): Promise<void> {
  const client = getGoogleOAuthClient(env);
  try {
    await client.revokeToken(token);
  } catch (error) {
    // If revocation fails remotely, log but don't crash — we'll still delete local row
    console.warn('Failed to revoke Google token remotely:', error);
  }
}

/**
 * Retrieves a valid, authorized OAuth2Client for a user.
 * Automatically refreshes the token if it is expired or expiring within 5 minutes.
 */
export async function getUserGoogleClient(
  env: Env,
  prisma: PrismaClient,
  userId: string,
) {
  const tokenRecord = await prisma.googleToken.findUnique({
    where: { userId },
  });

  if (!tokenRecord) {
    throw new GoogleOAuthError('User has not linked their Google account');
  }

  const client = getGoogleOAuthClient(env);
  const nowMs = Date.now();
  const expiryMs = tokenRecord.expiryDate ? Number(tokenRecord.expiryDate) : null;
  const isExpiringSoon = expiryMs !== null && expiryMs - nowMs < 5 * 60 * 1000;

  if (isExpiringSoon) {
    const refreshed = await refreshAccessToken(env, tokenRecord.refreshToken);
    await prisma.googleToken.update({
      where: { userId },
      data: {
        accessToken: refreshed.accessToken,
        expiryDate: refreshed.expiryDate ? BigInt(refreshed.expiryDate) : null,
      },
    });

    client.setCredentials({
      access_token: refreshed.accessToken,
      refresh_token: tokenRecord.refreshToken,
    });
  } else {
    client.setCredentials({
      access_token: tokenRecord.accessToken,
      refresh_token: tokenRecord.refreshToken,
    });
  }

  return client;
}
