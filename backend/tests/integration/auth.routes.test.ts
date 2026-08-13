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

describe('POST /auth/register', () => {
  it('creates a pending account with no role and no session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'New Applicant',
        email: 'applicant@fintalk.test',
        password: 'Demo!2345',
        username: 'applicant1',
        staffId: 'STF-9001',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ accountStatus: 'PENDING' });
    expect(cookiesOf(response)).toHaveLength(0);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'applicant@fintalk.test' } });
    expect(stored.role).toBeNull();
    expect(stored.accountStatus).toBe('PENDING');
  });

  it('refuses to sign in until approved', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'Waiting Applicant',
        email: 'waiting@fintalk.test',
        password: 'Demo!2345',
        username: 'waitingapp',
        staffId: 'STF-9002',
      },
    });

    const response = await login('waiting@fintalk.test', 'Demo!2345');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ detail: expect.stringContaining('administrator approval') });
  });

  it('refuses a duplicate email', async () => {
    const payload = {
      displayName: 'Dup Email',
      email: 'dupemail@fintalk.test',
      password: 'Demo!2345',
      username: 'dupemail1',
      staffId: 'STF-9003',
    };
    await app.inject({ method: 'POST', url: '/auth/register', payload });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...payload, username: 'dupemail2' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('refuses a duplicate username', async () => {
    const first = {
      displayName: 'Dup Username One',
      email: 'dupuser1@fintalk.test',
      password: 'Demo!2345',
      username: 'shared-handle',
      staffId: 'STF-9004',
    };
    await app.inject({ method: 'POST', url: '/auth/register', payload: first });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...first, email: 'dupuser2@fintalk.test' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('rejects a password shorter than the policy floor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'Short Password',
        email: 'shortpw@fintalk.test',
        password: 'short1',
        username: 'shortpw1',
        staffId: 'STF-9005',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('audits registration without the display name or password', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'Audited Applicant',
        email: 'audited@fintalk.test',
        password: 'Demo!2345',
        username: 'auditedapp',
        staffId: 'STF-9006',
      },
    });

    const entry = await prisma.auditEntry.findFirst({ where: { action: 'user.registered' } });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBeNull();
    expect(entry?.payload).toMatchObject({
      email: 'audited@fintalk.test',
      username: 'auditedapp',
      staffId: 'STF-9006',
    });
    expect(entry?.payload).not.toHaveProperty('displayName');
    expect(JSON.stringify(entry?.payload)).not.toContain('Demo!2345');
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
    await prisma.user.update({
      where: { email: EMAIL },
      data: { role: 'OVERSIGHT', canViewAuditTrail: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: cookieHeader(session) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ role: string }>().role).toBe('OVERSIGHT');

    // The refreshed cookie must carry canViewAuditTrail as read from the
    // database, not one still stale from before the promotion — otherwise a
    // freshly promoted OVERSIGHT account keeps being refused the audit trail
    // for the rest of the access token's life.
    const refreshedAccess = cookiesOf(response).find((c) => c.name === ACCESS_COOKIE)!.value;
    const audit = await app.inject({
      method: 'GET',
      url: '/audit',
      headers: { cookie: `${ACCESS_COOKIE}=${refreshedAccess}` },
    });
    expect(audit.statusCode).toBe(200);
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
