import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

beforeEach(async () => {
  await app.backgroundJobs.drain();
  await resetDb();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function sessionFor(
  role: Role,
  oversight?: { canViewMeetings?: boolean },
): Promise<string> {
  const email = `${role.toLowerCase()}@fintalk.ai`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}`,
      role,
      canViewMeetings: oversight?.canViewMeetings ?? false,
    },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });

  const cookies = (login as unknown as { cookies: { name: string; value: string }[] }).cookies;
  return `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`;
}

describe('POST /meetings/redact-live-caption', () => {
  /**
   * The anti-vacuity case, same fixture value used elsewhere in this suite
   * (see whiteboards.routes.test.ts) — a pass here means redact() actually ran.
   */
  it('redacts a seeded identifier out of a live caption line', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/redact-live-caption',
      headers: { cookie },
      payload: { text: 'My IC is 880101-14-5678, call me back.' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ textRedacted: string }>();
    expect(body.textRedacted).toContain('[NRIC_1]');
    expect(body.textRedacted).not.toMatch(/\d{6}-\d{2}-\d{4}/);
  });

  it('leaves caption text with no personal data unchanged', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/redact-live-caption',
      headers: { cookie },
      payload: { text: 'Let us move to the next agenda item.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ textRedacted: string }>().textRedacted).toBe(
      'Let us move to the next agenda item.',
    );
  });

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/meetings/redact-live-caption',
      payload: { text: 'Some caption text.' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses a role without meeting:create', async () => {
    const cookie = await sessionFor('OVERSIGHT', { canViewMeetings: true });

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/redact-live-caption',
      headers: { cookie },
      payload: { text: 'Some caption text.' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an empty text field', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/redact-live-caption',
      headers: { cookie },
      payload: { text: '' },
    });

    expect(response.statusCode).toBe(400);
  });
});
