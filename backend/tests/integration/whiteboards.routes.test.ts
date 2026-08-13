import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { verifyChain } from '../../src/audit/chain.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

beforeEach(async () => {
  // Capture work outlives its request; see meetings.routes.test.ts. A pipeline
  // still holding table locks deadlocks against resetDb's TRUNCATE.
  await app.backgroundJobs.drain();
  await resetDb();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function sessionFor(
  role: Role,
  oversight?: { canViewMeetings?: boolean; canViewAuditTrail?: boolean },
): Promise<string> {
  const email = `${role.toLowerCase()}@fintalk.test`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}`,
      role,
      canViewMeetings: oversight?.canViewMeetings ?? false,
      canViewAuditTrail: oversight?.canViewAuditTrail ?? false,
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
function multipart(file: { filename: string; contentType: string; body: Buffer }) {
  const boundary = '----FinTalkWhiteboardBoundary';
  const chunks = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; `
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

/** A meeting owned by the MAKER that sessionFor has already created. */
async function meetingForMaker(): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { role: 'MAKER' } });
  const meeting = await prisma.meeting.create({
    data: {
      title: 'Whiteboard meeting',
      occurredAt: new Date('2026-08-09T02:00:00Z'),
      consentConfirmed: true,
      transferAcknowledged: true,
      createdById: user.id,
    },
  });
  return meeting.id;
}

function upload(cookie: string, meetingId: string) {
  const { payload, headers } = multipart(IMAGE);
  return app.inject({
    method: 'POST',
    url: `/meetings/${meetingId}/whiteboards`,
    headers: { ...headers, cookie },
    payload,
  });
}

describe('POST /meetings/:id/whiteboards — access control', () => {
  it('refuses an unauthenticated upload', async () => {
    await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    const { payload, headers } = multipart(IMAGE);

    const response = await app.inject({
      method: 'POST',
      url: `/meetings/${meetingId}/whiteboards`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(await prisma.whiteboard.count()).toBe(0);
  });

  it('refuses an oversight account, who cannot create even with read access', async () => {
    await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await upload(
      await sessionFor('OVERSIGHT', { canViewMeetings: true }),
      meetingId,
    );
    expect(response.statusCode).toBe(403);
    expect(await prisma.whiteboard.count()).toBe(0);
  });
});

describe('POST /meetings/:id/whiteboards — the capture round trip', () => {
  /**
   * The anti-vacuity case. The fixture writes an NRIC on the board, so a pass
   * here means redaction actually ran rather than finding nothing to do.
   */
  it('stores the board with the identifier replaced, sealed and logged', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await upload(cookie, meetingId);
    expect(response.statusCode).toBe(201);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: { include: { vault: true } } },
    });

    expect(board.rawRedacted).toContain('[NRIC_1]');
    expect(board.rawRedacted).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(board.mermaid).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(JSON.stringify(board.structuredJson)).not.toMatch(/\d{6}-\d{2}-\d{4}/);

    expect(board.redactions.length).toBeGreaterThan(0);
    for (const redaction of board.redactions) {
      expect(redaction.transcriptId).toBeNull();
      expect(redaction.vault).not.toBeNull();
    }
  });

  /**
   * The vault must hold the original identifier, not the placeholder. A row that
   * round-trips to "[NRIC_1]" would satisfy every other assertion here while
   * having lost the data it exists to hold.
   */
  it('seals something other than the placeholder', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const nric = await prisma.redaction.findFirstOrThrow({
      where: { piiType: 'NRIC' },
      include: { vault: true },
    });

    expect(nric.vault).not.toBeNull();
    const asText = Buffer.from(nric.vault!.ciphertext).toString('utf8');
    expect(asText).not.toContain('880101');
    expect(asText).not.toContain('[NRIC_1]');
  });

  /**
   * Regression. The structured fields are redacted by serialising them,
   * replacing identifiers in the text, and reparsing. A numeric value carrying
   * an identifier used to have its digits replaced inside a JSON number
   * literal — {"settlementAccount":[ACCOUNT_1]} — which is not valid JSON, so
   * the reparse threw and the upload answered 500. The fixture now includes such
   * a number.
   */
  it('redacts a numeric identifier without producing invalid JSON', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await upload(cookie, meetingId);
    expect(response.statusCode).toBe(201);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: true },
    });

    const structured = JSON.stringify(board.structuredJson);
    expect(structured).not.toContain('1234567890');
    // The value survives as a redacted string rather than vanishing.
    expect(structured).toContain('settlementAccount');
    expect(board.redactions.some((r) => r.piiType === 'BANK_ACCOUNT')).toBe(true);
  });

  it('points every offset at the placeholder inside rawRedacted', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: true },
    });

    for (const redaction of board.redactions) {
      const slice = board.rawRedacted.slice(redaction.startOffset, redaction.endOffset);
      expect(slice).toBe(redaction.placeholder);
    }
  });

  it('gives one placeholder to an identifier written in both fields', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: true },
    });

    // The fixture puts the same NRIC in the diagram and in structured, so the
    // shared context must collapse them rather than number them separately.
    const placeholders = board.redactions.map((r) => r.placeholder);
    expect(placeholders).toContain('[NRIC_1]');
    expect(placeholders).not.toContain('[NRIC_2]');
  });

  it('audits the capture without the board text, leaving a valid chain', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'whiteboard.captured' },
    });

    expect(entry.actorRole).toBe('MAKER');
    const payload = JSON.stringify(entry.payload);
    expect(payload).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(payload).not.toContain('graph TD');
    expect(payload).not.toContain('[NRIC_1]');

    const verdict = await verifyChain(prisma);
    expect(verdict.ok).toBe(true);
    // Guards against a vacuous pass: verifyChain is trivially true on an
    // empty log.
    expect(verdict.length).toBeGreaterThan(0);
  });

  it('answers 404 for an unknown meeting', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, 'does-not-exist');
    expect(response.statusCode).toBe(404);
    expect(await prisma.whiteboard.count()).toBe(0);
  });

  it('rejects a request carrying no image', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await app.inject({
      method: 'POST',
      url: `/meetings/${meetingId}/whiteboards`,
      headers: { 'content-type': 'multipart/form-data; boundary=----Empty', cookie },
      payload: Buffer.from('------Empty--\r\n'),
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.whiteboard.count()).toBe(0);
  });
});

describe('GET /meetings/:id/whiteboards', () => {
  it('serves the boards back with no vault ciphertext', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const response = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}/whiteboards`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('[NRIC_1]');
    expect(response.body).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(response.body).not.toContain('ciphertext');
    expect(response.body).not.toContain('authTag');
    expect(response.body).not.toContain('vaultId');
  });

  it('returns an empty list for a meeting with no board', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}/whiteboards`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ whiteboards: unknown[] }>().whiteboards).toHaveLength(0);
  });
});
