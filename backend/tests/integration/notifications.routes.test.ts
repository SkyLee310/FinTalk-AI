import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { decideApproval, draftTermSheet, submitForApproval } from '../../src/compliance/termsheet.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb, seedMeeting } from '../helpers/db.js';

/**
 * Covers the route (GET /notifications, PATCH /notifications/:id/read) and
 * two of the three triggers wired in compliance/termsheet.ts. The third —
 * pipeline/process-meeting.ts's Shariah-flag trigger — calls the same
 * notifyCapabilityHolders used here, just with a different capability and
 * message, so it is not separately re-driven through the full capture
 * pipeline here; see process-meeting.ts's own transaction for that call site.
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

async function loggedInUser(role: Role): Promise<{ id: string; cookie: string }> {
  const email = `${role.toLowerCase()}@fintalk.test`;
  const user = await prisma.user.create({
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
  return {
    id: user.id,
    cookie: `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`,
  };
}

async function draftedSheet(meetingId: string, makerId: string) {
  // draftTermSheet now requires a processed transcript on the meeting;
  // seedMeeting() deliberately leaves meetings transcript-less for the tests
  // that seed it, so this suite attaches one directly.
  await prisma.transcript.create({
    data: {
      meetingId,
      rawRedacted: 'Test transcript.',
      summaryEn: 'Test summary.',
      languages: ['en'],
      modelId: 'test-fixture',
      promptVersion: 'test',
    },
  });

  return draftTermSheet(prisma, { id: makerId, role: 'MAKER' }, {
    meetingId,
    applicantName: 'Test Sdn Bhd',
    facilityKind: 'CONVENTIONAL',
    interestRateBps: 500,
    principalMinor: 100_000n,
    tenureMonths: 12,
  });
}

describe('GET /notifications', () => {
  it('refuses an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/notifications' });
    expect(response.statusCode).toBe(401);
  });

  it("lists only the caller's own notifications, unread first", async () => {
    const maker = await loggedInUser('MAKER');
    const other = await loggedInUser('CHECKER');

    await prisma.notification.create({
      data: {
        userId: maker.id,
        type: 'TERMSHEET_DECIDED',
        message: 'old, already read',
        read: true,
        createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    await prisma.notification.create({
      data: {
        userId: maker.id,
        type: 'TERMSHEET_SUBMITTED',
        message: 'new, unread',
        read: false,
        createdAt: new Date('2026-08-02T00:00:00Z'),
      },
    });
    // Belongs to someone else — must never appear in the maker's list.
    await prisma.notification.create({
      data: { userId: other.id, type: 'SHARIAH_FLAGGED', message: 'not yours', read: false },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { cookie: maker.cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      unreadCount: number;
      notifications: { message: string; read: boolean }[];
    }>();
    expect(body.unreadCount).toBe(1);
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0]?.message).toBe('new, unread');
    expect(body.notifications[0]?.read).toBe(false);
    expect(body.notifications[1]?.message).toBe('old, already read');
  });
});

describe('PATCH /notifications/:id/read', () => {
  it('refuses an unauthenticated request', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/notifications/does-not-exist/read',
    });
    expect(response.statusCode).toBe(401);
  });

  it("marks the caller's own notification read", async () => {
    const maker = await loggedInUser('MAKER');
    const notification = await prisma.notification.create({
      data: { userId: maker.id, type: 'TERMSHEET_DECIDED', message: 'mark me', read: false },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/notifications/${notification.id}/read`,
      headers: { cookie: maker.cookie },
    });

    expect(response.statusCode).toBe(200);
    const updated = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(updated.read).toBe(true);
  });

  /**
   * The where clause scopes on userId as well as id, so this returns the same
   * 404 as a nonexistent id — neither confirms nor denies that the other
   * user's notification exists.
   */
  it("404s rather than marking another user's notification read", async () => {
    const maker = await loggedInUser('MAKER');
    const checker = await loggedInUser('CHECKER');
    const notification = await prisma.notification.create({
      data: { userId: checker.id, type: 'TERMSHEET_SUBMITTED', message: 'not yours', read: false },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/notifications/${notification.id}/read`,
      headers: { cookie: maker.cookie },
    });

    expect(response.statusCode).toBe(404);
    const untouched = await prisma.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });
    expect(untouched.read).toBe(false);
  });
});

describe('Notification triggers', () => {
  it('submitting a term sheet notifies every CHECKER', async () => {
    const maker = await loggedInUser('MAKER');
    const checker = await loggedInUser('CHECKER');
    const meeting = await seedMeeting(maker.id);
    const sheet = await draftedSheet(meeting.id, maker.id);

    await submitForApproval(prisma, { id: maker.id, role: 'MAKER' }, sheet.id);

    const notifications = await prisma.notification.findMany({ where: { userId: checker.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('TERMSHEET_SUBMITTED');
    expect(notifications[0]?.relatedMeetingId).toBe(meeting.id);
  });

  it("deciding an approval notifies the term sheet's own maker", async () => {
    const maker = await loggedInUser('MAKER');
    const checker = await loggedInUser('CHECKER');
    const meeting = await seedMeeting(maker.id);
    const sheet = await draftedSheet(meeting.id, maker.id);
    const approval = await submitForApproval(prisma, { id: maker.id, role: 'MAKER' }, sheet.id);

    await decideApproval(prisma, { id: checker.id, role: 'CHECKER' }, approval.id, 'APPROVED', '');

    // submitForApproval already notified every CHECKER above, not the maker —
    // so the maker's only notification here is the decision itself.
    const notifications = await prisma.notification.findMany({ where: { userId: maker.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('TERMSHEET_DECIDED');
    expect(notifications[0]?.message).toContain('approved');
    expect(notifications[0]?.relatedMeetingId).toBe(meeting.id);
  });
});
