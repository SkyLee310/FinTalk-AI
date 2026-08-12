import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

/**
 * Feedback: anyone signed in may submit it, only user:manage may read the pile.
 *
 * Two properties matter. First, personal data is refused rather than stored —
 * the same rule the assistant applies to a question, applied here to a message
 * that is kept indefinitely rather than answered and discarded. Second, a
 * refused submission writes nothing: no Feedback row and no audit entry.
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

async function sessionFor(role: Role, suffix = ''): Promise<{ id: string; cookie: string }> {
  const email = `${role.toLowerCase()}${suffix}@fintalk.test`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}${suffix}`,
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

describe('POST /feedback', () => {
  it('lets a signed-in user submit feedback', async () => {
    const maker = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { cookie: maker.cookie },
      payload: { category: 'IDEA', message: 'A dark-mode toggle would be great here.' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string; category: string; createdAt: string }>();
    expect(body.category).toBe('IDEA');

    const stored = await prisma.feedback.findUnique({ where: { id: body.id } });
    expect(stored?.authorId).toBe(maker.id);
    expect(stored?.message).toBe('A dark-mode toggle would be great here.');
  });

  it('refuses a submission containing personal data, and stores nothing', async () => {
    const maker = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { cookie: maker.cookie },
      payload: { category: 'BUG', message: 'Contact me at 991231-14-5678 if you need more detail.' },
    });

    expect(response.statusCode).toBe(422);
    expect(await prisma.feedback.count()).toBe(0);
    expect(await prisma.auditEntry.count()).toBe(0);
  });

  it('rejects an unauthenticated submission', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/feedback',
      payload: { category: 'OTHER', message: 'This is a message from nobody in particular.' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('records an audit entry with the category and no message text', async () => {
    const maker = await sessionFor('MAKER');

    await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { cookie: maker.cookie },
      payload: { category: 'BUG', message: 'The Capture accordion collapses when I click Next.' },
    });

    const entry = await prisma.auditEntry.findFirst({ where: { action: 'feedback.submitted' } });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBe(maker.id);
    expect(entry?.payload).toEqual({ category: 'BUG' });
  });
});

describe('GET /feedback', () => {
  it('is refused for a role without user:manage', async () => {
    const maker = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'GET',
      url: '/feedback',
      headers: { cookie: maker.cookie },
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets an administrator see submitted feedback with its author', async () => {
    const maker = await sessionFor('MAKER');
    const admin = await sessionFor('ADMIN');

    await app.inject({
      method: 'POST',
      url: '/feedback',
      headers: { cookie: maker.cookie },
      payload: { category: 'IDEA', message: 'Please add a bulk-export button on Review.' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/feedback',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    const { feedback } = response.json<{
      feedback: { category: string; message: string; author: { displayName: string; role: string } }[];
    }>();

    expect(feedback).toHaveLength(1);
    expect(feedback[0]!.author.displayName).toBe('Demo MAKER');
    expect(feedback[0]!.author.role).toBe('MAKER');
    expect(feedback[0]!.message).toBe('Please add a bulk-export button on Review.');
  });
});
