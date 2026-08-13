import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import type { DecisionDraft, TranscriptionProvider, TranscriptionResult } from '../../src/ai/provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildGraph } from '../../src/knowledge/graph.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

/**
 * Capture answers 202 and keeps processing, so a pipeline started by the
 * previous test may still hold locks on the tables resetDb truncates. TRUNCATE
 * wants an AccessExclusiveLock and the pipeline wants an AccessShareLock on a
 * table TRUNCATE already holds — Postgres reported a deadlock and CI went red.
 * Waiting for in-flight work is the fix, not a longer timeout.
 */
beforeEach(async () => {
  await app.backgroundJobs.drain();
  await resetDb();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function sessionFor(
  role: Role,
  suffix = '',
  oversight?: { canViewMeetings?: boolean; canViewAuditTrail?: boolean },
): Promise<string> {
  const email = `${role.toLowerCase()}${suffix}@fintalk.test`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}`,
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
  return `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`;
}

/** Builds a multipart body without pulling in a form-data dependency. */
function multipart(
  fields: Record<string, string>,
  file?: { field: string; filename: string; contentType: string; body: Buffer },
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----FinTalkTestBoundary';
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; `
        + `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.body,
      Buffer.from('\r\n'),
    );
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
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

function upload(
  cookie: string,
  fields: Record<string, string>,
  withAudio = true,
  targetApp = app,
) {
  const { payload, headers } = multipart(fields, withAudio ? AUDIO : undefined);
  return targetApp.inject({
    method: 'POST',
    url: '/meetings',
    headers: { ...headers, cookie },
    payload,
  });
}

/**
 * The upload returns 202 and processes in the background, so a test that wants a
 * finished transcript has to wait for one. Polls the status the route itself
 * publishes rather than sleeping for a guessed duration.
 */
async function waitForSettled(meetingId: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const meeting = await prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { status: true },
    });
    if (meeting.status === 'READY' || meeting.status === 'FAILED') return meeting.status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`meeting ${meetingId} never settled`);
}

async function uploadAndWait(cookie: string, targetApp = app): Promise<string> {
  const response = await upload(cookie, METADATA, true, targetApp);
  expect(response.statusCode).toBe(202);
  const { meetingId } = response.json<{ meetingId: string }>();
  expect(await waitForSettled(meetingId)).toBe('READY');
  return meetingId;
}

describe('POST /meetings — access control', () => {
  it('refuses an unauthenticated upload', async () => {
    const { payload, headers } = multipart(METADATA, AUDIO);
    const response = await app.inject({
      method: 'POST',
      url: '/meetings',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses an oversight account, who cannot create meetings even with read access', async () => {
    const response = await upload(
      await sessionFor('OVERSIGHT', '', { canViewMeetings: true }),
      METADATA,
    );
    expect(response.statusCode).toBe(403);
    expect(await prisma.meeting.count()).toBe(0);
  });

  it('accepts a maker', async () => {
    const response = await upload(await sessionFor('MAKER'), METADATA);
    expect(response.statusCode).toBe(202);
  });
});

describe('POST /meetings — consent gate', () => {
  /**
   * Processing sends audio to a third-party model. Consent is refused before the
   * audio is looked at, and nothing is recorded — not even a failed meeting row,
   * which would imply the recording had been accepted.
   */
  it('refuses to process without confirmed consent', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, { ...METADATA, consentConfirmed: 'false' });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(/consent/i);
    expect(await prisma.meeting.count()).toBe(0);
    expect(await prisma.transcript.count()).toBe(0);
  });

  it('refuses when the consent field is absent entirely', async () => {
    const cookie = await sessionFor('MAKER');
    const { title, occurredAt } = METADATA;
    const response = await upload(cookie, { title, occurredAt });

    expect(response.statusCode).toBe(422);
    expect(await prisma.meeting.count()).toBe(0);
  });

  /**
   * The transfer acknowledgement is a second, independent refusal.
   *
   * Consenting to be recorded is not the same act as accepting that the audio
   * leaves Malaysia for Google before anything is redacted. If one field could
   * satisfy both gates, the audit log would be unable to show which was actually
   * agreed to — so this asserts that consent alone is not enough.
   */
  it('refuses to process when only consent is given, without the transfer acknowledgement', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, {
      ...METADATA,
      transferAcknowledged: 'false',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(/google|transfer/i);
    expect(await prisma.meeting.count()).toBe(0);
    expect(await prisma.transcript.count()).toBe(0);
  });

  it('refuses when the transfer field is absent entirely', async () => {
    const cookie = await sessionFor('MAKER');
    const { title, occurredAt, consentConfirmed } = METADATA;
    const response = await upload(cookie, { title, occurredAt, consentConfirmed });

    expect(response.statusCode).toBe(422);
    expect(await prisma.meeting.count()).toBe(0);
  });
});

describe('POST /meetings — validation', () => {
  it('rejects a missing title', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, {
      occurredAt: METADATA.occurredAt,
      consentConfirmed: 'true',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-ISO occurredAt', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, { ...METADATA, occurredAt: '7 Aug 2026' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a request carrying no audio', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, METADATA, false);
    expect(response.statusCode).toBe(400);
    expect(await prisma.meeting.count()).toBe(0);
  });
});

describe('POST /meetings — the capture round trip', () => {
  /**
   * The upload no longer waits for the pipeline. Railway's edge proxy closes a
   * request at 300 seconds and a real recording takes longer than that to
   * transcribe, so the route answers 202 with an id to poll.
   */
  it('accepts the upload immediately rather than waiting for the pipeline', async () => {
    const response = await upload(await sessionFor('MAKER'), METADATA);

    expect(response.statusCode).toBe(202);
    const body = response.json<{ meetingId: string; status: string; pollUrl: string }>();
    expect(body.status).toBe('CAPTURED');
    expect(body.pollUrl).toBe(`/meetings/${body.meetingId}`);
  });

  it('reaches READY with every segment and its redactions stored', async () => {
    const meetingId = await uploadAndWait(await sessionFor('MAKER'));

    const transcript = await prisma.transcript.findFirstOrThrow({
      where: { meetingId },
      include: { segments: true, redactions: true },
    });
    expect(transcript.segments).toHaveLength(6);
    expect(transcript.redactions.length).toBeGreaterThan(3);
  });

  it('serves the redacted transcript back with no identifier in it', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(cookie);

    const detail = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: { cookie },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(detail.body).not.toContain('4111');
    expect(detail.body).toContain('[NRIC_1]');
  });

  /**
   * The detail response must never carry the vault relation. Recovering a stored
   * identifier is a separate action that gets its own audit entry.
   */
  it('never includes vault ciphertext in the detail response', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(cookie);

    const detail = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: { cookie },
    });

    expect(detail.body).not.toContain('ciphertext');
    expect(detail.body).not.toContain('authTag');
    expect(detail.body).not.toContain('vaultId');
  });

  it('lists the meeting for an oversight account with canViewMeetings', async () => {
    await uploadAndWait(await sessionFor('MAKER'));

    const response = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: { cookie: await sessionFor('OVERSIGHT', '', { canViewMeetings: true }) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ meetings: unknown[] }>().meetings).toHaveLength(1);
  });

  it('refuses the list to an oversight account with canViewMeetings unset', async () => {
    await uploadAndWait(await sessionFor('MAKER', '-2'));

    const response = await app.inject({
      method: 'GET',
      url: '/meetings',
      headers: { cookie: await sessionFor('OVERSIGHT', '-noflag', { canViewAuditTrail: true }) },
    });

    expect(response.statusCode).toBe(403);
  });

  /**
   * Regression: the upload wrote no audit entry, so the uploader's identity and
   * their consent confirmation — the first item in the spec's audit strip — went
   * unrecorded, and a deployment that had only captured meetings served an empty
   * audit trail while reporting it valid.
   */
  it('audits the upload together with the consent confirmation', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(cookie);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'meeting.uploaded', entityId: meetingId },
    });

    expect(entry.actorRole).toBe('MAKER');
    expect(entry.payload).toMatchObject({
      consentConfirmed: true,
      // Recorded separately from consent, and naming the processor, so the log
      // shows what was actually agreed to rather than one flag standing in for
      // two different acts (spec §12.3).
      transferAcknowledged: true,
      transferProcessor: 'google-gemini',
      audioBytes: AUDIO.body.byteLength,
      audioMimeType: 'audio/wav',
    });
    // The title is free text an operator typed; it can name a person and
    // nothing redacts it, so it stays in Meeting.title rather than the log.
    expect(JSON.stringify(entry.payload)).not.toContain(METADATA.title);
  });

  it('writes no audit entry when consent is refused', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, { ...METADATA, consentConfirmed: 'false' });

    expect(response.statusCode).toBe(422);
    expect(await prisma.auditEntry.count()).toBe(0);
  });

  it('answers 404 for an unknown meeting', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/meetings/does-not-exist',
      headers: { cookie: await sessionFor('MAKER') },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /meetings — meeting intelligence', () => {
  it('stores decisions, action items, and a project draft, and audits the step', async () => {
    const cookie = await sessionFor('MAKER', '-intel');
    const meetingId = await uploadAndWait(cookie);

    const detail = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}`,
      headers: { cookie },
    });
    const body = detail.json<{
      decisions: { id: string; topic: string; decision: string; rationale: string }[];
      actionItems: { id: string; owner: string; task: string; dueDate: string | null }[];
      transcript: { projectKickoff: string | null; followUps: string[] } | null;
    }>();

    expect(body.decisions.length).toBeGreaterThan(0);
    expect(body.actionItems.length).toBeGreaterThan(0);
    expect(body.transcript?.projectKickoff).toBeTruthy();
    expect(body.transcript?.followUps.length).toBeGreaterThan(0);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'meeting.intelligence', entityId: meetingId },
    });
    expect(entry.payload).toMatchObject({
      decisionCount: body.decisions.length,
      actionItemCount: body.actionItems.length,
      hasProjectDraft: true,
      followUpCount: body.transcript?.followUps.length,
      skipped: [],
    });
  });

  /**
   * A provider that implements only arbitrateDecisions, and answers with a
   * fresh NRIC-shaped string its input never contained. redactDerived must
   * catch it the same way it would catch a leak from a real model — this
   * stub exists to prove the fail-closed path actually runs, not to describe
   * anything a real provider would do.
   */
  class DirtyIntelligenceProvider implements TranscriptionProvider {
    readonly name = 'fake' as const;

    transcribe(): Promise<TranscriptionResult> {
      return new FakeTranscriptionProvider().transcribe({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'audio/wav',
      });
    }

    arbitrateDecisions(): Promise<readonly DecisionDraft[]> {
      return Promise.resolve([
        {
          topic: 'Pricing basis',
          decision: 'Approved.',
          rationale: 'Confirmed directly with the director, IC 770202-08-2222.',
        },
      ]);
    }
  }

  it('skips an output whose derived text leaks real PII, without failing the meeting', async () => {
    const dirtyApp = buildServer({ prisma, provider: new DirtyIntelligenceProvider() });
    try {
      const cookie = await sessionFor('MAKER', '-dirty');
      const meetingId = await uploadAndWait(cookie, dirtyApp);

      const detail = await dirtyApp.inject({
        method: 'GET',
        url: `/meetings/${meetingId}`,
        headers: { cookie },
      });
      const body = detail.json<{ decisions: unknown[] }>();
      expect(body.decisions).toHaveLength(0);
      // No leaked NRIC anywhere in the response, not even inside the skipped output.
      expect(detail.body).not.toContain('770202-08-2222');

      const meetingRow = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
      expect(meetingRow.status).toBe('READY');

      const entry = await prisma.auditEntry.findFirstOrThrow({
        where: { action: 'meeting.intelligence', entityId: meetingId },
      });
      expect(entry.payload).toMatchObject({
        decisionCount: 0,
        actionItemCount: 0,
        hasProjectDraft: false,
        skipped: ['decisions'],
      });
    } finally {
      await dirtyApp.backgroundJobs.drain();
      await dirtyApp.close();
    }
  });
});

describe('PATCH /meetings/:id/archive', () => {
  it('archives a meeting for the maker who created it', async () => {
    const maker = await sessionFor('MAKER');
    const meetingId = await uploadAndWait(maker);

    const response = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: maker },
    });
    expect(response.statusCode).toBe(200);

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    expect(stored.archivedAt).not.toBeNull();

    const entry = await prisma.auditEntry.findFirst({
      where: { action: 'meeting.archived', entityId: meetingId },
    });
    expect(entry).not.toBeNull();
  });

  it('excludes an archived meeting from the list but the detail route still resolves it', async () => {
    const maker = await sessionFor('MAKER', '-list');
    const meetingId = await uploadAndWait(maker);

    await app.inject({ method: 'PATCH', url: `/meetings/${meetingId}/archive`, headers: { cookie: maker } });

    const list = await app.inject({ method: 'GET', url: '/meetings', headers: { cookie: maker } });
    const ids = list.json<{ meetings: Array<{ id: string }> }>().meetings.map((m) => m.id);
    expect(ids).not.toContain(meetingId);

    const detail = await app.inject({ method: 'GET', url: `/meetings/${meetingId}`, headers: { cookie: maker } });
    expect(detail.statusCode).toBe(200);

    // A referencing row must keep resolving meetingId after the meeting is archived.
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId,
        applicantName: 'Archived-facility Sdn Bhd',
        currency: 'MYR',
        principalMinor: 10_000_00n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    });
    const reloaded = await prisma.termSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    expect(reloaded.meetingId).toBe(meetingId);
  });

  it('removes an archived meeting from the knowledge graph, same as a hard delete', async () => {
    const maker = await sessionFor('MAKER', '-archive-graph');
    const meetingId = await uploadAndWait(maker);
    expect((await buildGraph(prisma)).nodes.map((n) => n.meetingId)).toContain(meetingId);

    await app.inject({ method: 'PATCH', url: `/meetings/${meetingId}/archive`, headers: { cookie: maker } });

    expect((await buildGraph(prisma)).nodes.map((n) => n.meetingId)).not.toContain(meetingId);
  });

  it('refuses a maker who did not create this meeting', async () => {
    const creator = await sessionFor('MAKER', '-owner');
    const other = await sessionFor('MAKER', '-other');
    const meetingId = await uploadAndWait(creator);

    const response = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: other },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a role without meeting:create', async () => {
    const maker = await sessionFor('MAKER', '-viewed');
    const oversight = await sessionFor('OVERSIGHT', '-x', { canViewMeetings: true });
    const meetingId = await uploadAndWait(maker);

    const response = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: oversight },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses archiving the same meeting twice', async () => {
    const maker = await sessionFor('MAKER', '-twice');
    const meetingId = await uploadAndWait(maker);

    await app.inject({ method: 'PATCH', url: `/meetings/${meetingId}/archive`, headers: { cookie: maker } });
    const second = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: maker },
    });
    expect(second.statusCode).toBe(409);
  });

  it('answers 404 for an unknown meeting', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/meetings/does-not-exist/archive',
      headers: { cookie: await sessionFor('MAKER', '-404') },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /meetings/:id', () => {
  it('deletes a meeting for the maker who created it, cascading to its transcript', async () => {
    const maker = await sessionFor('MAKER', '-hard');
    const meetingId = await uploadAndWait(maker);

    const response = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: { cookie: maker },
    });
    expect(response.statusCode).toBe(200);

    expect(await prisma.meeting.findUnique({ where: { id: meetingId } })).toBeNull();
    expect(await prisma.transcript.findFirst({ where: { meetingId } })).toBeNull();

    const entry = await prisma.auditEntry.findFirst({
      where: { action: 'meeting.deleted', entityId: meetingId },
    });
    expect(entry).not.toBeNull();
  });

  it('removes a deleted meeting from the knowledge graph', async () => {
    const maker = await sessionFor('MAKER', '-graph');
    const meetingId = await uploadAndWait(maker);
    expect((await buildGraph(prisma)).nodes.map((n) => n.meetingId)).toContain(meetingId);

    await app.inject({ method: 'DELETE', url: `/meetings/${meetingId}`, headers: { cookie: maker } });

    expect((await buildGraph(prisma)).nodes.map((n) => n.meetingId)).not.toContain(meetingId);
  });

  it('refuses a maker who did not create this meeting', async () => {
    const creator = await sessionFor('MAKER', '-hard-owner');
    const other = await sessionFor('MAKER', '-hard-other');
    const meetingId = await uploadAndWait(creator);

    const response = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: { cookie: other },
    });
    expect(response.statusCode).toBe(403);
    expect(await prisma.meeting.findUnique({ where: { id: meetingId } })).not.toBeNull();
  });

  it('refuses a role without meeting:create', async () => {
    const maker = await sessionFor('MAKER', '-hard-viewed');
    const oversight = await sessionFor('OVERSIGHT', '-hard-x', { canViewMeetings: true });
    const meetingId = await uploadAndWait(maker);

    const response = await app.inject({
      method: 'DELETE',
      url: `/meetings/${meetingId}`,
      headers: { cookie: oversight },
    });
    expect(response.statusCode).toBe(403);
  });

  it('answers 404 for an unknown meeting', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/meetings/does-not-exist',
      headers: { cookie: await sessionFor('MAKER', '-hard-404') },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /meetings response shape', () => {
  it('includes createdById on each row', async () => {
    const maker = await sessionFor('MAKER', '-shape');
    const meetingId = await uploadAndWait(maker);

    const response = await app.inject({ method: 'GET', url: '/meetings', headers: { cookie: maker } });
    const row = response
      .json<{ meetings: Array<{ id: string; createdById: string }> }>()
      .meetings.find((m) => m.id === meetingId);
    expect(row?.createdById).toBeTruthy();
  });
});
