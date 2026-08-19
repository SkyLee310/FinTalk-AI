import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const EMAIL = 'maker@fintalk.ai';

const app = buildServer({ prisma });

interface WithCookies {
  cookies: { name: string; value: string }[];
}

function cookieHeader(response: unknown): string {
  const cookies = (response as WithCookies).cookies;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function login(email = EMAIL, password = PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
}

beforeEach(async () => {
  await resetDb();
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Demo MAKER',
      role: 'MAKER',
    },
  });

  // Link Google account for test user
  await prisma.googleToken.create({
    data: {
      userId: user.id,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      scope: 'https://www.googleapis.com/auth/meetings.space.readonly',
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { googleLinked: true },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Google Meet Capture & Webhook Integration', () => {
  describe('POST /meetings/connect-meet', () => {
    it('creates a CAPTURED meeting with captureSource GOOGLE_MEET and redacted participants', async () => {
      const auth = await login();
      const res = await app.inject({
        method: 'POST',
        url: '/meetings/connect-meet',
        headers: { cookie: cookieHeader(auth) },
        payload: {
          meetLink: 'https://meet.google.com/abc-defg-hij',
          title: 'Credit Committee — Google Meet Session',
          occurredAt: '2026-08-19T10:00:00Z',
          consentConfirmed: true,
          transferAcknowledged: true,
          participants: [
            { name: 'Ahmad bin Zaki', role: 'Credit Manager' },
            { name: 'Siti Aminah', role: 'Shariah Officer' },
          ],
        },
      });

      expect(res.statusCode).toBe(202);
      const json = res.json();
      expect(json.meetingId).toBeDefined();
      expect(json.status).toBe('CAPTURED');

      const meeting = await prisma.meeting.findUniqueOrThrow({
        where: { id: json.meetingId },
        include: { participants: true },
      });

      expect(meeting.captureSource).toBe('GOOGLE_MEET');
      expect(meeting.meetLink).toBe('https://meet.google.com/abc-defg-hij');
      expect(meeting.googleConferenceId).toBe('abc-defg-hij');
      expect(meeting.participants).toHaveLength(2);
      expect(meeting.participants[0].nameRedacted).toBe('[PERSON_NAME_1]');
      expect(meeting.participants[1].nameRedacted).toBe('[PERSON_NAME_2]');
    });

    it('rejects connection if consent is missing', async () => {
      const auth = await login();
      const res = await app.inject({
        method: 'POST',
        url: '/meetings/connect-meet',
        headers: { cookie: cookieHeader(auth) },
        payload: {
          meetLink: 'https://meet.google.com/abc-defg-hij',
          title: 'Credit Committee',
          occurredAt: '2026-08-19T10:00:00Z',
          consentConfirmed: false,
          transferAcknowledged: true,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().title).toContain('Consent');
    });

    it('rejects connection if Google account is not linked', async () => {
      // Unlink user
      const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      await prisma.googleToken.delete({ where: { userId: user.id } });

      const auth = await login();
      const res = await app.inject({
        method: 'POST',
        url: '/meetings/connect-meet',
        headers: { cookie: cookieHeader(auth) },
        payload: {
          meetLink: 'https://meet.google.com/abc-defg-hij',
          title: 'Credit Committee',
          occurredAt: '2026-08-19T10:00:00Z',
          consentConfirmed: true,
          transferAcknowledged: true,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().title).toContain('Google Account Not Linked');
    });
  });

  describe('POST /webhooks/google-meet', () => {
    it('accepts valid webhook payload gracefully even if meeting not found', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/google-meet',
        payload: {
          conferenceRecord: 'conferenceRecords/unknown-meeting-123',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.received).toBe(true);
      expect(json.matched).toBe(0);
    });
  });
});
