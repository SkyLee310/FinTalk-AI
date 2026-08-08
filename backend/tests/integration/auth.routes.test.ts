import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const EMAIL = 'maker@fintalk.test';

const app = buildServer({ prisma });

beforeEach(async () => {
  await resetDb();
  await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Demo MAKER',
      role: 'MAKER',
    },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

interface WithCookies {
  cookies: { name: string; value: string }[];
}

function cookiesOf(response: unknown): { name: string; value: string }[] {
  return (response as WithCookies).cookies;
}

function cookieHeader(response: unknown): string {
  return cookiesOf(response)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function login(email = EMAIL, password = PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
}

describe('POST /auth/login', () => {
  it('returns the user with its capabilities and sets both cookies', async () => {
    const response = await login();
    expect(response.statusCode).toBe(200);

    const body = response.json<{ role: string; capabilities: string[]; email: string }>();
    expect(body.email).toBe(EMAIL);
    expect(body.role).toBe('MAKER');
    expect(body.capabilities).toContain('termsheet:submit');
    expect(body.capabilities).not.toContain('termsheet:approve');

    const names = cookiesOf(response).map((c) => c.name);
    expect(names).toContain(ACCESS_COOKIE);
    expect(names).toContain(REFRESH_COOKIE);
  });

  it('marks the session cookies httpOnly so script cannot read them', async () => {
    const response = await login();
    const raw = response.headers['set-cookie'];
    const header = Array.isArray(raw) ? raw.join('\n') : String(raw);
    expect(header).toMatch(/HttpOnly/i);
  });

  it('never returns the password hash', async () => {
    const response = await login();
    expect(response.body).not.toContain('argon2');
    expect(response.body).not.toContain('passwordHash');
  });

  it('rejects a wrong password with a problem document', async () => {
    const response = await login(EMAIL, 'wrong-password');
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<{ detail: string }>().detail).toBeTruthy();
  });

  /**
   * The two failures must be indistinguishable. A different message, status or
   * shape for an unknown address turns this endpoint into a way to discover who
   * holds an account.
   */
  it('gives an unknown address exactly the same answer as a wrong password', async () => {
    const unknown = await login('nobody@fintalk.test', PASSWORD);
    const wrong = await login(EMAIL, 'wrong-password');

    expect(unknown.statusCode).toBe(wrong.statusCode);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('rejects a malformed body with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('rejects a request with no session', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('rejects a forged token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `${ACCESS_COOKIE}=not.a.token` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns the caller when the session is valid', async () => {
    const session = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: cookieHeader(session) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ email: string }>().email).toBe(EMAIL);
  });
});

describe('POST /auth/refresh', () => {
  it('issues a new access cookie', async () => {
    const session = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: cookieHeader(session) },
    });

    expect(response.statusCode).toBe(200);
    expect(cookiesOf(response).map((c) => c.name)).toContain(ACCESS_COOKIE);
  });

  /**
   * The refreshed token takes its role from the database, not from the refresh
   * token. Otherwise a user demoted from CHECKER would keep approving for the
   * remaining life of a seven-day token.
   */
  it('reflects a role change made after the refresh token was issued', async () => {
    const session = await login();
    await prisma.user.update({ where: { email: EMAIL }, data: { role: 'VIEWER' } });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: cookieHeader(session) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ role: string }>().role).toBe('VIEWER');
  });

  it('refuses an access token presented as a refresh token', async () => {
    const session = await login();
    const access = cookiesOf(session).find((c) => c.name === ACCESS_COOKIE)!.value;

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: `${REFRESH_COOKIE}=${access}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a request with no refresh cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/refresh' });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears both session cookies', async () => {
    const session = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: cookieHeader(session) },
    });

    expect(response.statusCode).toBe(200);
    const cleared = cookiesOf(response);
    expect(cleared.find((c) => c.name === ACCESS_COOKIE)?.value).toBe('');
    expect(cleared.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');
  });
});
