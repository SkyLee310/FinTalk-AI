import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { redact } from '../../src/pdpa/redactor.js';
import { storeTranscript } from '../../src/pdpa/transcript-store.js';
import { open, sealedFromRow } from '../../src/pdpa/vault.js';
import { prisma, resetDb, seedMeeting, seedUser } from '../helpers/db.js';

const KEY = Buffer.alloc(32, 5);

// Synthetic, in the grouped form transcription actually produces.
const SPOKEN =
  'Director IC 880101-14-5678, account 1234 5678 90, card 4111 1111 1111 1111.';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

async function freshMeeting() {
  const user = await seedUser('MAKER');
  return seedMeeting(user.id);
}

function inputFor(meeting: { id: string; createdById: string }) {
  const { text, records } = redact(SPOKEN, KEY);
  return {
    meetingId: meeting.id,
    // Attributed to the maker who captured the meeting, as the route does.
    actor: { id: meeting.createdById, role: 'MAKER' as const },
    rawRedacted: text,
    summaryEn: text,
    languages: ['en', 'ms'],
    modelId: 'test-fixture',
    promptVersion: 'v1',
    segments: [
      { startMs: 0, endMs: 5_000, speakerLabel: 'Credit Officer', textRedacted: text },
    ],
    redactions: records,
  };
}

describe('storeTranscript', () => {
  it('persists text with every identifier replaced', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting));

    const stored = await prisma.transcript.findFirstOrThrow();
    expect(stored.rawRedacted).toContain('[NRIC_1]');
    expect(stored.rawRedacted).toContain('[BANK_ACCOUNT_1]');
    expect(stored.rawRedacted).toContain('[CARD_1]');
    expect(stored.rawRedacted).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(stored.rawRedacted).not.toContain('4111');
    expect(stored.rawRedacted).not.toContain('5678 90');
  });

  it('writes one vault row and one redaction row per occurrence', async () => {
    const meeting = await freshMeeting();
    const input = inputFor(meeting);
    await storeTranscript(prisma, input);

    expect(await prisma.redaction.count()).toBe(input.redactions.length);
    expect(await prisma.piiVault.count()).toBe(input.redactions.length);
  });

  it('stores no plaintext identifier in the vault', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting));

    for (const row of await prisma.piiVault.findMany()) {
      const asText = Buffer.from(row.ciphertext).toString('utf8');
      expect(asText).not.toContain('880101');
      expect(asText).not.toContain('4111');
    }
  });

  it('lets a holder of the key recover the original value', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting));

    const nric = await prisma.redaction.findFirstOrThrow({
      where: { piiType: 'NRIC' },
      include: { vault: true },
    });
    expect(nric.vault).not.toBeNull();
    expect(open(sealedFromRow(nric.vault!), KEY)).toBe('880101-14-5678');
  });

  it('links every redaction row to its own vault row', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting));

    const rows = await prisma.redaction.findMany();
    const vaultIds = rows.map((r) => r.vaultId);
    expect(vaultIds.every((id) => id !== null)).toBe(true);
    expect(new Set(vaultIds).size).toBe(vaultIds.length);
  });

  /**
   * A transcript stored beside a partial redaction log would claim its personal
   * data was accounted for when it was not. The DB confidence constraint is
   * used here as the injected fault.
   */
  it('rolls back the whole transcript when a redaction row is rejected', async () => {
    const meeting = await freshMeeting();
    const input = inputFor(meeting);
    const poisoned = {
      ...input,
      redactions: input.redactions.map((r, i) =>
        i === 0 ? { ...r, confidence: 1.5 } : r,
      ),
    };

    await expect(storeTranscript(prisma, poisoned))
      .rejects.toThrow(/redaction_confidence_range/);

    expect(await prisma.transcript.count()).toBe(0);
    expect(await prisma.transcriptSegment.count()).toBe(0);
    expect(await prisma.redaction.count()).toBe(0);
    expect(await prisma.piiVault.count()).toBe(0);
    // The audit entry is part of the same transaction, so it must roll back
    // too. An entry claiming a transcript that does not exist is a false record.
    expect(await prisma.auditEntry.count()).toBe(0);
  });

  /**
   * Spec §5.6 lists transcript.created among the audited actions. It was
   * missing: capture wrote no audit entry at all, so a deployment that had only
   * ever captured meetings reported an empty chain as valid.
   */
  it('audits transcript.created, attributed to the uploader', async () => {
    const meeting = await freshMeeting();
    const input = inputFor(meeting);
    await storeTranscript(prisma, input);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'transcript.created' },
    });
    expect(entry.actorId).toBe(meeting.createdById);
    expect(entry.actorRole).toBe('MAKER');
    expect(entry.payload).toMatchObject({
      meetingId: meeting.id,
      segmentCount: 1,
      redactionCount: input.redactions.length,
      modelId: 'test-fixture',
    });
  });

  /** The audit log is not a second place for personal data to accumulate. */
  it('keeps identifiers and transcript text out of the audit payload', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting));

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'transcript.created' },
    });
    const serialised = JSON.stringify(entry.payload);

    expect(serialised).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(serialised).not.toContain('4111');
    expect(serialised).not.toContain('1234 5678 90');
    // Not even the placeholder text: the redaction log owns the offsets.
    expect(serialised).not.toContain('[NRIC_1]');
    // The types found are recorded, which is what an auditor reconciles against.
    expect(entry.payload).toMatchObject({ redactionTypes: expect.arrayContaining(['NRIC']) });
  });
});
