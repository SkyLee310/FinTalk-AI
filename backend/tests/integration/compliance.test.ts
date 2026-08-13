import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { verifyChain } from '../../src/audit/chain.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { decideApproval } from '../../src/compliance/termsheet.js';
import { TO_BE_COMPLETED } from '../../src/export/pain001.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

const sessions = new Map<Role, string>();
const userIds = new Map<Role, string>();

beforeEach(async () => {
  // Capture work outlives its request; see meetings.routes.test.ts. A pipeline
  // still holding table locks deadlocks against resetDb's TRUNCATE.
  await app.backgroundJobs.drain();
  await resetDb();
  sessions.clear();
  userIds.clear();

  for (const role of ['MAKER', 'CHECKER', 'SHARIAH', 'ADMIN', 'OVERSIGHT'] as const) {
    const email = `${role.toLowerCase()}@fintalk.test`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        displayName: `Demo ${role}`,
        role,
        ...(role === 'OVERSIGHT' ? { canViewMeetings: true, canViewAuditTrail: true } : {}),
      },
    });
    userIds.set(role, user.id);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: PASSWORD },
    });
    const cookies = (login as unknown as { cookies: { name: string; value: string }[] }).cookies;
    sessions.set(
      role,
      `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`,
    );
  }
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function as(role: Role): string {
  return sessions.get(role)!;
}

/** Uploads the fake fixture, which mentions an interest rate and Murabahah. */
async function capturedMeeting(): Promise<string> {
  const boundary = '----FinTalkComplianceBoundary';
  const fields: Record<string, string> = {
    title: 'SME Loan Approval Meeting',
    occurredAt: '2026-08-07T02:30:00.000Z',
    consentConfirmed: 'true',
    transferAcknowledged: 'true',
  };

  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; `
      + 'filename="m.wav"\r\nContent-Type: audio/wav\r\n\r\n',
    ),
    Buffer.from([1, 2, 3, 4]),
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`),
  );

  const response = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: as('MAKER'),
    },
    payload: Buffer.concat(chunks),
  });

  // 202: the pipeline runs in the background, so wait for it to settle before
  // asserting on the findings it produces.
  expect(response.statusCode).toBe(202);
  const { meetingId } = response.json<{ meetingId: string }>();

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const meeting = await prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { status: true },
    });
    if (meeting.status === 'READY') return meetingId;
    if (meeting.status === 'FAILED') throw new Error('capture failed during setup');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('capture never settled');
}

function draft(meetingId: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/meetings/${meetingId}/term-sheets`,
    headers: { cookie: as('MAKER') },
    payload: {
      applicantName: 'Tech Solutions Sdn Bhd',
      principalMinor: '5000000',
      tenureMonths: 60,
      facilityKind: 'ISLAMIC',
      profitRateBps: 800,
      islamicContract: 'MURABAHAH',
      ...overrides,
    },
  });
}

function review(flagId: string, status: string, note: string, role: Role = 'SHARIAH') {
  return app.inject({
    method: 'POST',
    url: `/shariah-flags/${flagId}/review`,
    headers: { cookie: as(role) },
    payload: { status, note },
  });
}

async function flagIds(meetingId: string): Promise<string[]> {
  const flags = await prisma.shariahFlag.findMany({ where: { meetingId } });
  return flags.map((f) => f.id);
}

async function clearAllFlags(meetingId: string): Promise<void> {
  for (const id of await flagIds(meetingId)) {
    await review(id, 'CLEARED', 'Restructured as a Murabahah profit rate.');
  }
}

describe('the pipeline raises Shariah findings', () => {
  it('flags the riba mention in the captured transcript', async () => {
    const meetingId = await capturedMeeting();
    const flags = await prisma.shariahFlag.findMany({ where: { meetingId } });

    expect(flags.length).toBeGreaterThan(0);
    expect(flags.map((f) => f.issueType)).toContain('RIBA');
    expect(flags.every((f) => f.status === 'FLAGGED')).toBe(true);
    expect(flags.every((f) => f.reviewedById === null)).toBe(true);
  });

  it('puts no identifier in any excerpt', async () => {
    const meetingId = await capturedMeeting();
    for (const flag of await prisma.shariahFlag.findMany({ where: { meetingId } })) {
      expect(flag.excerpt).not.toMatch(/\d{6}-\d{2}-\d{4}/);
      expect(flag.excerpt).not.toContain('4111');
    }
  });
});

describe('only a Shariah reviewer may resolve a finding', () => {
  it('refuses an administrator', async () => {
    const meetingId = await capturedMeeting();
    const [flagId] = await flagIds(meetingId);
    expect((await review(flagId!, 'CLEARED', 'Reviewed.', 'ADMIN')).statusCode).toBe(403);
  });

  it('refuses the maker', async () => {
    const meetingId = await capturedMeeting();
    const [flagId] = await flagIds(meetingId);
    expect((await review(flagId!, 'CLEARED', 'Reviewed.', 'MAKER')).statusCode).toBe(403);
  });

  it('accepts a Shariah reviewer and records attribution', async () => {
    const meetingId = await capturedMeeting();
    const [flagId] = await flagIds(meetingId);

    const response = await review(flagId!, 'CLEARED', 'Restructured as Murabahah.');
    expect(response.statusCode).toBe(200);

    const body = response.json<{ status: string; reviewedById: string; reviewedAt: string }>();
    expect(body.status).toBe('CLEARED');
    expect(body.reviewedById).toBe(userIds.get('SHARIAH'));
    expect(body.reviewedAt).toBeTruthy();
  });

  it('refuses a clearance with no reasoning', async () => {
    const meetingId = await capturedMeeting();
    const [flagId] = await flagIds(meetingId);
    expect((await review(flagId!, 'CLEARED', '   ')).statusCode).toBe(422);
  });

  it('refuses a note containing personal data', async () => {
    const meetingId = await capturedMeeting();
    const [flagId] = await flagIds(meetingId);

    const response = await review(flagId!, 'CLEARED', 'Confirmed with director 880101-14-5678.');
    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(/must not contain personal data/);
  });

  it('refuses to re-resolve a finding already resolved', async () => {
    const meetingId = await capturedMeeting();
    const [flagId] = await flagIds(meetingId);

    expect((await review(flagId!, 'CLEARED', 'Cleared.')).statusCode).toBe(200);
    expect((await review(flagId!, 'CONFIRMED_VIOLATION', 'Changed my mind.')).statusCode)
      .toBe(409);
  });
});

describe('the approval gate', () => {
  it('refuses to submit while a finding is unresolved', async () => {
    const meetingId = await capturedMeeting();
    const sheet = await draft(meetingId);
    expect(sheet.statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST',
      url: `/term-sheets/${sheet.json<{ id: string }>().id}/submit`,
      headers: { cookie: as('MAKER') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toMatch(/not cleared/);
  });

  /**
   * A confirmed violation is not "reviewed and therefore fine". The facility has
   * to be restructured, so it blocks permanently.
   */
  it('still refuses after a finding is confirmed as a violation', async () => {
    const meetingId = await capturedMeeting();
    const ids = await flagIds(meetingId);
    for (const id of ids) {
      await review(id, id === ids[0] ? 'CONFIRMED_VIOLATION' : 'CLEARED', 'Reviewed.');
    }

    const sheet = await draft(meetingId);
    const response = await app.inject({
      method: 'POST',
      url: `/term-sheets/${sheet.json<{ id: string }>().id}/submit`,
      headers: { cookie: as('MAKER') },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toMatch(/CONFIRMED_VIOLATION/);
  });

  it('allows submission once every finding is cleared', async () => {
    const meetingId = await capturedMeeting();
    await clearAllFlags(meetingId);

    const sheet = await draft(meetingId);
    const response = await app.inject({
      method: 'POST',
      url: `/term-sheets/${sheet.json<{ id: string }>().id}/submit`,
      headers: { cookie: as('MAKER') },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ decision: string }>().decision).toBe('PENDING_CHECKER');
  });
});

describe('term sheet validation', () => {
  it('refuses an Islamic facility carrying an interest rate', async () => {
    const meetingId = await capturedMeeting();
    const response = await draft(meetingId, {
      interestRateBps: 800,
      profitRateBps: null,
      islamicContract: 'MURABAHAH',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(/cannot carry an interest rate/);
  });

  it('keeps money exact across the wire as a string', async () => {
    const meetingId = await capturedMeeting();
    const response = await draft(meetingId, { principalMinor: '9007199254740993' });

    const body = response.json<{ principalMinor: string; principalFormatted: string }>();
    expect(body.principalMinor).toBe('9007199254740993');
    expect(body.principalFormatted).toBe('90071992547409.93');
  });

  it('refuses an oversight account, even with full read access', async () => {
    const meetingId = await capturedMeeting();
    const response = await app.inject({
      method: 'POST',
      url: `/meetings/${meetingId}/term-sheets`,
      headers: { cookie: as('OVERSIGHT') },
      payload: {
        applicantName: 'X',
        principalMinor: '1',
        tenureMonths: 1,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 1,
      },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('maker–checker segregation', () => {
  async function submitted(): Promise<{ termSheetId: string; approvalId: string }> {
    const meetingId = await capturedMeeting();
    await clearAllFlags(meetingId);

    const sheet = await draft(meetingId);
    const termSheetId = sheet.json<{ id: string }>().id;

    const response = await app.inject({
      method: 'POST',
      url: `/term-sheets/${termSheetId}/submit`,
      headers: { cookie: as('MAKER') },
    });

    return { termSheetId, approvalId: response.json<{ approvalId: string }>().approvalId };
  }

  it('refuses a maker attempting to approve', async () => {
    const { approvalId } = await submitted();
    const response = await app.inject({
      method: 'POST',
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: as('MAKER') },
      payload: { decision: 'APPROVED', note: 'Looks fine.' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('lets a checker approve', async () => {
    const { approvalId } = await submitted();
    const response = await app.inject({
      method: 'POST',
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: as('CHECKER') },
      payload: { decision: 'APPROVED', note: 'Terms verified.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ decision: string }>().decision).toBe('APPROVED');
  });

  it('refuses to decide the same approval twice', async () => {
    const { approvalId } = await submitted();
    const decide = () =>
      app.inject({
        method: 'POST',
        url: `/approvals/${approvalId}/decide`,
        headers: { cookie: as('CHECKER') },
        payload: { decision: 'APPROVED', note: 'Terms verified.' },
      });

    expect((await decide()).statusCode).toBe(200);
    expect((await decide()).statusCode).toBe(409);
  });

  /**
   * The role split already makes this unreachable over HTTP, since submitting
   * needs MAKER and deciding needs CHECKER. The service check is defence for a
   * deployment that ever grants one person both.
   */
  it('refuses at the service layer when the checker is the maker', async () => {
    const { approvalId } = await submitted();
    const checkerId = userIds.get('CHECKER')!;

    await prisma.approval.update({ where: { id: approvalId }, data: { makerId: checkerId } });

    await expect(
      decideApproval(prisma, { id: checkerId, role: 'CHECKER' }, approvalId, 'APPROVED', 'ok'),
    ).rejects.toThrow(/checker cannot be the maker/);
  });

  it('refuses a rejection with no reason', async () => {
    const { approvalId } = await submitted();
    const response = await app.inject({
      method: 'POST',
      url: `/approvals/${approvalId}/decide`,
      headers: { cookie: as('CHECKER') },
      payload: { decision: 'REJECTED', note: '  ' },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('payment payload', () => {
  async function approve(): Promise<string> {
    const meetingId = await capturedMeeting();
    await clearAllFlags(meetingId);

    const sheet = await draft(meetingId);
    const termSheetId = sheet.json<{ id: string }>().id;

    const response = await app.inject({
      method: 'POST',
      url: `/term-sheets/${termSheetId}/submit`,
      headers: { cookie: as('MAKER') },
    });

    await app.inject({
      method: 'POST',
      url: `/approvals/${response.json<{ approvalId: string }>().approvalId}/decide`,
      headers: { cookie: as('CHECKER') },
      payload: { decision: 'APPROVED', note: 'Verified.' },
    });

    return termSheetId;
  }

  it('refuses a payload for a term sheet that is not approved', async () => {
    const meetingId = await capturedMeeting();
    const sheet = await draft(meetingId);
    const response = await app.inject({
      method: 'GET',
      url: `/term-sheets/${sheet.json<{ id: string }>().id}/payment-payload`,
      headers: { cookie: as('CHECKER') },
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses the maker who drafted it — the payload belongs to the checker who approves and settles', async () => {
    const termSheetId = await approve();
    const response = await app.inject({
      method: 'GET',
      url: `/term-sheets/${termSheetId}/payment-payload`,
      headers: { cookie: as('MAKER') },
    });
    expect(response.statusCode).toBe(403);
  });

  it('produces a CSV handoff for an approved facility', async () => {
    const termSheetId = await approve();
    const response = await app.inject({
      method: 'GET',
      url: `/term-sheets/${termSheetId}/payment-payload`,
      headers: { cookie: as('CHECKER') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).toContain('end_to_end_id');
    expect(response.body).toContain('"MYR"');
    expect(response.body).toContain('"50000.00"');
  });

  /**
   * The endpoint used to answer XML by default and CSV on ?format=csv. The XML
   * was an ISO 20022 pain.001 payment instruction, which is the wrong artifact
   * for a credit decision and actively misleading for a Murabahah facility — see
   * the note in src/export/pain001.ts. Nothing should serve XML now, whatever the
   * caller asks for.
   */
  it('answers CSV even when a caller still asks for the old XML format', async () => {
    const termSheetId = await approve();
    const response = await app.inject({
      method: 'GET',
      url: `/term-sheets/${termSheetId}/payment-payload?format=xml`,
      headers: { cookie: as('CHECKER') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.body).not.toContain('pain.001');
    expect(response.body).not.toContain('<?xml');
  });

  it('carries no account number, only a marker for the maker', async () => {
    const termSheetId = await approve();
    const response = await app.inject({
      method: 'GET',
      url: `/term-sheets/${termSheetId}/payment-payload`,
      headers: { cookie: as('CHECKER') },
    });

    expect(response.body).toContain(TO_BE_COMPLETED);
    expect(response.body).not.toMatch(/\b\d{10,16}\b/);
  });

  it('records the download in the audit log', async () => {
    const termSheetId = await approve();
    await app.inject({
      method: 'GET',
      url: `/term-sheets/${termSheetId}/payment-payload`,
      headers: { cookie: as('CHECKER') },
    });

    const entry = await prisma.auditEntry.findFirst({
      where: { action: 'termsheet.payload.downloaded' },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(userIds.get('CHECKER'));
  });
});

describe('the audit log records the whole flow', () => {
  it('stays a verifiable chain across every compliance action', async () => {
    const meetingId = await capturedMeeting();
    await clearAllFlags(meetingId);

    const sheet = await draft(meetingId);
    const response = await app.inject({
      method: 'POST',
      url: `/term-sheets/${sheet.json<{ id: string }>().id}/submit`,
      headers: { cookie: as('MAKER') },
    });
    await app.inject({
      method: 'POST',
      url: `/approvals/${response.json<{ approvalId: string }>().approvalId}/decide`,
      headers: { cookie: as('CHECKER') },
      payload: { decision: 'APPROVED', note: 'Verified.' },
    });

    expect((await verifyChain(prisma)).ok).toBe(true);

    const actions = (await prisma.auditEntry.findMany({ orderBy: { id: 'asc' } }))
      .map((e) => e.action);
    expect(actions).toContain('shariah.flag.cleared');
    expect(actions).toContain('termsheet.drafted');
    expect(actions).toContain('termsheet.submitted');
    expect(actions).toContain('termsheet.approved');
  });

  it('reports chain integrity to an oversight account with canViewAuditTrail', async () => {
    await capturedMeeting();
    const response = await app.inject({
      method: 'GET',
      url: '/audit',
      headers: { cookie: as('OVERSIGHT') },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ integrity: { ok: boolean } }>().integrity.ok).toBe(true);
  });

  /**
   * The separation-of-duties property this session's role redesign turns on:
   * an administrator manages permissions, so an administrator must not also
   * be able to read the trail meant to catch abuse of them.
   */
  it('refuses the audit log to an administrator', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/audit',
      headers: { cookie: as('ADMIN') },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses the audit log to a maker', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/audit',
      headers: { cookie: as('MAKER') },
    });
    expect(response.statusCode).toBe(403);
  });
});
