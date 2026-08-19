import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

/**
 * User administration, and the two properties that make it safe.
 *
 * First: no password crosses this boundary. Creating a user must not accept one,
 * return one, or log one — an admin-chosen password would let the admin sign in as
 * that user, and every action attributed to them afterwards would be deniable.
 *
 * Second: deactivation is real. An administrator who revokes access must actually
 * stop that person signing in, or the feature is a badge and nothing more.
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

async function sessionFor(
  role: Role,
  suffix = '',
  oversight?: { canViewMeetings?: boolean; canViewAuditTrail?: boolean },
): Promise<{ id: string; cookie: string }> {
  const email = `${role.toLowerCase()}${suffix}@fintalk.ai`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}${suffix}`,
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
  return {
    id: user.id,
    cookie: `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`,
  };
}

async function pendingApplicant(suffix: string): Promise<{ id: string; email: string }> {
  const email = `pending${suffix}@fintalk.ai`;
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      displayName: `Pending ${suffix}`,
      email,
      password: 'Demo!2345',
      username: `pendinguser${suffix}`,
      staffId: `STF-${suffix}`,
    },
  });
  const { id } = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id, email };
}

describe('GET /users', () => {
  it('lists users with the capabilities their role grants', async () => {
    const admin = await sessionFor('ADMIN');
    await sessionFor('MAKER');

    const response = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { cookie: admin.cookie },
    });

    expect(response.statusCode).toBe(200);
    const { users } = response.json<{
      users: { role: string; capabilities: string[]; deactivatedAt: string | null }[];
    }>();

    expect(users).toHaveLength(2);
    const maker = users.find((u) => u.role === 'MAKER');
    expect(maker?.capabilities).toContain('meeting:create');
    expect(maker?.deactivatedAt).toBeNull();
  });

  it('refuses every role but ADMIN', async () => {
    for (const role of ['MAKER', 'CHECKER', 'SHARIAH', 'OVERSIGHT'] as const) {
      const actor = await sessionFor(role);
      const response = await app.inject({
        method: 'GET',
        url: '/users',
        headers: { cookie: actor.cookie },
      });
      expect(response.statusCode).toBe(403);
    }
  });
});

describe('POST /users', () => {
  /**
   * The property this whole feature turns on. If an administrator could set another
   * person's password they could act as them, and attribution — which the audit
   * chain exists to provide — would mean nothing.
   */
  it('never accepts, returns or logs a password', async () => {
    const admin = await sessionFor('ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie: admin.cookie },
      payload: {
        email: 'New.Person@bank.example',
        displayName: 'New Person',
        role: 'MAKER',
        // Offered on purpose. It must be ignored rather than honoured.
        password: 'attacker-chosen-password',
      },
    });

    expect(response.statusCode).toBe(201);
    const serialised = JSON.stringify(response.json());
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('attacker-chosen');

    // The supplied password must not work, which is what proves it was unused.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'new.person@bank.example', password: 'attacker-chosen-password' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('lowercases the email so the same person cannot be invited twice', async () => {
    const admin = await sessionFor('ADMIN');

    const first = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie: admin.cookie },
      payload: { email: 'Person@bank.example', displayName: 'Person', role: 'MAKER' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json<{ email: string }>().email).toBe('person@bank.example');

    const second = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie: admin.cookie },
      payload: { email: 'PERSON@bank.example', displayName: 'Person', role: 'MAKER' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('audits creation without copying the display name', async () => {
    const admin = await sessionFor('ADMIN');

    await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie: admin.cookie },
      payload: { email: 'invited@bank.example', displayName: 'Nurul Aisyah', role: 'MAKER' },
    });

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'user.created' },
    });
    expect(entry.payload).toMatchObject({ email: 'invited@bank.example', role: 'MAKER' });
    // A person's name is not copied into the log — the rule Meeting.title follows.
    expect(JSON.stringify(entry.payload)).not.toContain('Nurul');
  });
});

describe('PATCH /users/:id/role', () => {
  it('changes a role and audits both sides of the change', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('OVERSIGHT', '', { canViewMeetings: true });

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: 'CHECKER' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ role: string }>().role).toBe('CHECKER');

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'user.role.changed' },
    });
    expect(entry.payload).toMatchObject({ from: 'OVERSIGHT', to: 'CHECKER' });
  });

  /**
   * Self-protection. An administrator demoting themselves is how a system ends up
   * with no administrator, and it reads as a mistake rather than a decision.
   */
  it('refuses an administrator changing their own role', async () => {
    const admin = await sessionFor('ADMIN');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${admin.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: 'MAKER' },
    });

    expect(response.statusCode).toBe(409);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(unchanged.role).toBe('ADMIN');
  });

  it('rejects an unknown role', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('OVERSIGHT');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: 'SUPERUSER' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /users/:id/active', () => {
  /** What makes deactivation more than a badge. */
  it('stops a deactivated user signing in', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('MAKER');

    const before = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'maker@fintalk.ai', password: PASSWORD },
    });
    expect(before.statusCode).toBe(200);

    const deactivate = await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/active`,
      headers: { cookie: admin.cookie },
      payload: { active: false },
    });
    expect(deactivate.statusCode).toBe(200);

    const after = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'maker@fintalk.ai', password: PASSWORD },
    });
    expect(after.statusCode).toBe(403);
  });

  it('keeps the row, so audit entries naming them still resolve', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('MAKER');

    await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/active`,
      headers: { cookie: admin.cookie },
      payload: { active: false },
    });

    const still = await prisma.user.findUnique({ where: { id: target.id } });
    expect(still).not.toBeNull();
    expect(still?.deactivatedAt).not.toBeNull();
  });

  it('restores access on reactivation', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('MAKER');

    for (const active of [false, true]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${target.id}/active`,
        headers: { cookie: admin.cookie },
        payload: { active },
      });
      expect(response.statusCode).toBe(200);
    }

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'maker@fintalk.ai', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses an administrator deactivating themselves', async () => {
    const admin = await sessionFor('ADMIN');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${admin.id}/active`,
      headers: { cookie: admin.cookie },
      payload: { active: false },
    });

    expect(response.statusCode).toBe(409);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(unchanged.deactivatedAt).toBeNull();
  });

  it('refuses a no-op change rather than writing a misleading audit entry', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('MAKER');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/active`,
      headers: { cookie: admin.cookie },
      payload: { active: true },
    });

    expect(response.statusCode).toBe(409);
    const entries = await prisma.auditEntry.count({
      where: { action: { in: ['user.reactivated', 'user.deactivated'] } },
    });
    expect(entries).toBe(0);
  });
});

describe('PATCH /users/:id/approve', () => {
  it('grants the chosen role and activates the account', async () => {
    const admin = await sessionFor('ADMIN');
    const applicant = await pendingApplicant('a1');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${applicant.id}/approve`,
      headers: { cookie: admin.cookie },
      payload: { role: 'MAKER' },
    });
    expect(response.statusCode).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(stored.role).toBe('MAKER');
    expect(stored.accountStatus).toBe('ACTIVE');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: applicant.email, password: 'Demo!2345' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('audits the approval with the granted role', async () => {
    const admin = await sessionFor('ADMIN');
    const applicant = await pendingApplicant('a2');

    await app.inject({
      method: 'PATCH',
      url: `/users/${applicant.id}/approve`,
      headers: { cookie: admin.cookie },
      payload: { role: 'CHECKER' },
    });

    const entry = await prisma.auditEntry.findFirst({
      where: { action: 'user.approved', entityId: applicant.id },
    });
    expect(entry?.payload).toMatchObject({ role: 'CHECKER' });
  });

  it('refuses a row that is already active', async () => {
    const admin = await sessionFor('ADMIN');
    const other = await sessionFor('OVERSIGHT', '-active');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${other.id}/approve`,
      headers: { cookie: admin.cookie },
      payload: { role: 'MAKER' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('refuses a caller without user:manage', async () => {
    const checker = await sessionFor('CHECKER');
    const applicant = await pendingApplicant('a3');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${applicant.id}/approve`,
      headers: { cookie: checker.cookie },
      payload: { role: 'MAKER' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('PATCH /users/:id/reject', () => {
  it('deletes the row and audits a full snapshot', async () => {
    const admin = await sessionFor('ADMIN');
    const applicant = await pendingApplicant('r1');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${applicant.id}/reject`,
      headers: { cookie: admin.cookie },
    });
    expect(response.statusCode).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: applicant.id } })).toBeNull();

    const entry = await prisma.auditEntry.findFirst({
      where: { action: 'user.registration.rejected', entityId: applicant.id },
    });
    expect(entry?.payload).toMatchObject({
      email: applicant.email,
      displayName: 'Pending r1',
      username: 'pendinguserr1',
      staffId: 'STF-r1',
    });
  });

  it('refuses a row that is already active', async () => {
    const admin = await sessionFor('ADMIN');
    const other = await sessionFor('OVERSIGHT', '-active2');

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${other.id}/reject`,
      headers: { cookie: admin.cookie },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('GET /users pending row shape', () => {
  it('reports a pending applicant with no role and no capabilities', async () => {
    const admin = await sessionFor('ADMIN');
    await pendingApplicant('shape1');

    const response = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { cookie: admin.cookie },
    });
    const body = response.json<{
      users: Array<{ email: string; accountStatus: string; role: string | null; capabilities: string[] }>;
    }>();
    const row = body.users.find((u) => u.email === 'pendingshape1@fintalk.ai');

    expect(row).toMatchObject({ accountStatus: 'PENDING', role: null, capabilities: [] });
  });
});

describe('OVERSIGHT accounts', () => {
  it('grants exactly the ticked flags at creation', async () => {
    const admin = await sessionFor('ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie: admin.cookie },
      payload: {
        email: 'oversight-new@bank.example',
        displayName: 'New Oversight',
        role: 'OVERSIGHT',
        canViewMeetings: true,
        canViewAuditTrail: false,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      canViewMeetings: boolean;
      canViewAuditTrail: boolean;
      capabilities: string[];
    }>();
    expect(body.canViewMeetings).toBe(true);
    expect(body.canViewAuditTrail).toBe(false);
    expect(body.capabilities).toContain('meeting:read');
    expect(body.capabilities).not.toContain('audit:read');
  });

  it('ignores the two flags for a non-OVERSIGHT role', async () => {
    const admin = await sessionFor('ADMIN');

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { cookie: admin.cookie },
      payload: {
        email: 'maker-flagged@bank.example',
        displayName: 'Flagged Maker',
        role: 'MAKER',
        canViewAuditTrail: true,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ canViewMeetings: boolean; canViewAuditTrail: boolean }>();
    expect(body.canViewMeetings).toBe(false);
    expect(body.canViewAuditTrail).toBe(false);
  });

  it("lets an administrator edit an existing OVERSIGHT account's flags without changing its role", async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('OVERSIGHT', '-edit', { canViewMeetings: true });

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: 'OVERSIGHT', canViewMeetings: true, canViewAuditTrail: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ canViewAuditTrail: boolean }>();
    expect(body.canViewAuditTrail).toBe(true);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'user.role.changed', entityId: target.id },
    });
    expect(entry.payload).toMatchObject({ canViewMeetings: true, canViewAuditTrail: true });
  });

  it('refuses a true no-op — same role, same flags', async () => {
    const admin = await sessionFor('ADMIN');
    const target = await sessionFor('OVERSIGHT', '-noop', {
      canViewMeetings: true,
      canViewAuditTrail: true,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/users/${target.id}/role`,
      headers: { cookie: admin.cookie },
      payload: { role: 'OVERSIGHT', canViewMeetings: true, canViewAuditTrail: true },
    });

    expect(response.statusCode).toBe(409);
  });

  it('lets an OVERSIGHT session with canViewAuditTrail read the audit trail, and refuses one without it', async () => {
    const withAudit = await sessionFor('OVERSIGHT', '-audit-yes', { canViewAuditTrail: true });
    const withoutAudit = await sessionFor('OVERSIGHT', '-audit-no', { canViewMeetings: true });

    const allowed = await app.inject({ method: 'GET', url: '/audit', headers: { cookie: withAudit.cookie } });
    const denied = await app.inject({ method: 'GET', url: '/audit', headers: { cookie: withoutAudit.cookie } });

    expect(allowed.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
  });
});
