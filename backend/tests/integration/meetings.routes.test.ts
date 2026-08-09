import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

/**
 * Capture answers 202 and keeps processing, so a pipeline started by the
 * previous test may still hold locks on the tables resetDb truncates. TRUNCATE
 * wants an AccessExclusiveLock and the pipeline wants an AccessShareLock on a
 * table TRUNCATE already holds — Postgres reported a deadlock and CI went red.
 * Waiting for in-flight work is the fix, not a longer timeout.
 */
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

/** Builds a multipart body without pulling in a form-data dependency. */
function multipart(
  fields: Record<string, string>,
  file?: { field: string; filename: string; contentType: string; body: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----FinTalkTestBoundary';
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; `
        + `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.body,
      Buffer.from('\r\n'),
    );
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const AUDIO = {
  field: 'audio',
  filename: 'meeting.wav',
  contentType: 'audio/wav',
  body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
};

const METADATA = {
  title: 'SME Loan Approval Meeting',
  occurredAt: '2026-08-07T02:30:00.000Z',
  consentConfirmed: 'true',
};

function upload(cookie: string, fields: Record<string, string>, withAudio = true) {
  const { payload, headers } = multipart(fields, withAudio ? AUDIO : undefined);
  return app.inject({
    method: 'POST',
    url: '/meetings',
    headers: { ...headers, cookie },
    payload,
  });
}

/**
 * The upload returns 202 and processes in the background, so a test that wants a
 * finished transcript has to wait for one. Polls the status the route itself
 * publishes rather than sleeping for a guessed duration.
 */
async function waitForSettled(meetingId: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const meeting = await prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { status: true },
    });
    if (meeting.status === 'READY' || meeting.status === 'FAILED') return meeting.status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`meeting ${meetingId} never settled`);
}

async function uploadAndWait(cookie: string): Promise<string> {
  const response = await upload(cookie, METADATA);
  expect(response.statusCode).toBe(202);
  const { meetingId } = response.json<{ meetingId: string }>();
  expect(await waitForSettled(meetingId)).toBe('READY');
  return meetingId;
}

describe('POST /meetings — access control', () => {
  it('refuses an unauthenticated upload', async () => {
    const { payload, headers } = multipart(METADATA, AUDIO);
    const response = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a viewer, who cannot create meetings', async () => {
    const response = await upload(await sessionFor('VIEWER'), METADATA);
    expect(response.statusCode).toBe(403);
    expect(await prisma.meeting.count()).toBe(0);
  });

  it('accepts a maker', async () => {
    const response = await upload(await sessionFor('MAKER'), METADATA);
    expect(response.statusCode).toBe(202);
  });
});

describe('POST /meetings — consent gate', () => {
  /**
   * Processing sends audio to a third-party model. Consent is refused before the
   * audio is looked at, and nothing is recorded — not even a failed meeting row,
   * which would imply the recording had been accepted.
   */
  it('refuses to process without confirmed consent', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, { ...METADATA, consentConfirmed: 'false' });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(/consent/i);
    expect(await prisma.meeting.count()).toBe(0);
    expect(await prisma.transcript.count()).toBe(0);
  });

  it('refuses when the consent field is absent entirely', async () => {
    const cookie = await sessionFor('MAKER');
    const { title, occurredAt } = METADATA;
    const response = await upload(cookie, { title, occurredAt });

    expect(response.statusCode).toBe(422);
    expect(await prisma.meeting.count()).toBe(0);
  });
});

describe('POST /meetings — validation', () => {
  it('rejects a missing title', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, {
      occurredAt: METADATA.occurredAt,
      consentConfirmed: 'true',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-ISO occurredAt', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, { ...METADATA, occurredAt: '7 Aug 2026' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a request carrying no audio', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, METADATA, false);
    expect(response.statusCode).toBe(400);
    expect(await prisma.meeting.count()).toBe(0);
  });
});

describe('POST /meetings — the capture round trip', () => {
  /**
   * The upload no longer waits for the pipeline. Railway's edge proxy closes a
   * request at 300 seconds and a real recording takes longer than that to
   * transcribe, so the route answers 202 with an id to poll.
   */
  it('accepts the upload immediately rather than waiting for the pipeline', async () => {
    const response = await upload(await sessionFor('MAKER'), METADATA);

    expect(response.statusCode).toBe(202);
    const body = response.json<{ meetingId: string; status: string; pollUrl: string }>();
    expect(body.status).toBe('CAPTURED');
    expect(body.pollUrl).toBe(`/meetings/${body.meetingId}`);
  });

  it('reaches READY with every segment and its redactions stored', async () => {
    const meetingId = await uploadAndWait(await sessionFor('MAKER'));

    const transcript = await prisma.transcript.findFirstOrThrow({
      where: { meetingId },
      include: { segments: true, redactions: true },
    });
    expect(transcript.segments).toHaveLength(6);
    expect(transcript.redactions.length).toBeGreaterThan(3);
  });

  it('serves the redacted transcript back with no identifier in it', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(cookie);

    const detail = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: { cookie },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(detail.body).not.toContain('4111');
    expect(detail.body).toContain('[NRIC_1]');
  });

  /**
   * The detail response must never carry the vault relation. Recovering a stored
   * identifier is a separate action that gets its own audit entry.
   */
  it('never includes vault ciphertext in the detail response', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(cookie);

    const detail = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: { cookie },
    });

    expect(detail.body).not.toContain('ciphertext');
    expect(detail.body).not.toContain('authTag');
    expect(detail.body).not.toContain('vaultId');
  });

  it('lists the meeting for a viewer', async () => {
    await uploadAndWait(await sessionFor('MAKER'));

    const response = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: { cookie: await sessionFor('VIEWER') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ meetings: unknown[] }>().meetings).toHaveLength(1);
  });

  /**
   * Regression: the upload wrote no audit entry, so the uploader's identity and
   * their consent confirmation — the first item in the spec's audit strip — went
   * unrecorded, and a deployment that had only captured meetings served an empty
   * audit trail while reporting it valid.
   */
  it('audits the upload together with the consent confirmation', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(cookie);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'meeting.uploaded', entityId: meetingId },
    });

    expect(entry.actorRole).toBe('MAKER');
    expect(entry.payload).toMatchObject({
      consentConfirmed: true,
      audioBytes: AUDIO.body.byteLength,
      audioMimeType: 'audio/wav',
    });
    // The title is free text an operator typed; it can name a person and
    // nothing redacts it, so it stays in Meeting.title rather than the log.
    expect(JSON.stringify(entry.payload)).not.toContain(METADATA.title);
  });

  it('writes no audit entry when consent is refused', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, { ...METADATA, consentConfirmed: 'false' });

    expect(response.statusCode).toBe(422);
    expect(await prisma.auditEntry.count()).toBe(0);
  });

  it('answers 404 for an unknown meeting', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/meetings/does-not-exist',
      headers: { cookie: await sessionFor('MAKER') },
    });
    expect(response.statusCode).toBe(404);
  });
});
