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

function inputFor(meetingId: string) {
  const { text, records } = redact(SPOKEN, KEY);
  return {
    meetingId,
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
    await storeTranscript(prisma, inputFor(meeting.id));

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
    const input = inputFor(meeting.id);
    await storeTranscript(prisma, input);

    expect(await prisma.redaction.count()).toBe(input.redactions.length);
    expect(await prisma.piiVault.count()).toBe(input.redactions.length);
  });

  it('stores no plaintext identifier in the vault', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting.id));

    for (const row of await prisma.piiVault.findMany()) {
      const asText = Buffer.from(row.ciphertext).toString('utf8');
      expect(asText).not.toContain('880101');
      expect(asText).not.toContain('4111');
    }
  });

  it('lets a holder of the key recover the original value', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting.id));

    const nric = await prisma.redaction.findFirstOrThrow({
      where: { piiType: 'NRIC' },
      include: { vault: true },
    });
    expect(nric.vault).not.toBeNull();
    expect(open(sealedFromRow(nric.vault!), KEY)).toBe('880101-14-5678');
  });

  it('links every redaction row to its own vault row', async () => {
    const meeting = await freshMeeting();
    await storeTranscript(prisma, inputFor(meeting.id));

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
    const input = inputFor(meeting.id);
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
  });
});
