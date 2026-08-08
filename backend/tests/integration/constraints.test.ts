import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb, seedMeeting, seedUser } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('TermSheet rate exclusivity (spec §5.3)', () => {
  it('accepts a conventional facility with an interest rate', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'SME Tech Solutions Sdn Bhd',
        principalMinor: 5_000_000n, // MYR 50,000.00
        tenureMonths: 60,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 800,
      },
    });
    expect(sheet.principalMinor).toBe(5_000_000n);
    expect(sheet.profitRateBps).toBeNull();
  });

  it('accepts an Islamic facility with a profit rate and a named contract', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'SME Tech Solutions Sdn Bhd',
        principalMinor: 5_000_000n,
        tenureMonths: 60,
        facilityKind: 'ISLAMIC',
        profitRateBps: 800,
        islamicContract: 'MURABAHAH',
      },
    });
    expect(sheet.islamicContract).toBe('MURABAHAH');
    expect(sheet.interestRateBps).toBeNull();
  });

  // This is the slide 6 / slide 7 contradiction, made impossible.
  it('rejects an Islamic facility carrying an interest rate', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'SME Tech Solutions Sdn Bhd',
        principalMinor: 5_000_000n,
        tenureMonths: 60,
        facilityKind: 'ISLAMIC',
        interestRateBps: 800,
        profitRateBps: 800,
        islamicContract: 'MURABAHAH',
      },
    })).rejects.toThrow(/term_sheet_rate_kind_exclusive/);
  });

  it('rejects an Islamic facility with no named contract', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 1_000_000n,
        tenureMonths: 12,
        facilityKind: 'ISLAMIC',
        profitRateBps: 500,
      },
    })).rejects.toThrow(/term_sheet_rate_kind_exclusive/);
  });

  it('rejects a zero principal', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 0n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    })).rejects.toThrow(/term_sheet_amounts_non_negative/);
  });
});

describe('Approval segregation of duties (spec §5.5)', () => {
  it('rejects a checker who is also the maker', async () => {
    const maker = await seedUser('MAKER');
    const meeting = await seedMeeting(maker.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 1_000_000n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    });
    await expect(prisma.approval.create({
      data: { termSheetId: sheet.id, makerId: maker.id, checkerId: maker.id },
    })).rejects.toThrow(/approval_checker_not_maker/);
  });

  it('accepts a distinct checker', async () => {
    const maker = await seedUser('MAKER');
    const checker = await seedUser('CHECKER');
    const meeting = await seedMeeting(maker.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 1_000_000n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    });
    const approval = await prisma.approval.create({
      data: { termSheetId: sheet.id, makerId: maker.id, checkerId: checker.id },
    });
    expect(approval.checkerId).toBe(checker.id);
  });
});

describe('ShariahFlag resolution attribution (spec §5.4)', () => {
  it('rejects a CLEARED flag with no reviewer recorded', async () => {
    const user = await seedUser('SHARIAH');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.shariahFlag.create({
      data: {
        meetingId: meeting.id,
        issueType: 'RIBA',
        excerpt: 'fixed interest rate of 8% per annum',
        detectedBy: 'rule:riba.interest-rate-mention',
        confidence: 0.9,
        reference: 'BNM SGP',
        status: 'CLEARED',
      },
    })).rejects.toThrow(/shariah_flag_resolution_attributed/);
  });

  it('rejects a confidence above 1', async () => {
    const user = await seedUser('SHARIAH');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.shariahFlag.create({
      data: {
        meetingId: meeting.id,
        issueType: 'RIBA',
        excerpt: 'x',
        detectedBy: 'llm',
        confidence: 1.5,
        reference: 'BNM SGP',
      },
    })).rejects.toThrow(/shariah_flag_confidence_range/);
  });
});

describe('AuditEntry is append-only (spec §5.6)', () => {
  async function insertEntry() {
    return prisma.auditEntry.create({
      data: {
        action: 'meeting.uploaded',
        entityType: 'Meeting',
        entityId: 'm1',
        payload: { note: 'synthetic' },
        prevHash: 'GENESIS',
        hash: `h-${Date.now()}-${Math.random()}`,
      },
    });
  }

  it('allows insert', async () => {
    const entry = await insertEntry();
    expect(entry.id).toBeGreaterThan(0n);
  });

  it('rejects update', async () => {
    const entry = await insertEntry();
    await expect(
      prisma.auditEntry.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects delete', async () => {
    const entry = await insertEntry();
    await expect(
      prisma.auditEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a duplicate hash', async () => {
    const hash = 'fixed-hash-value';
    await prisma.auditEntry.create({
      data: { action: 'a', entityType: 'T', entityId: '1', payload: {}, prevHash: 'GENESIS', hash },
    });
    await expect(prisma.auditEntry.create({
      data: { action: 'b', entityType: 'T', entityId: '2', payload: {}, prevHash: hash, hash },
    })).rejects.toThrow();
  });
});
