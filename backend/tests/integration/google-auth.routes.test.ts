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
  await prisma.user.create({
    data: {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Demo MAKER',
      role: 'MAKER',
    },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Google Auth Routes', () => {
  describe('GET /auth/google/status', () => {
    it('returns linked: false when the user has no Google token', async () => {
      const auth = await login();
      const res = await app.inject({
        method: 'GET',
        url: '/auth/google/status',
        headers: { cookie: cookieHeader(auth) },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.linked).toBe(false);
      expect(json.scope).toBeNull();
    });

    it('returns linked: true when the user has a stored Google token', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
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

      const auth = await login();
      const res = await app.inject({
        method: 'GET',
        url: '/auth/google/status',
        headers: { cookie: cookieHeader(auth) },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.linked).toBe(true);
      expect(json.scope).toContain('meetings.space.readonly');
    });
  });

  describe('DELETE /auth/google/link', () => {
    it('removes stored Google token and updates user.googleLinked to false', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      await prisma.googleToken.create({
        data: {
          userId: user.id,
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { googleLinked: true },
      });

      const auth = await login();
      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/google/link',
        headers: { cookie: cookieHeader(auth) },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);

      const tokenAfter = await prisma.googleToken.findUnique({
        where: { userId: user.id },
      });
      expect(tokenAfter).toBeNull();

      const userAfter = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(userAfter.googleLinked).toBe(false);
    });
  });
});
