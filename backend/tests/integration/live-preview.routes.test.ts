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

async function sessionFor(role: Role): Promise<string> {
  const email = `${role.toLowerCase()}@fintalk.test`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}`,
      role,
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

/**
 * Builds a multipart body without pulling in a form-data dependency, the same
 * approach whiteboards.routes.test.ts uses. `fields` carries the consent pair
 * (and anything else) as plain text parts, ahead of the audio file.
 */
function multipart(
  file: { filename: string; contentType: string; body: Buffer },
  fields: Record<string, string> = {},
) {
  const boundary = '----FinTalkLivePreviewBoundary';
  const chunks = [
    ...Object.entries(fields).flatMap(([name, value]) => [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    ]),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; `
      + `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const CLIP = {
  filename: 'clip.webm',
  contentType: 'audio/webm',
  body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]),
};

const ACKNOWLEDGED = { consentConfirmed: 'true', transferAcknowledged: 'true' };

describe('POST /meetings/live-preview', () => {
  it('returns redacted segments for a maker with both acknowledgements', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart(CLIP, ACKNOWLEDGED);

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/live-preview',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { segments: { textRedacted: string }[]; languages: string[] };
    expect(body.segments.length).toBeGreaterThan(0);
    expect(body.languages).toEqual(['en', 'ms']);

    // The fake provider's fixture carries a synthetic NRIC and a test Visa
    // number in the clear (see fake.provider.ts) — proving this endpoint
    // actually redacts rather than passing model output straight through.
    const joined = body.segments.map((s) => s.textRedacted).join(' ');
    expect(joined).not.toContain('880101-14-5678');
    expect(joined).not.toContain('4111 1111 1111 1111');
    expect(joined).toMatch(/\[NRIC_\d+]/);
  });

  it('refuses 422 when consent is not confirmed', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart(CLIP, {
      consentConfirmed: 'false',
      transferAcknowledged: 'true',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/live-preview',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(422);
    expect((response.json() as { title: string }).title).toBe('Consent required');
  });

  it('refuses 422 when the transfer is not acknowledged', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart(CLIP, {
      consentConfirmed: 'true',
      transferAcknowledged: 'false',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/live-preview',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(422);
    expect((response.json() as { title: string }).title).toBe('Transfer acknowledgement required');
  });

  it('refuses 403 for a role without meeting:create', async () => {
    const cookie = await sessionFor('CHECKER');
    const { payload, headers } = multipart(CLIP, ACKNOWLEDGED);

    const response = await app.inject({
      method: 'POST',
      url: '/meetings/live-preview',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses 429 on a second call inside the rate-guard window', async () => {
    const cookie = await sessionFor('MAKER');

    const first = multipart(CLIP, ACKNOWLEDGED);
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/meetings/live-preview',
      headers: { ...first.headers, cookie },
      payload: first.payload,
    });
    expect(firstResponse.statusCode).toBe(200);

    const second = multipart(CLIP, ACKNOWLEDGED);
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/meetings/live-preview',
      headers: { ...second.headers, cookie },
      payload: second.payload,
    });
    expect(secondResponse.statusCode).toBe(429);
  });
});
