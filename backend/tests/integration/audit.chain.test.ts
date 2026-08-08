import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { appendAudit, GENESIS_HASH, verifyChain } from '../../src/audit/chain.js';
import { prisma, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

function entry(action: string, entityId: string) {
  return {
    at: new Date('2026-08-07T02:30:00.000Z'),
    actorId: 'user_1',
    actorRole: 'MAKER' as const,
    action,
    entityType: 'Meeting',
    entityId,
    payload: { note: 'synthetic' },
  };
}

describe('appendAudit', () => {
  it('anchors the first entry to the genesis hash', async () => {
    const first = await appendAudit(prisma, entry('meeting.uploaded', 'm_1'));
    expect(first.prevHash).toBe(GENESIS_HASH);
  });

  it('links each entry to the one before it', async () => {
    const first = await appendAudit(prisma, entry('meeting.uploaded', 'm_1'));
    const second = await appendAudit(prisma, entry('transcript.stored', 'm_1'));
    expect(second.prevHash).toBe(first.hash);
  });

  it('verifies a chain it built', async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendAudit(prisma, entry('meeting.read', `m_${String(i)}`));
    }
    expect(await verifyChain(prisma)).toEqual({ ok: true, length: 5 });
  });

  it('treats an empty log as valid', async () => {
    expect(await verifyChain(prisma)).toEqual({ ok: true, length: 0 });
  });

  /**
   * Two writers reading the same tail would produce two entries claiming the
   * same predecessor, forking the chain with no way to say which is real. The
   * advisory lock serialises appends; this fires ten at once to prove it.
   */
  it('stays a single chain under concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_unused, i) =>
        appendAudit(prisma, entry('meeting.read', `m_${String(i)}`)),
      ),
    );

    expect(await verifyChain(prisma)).toEqual({ ok: true, length: 10 });

    const rows = await prisma.auditEntry.findMany({ orderBy: { id: 'asc' } });
    expect(new Set(rows.map((r) => r.prevHash)).size).toBe(10);
  });
});

describe('verifyChain detects tampering the triggers cannot stop', () => {
  /**
   * The append-only triggers bind callers going through Postgres normally, and
   * someone with direct access can disable them — which is exactly what this
   * helper does, to prove the chain still catches the edit.
   */
  async function tamper(sql: string): Promise<void> {
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditEntry" DISABLE TRIGGER USER');
    try {
      await prisma.$executeRawUnsafe(sql);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditEntry" ENABLE TRIGGER USER');
    }
  }

  it('catches an altered action', async () => {
    await appendAudit(prisma, entry('meeting.uploaded', 'm_1'));
    const target = await appendAudit(prisma, entry('termsheet.approved', 'm_1'));
    await appendAudit(prisma, entry('meeting.read', 'm_1'));

    await tamper(
      `UPDATE "AuditEntry" SET action = 'termsheet.rejected' WHERE id = ${String(target.id)}`,
    );

    const verdict = await verifyChain(prisma);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.brokenAtId).toBe(target.id);
      expect(verdict.reason).toBe('hash-mismatch');
    }
  });

  it('catches a deleted entry as a broken link', async () => {
    await appendAudit(prisma, entry('meeting.uploaded', 'm_1'));
    const middle = await appendAudit(prisma, entry('termsheet.approved', 'm_1'));
    const last = await appendAudit(prisma, entry('meeting.read', 'm_1'));

    await tamper(`DELETE FROM "AuditEntry" WHERE id = ${String(middle.id)}`);

    const verdict = await verifyChain(prisma);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.brokenAtId).toBe(last.id);
      expect(verdict.reason).toBe('broken-link');
    }
  });

  it('catches a rewritten actor, so an action cannot be reassigned', async () => {
    const target = await appendAudit(prisma, entry('termsheet.approved', 'm_1'));

    await tamper(
      `UPDATE "AuditEntry" SET "actorId" = 'someone_else' WHERE id = ${String(target.id)}`,
    );

    const verdict = await verifyChain(prisma);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe('hash-mismatch');
  });

  it('still refuses an update through the normal path', async () => {
    const target = await appendAudit(prisma, entry('meeting.uploaded', 'm_1'));
    await expect(
      prisma.auditEntry.update({
        where: { id: target.id },
        data: { action: 'tampered' },
      }),
    ).rejects.toThrow(/append-only/);
  });
});
