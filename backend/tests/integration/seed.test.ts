import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../prisma/seed.js';
import { prisma, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('seedDatabase', () => {
  it('creates one user per role', async () => {
    await seedDatabase(prisma);
    const roles = (await prisma.user.findMany({ select: { role: true } })).map((u) => u.role).sort();
    expect(roles).toEqual(['ADMIN', 'CHECKER', 'MAKER', 'SHARIAH', 'SUPERVISOR', 'VIEWER']);
  });

  it('creates the demo SME loan meeting with a redacted transcript', async () => {
    await seedDatabase(prisma);
    const meeting = await prisma.meeting.findFirst({
      where: { title: { contains: 'SME' } },
      include: { transcript: { include: { segments: true, redactions: true } } },
    });
    expect(meeting?.status).toBe('READY');
    expect(meeting?.consentConfirmed).toBe(true);
    expect(meeting?.transcript?.segments.length).toBeGreaterThan(0);
    expect(meeting?.transcript?.redactions.length).toBeGreaterThan(0);
  });

  it('never stores an unmasked NRIC in the transcript', async () => {
    await seedDatabase(prisma);
    const t = await prisma.transcript.findFirst();
    expect(t?.rawRedacted).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(t?.rawRedacted).toContain('[NRIC_1]');
  });

  it('creates an open Shariah flag for the riba mention', async () => {
    await seedDatabase(prisma);
    const flag = await prisma.shariahFlag.findFirst({ where: { issueType: 'RIBA' } });
    expect(flag?.status).toBe('FLAGGED');
    expect(flag?.reviewedById).toBeNull();
  });

  it('is idempotent', async () => {
    await seedDatabase(prisma);
    await seedDatabase(prisma);
    expect(await prisma.user.count()).toBe(6);
    expect(await prisma.meeting.count()).toBe(1);
  });
});
