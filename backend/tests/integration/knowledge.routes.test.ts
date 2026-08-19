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

/** Mirrors whiteboards.routes.test.ts's helper — builds a multipart body with no form-data dependency. */
function multipart(
  file: { filename: string; contentType: string; body: Buffer },
  fields: Record<string, string> = {},
) {
  const boundary = '----FinTalkAskBoundary';
  const chunks = [
    ...Object.entries(fields).flatMap(([name, value]) => [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    ]),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; `
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

const IMAGE = {
  filename: 'board.png',
  contentType: 'image/png',
  body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
};

const UNSUPPORTED = {
  filename: 'archive.zip',
  contentType: 'application/zip',
  body: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
};

describe('POST /knowledge/ask — access control', () => {
  it('refuses an unauthenticated question', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      payload: { question: 'What was discussed?' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /knowledge/ask — plain JSON, no attachment', () => {
  it('answers unanswerable with no citations when the corpus is empty', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { cookie },
      payload: { question: 'What was discussed about pricing?' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ type: string; unanswerable: boolean; citations: unknown[] }>();
    expect(body.type).toBe('answer');
    expect(body.unanswerable).toBe(true);
    expect(body.citations).toHaveLength(0);
  });

  it('rejects a question under three characters', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { cookie },
      payload: { question: 'hi' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /knowledge/ask — the "start a capture" action', () => {
  /**
   * A quoted title wins over any other extraction — see intent.ts's QUOTED
   * pattern. Also proves the intent check runs before ask(): a corpus-search
   * question this short would otherwise 400 on AskBody's min(3), and this
   * one is well past that, so a 200 with `type: 'action'` and no assistant
   * prose is the only way to tell the short-circuit actually fired.
   */
  it('returns a start_capture action with the quoted title, not an answer', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { cookie },
      payload: { question: 'start a capture called "Credit Committee Review"' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ type: string; action?: string; title?: string }>();
    expect(body).toEqual({ type: 'action', action: 'start_capture', title: 'Credit Committee Review' });
  });

  /**
   * The trigger phrase sits mid-sentence here, not at the start — this is
   * exactly what the anchored regex in intent.ts is for. Unanchored, this
   * question contains "start a capture" verbatim and would misfire.
   */
  it('does not misfire on a genuine finance question that mentions the trigger phrase mid-sentence', async () => {
    const cookie = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { cookie },
      payload: {
        question: 'Our treasury team wants advice on how to start a capture strategy for FX gains — what have meetings said about that?',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ type: string }>();
    expect(body.type).toBe('answer');
  });
});

describe('POST /knowledge/ask — multipart with an attachment', () => {
  /**
   * Zero transcripts in the corpus would normally short-circuit to the
   * "nothing to search" message before any ranking runs. An attachment
   * must still ground a real answer in that case — the whole point of
   * assistant.ts's attachmentExcerpt bypass — and the fake provider's
   * answerFromContext only reports unanswerable when handed zero excerpts,
   * so a false `unanswerable` here proves the sentinel excerpt reached it.
   */
  it('answers from the attachment alone when the corpus is empty', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart(IMAGE, { question: 'What does this whiteboard show?' });

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ type: string; unanswerable: boolean; citations: unknown[] }>();
    expect(body.type).toBe('answer');
    expect(body.unanswerable).toBe(false);
    // The attachment's sentinel id is never a real meeting — it must never
    // surface as a citation a person could click through to.
    expect(body.citations).toHaveLength(0);
  });

  it('rejects an unsupported attachment type without ever calling the assistant', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart(UNSUPPORTED, { question: 'What does this file show?' });

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(415);
  });

  it('rejects a malformed history field', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart(IMAGE, {
      question: 'What does this whiteboard show?',
      history: 'not valid json',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/ask',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(400);
  });
});
