import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider, LOW_CONFIDENCE_FIXTURE_COUNT } from '../../src/ai/fake.provider.js';
import { LOW_CONFIDENCE_THRESHOLD } from '../../src/ai/provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

/**
 * Human review of low-confidence transcript segments.
 *
 * The assertion that matters most is that a correction does **not** overwrite the
 * model's text. Every Redaction offset indexes into the joined transcript, so an
 * in-place edit would silently invalidate the redaction log — the record an
 * auditor uses to prove an identifier was accounted for.
 */

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

beforeEach(async () => {
  // Capture answers 202 and keeps working, so a pipeline from the previous test
  // may still hold locks on the tables resetDb truncates.
  await app.backgroundJobs.drain();
  await resetDb();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function sessionFor(role: Role): Promise<string> {
  const email = `${role.toLowerCase()}@fintalk.ai`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}`,
      role,
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

const AUDIO = {
  field: 'audio',
  filename: 'meeting.wav',
  contentType: 'audio/wav',
  body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
};

const METADATA = {
  title: 'SME Loan Approval Meeting',
  occurredAt: '2026-08-07T02:30:00.000Z',
  consentConfirmed: 'true',
  transferAcknowledged: 'true',
};

function multipart(fields: Record<string, string>) {
  const boundary = '----FinTalkSegmentBoundary';
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${AUDIO.field}"; `
      + `filename="${AUDIO.filename}"\r\nContent-Type: ${AUDIO.contentType}\r\n\r\n`,
    ),
    AUDIO.body,
    Buffer.from('\r\n'),
  );

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Uploads the fake fixture and waits for the pipeline to finish. */
async function readyTranscript(cookie: string): Promise<string> {
  const { payload, headers } = multipart(METADATA);
  const response = await app.inject({
    method: 'POST',
    url: '/meetings',
    headers: { ...headers, cookie },
    payload,
  });
  const { meetingId } = response.json<{ meetingId: string }>();

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    if (meeting.status === 'READY') return meetingId;
    if (meeting.status === 'FAILED') {
      throw new Error(`pipeline failed: ${meeting.failureReason ?? 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('transcript never became READY');
}

async function lowConfidenceSegment(): Promise<{ id: string; textRedacted: string }> {
  const segment = await prisma.transcriptSegment.findFirstOrThrow({
    where: { confidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
    orderBy: { startMs: 'asc' },
  });
  return { id: segment.id, textRedacted: segment.textRedacted };
}

describe('transcription confidence', () => {
  it('persists a score in range for every segment the provider reported one for', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);

    const segments = await prisma.transcriptSegment.findMany();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.confidence !== null)).toBe(true);
    expect(segments.every((s) => (s.confidence ?? -1) >= 0 && (s.confidence ?? 2) <= 1))
      .toBe(true);
  });

  /**
   * Anti-vacuity. If the fixture drifted above the threshold, every test below
   * would pass while exercising nothing — the same trap as a redaction test whose
   * input holds no identifier.
   */
  it('has segments below the review floor, so the review path is actually exercised', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);

    const low = await prisma.transcriptSegment.count({
      where: { confidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
    });
    expect(low).toBe(LOW_CONFIDENCE_FIXTURE_COUNT);
  });

  it('records how much of the transcript was weak, in the audit entry', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'transcript.created' },
    });
    expect(entry.payload).toMatchObject({
      lowConfidenceCount: LOW_CONFIDENCE_FIXTURE_COUNT,
      unscoredCount: 0,
    });
  });
});

describe('POST /transcript-segments/:id/confirm', () => {
  it('attributes the confirmation and audits it', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    const response = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/confirm`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);

    const stored = await prisma.transcriptSegment.findUniqueOrThrow({
      where: { id: segment.id },
    });
    expect(stored.confirmedById).not.toBeNull();
    expect(stored.confirmedAt).not.toBeNull();
    // Confirming asserts the model was right, so its text must be untouched.
    expect(stored.textRedacted).toBe(segment.textRedacted);

    const entry = await prisma.auditEntry.findFirst({
      where: { action: 'transcript.segment.confirmed', entityId: segment.id },
    });
    expect(entry).not.toBeNull();
  });

  it('refuses a second confirmation rather than replacing the first', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    const first = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/confirm`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/confirm`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(409);
  });

  it('answers 404 for a segment that does not exist', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await app.inject({
      method: 'POST',
      url: '/transcript-segments/does-not-exist/confirm',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /transcript-segments/:id/correct', () => {
  /**
   * The load-bearing assertion of this file.
   *
   * Redaction offsets index into the joined transcript. If a correction rewrote
   * textRedacted, every offset after it would point at the wrong span and the
   * redaction log would quietly stop being evidence.
   */
  it('stores the correction beside the model text without overwriting it', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    const response = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/correct`,
      headers: { cookie },
      payload: { correctedText: 'Betul. Director IC is [NRIC_1], account [BANK_ACCOUNT_1].' },
    });

    expect(response.statusCode).toBe(200);

    const stored = await prisma.transcriptSegment.findUniqueOrThrow({
      where: { id: segment.id },
    });
    expect(stored.textRedacted).toBe(segment.textRedacted);

    const edit = await prisma.humanEdit.findFirstOrThrow({
      where: { entityType: 'TranscriptSegment', entityId: segment.id },
    });
    expect(edit.aiValue).toBe(segment.textRedacted);
    expect(edit.humanValue).toContain('[NRIC_1]');
    expect(edit.fieldPath).toBe('textRedacted');

    // A corrected segment has certainly been read, so it must not keep
    // reporting as unexamined.
    expect(stored.confirmedAt).not.toBeNull();
  });

  it('refuses a correction containing real personal data', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    const response = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/correct`,
      headers: { cookie },
      // Synthetic, and the point: retyping an identifier would assert a value
      // for something sealed in the vault.
      payload: { correctedText: 'Director IC is 880101-14-5678 for the record.' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(/personal data/i);
    expect(await prisma.humanEdit.count()).toBe(0);
  });

  it('refuses a correction identical to the model text', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    const response = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/correct`,
      headers: { cookie },
      payload: { correctedText: segment.textRedacted },
    });

    expect(response.statusCode).toBe(422);
    expect(await prisma.humanEdit.count()).toBe(0);
  });

  it('keeps both corrections when a segment is corrected twice', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    for (const text of ['First reading of the line.', 'Second reading of the line.']) {
      const response = await app.inject({
        method: 'POST',
        url: `/transcript-segments/${segment.id}/correct`,
        headers: { cookie },
        payload: { correctedText: text },
      });
      expect(response.statusCode).toBe(200);
    }

    // Two judgements were made. Keeping only the last would hide that the first
    // was reconsidered.
    const edits = await prisma.humanEdit.findMany({
      where: { entityId: segment.id },
      orderBy: { editedAt: 'asc' },
    });
    expect(edits).toHaveLength(2);
    expect(edits[0]?.humanValue).toContain('First');
    expect(edits[1]?.humanValue).toContain('Second');
  });

  it('audits the correction without copying either version of the text', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();
    const corrected = 'Betul. Director IC is [NRIC_1] at the bank.';

    await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/correct`,
      headers: { cookie },
      payload: { correctedText: corrected },
    });

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'transcript.segment.corrected', entityId: segment.id },
    });

    const serialised = JSON.stringify(entry.payload);
    // Transcript text has exactly one home. Copying it into an append-only log
    // would put the same words where no redaction offset describes them and no
    // retention sweep can reach them.
    expect(serialised).not.toContain(corrected);
    expect(serialised).not.toContain(segment.textRedacted);
    expect(entry.payload).toMatchObject({ humanLength: corrected.length });
  });

  it('rejects an empty correction at the schema', async () => {
    const cookie = await sessionFor('MAKER');
    await readyTranscript(cookie);
    const segment = await lowConfidenceSegment();

    const response = await app.inject({
      method: 'POST',
      url: `/transcript-segments/${segment.id}/correct`,
      headers: { cookie },
      payload: { correctedText: '' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('participants', () => {
  it('stores a placeholder and seals the name, never storing it in the clear', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart({
      ...METADATA,
      // Invented names.
      participants: JSON.stringify([
        { name: 'Nurul Aisyah binti Rahman', role: 'Credit Manager' },
        { name: 'Tan Wei Ming', role: 'Shariah Officer' },
        { name: 'Nurul Aisyah binti Rahman', role: 'Chair' },
      ]),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: { ...headers, cookie },
      payload,
    });
    expect(response.statusCode).toBe(202);

    const participants = await prisma.meetingParticipant.findMany({
      orderBy: { ordinal: 'asc' },
    });
    expect(participants).toHaveLength(3);

    // No name anywhere in the row.
    for (const participant of participants) {
      expect(participant.nameRedacted).toMatch(/^\[PERSON_NAME_\d+\]$/);
    }
    expect(participants.map((p) => p.nameRedacted)).toEqual([
      '[PERSON_NAME_1]',
      '[PERSON_NAME_2]',
      // The same person entered twice keeps one placeholder, so the record does
      // not read as three different people.
      '[PERSON_NAME_1]',
    ]);

    // Roles are not personal data and are kept as written.
    expect(participants.map((p) => p.role)).toEqual([
      'Credit Manager',
      'Shariah Officer',
      'Chair',
    ]);

    // Every participant redaction has a vault row behind it, and every row
    // names exactly one parent.
    const redactions = await prisma.redaction.findMany({
      where: { participantId: { not: null } },
    });
    expect(redactions).toHaveLength(3);
    expect(redactions.every((r) => r.vaultId !== null)).toBe(true);
    expect(redactions.every((r) => r.transcriptId === null && r.whiteboardId === null))
      .toBe(true);
    expect(redactions.every((r) => r.detectedBy === 'declared')).toBe(true);
  });

  it('keeps a name out of the audit payload, recording only a count', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart({
      ...METADATA,
      participants: JSON.stringify([{ name: 'Nurul Aisyah binti Rahman', role: 'Chair' }]),
    });

    await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: { ...headers, cookie },
      payload,
    });

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'meeting.uploaded' },
    });
    expect(JSON.stringify(entry.payload)).not.toContain('Nurul');
    expect(entry.payload).toMatchObject({ participantCount: 1 });
  });

  /**
   * A malformed participants field loses the participants, not the recording.
   * The audio is the irreplaceable half.
   */
  it('accepts the recording when the participants field is unparseable', async () => {
    const cookie = await sessionFor('MAKER');
    const { payload, headers } = multipart({ ...METADATA, participants: 'not json' });

    const response = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers: { ...headers, cookie },
      payload,
    });

    expect(response.statusCode).toBe(202);
    expect(await prisma.meetingParticipant.count()).toBe(0);
    expect(await prisma.meeting.count()).toBe(1);
  });
});
