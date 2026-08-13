import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../prisma/seed.js';
import { prisma, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('seedDatabase', () => {
  it('creates one user per role', async () => {
    await seedDatabase(prisma);
    const roles = (await prisma.user.findMany({ select: { role: true } })).map((u) => u.role).sort();
    expect(roles).toEqual(['ADMIN', 'CHECKER', 'MAKER', 'OVERSIGHT', 'SHARIAH']);
  });

  it('grants the demo OVERSIGHT account both flags', async () => {
    await seedDatabase(prisma);
    const oversight = await prisma.user.findFirstOrThrow({ where: { role: 'OVERSIGHT' } });
    expect(oversight.canViewMeetings).toBe(true);
    expect(oversight.canViewAuditTrail).toBe(true);
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
    expect(await prisma.user.count()).toBe(5);
    expect(await prisma.meeting.count()).toBe(2);
  });

  describe('the Zenith Heights project-kickoff meeting', () => {
    it('creates decisions, action items and a project-kickoff draft', async () => {
      await seedDatabase(prisma);
      const meeting = await prisma.meeting.findFirst({
        where: { title: { contains: 'Zenith Heights' } },
        include: { transcript: true, decisions: true, actionItems: true },
      });
      expect(meeting?.status).toBe('READY');
      expect(meeting?.decisions.length).toBe(2);
      expect(meeting?.actionItems.length).toBe(3);
      expect(meeting?.transcript?.projectKickoffRedacted).toContain('Murabahah');
      expect(meeting?.transcript?.followUpsRedacted.length).toBeGreaterThan(0);
    });

    it('flags at least three distinct Shariah issue types, all open', async () => {
      await seedDatabase(prisma);
      const meeting = await prisma.meeting.findFirstOrThrow({
        where: { title: { contains: 'Zenith Heights' } },
      });
      const flags = await prisma.shariahFlag.findMany({ where: { meetingId: meeting.id } });
      const issueTypes = new Set(flags.map((f) => f.issueType));
      expect(issueTypes.size).toBeGreaterThanOrEqual(3);
      expect(flags.every((f) => f.status === 'FLAGGED')).toBe(true);
    });

    it('records a whiteboard capture with a redacted structured extraction', async () => {
      await seedDatabase(prisma);
      const meeting = await prisma.meeting.findFirstOrThrow({
        where: { title: { contains: 'Zenith Heights' } },
      });
      const boards = await prisma.whiteboard.findMany({
        where: { meetingId: meeting.id },
        include: { redactions: true },
      });
      expect(boards.length).toBe(1);
      expect(boards[0]?.redactions.length).toBeGreaterThan(0);
      expect(boards[0]?.mermaid).toContain('graph');
      // Never an unmasked NRIC shape, in either the diagram or the structured JSON.
      expect(boards[0]?.mermaid).not.toMatch(/\d{6}-\d{2}-\d{4}/);
      expect(JSON.stringify(boards[0]?.structuredJson)).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    });

    it('redacts four distinct PII types in the transcript', async () => {
      await seedDatabase(prisma);
      const meeting = await prisma.meeting.findFirstOrThrow({
        where: { title: { contains: 'Zenith Heights' } },
        include: { transcript: { include: { redactions: true } } },
      });
      const piiTypes = new Set(meeting.transcript?.redactions.map((r) => r.piiType));
      expect(piiTypes).toEqual(new Set(['NRIC', 'BANK_ACCOUNT', 'EMAIL', 'PHONE']));
    });
  });
});
