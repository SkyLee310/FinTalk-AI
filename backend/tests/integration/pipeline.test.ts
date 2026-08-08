import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import {
  type AudioInput,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '../../src/ai/provider.js';
import { PipelineError, processMeeting } from '../../src/pipeline/process-meeting.js';
import { prisma, resetDb, seedMeeting, seedUser } from '../helpers/db.js';

const VAULT_KEY = Buffer.alloc(32, 11);
const AUDIO: AudioInput = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'audio/wav' };

const deps = {
  prisma,
  provider: new FakeTranscriptionProvider(),
  vaultKey: VAULT_KEY,
};

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

async function freshMeeting() {
  const user = await seedUser('MAKER');
  return seedMeeting(user.id);
}

describe('processMeeting — success path', () => {
  it('stores every segment and marks the meeting ready', async () => {
    const meeting = await freshMeeting();
    const result = await processMeeting(deps, meeting.id, AUDIO);

    expect(result.segmentCount).toBe(6);
    expect(result.redactionCount).toBeGreaterThan(3);

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(stored.status).toBe('READY');
    expect(stored.failureReason).toBeNull();
  });

  it('leaves no identifier from the fixture anywhere in stored text', async () => {
    const meeting = await freshMeeting();
    await processMeeting(deps, meeting.id, AUDIO);

    const transcript = await prisma.transcript.findFirstOrThrow({
      include: { segments: true },
    });
    const everything = [
      transcript.rawRedacted,
      transcript.summaryEn,
      ...transcript.segments.map((s) => s.textRedacted),
    ].join('\n');

    expect(everything).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(everything).not.toContain('4111');
    expect(everything).not.toContain('1234 5678 90');
    expect(everything).toContain('[NRIC_1]');
    expect(everything).toContain('[CARD_1]');
  });

  /**
   * The director speaks in two segments. Redacting each segment with its own
   * numbering would restart at [NRIC_1] every time, so a second person could
   * also be labelled [NRIC_1]. One shared context is what prevents that.
   */
  it('gives one person one placeholder across the whole transcript', async () => {
    const meeting = await freshMeeting();
    await processMeeting(deps, meeting.id, AUDIO);

    const nricRows = await prisma.redaction.findMany({ where: { piiType: 'NRIC' } });
    expect(nricRows).toHaveLength(2);
    expect(new Set(nricRows.map((r) => r.placeholder))).toEqual(new Set(['[NRIC_1]']));

    const transcript = await prisma.transcript.findFirstOrThrow();
    expect(transcript.rawRedacted).not.toContain('[NRIC_2]');
  });

  /**
   * Offsets are recorded against the joined document, not the segment they came
   * from. If the rebasing is wrong they point into the middle of some other
   * sentence, and the redaction log stops being usable evidence.
   */
  it('records offsets that resolve to the placeholder in the joined text', async () => {
    const meeting = await freshMeeting();
    await processMeeting(deps, meeting.id, AUDIO);

    const transcript = await prisma.transcript.findFirstOrThrow({
      include: { redactions: true },
    });
    expect(transcript.redactions.length).toBeGreaterThan(3);

    for (const row of transcript.redactions) {
      expect(
        transcript.rawRedacted.slice(row.startOffset, row.endOffset),
        `offset for ${row.placeholder}`,
      ).toBe(row.placeholder);
    }
  });

  it('re-redacts the summary rather than trusting the summariser', async () => {
    const meeting = await freshMeeting();
    await processMeeting(deps, meeting.id, AUDIO);

    const transcript = await prisma.transcript.findFirstOrThrow();
    expect(transcript.summaryEn).toContain('[NRIC_1]');
    expect(transcript.summaryEn).not.toMatch(/\d{6}-\d{2}-\d{4}/);
  });

  it('stores one vault row per redaction', async () => {
    const meeting = await freshMeeting();
    const result = await processMeeting(deps, meeting.id, AUDIO);
    expect(await prisma.piiVault.count()).toBe(result.redactionCount);
  });
});

describe('processMeeting — failure paths', () => {
  function failingProvider(cause: Error): TranscriptionProvider {
    return {
      name: 'fake',
      transcribe(): Promise<TranscriptionResult> {
        return Promise.reject(cause);
      },
    };
  }

  it('marks the meeting failed and stores no transcript', async () => {
    const meeting = await freshMeeting();
    const provider = failingProvider(new TranscriptionError('fake', 'upstream refused'));

    await expect(processMeeting({ ...deps, provider }, meeting.id, AUDIO))
      .rejects.toBeInstanceOf(PipelineError);

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(stored.status).toBe('FAILED');
    expect(await prisma.transcript.count()).toBe(0);
  });

  it('names the stage and error class in the stored reason', async () => {
    const meeting = await freshMeeting();
    const provider = failingProvider(new TranscriptionError('fake', 'upstream refused'));

    await expect(processMeeting({ ...deps, provider }, meeting.id, AUDIO)).rejects.toThrow();

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(stored.failureReason).toBe('transcription:TranscriptionError');
  });

  /**
   * Provider and database errors quote the text that caused them, and that text
   * is the transcript. failureReason must not become a column where unredacted
   * data accumulates unnoticed.
   */
  it('keeps the transcript out of the stored failure reason', async () => {
    const meeting = await freshMeeting();
    const leaky = new Error('failed on input "IC 880101-14-5678, card 4111 1111 1111 1111"');

    await expect(
      processMeeting({ ...deps, provider: failingProvider(leaky) }, meeting.id, AUDIO),
    ).rejects.toThrow();

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(stored.failureReason).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(stored.failureReason).not.toContain('4111');
    expect(stored.failureReason).toBe('transcription:Error');
  });

  it('refuses an invalid vault key without writing anything', async () => {
    const meeting = await freshMeeting();

    await expect(
      processMeeting({ ...deps, vaultKey: Buffer.alloc(16) }, meeting.id, AUDIO),
    ).rejects.toBeInstanceOf(PipelineError);

    expect(await prisma.transcript.count()).toBe(0);
    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    expect(stored.status).toBe('FAILED');
    expect(stored.failureReason).toBe('redaction:Error');
  });
});
