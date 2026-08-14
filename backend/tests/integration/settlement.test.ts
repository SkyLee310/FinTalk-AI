import { type Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

/**
 * Simulated settlement.
 *
 * The state gates are the substance here. A settlement recorded against a draft
 * or a rejected facility would assert that money moved on a decision nobody made,
 * and that is the worst thing a payments surface can do — mock or otherwise.
 *
 * The last three cases go straight to the database, because the CHECK constraints
 * are the line a future engineer cannot talk their way past.
 */

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

async function userWithSession(
  role: Role,
  suffix = '',
  oversight?: { canViewMeetings?: boolean; canViewAuditTrail?: boolean },
): Promise<{
  id: string;
  cookie: string;
}> {
  const email = `${role.toLowerCase()}${suffix}@fintalk.test`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}${suffix}`,
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
  return {
    id: user.id,
    cookie: `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`,
  };
}

/**
 * Builds a term sheet directly and puts it in the requested state.
 *
 * Deliberately not via the capture pipeline: this file is about the settlement
 * gates, and transcribing for each case would make it slow and couple it to
 * whatever the Shariah engine happens to find.
 */
async function facility(
  status: 'DRAFT' | 'APPROVED' | 'REJECTED',
  principalMinor = 50_000_00n,
): Promise<{
  termSheetId: string;
  checkerId: string;
  checkerCookie: string;
}> {
  const maker = await userWithSession('MAKER');
  const checker = await userWithSession('CHECKER');

  const meeting = await prisma.meeting.create({
    data: {
      title: 'SME facility',
      occurredAt: new Date('2026-08-09T02:00:00Z'),
      consentConfirmed: true,
      transferAcknowledged: true,
      createdById: maker.id,
    },
  });

  const sheet = await prisma.termSheet.create({
    data: {
      meetingId: meeting.id,
      applicantName: 'Demo Sdn Bhd',
      currency: 'MYR',
      principalMinor,
      tenureMonths: 60,
      facilityKind: 'ISLAMIC',
      profitRateBps: 800,
      islamicContract: 'MURABAHAH',
      status,
    },
  });

  if (status !== 'DRAFT') {
    await prisma.approval.create({
      data: {
        termSheetId: sheet.id,
        makerId: maker.id,
        checkerId: checker.id,
        decidedAt: new Date(),
        decision: status,
      },
    });
  }

  return {
    termSheetId: sheet.id,
    checkerId: checker.id,
    checkerCookie: checker.cookie,
  };
}

function settle(cookie: string, termSheetId: string, rail = 'DUITNOW') {
  return app.inject({
    method: 'POST',
    url: `/term-sheets/${termSheetId}/settle`,
    headers: { cookie },
    payload: { rail },
  });
}

describe('POST /term-sheets/:id/settle', () => {
  it('records a simulated settlement for an approved facility', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED');

    const response = await settle(checkerCookie, termSheetId);
    expect(response.statusCode).toBe(201);

    const body = response.json<{
      mockReference: string;
      amountMinor: string;
      simulated: boolean;
      rail: string;
    }>();

    // The reference must be unmistakable in a screenshot or an email.
    expect(body.mockReference).toMatch(/^MOCK-DUITNOW-/);
    expect(body.simulated).toBe(true);
    // A string on the wire: a JSON number silently drops cents above 2^53.
    expect(body.amountMinor).toBe('5000000');
    expect(typeof body.amountMinor).toBe('string');

    const stored = await prisma.settlement.findUniqueOrThrow({ where: { termSheetId } });
    // Copied from the approved sheet, never supplied by the caller.
    expect(stored.amountMinor).toBe(50_000_00n);
    expect(stored.simulated).toBe(true);
  });

  it('audits it as a mock, never as a real settlement', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED');
    await settle(checkerCookie, termSheetId);

    const mock = await prisma.auditEntry.findFirst({
      where: { action: 'payment.settled.mock' },
    });
    expect(mock).not.toBeNull();
    expect(mock?.actorRole).toBe('CHECKER');
    expect(mock?.payload).toMatchObject({ simulated: true, rail: 'DUITNOW' });

    // A future real action must not inherit a simulated one's history.
    const real = await prisma.auditEntry.findFirst({
      where: { action: 'payment.settled' },
    });
    expect(real).toBeNull();
  });

  it('refuses a facility that is still a draft', async () => {
    const { termSheetId, checkerCookie } = await facility('DRAFT');

    const response = await settle(checkerCookie, termSheetId);
    expect(response.statusCode).toBe(409);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('refuses a rejected facility', async () => {
    const { termSheetId, checkerCookie } = await facility('REJECTED');

    const response = await settle(checkerCookie, termSheetId);
    expect(response.statusCode).toBe(409);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('refuses a second settlement of the same facility', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED');

    expect((await settle(checkerCookie, termSheetId)).statusCode).toBe(201);
    const second = await settle(checkerCookie, termSheetId, 'RENTAS');

    expect(second.statusCode).toBe(409);
    expect(await prisma.settlement.count()).toBe(1);
  });

  /**
   * DuitNow Business and RENTAS each have a real per-transaction limit, not a
   * shared size cutoff — see mock-settlement.ts. RM50,000 (the default
   * facility) satisfies both, so these cases deliberately push outside one
   * rail's range to prove the other is required.
   */
  it('refuses DuitNow Business above its RM10,000,000 ceiling', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED', 15_000_000_00n);

    const response = await settle(checkerCookie, termSheetId, 'DUITNOW');
    expect(response.statusCode).toBe(400);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('refuses RENTAS below its RM10,000 floor', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED', 5_000_00n);

    const response = await settle(checkerCookie, termSheetId, 'RENTAS');
    expect(response.statusCode).toBe(400);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('accepts RENTAS for a facility above the DuitNow Business ceiling', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED', 15_000_000_00n);

    const response = await settle(checkerCookie, termSheetId, 'RENTAS');
    expect(response.statusCode).toBe(201);
  });

  /**
   * Four-eyes, one step later. A second checker settling another's approval would
   * mean the person releasing the money never read the decision.
   */
  it('refuses a checker who did not approve this facility', async () => {
    const { termSheetId } = await facility('APPROVED');
    const other = await userWithSession('CHECKER', '2');

    const response = await settle(other.cookie, termSheetId);
    expect(response.statusCode).toBe(403);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('refuses every role that does not hold payment:settle', async () => {
    const { termSheetId } = await facility('APPROVED');

    for (const role of ['MAKER', 'SHARIAH', 'ADMIN', 'OVERSIGHT'] as const) {
      const actor = await userWithSession(
        role,
        '-x',
        role === 'OVERSIGHT' ? { canViewMeetings: true, canViewAuditTrail: true } : undefined,
      );
      const response = await settle(actor.cookie, termSheetId);
      // ADMIN especially: it governs access and reads the record, and must never
      // be able to move money. Same for OVERSIGHT even with every read flag on.
      expect(response.statusCode).toBe(403);
    }

    expect(await prisma.settlement.count()).toBe(0);
  });

  it('rejects an unknown rail at the schema', async () => {
    const { termSheetId, checkerCookie } = await facility('APPROVED');

    const response = await settle(checkerCookie, termSheetId, 'SWIFT');
    expect(response.statusCode).toBe(400);
  });

  it('answers 404 for a term sheet that does not exist', async () => {
    const checker = await userWithSession('CHECKER');
    const response = await settle(checker.cookie, 'does-not-exist');
    expect(response.statusCode).toBe(404);
  });
});

describe('Settlement constraints', () => {
  it('refuses a row claiming not to be simulated', async () => {
    const { termSheetId, checkerId } = await facility('APPROVED');

    await expect(
      prisma.settlement.create({
        data: {
          termSheetId,
          rail: 'DUITNOW',
          mockReference: 'MOCK-DUITNOW-DIRECT1',
          amountMinor: 1_000n,
          currency: 'MYR',
          settledById: checkerId,
          simulated: false,
        },
      }),
    ).rejects.toThrow(/settlement_is_simulated/);
  });

  it('refuses a reference that could pass for a real one', async () => {
    const { termSheetId, checkerId } = await facility('APPROVED');

    await expect(
      prisma.settlement.create({
        data: {
          termSheetId,
          rail: 'DUITNOW',
          // No MOCK- prefix: exactly what the constraint exists to stop.
          mockReference: 'DN20260810123456',
          amountMinor: 1_000n,
          currency: 'MYR',
          settledById: checkerId,
        },
      }),
    ).rejects.toThrow(/settlement_reference_is_marked_mock/);
  });

  it('refuses a zero amount', async () => {
    const { termSheetId, checkerId } = await facility('APPROVED');

    await expect(
      prisma.settlement.create({
        data: {
          termSheetId,
          rail: 'FPX',
          mockReference: 'MOCK-FPX-ZERO1',
          amountMinor: 0n,
          currency: 'MYR',
          settledById: checkerId,
        },
      }),
    ).rejects.toThrow(/settlement_amount_positive/);
  });

  it('refuses a DuitNow Business row above its ceiling at the database', async () => {
    const { termSheetId, checkerId } = await facility('APPROVED', 15_000_000_00n);

    await expect(
      prisma.settlement.create({
        data: {
          termSheetId,
          rail: 'DUITNOW',
          mockReference: 'MOCK-DUITNOW-OVERCEIL1',
          amountMinor: 15_000_000_00n,
          currency: 'MYR',
          settledById: checkerId,
        },
      }),
    ).rejects.toThrow(/settlement_duitnow_business_ceiling/);
  });

  it('refuses a RENTAS row below its floor at the database', async () => {
    const { termSheetId, checkerId } = await facility('APPROVED', 5_000_00n);

    await expect(
      prisma.settlement.create({
        data: {
          termSheetId,
          rail: 'RENTAS',
          mockReference: 'MOCK-RENTAS-UNDERFLOOR1',
          amountMinor: 5_000_00n,
          currency: 'MYR',
          settledById: checkerId,
        },
      }),
    ).rejects.toThrow(/settlement_rentas_floor/);
  });
});
