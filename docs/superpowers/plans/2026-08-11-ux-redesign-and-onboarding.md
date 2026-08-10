# FinTalk AI — UX Redesign & Self-Service Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a themeable, glass-accented FinTalk AI where a staff member self-registers and an admin approves them with a role, Ask FinTalk AI becomes a header-anchored multi-turn chatbot, and Capture/Review/Decide restructure into an accordion, a numbered archivable list, and a split Approvals/Settlement view.

**Architecture:** Additive to the existing spine — `backend/src/auth/rbac.ts`, the redaction pipeline, the audit chain, and the mock-settlement guard are untouched. Three schema additions (`AccountStatus`, nullable `User.role`, `Meeting.archivedAt`) drive five new/changed route surfaces; the frontend gets a design-system foundation (theme tokens, `GlassPanel`, view transitions) that every restyled page then consumes.

**Tech Stack:** Fastify + Prisma + PostgreSQL (backend), Next.js App Router + Tailwind (frontend), Vitest on both sides, Gemini as the AI provider behind an already-abstracted `TranscriptionProvider` interface.

## Global Constraints

Carried forward from `docs/superpowers/specs/2026-08-08-fintalk-ai-design.md`, still binding, unchanged by this work:

1. **`RedactedText` is the only write path** for text derived from audio, images, or models. Minted only in `backend/src/pdpa/redactor.ts`; `tests/unit/pdpa/architecture.test.ts` fails the build if any other module casts to it.
2. **Audit entries append inside the transaction that writes the data they describe**, via `appendAuditWithin(tx, …)` in `backend/src/audit/chain.ts`. Every new mutating route below gets one.
3. **Money is `BigInt` minor units**, rates integer basis points, strings over HTTP.
4. **The AI never issues a Shariah ruling.**
5. **No real payment transmission.** Every settlement stays simulated.
6. **Four-eyes holds.** No role gains both `termsheet:submit` and `termsheet:approve`. `backend/src/auth/rbac.ts` is not modified by any task in this plan.
7. **`.env` is never committed.** Only `.env.example` is tracked.

New, introduced by this redesign (spec §4):

8. **A `PENDING` account never receives a session.** Login checks `accountStatus` at the same point as the existing `deactivatedAt` check — after password verification, so no timing oracle is created.
9. **Nothing may reference a `PENDING` registration.** It has no role and no capability. This is exactly why rejecting one can be a real delete without breaching the no-hard-delete precedent for `User` and `Meeting`.
10. **Archiving a meeting must never remove or orphan a referencing row.** `TermSheet`, `Approval`, `Settlement`, `ShariahFlag`, and `Transcript` all keep resolving their `meetingId` after archive. Only `GET /meetings`'s own query excludes it.
11. **New glass surfaces meet the existing contrast floor.** `globals.css` already requires `--faint` to clear 4.5:1 at `text-xs`; text over a blurred translucent background needs its own check, because blur erodes effective contrast that a flat color would not.
12. **`prefers-reduced-motion` continues to zero every transition**, including the new View Transitions navigation. It is decoration and must be able to disappear completely.

---

## Environment facts that shape the plan

- **No local Postgres.** Migrations are hand-written SQL under `backend/prisma/migrations/<timestamp>_<name>/migration.sql`, applied by `prisma migrate deploy`, which checksums the file as written. Follow `20260809000000_whiteboard_redactions/migration.sql`. CI is the only place migrations and `prisma/sql/constraints.sql` are actually exercised.
- **The frontend has no component-testing stack.** `frontend/package.json` carries `vitest` but no `@testing-library/react`, no `jsdom`, no `happy-dom`; the only existing test is `frontend/tests/unit/api-client.test.ts`, which stubs `fetch` and asserts on `apiFetch` directly. This plan does not add a rendering stack. Instead, frontend logic worth testing is extracted into pure, node-testable functions (`resolveTheme`, `gridColumnClass`), and pure-JSX/layout work is verified in a real browser via `preview_start` + the Browser tools.
- **Three backend test files define near-identical session helpers, inconsistently.** `settlement.test.ts` and `users.routes.test.ts` have `sessionFor(role, suffix = '')` returning `{ id, cookie }`; `meetings.routes.test.ts` has `sessionFor(role)` returning only a cookie string, with no suffix. Task 4 needs a second MAKER session, so it adds the `suffix` parameter there — backward-compatible with every existing call site in that file.

---

## File Structure

**Backend — modify**

| File | Responsibility of the change |
|---|---|
| `backend/prisma/schema.prisma` | `AccountStatus` enum; `User.role` nullable; `User.accountStatus`/`username`/`staffId`; `Meeting.archivedAt` |
| `backend/prisma/migrations/20260811000000_account_status_and_meeting_archive/migration.sql` | **create** — hand-written SQL for the above |
| `backend/src/routes/auth.routes.ts` | `POST /auth/register`; PENDING login refusal; null-role guards in `/auth/me` and `/auth/refresh` |
| `backend/src/routes/users.routes.ts` | `PATCH /users/:id/approve`; `PATCH /users/:id/reject`; `GET /users` exposes `accountStatus`/`username`/`staffId` and tolerates a null role |
| `backend/src/routes/meetings.routes.ts` | `PATCH /meetings/:id/archive`; `GET /meetings` filters `archivedAt IS NULL` and returns `createdById` |
| `backend/src/routes/knowledge.routes.ts` | `POST /knowledge/ask` accepts optional capped `history` |
| `backend/src/knowledge/assistant.ts` | new exported pure `withHistory()`; `AskInput.history` |

**Backend — tests**

`backend/tests/integration/auth.routes.test.ts` (register + PENDING login), `users.routes.test.ts` (approve + reject + pending row shape), `meetings.routes.test.ts` (archive + `sessionFor` suffix fix), `backend/tests/unit/knowledge/with-history.test.ts` (**create** — pure `withHistory`).

**Frontend — create**

| File | Responsibility |
|---|---|
| `frontend/src/lib/theme.ts` | `Theme` type, storage key, pure `resolveTheme()`, DOM `applyTheme()`/`readStoredTheme()`/`setTheme()` |
| `frontend/src/components/theme-toggle.tsx` | sun/moon icon button, used on landing and in the app header |
| `frontend/src/components/glass-panel.tsx` | `backdrop-blur-xl` + `--glass-*` tokens + 1px border |
| `frontend/src/lib/view-transition.ts` | `navigateWithTransition()` — `document.startViewTransition` where supported, instant otherwise, instant under reduced motion |
| `frontend/src/components/ask-fintalk-ai.tsx` | right-hand slide-over chat panel with scrim, bubbles, citation chips, example questions |
| `frontend/tests/unit/theme.test.ts` | `resolveTheme` truth table |
| `frontend/tests/unit/home-grid.test.ts` | `gridColumnClass` |

**Frontend — modify**

`globals.css` (glass tokens + `data-theme` blocks), `app/layout.tsx` (pre-paint theme script), `components/ui.tsx` (controllable `Disclosure`, `Button` press state), `app/page.tsx` (landing restructure), `app/login/page.tsx` (segmented sign-in/sign-up), `app/(app)/layout.tsx` (header icons, chat state, Administration pending badge), `app/(app)/home/page.tsx` (role stat tiles, adaptive grid), `app/(app)/knowledge/page.tsx` (graph only), `app/(app)/record/page.tsx` (accordion), `app/(app)/meetings/page.tsx` (numbered + More Details + archive), `app/(app)/approvals/page.tsx` (Approvals/Settlement split), `app/(app)/admin/page.tsx` (pending count), `app/(app)/admin/users/page.tsx` (pending queue), `src/lib/api.ts` (types + four new methods).

`frontend/src/lib/nav.ts` and `backend/src/auth/rbac.ts` are **not modified**.

---

## Tasks

Each task is TDD where a test can exist: failing test → run it and watch it fail → minimal implementation → run it and watch it pass → commit. Where no test stack exists (pure JSX), the task ends with a browser verification step and a commit.

### Task 1 — Schema: account status, nullable role, meeting archive

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260811000000_account_status_and_meeting_archive/migration.sql`

**Interfaces:**
- Produces: `enum AccountStatus { PENDING ACTIVE }`; `User.role: Role?`, `User.accountStatus: AccountStatus`, `User.username: string | null`, `User.staffId: string | null`; `Meeting.archivedAt: DateTime | null`.

- [ ] **Step 1: Edit the schema**

In `backend/prisma/schema.prisma`, add the enum near the other enums:

```prisma
enum AccountStatus {
  PENDING
  ACTIVE
}
```

On `model User`, change `role Role` to `role Role?` and add:

```prisma
  accountStatus AccountStatus @default(ACTIVE)
  username      String?       @unique
  staffId       String?
```

On `model Meeting`, add:

```prisma
  archivedAt DateTime?
```

- [ ] **Step 2: Write the migration**

Create `backend/prisma/migrations/20260811000000_account_status_and_meeting_archive/migration.sql`:

```sql
-- PENDING is reachable only through POST /auth/register.
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE');

-- Every existing account was admin-created with a role already assigned,
-- so ACTIVE is correct for all of them and no backfill is needed.
ALTER TABLE "User" ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- Nullable on purpose (spec §6.3): requiring these at the schema level would
-- force a fake backfill onto admin-created accounts that never collected them.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "staffId" TEXT;

-- Postgres allows many NULLs under a unique index, which is what lets every
-- pre-existing account keep username = NULL.
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- A PENDING registration has no role until an admin approves it.
ALTER TABLE "User" ALTER COLUMN "role" DROP NOT NULL;

-- Archive, never delete: the row and everything referencing it stay resolvable.
ALTER TABLE "Meeting" ADD COLUMN "archivedAt" TIMESTAMP(3);
```

- [ ] **Step 3: Generate the client**

Run: `cd backend && npx prisma generate`

- [ ] **Step 4: Typecheck (expected to fail)**

Run: `cd backend && npm run typecheck`
Expected: FAIL — `user.role` is now `Role | null` everywhere it was consumed as non-null. This is the compiler enumerating every site Tasks 2–4 must fix. Do not attempt to fix them here.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260811000000_account_status_and_meeting_archive/migration.sql
git commit -m "feat(db): add AccountStatus, nullable User.role, Meeting.archivedAt

Typecheck is expected to be red until Task 2 lands — this commit is the
schema/migration half only, split out so the compiler enumerates every
call site that assumed role was non-null."
```

---

### Task 2 — `POST /auth/register` and the PENDING login refusal

**Files:**
- Modify: `backend/src/routes/auth.routes.ts`
- Test: `backend/tests/integration/auth.routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `AccountStatus`, nullable `User.role`.
- Produces: `POST /auth/register` → `201 { accountStatus: 'PENDING' }`; `POST /auth/login` → `403` for a PENDING account with detail `'Your account is awaiting administrator approval.'`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/integration/auth.routes.test.ts`, reusing the file's existing `login()`, `cookiesOf()`, `cookieHeader()` helpers:

```ts
describe('POST /auth/register', () => {
  it('creates a pending account with no role and no session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'New Applicant',
        email: 'applicant@fintalk.test',
        password: 'Demo!2345',
        username: 'applicant1',
        staffId: 'STF-9001',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ accountStatus: 'PENDING' });
    expect(cookiesOf(response)).toHaveLength(0);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'applicant@fintalk.test' } });
    expect(stored.role).toBeNull();
    expect(stored.accountStatus).toBe('PENDING');
  });

  it('refuses to sign in until approved', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'Waiting Applicant',
        email: 'waiting@fintalk.test',
        password: 'Demo!2345',
        username: 'waitingapp',
        staffId: 'STF-9002',
      },
    });

    const response = await login('waiting@fintalk.test', 'Demo!2345');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ detail: expect.stringContaining('administrator approval') });
  });

  it('refuses a duplicate email', async () => {
    const payload = {
      displayName: 'Dup Email',
      email: 'dupemail@fintalk.test',
      password: 'Demo!2345',
      username: 'dupemail1',
      staffId: 'STF-9003',
    };
    await app.inject({ method: 'POST', url: '/auth/register', payload });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...payload, username: 'dupemail2' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('refuses a duplicate username', async () => {
    const first = {
      displayName: 'Dup Username One',
      email: 'dupuser1@fintalk.test',
      password: 'Demo!2345',
      username: 'shared-handle',
      staffId: 'STF-9004',
    };
    await app.inject({ method: 'POST', url: '/auth/register', payload: first });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...first, email: 'dupuser2@fintalk.test' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('rejects a password shorter than the policy floor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'Short Password',
        email: 'shortpw@fintalk.test',
        password: 'short1',
        username: 'shortpw1',
        staffId: 'STF-9005',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('audits registration without the display name or password', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        displayName: 'Audited Applicant',
        email: 'audited@fintalk.test',
        password: 'Demo!2345',
        username: 'auditedapp',
        staffId: 'STF-9006',
      },
    });

    const entry = await prisma.auditEntry.findFirst({ where: { action: 'user.registered' } });
    expect(entry).not.toBeNull();
    expect(entry?.actorId).toBeNull();
    expect(entry?.payload).toMatchObject({
      email: 'audited@fintalk.test',
      username: 'auditedapp',
      staffId: 'STF-9006',
    });
    expect(entry?.payload).not.toHaveProperty('displayName');
    expect(JSON.stringify(entry?.payload)).not.toContain('Demo!2345');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- auth.routes`
Expected: FAIL — `POST /auth/register` does not exist (404), and the PENDING-login test fails because there is no status check yet.

- [ ] **Step 3: Implement `POST /auth/register`**

In `backend/src/routes/auth.routes.ts`, add near the top alongside `LoginBody`:

```ts
const RegisterBody = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().email(),
  // 8 is this endpoint's own floor — there is no shared password policy
  // elsewhere in backend/src/ to reuse; login only enforces z.string().min(1).
  password: z.string().min(8).max(200),
  username: z.string().min(3).max(60),
  staffId: z.string().min(1).max(60),
});
```

Register the route inside `registerAuthRoutes`, with no `preHandler` — this is the one public, unauthenticated mutation in the file:

```ts
app.post('/auth/register', async (request, reply) => {
  const body = RegisterBody.safeParse(request.body);
  if (!body.success) {
    return sendProblem(reply, 400, 'Invalid registration', body.error.issues[0]?.message ?? 'Invalid input.');
  }

  const [existingEmail, existingUsername] = await Promise.all([
    prisma.user.findFirst({ where: { email: body.data.email } }),
    prisma.user.findFirst({ where: { username: body.data.username } }),
  ]);
  if (existingEmail !== null) {
    return sendProblem(reply, 409, 'Email already registered', 'An account with this email already exists.');
  }
  if (existingUsername !== null) {
    return sendProblem(reply, 409, 'Username already taken', 'This username is already in use.');
  }

  const passwordHash = await hashPassword(body.data.password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        displayName: body.data.displayName,
        email: body.data.email,
        passwordHash,
        username: body.data.username,
        staffId: body.data.staffId,
        role: null,
        accountStatus: 'PENDING',
      },
    });

    // No display name and no password: the same exclusion POST /users already
    // applies to user.created, extended to this public path for the same reason.
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: null,
      actorRole: null,
      action: 'user.registered',
      entityType: 'User',
      entityId: user.id,
      payload: {
        email: body.data.email,
        username: body.data.username,
        staffId: body.data.staffId,
      },
    });
  });

  return reply.status(201).send({ accountStatus: 'PENDING' });
});
```

Add `hashPassword` to the existing import from `../auth/password.js` if not already imported, and `appendAuditWithin` from `../audit/chain.js`.

- [ ] **Step 4: Add the PENDING login refusal**

In the `POST /auth/login` handler, immediately after the existing `deactivatedAt` check and before `const env = getEnv();`:

```ts
// Same placement as the deactivated check, for the same reason: it runs after
// password verification so it cannot become a timing oracle for account
// existence. Unlike a wrong password, this state is safe to name — the person
// needs to know they are waiting on an admin, not retrying their password.
if (user.accountStatus === 'PENDING') {
  return sendProblem(reply, 403, 'Awaiting approval', 'Your account is awaiting administrator approval.');
}
```

- [ ] **Step 5: Fix the nullable-role narrowing**

In `POST /auth/login`, after the PENDING check, the token-signing code that reads `user.role` needs no change if the PENDING/deactivated checks already precede it — but add a defensive guard directly above the sign step for the compiler:

```ts
// Structurally unreachable: PENDING is refused above and every other path
// assigns a role before flipping accountStatus to ACTIVE (see Task 3). This
// exists purely to satisfy TypeScript's Role | null narrowing.
if (user.role === null) {
  return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
}
```

In `GET /auth/me`, immediately after its existing `user === null` check:

```ts
if (user.role === null) {
  return sendProblem(reply, 401, 'Unauthenticated', UNAUTHENTICATED);
}
```

In `POST /auth/refresh`, immediately after its existing `user === null` check, the identical guard.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npm test -- auth.routes`
Expected: PASS, all cases including the pre-existing describe blocks.

- [ ] **Step 7: Typecheck and lint**

Run: `cd backend && npm run typecheck && npm run lint`
Expected: PASS — this clears three of the five sites Task 1 left red (login, `/auth/me`, `/auth/refresh`). `users.routes.ts` and `admin/users/page.tsx` remain red until Tasks 3 and 16.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/auth.routes.ts backend/tests/integration/auth.routes.test.ts
git commit -m "feat(auth): add self-service registration and PENDING login refusal"
```

---

### Task 3 — `PATCH /users/:id/approve` and `PATCH /users/:id/reject`

**Files:**
- Modify: `backend/src/routes/users.routes.ts`
- Test: `backend/tests/integration/users.routes.test.ts`

**Interfaces:**
- Consumes: Task 1's schema, Task 2's `/auth/register` (to create PENDING fixtures).
- Produces: `PATCH /users/:id/approve` (body `{ role }`) → `200`; `PATCH /users/:id/reject` → `200`; `GET /users` rows carry `accountStatus`, `username`, `staffId`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/integration/users.routes.test.ts`, using its existing `sessionFor(role, suffix = '')` helper. First add a small local helper reused by all new cases:

```ts
async function pendingApplicant(suffix: string): Promise<{ id: string; email: string }> {
  const email = `pending${suffix}@fintalk.test`;
  const response = await app.inject({
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
```

```ts
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

    const entry = await prisma.auditEntry.findFirst({ where: { action: 'user.approved', entityId: applicant.id } });
    expect(entry?.payload).toMatchObject({ role: 'CHECKER' });
  });

  it('refuses a row that is already active', async () => {
    const admin = await sessionFor('ADMIN');
    const other = await sessionFor('VIEWER', '-active');

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
    const other = await sessionFor('VIEWER', '-active2');

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

    const response = await app.inject({ method: 'GET', url: '/users', headers: { cookie: admin.cookie } });
    const body = response.json<{ users: Array<{ email: string; accountStatus: string; role: string | null; capabilities: string[] }> }>();
    const row = body.users.find((u) => u.email === 'pendingshape1@fintalk.test');

    expect(row).toMatchObject({ accountStatus: 'PENDING', role: null, capabilities: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- users.routes`
Expected: FAIL — both routes 404, and the `GET /users` shape test fails on missing `accountStatus`.

- [ ] **Step 3: Implement**

In `backend/src/routes/users.routes.ts`, reuse the file's existing `gate = { preHandler: [requireAuth, requireCapability('user:manage')] }`.

```ts
const ApproveBody = z.object({ role: z.enum(ROLES) });

app.patch('/users/:id/approve', gate, async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = ApproveBody.safeParse(request.body);
  if (!body.success) {
    return sendProblem(reply, 400, 'Invalid role', body.error.issues[0]?.message ?? 'Invalid input.');
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (target === null) {
    return sendProblem(reply, 404, 'Not found', 'No such user.');
  }
  if (target.accountStatus !== 'PENDING') {
    return sendProblem(reply, 409, 'Not pending', 'This account is not awaiting approval.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { role: body.data.role, accountStatus: 'ACTIVE' } });
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: request.actor.id,
      actorRole: request.actor.role,
      action: 'user.approved',
      entityType: 'User',
      entityId: id,
      payload: { role: body.data.role },
    });
  });

  return reply.status(200).send({ ok: true });
});

app.patch('/users/:id/reject', gate, async (request, reply) => {
  const { id } = request.params as { id: string };

  const target = await prisma.user.findUnique({ where: { id } });
  if (target === null) {
    return sendProblem(reply, 404, 'Not found', 'No such user.');
  }
  if (target.accountStatus !== 'PENDING') {
    return sendProblem(reply, 409, 'Not pending', 'This account is not awaiting approval.');
  }

  await prisma.$transaction(async (tx) => {
    // Audit first: after the delete this is the only surviving record of the
    // submission, so the snapshot must be written before the row is gone.
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: request.actor.id,
      actorRole: request.actor.role,
      action: 'user.registration.rejected',
      entityType: 'User',
      entityId: id,
      payload: {
        displayName: target.displayName,
        email: target.email,
        username: target.username,
        staffId: target.staffId,
      },
    });
    await tx.user.delete({ where: { id } });
  });

  return reply.status(200).send({ ok: true });
});
```

In `GET /users`'s `select` and mapped response, add `accountStatus: true`, `username: true`, `staffId: true`, and change the capabilities line to:

```ts
capabilities: user.role === null ? [] : capabilitiesOf(user.role),
```

`capabilitiesOf` itself is not touched — it keeps its non-null `Role` parameter per constraint 6; the guard belongs at this call site.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- users.routes`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `cd backend && npm run typecheck && npm run lint`
Expected: PASS — this clears the fourth of Task 1's five red sites.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/users.routes.ts backend/tests/integration/users.routes.test.ts
git commit -m "feat(users): add approve/reject for pending registrations"
```

---

### Task 4 — `PATCH /meetings/:id/archive`

**Files:**
- Modify: `backend/src/routes/meetings.routes.ts`
- Test: `backend/tests/integration/meetings.routes.test.ts`

**Interfaces:**
- Consumes: Task 1's `Meeting.archivedAt`.
- Produces: `PATCH /meetings/:id/archive` → `200`; `GET /meetings` filters `archivedAt IS NULL` and rows include `createdById: string`.

- [ ] **Step 1: Fix the `sessionFor` helper**

In `backend/tests/integration/meetings.routes.test.ts`, change:

```ts
async function sessionFor(role: Role): Promise<string> {
```

to:

```ts
async function sessionFor(role: Role, suffix = ''): Promise<string> {
```

and interpolate `suffix` into the email it builds, mirroring `users.routes.test.ts` exactly (e.g. `` `${role.toLowerCase()}${suffix}@fintalk.test` ``). Every existing call site in this file passes one argument and is unaffected.

- [ ] **Step 2: Write the failing tests**

```ts
describe('PATCH /meetings/:id/archive', () => {
  it('archives a meeting for the maker who created it', async () => {
    const maker = await sessionFor('MAKER');
    const { meetingId } = await uploadAndWait(maker);

    const response = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: maker },
    });
    expect(response.statusCode).toBe(200);

    const stored = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    expect(stored.archivedAt).not.toBeNull();

    const entry = await prisma.auditEntry.findFirst({ where: { action: 'meeting.archived', entityId: meetingId } });
    expect(entry).not.toBeNull();
  });

  it('excludes an archived meeting from the list but the detail route still resolves it', async () => {
    const maker = await sessionFor('MAKER', '-list');
    const { meetingId } = await uploadAndWait(maker);

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
        profitRateBps: 500,
      },
    });
    const reloaded = await prisma.termSheet.findUniqueOrThrow({ where: { id: sheet.id } });
    expect(reloaded.meetingId).toBe(meetingId);
  });

  it('refuses a maker who did not create this meeting', async () => {
    const creator = await sessionFor('MAKER', '-owner');
    const other = await sessionFor('MAKER', '-other');
    const { meetingId } = await uploadAndWait(creator);

    const response = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: other },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a role without meeting:create', async () => {
    const maker = await sessionFor('MAKER', '-viewed');
    const viewer = await sessionFor('VIEWER', '-x');
    const { meetingId } = await uploadAndWait(maker);

    const response = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: viewer },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses archiving the same meeting twice', async () => {
    const maker = await sessionFor('MAKER', '-twice');
    const { meetingId } = await uploadAndWait(maker);

    await app.inject({ method: 'PATCH', url: `/meetings/${meetingId}/archive`, headers: { cookie: maker } });
    const second = await app.inject({
      method: 'PATCH',
      url: `/meetings/${meetingId}/archive`,
      headers: { cookie: maker },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('GET /meetings response shape', () => {
  it('includes createdById on each row', async () => {
    const maker = await sessionFor('MAKER', '-shape');
    const { meetingId } = await uploadAndWait(maker);

    const response = await app.inject({ method: 'GET', url: '/meetings', headers: { cookie: maker } });
    const row = response.json<{ meetings: Array<{ id: string; createdById: string }> }>().meetings.find((m) => m.id === meetingId);
    expect(row?.createdById).toBeTruthy();
  });
});
```

Adjust the exact shape/arguments of `uploadAndWait` calls to match this file's existing helper signature (it already exists per prior reads of this file — reuse it verbatim, do not redefine it).

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npm test -- meetings.routes`
Expected: FAIL — the archive route 404s; `createdById` is absent from the list response.

- [ ] **Step 4: Implement**

In `backend/src/routes/meetings.routes.ts`:

```ts
app.patch(
  '/meetings/:id/archive',
  { preHandler: [requireAuth, requireCapability('meeting:create')] },
  async (request, reply) => {
    const { id } = request.params as { id: string };

    const meeting = await prisma.meeting.findUnique({ where: { id } });
    if (meeting === null) {
      return sendProblem(reply, 404, 'Not found', 'No such meeting.');
    }
    if (meeting.createdById !== request.actor.id) {
      // Archiving is personal cleanup, not shared moderation (spec §11's
      // deliberate scope). Widening this to SUPERVISOR/ADMIN later is a
      // capability decision (meeting:archive), not a tweak to this check.
      return sendProblem(reply, 403, 'Forbidden', 'Only the meeting you captured can be archived by you.');
    }
    if (meeting.archivedAt !== null) {
      return sendProblem(reply, 409, 'Already archived', 'This meeting is already archived.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id }, data: { archivedAt: new Date() } });
      // Empty payload: the meeting's title is operator-typed text that
      // meeting.uploaded already excludes from audit payloads for the same reason.
      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: request.actor.id,
        actorRole: request.actor.role,
        action: 'meeting.archived',
        entityType: 'Meeting',
        entityId: id,
        payload: {},
      });
    });

    return reply.status(200).send({ ok: true });
  },
);
```

In `GET /meetings`'s Prisma call, add `where: { archivedAt: null }` and add `createdById: true` to the `select`; add `createdById: meeting.createdById` to the mapped response. Do **not** touch `GET /meetings/:id` — it must keep resolving archived meetings in full.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm test -- meetings.routes`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `cd backend && npm run typecheck && npm run lint`
Expected: PASS — all five of Task 1's red sites are now clear on the backend side (the sixth, `admin/users/page.tsx`, is frontend and closes in Task 16).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/meetings.routes.ts backend/tests/integration/meetings.routes.test.ts
git commit -m "feat(meetings): add creator-scoped archive; exclude archived from list"
```

---

### Task 5 — Multi-turn Ask: `withHistory`

**Files:**
- Modify: `backend/src/knowledge/assistant.ts`, `backend/src/routes/knowledge.routes.ts`
- Create: `backend/tests/unit/knowledge/with-history.test.ts`

**Interfaces:**
- Produces: `type AskHistoryTurn = { role: 'user' | 'assistant'; content: string }`; `withHistory(question: string, history?: readonly AskHistoryTurn[]): string`; `AskInput.history?: readonly AskHistoryTurn[]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/knowledge/with-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withHistory } from '../../../src/knowledge/assistant.js';

describe('withHistory', () => {
  it('returns the question unchanged when history is absent', () => {
    expect(withHistory('What facilities discuss Murabahah?')).toBe('What facilities discuss Murabahah?');
  });

  it('returns the question unchanged when history is empty', () => {
    expect(withHistory('What facilities discuss Murabahah?', [])).toBe('What facilities discuss Murabahah?');
  });

  it('folds one prior turn into a composite string containing both', () => {
    const result = withHistory('What about the second one?', [
      { role: 'user', content: 'Which meetings discuss Murabahah?' },
      { role: 'assistant', content: 'Two meetings: Alpha Sdn Bhd and Beta Holdings.' },
    ]);

    expect(result).toContain('Which meetings discuss Murabahah?');
    expect(result).toContain('Two meetings: Alpha Sdn Bhd and Beta Holdings.');
    expect(result).toContain('What about the second one?');
  });

  it('preserves turn order', () => {
    const result = withHistory('third', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);

    expect(result.indexOf('first')).toBeLessThan(result.indexOf('second'));
    expect(result.indexOf('second')).toBeLessThan(result.indexOf('third'));
  });

  it('labels roles distinguishably', () => {
    const result = withHistory('q', [{ role: 'user', content: 'earlier question' }]);
    expect(result).toMatch(/user/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npm test -- with-history`
Expected: FAIL — `withHistory` is not exported from `assistant.ts`.

- [ ] **Step 3: Implement**

In `backend/src/knowledge/assistant.ts`, add near the existing `Citation` type:

```ts
export type AskHistoryTurn = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Folds prior turns into a single composite string that stands in for the raw
 * question at retrieval and generation time only. Kept deliberately outside
 * TranscriptionProvider's embed/answerFromContext signatures — those stay
 * question-shaped, so gemini.provider.ts and fake.provider.ts need no change.
 */
export function withHistory(question: string, history?: readonly AskHistoryTurn[]): string {
  if (history === undefined || history.length === 0) {
    return question;
  }

  const transcript = history
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');

  return `Earlier in this conversation:\n${transcript}\n\nNew question: ${question}`;
}
```

Add `history?: readonly AskHistoryTurn[];` to `AskInput`. In `ask()`, replace the raw `question` with `withHistory(question, input.history)` at exactly the `embed(...)` call and the `answerFromContext(...)` call. Leave the length check, the `detectPii(question)` refusal, and the `assistant.queried` audit payload's `question` field using the **raw** `question` — the audit record must say what the user actually asked.

- [ ] **Step 4: Update the route**

In `backend/src/routes/knowledge.routes.ts`, extend `AskBody`:

```ts
const AskBody = z.object({
  question: z.string().min(3).max(500),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(10)
    .optional(),
});
```

Pass it through: `ask(deps, { question: body.data.question, actor: request.actor, history: body.data.history })`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm test -- with-history knowledge`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `cd backend && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/knowledge/assistant.ts backend/src/routes/knowledge.routes.ts backend/tests/unit/knowledge/with-history.test.ts
git commit -m "feat(knowledge): reformulate Ask retrieval using capped conversation history"
```

---

### Task 6 — Theme: tokens, `data-theme`, pre-paint script, toggle

**Files:**
- Create: `frontend/src/lib/theme.ts`, `frontend/src/components/theme-toggle.tsx`
- Test: `frontend/tests/unit/theme.test.ts`
- Modify: `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`

**Interfaces:**
- Produces: `type Theme = 'light' | 'dark'`; `THEME_STORAGE_KEY = 'fintalk-theme'`; `resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme`; `readStoredTheme(): Theme | null`; `applyTheme(theme: Theme): void`; `setTheme(theme: Theme): void`; `<ThemeToggle />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/lib/theme';

describe('resolveTheme', () => {
  it('prefers a stored dark choice over a light system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('prefers a stored light choice over a dark system', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('falls through to a dark system when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
  });

  it('falls through to a light system when nothing is stored', () => {
    expect(resolveTheme(null, false)).toBe('light');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- theme`
Expected: FAIL — `frontend/src/lib/theme.ts` does not exist.

- [ ] **Step 3: Implement `lib/theme.ts`**

Create `frontend/src/lib/theme.ts`:

```ts
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'fintalk-theme';

/** Pure truth table: an explicit stored choice always wins; otherwise, the system decides. */
export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  if (stored !== null) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked (private mode, policy): theme still applies for this load.
  }
  applyTheme(theme);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- theme`
Expected: PASS.

- [ ] **Step 5: Update `globals.css`**

Add to the existing `@theme inline` mapping block:

```css
  --color-glass-bg: var(--glass-bg);
  --color-glass-border: var(--glass-border);
  --color-glass-highlight: var(--glass-highlight);
```

Add light values inside the existing `:root { ... }` block:

```css
  --glass-bg: rgb(255 255 255 / 0.55);
  --glass-border: rgb(255 255 255 / 0.4);
  --glass-highlight: rgb(255 255 255 / 0.8);
```

Change the existing dark media block's selector — media queries gate applicability but add zero specificity, so without this change an explicit light choice loses to a dark OS:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* ...existing dark values, unchanged... */
    --glass-bg: rgb(17 17 20 / 0.55);
    --glass-border: rgb(255 255 255 / 0.12);
    --glass-highlight: rgb(255 255 255 / 0.08);
  }
}
```

Add a new unconditional block right after it — its attribute selector outranks the plain `:root` light block regardless of source order:

```css
:root[data-theme="dark"] {
  /* Same values as the media-query dark block above, kept in sync by hand. */
  --glass-bg: rgb(17 17 20 / 0.55);
  --glass-border: rgb(255 255 255 / 0.12);
  --glass-highlight: rgb(255 255 255 / 0.08);
  /* ...plus every existing dark semantic-token value from the media block... */
}
```

Leave the `--faint` 4.5:1 comment and the `prefers-reduced-motion` block untouched.

- [ ] **Step 6: Pre-paint script in `layout.tsx`**

`frontend/src/app/layout.tsx` currently has no `<head>` JSX. Add one, holding an inline script that runs before first paint:

```tsx
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('fintalk-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;
```

```tsx
<html lang="en">
  <head>
    <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
  </head>
  <body>
    {/* ...existing children unchanged... */}
  </body>
</html>
```

The literal string `'fintalk-theme'` here must match `THEME_STORAGE_KEY` in `lib/theme.ts` exactly — a mismatch is a flash of the wrong theme on every load.

- [ ] **Step 7: `ThemeToggle` component**

Create `frontend/src/components/theme-toggle.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { readStoredTheme, resolveTheme, setTheme, type Theme } from '@/lib/theme';

export function ThemeToggle() {
  const [theme, setLocalTheme] = useState<Theme>('light');

  useEffect(() => {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setLocalTheme(resolveTheme(readStoredTheme(), systemPrefersDark));
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setLocalTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="active:scale-[0.98] transition-transform inline-flex size-9 items-center justify-center rounded-full border border-line text-muted hover:bg-raised hover:text-text"
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4.5">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
        </svg>
      )}
    </button>
  );
}
```

- [ ] **Step 8: Verify in the browser**

Start the dev server and confirm the toggle flips both ways, a hard reload shows no flash, and the choice persists. Then confirm both themes render correctly when the OS-level color scheme is set to the opposite of the explicit choice.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/theme.ts frontend/src/components/theme-toggle.tsx frontend/tests/unit/theme.test.ts frontend/src/app/globals.css frontend/src/app/layout.tsx
git commit -m "feat(theme): add user-controlled light/dark toggle with pre-paint script"
```

---

### Task 7 — `GlassPanel`, button press state, view transitions

**Files:**
- Create: `frontend/src/components/glass-panel.tsx`, `frontend/src/lib/view-transition.ts`
- Modify: `frontend/src/components/ui.tsx`

**Interfaces:**
- Consumes: Task 6's `--glass-*` tokens.
- Produces: `<GlassPanel className?: string>`; `navigateWithTransition(fn: () => void): void`; `Disclosure` gains optional `open?: boolean` and `onToggle?: (open: boolean) => void`.

- [ ] **Step 1: `GlassPanel`**

Create `frontend/src/components/glass-panel.tsx`:

```tsx
import type { ReactNode } from 'react';

/**
 * Additive, not a replacement for Card: Card stays opaque and correct for
 * transcript segments, audit rows, and tables, where blur would cost
 * legibility. GlassPanel is for the landing hero, the chat panel, and the
 * Capture accordion's collapsed-step surfaces.
 */
export function GlassPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-glass-border bg-glass-bg backdrop-blur-xl shadow-[inset_0_1px_0_var(--glass-highlight)] ${className}`}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: `navigateWithTransition`**

Create `frontend/src/lib/view-transition.ts`:

```ts
/**
 * Decoration, not a feature: both the "unsupported" and "reduced motion"
 * branches fall through to the exact same instant navigation the app has
 * today, so its absence — including in Firefox — never blocks anything.
 */
export function navigateWithTransition(fn: () => void): void {
  const supportsViewTransitions = typeof document !== 'undefined' && 'startViewTransition' in document;
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (supportsViewTransitions && !prefersReducedMotion) {
    (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(fn);
    return;
  }

  fn();
}
```

- [ ] **Step 3: `Disclosure` becomes optionally controlled**

In `frontend/src/components/ui.tsx`, find the existing `Disclosure` component built on native `<details>`. Extend its props and pass `open`/`onToggle` through untouched when omitted:

```tsx
export function Disclosure({
  summary,
  children,
  open,
  onToggle,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details
      open={open}
      onToggle={onToggle === undefined ? undefined : (event) => onToggle(event.currentTarget.open)}
      className="group rounded-xl border border-line bg-surface"
    >
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">{summary}</summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
```

(Keep every existing class name and wrapper element from the current implementation — only the props and the two new attributes are additive. Every existing call site omits both `open` and `onToggle` and continues to render an uncontrolled, native `<details>`.)

- [ ] **Step 4: `Button` press state**

In the same file, add `active:scale-[0.98] transition-transform` to `Button`'s shared class string (the one applied regardless of `variant`). `globals.css`'s existing `prefers-reduced-motion` block already zeroes transform transitions globally, so no additional guard is needed here.

- [ ] **Step 5: Verify in the browser**

Render a `GlassPanel` with body text over the new hero background in both themes and read it — confirm it clears the contrast floor (constraint 11). Click a `Button` and confirm the press animation. Force `prefers-reduced-motion: reduce` and confirm navigation is still instant and buttons don't animate.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/glass-panel.tsx frontend/src/lib/view-transition.ts frontend/src/components/ui.tsx
git commit -m "feat(ui): add GlassPanel, view-transition navigation, controllable Disclosure"
```

---

### Task 8 — Landing page

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: Task 6's `<ThemeToggle />`, Task 7's `<GlassPanel>`.

- [ ] **Step 1: Restructure**

In `frontend/src/app/page.tsx`:

- Header row: `Logo` top-left, `<ThemeToggle />` top-right, no nav links.
- Hero: wrap the headline, one-line subhead, and two `Button`s ("Sign in", "Sign up", both `href="/login"`) in a `<GlassPanel>` sitting over a `bg-gradient-to-br` background using existing brand tokens (no image asset).
- Keep the existing `PILLARS` and `GUARANTEES` arrays and their mapped sections verbatim — restyle their wrapper classes only, not their content.
- Move the System status `Card` out of its current mid-page 3-of-5-column grid slot into a slim full-width bar at the very bottom of the page: a live status dot plus text from the same `/health` fetch already used, with the raw provider/status detail behind a `<Disclosure summary="Details">`.

- [ ] **Step 2: Verify in the browser**

Check both themes, and check the `mobile` preset — confirm the page body does not scroll horizontally.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(landing): restructure with glass hero, top-right theme toggle, footer status bar"
```

---

### Task 9 — Sign in / Sign up

**Files:**
- Modify: `frontend/src/app/login/page.tsx`, `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 6's toggle pattern (not directly rendered here, but the same `GlassPanel`/token vocabulary), Task 7's `<GlassPanel>` and `navigateWithTransition`.
- Produces in `api.ts`: `type AccountStatus = 'PENDING' | 'ACTIVE'`; `register(body: { displayName: string; email: string; password: string; username: string; staffId: string }): Promise<{ accountStatus: AccountStatus }>`.

- [ ] **Step 1: Extend `api.ts`**

Add near the existing `Role` type:

```ts
export type AccountStatus = 'PENDING' | 'ACTIVE';
```

Add to the `api` object:

```ts
  register: (body: {
    displayName: string;
    email: string;
    password: string;
    username: string;
    staffId: string;
  }) => apiFetch<{ accountStatus: AccountStatus }>('/auth/register', json(body)),
```

- [ ] **Step 2: Rewrite the page**

Replace `frontend/src/app/login/page.tsx`'s contents with a `mode: 'sign-in' | 'sign-up'` state, both forms inside one `<GlassPanel>`, a segmented control switching `mode`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GlassPanel } from '@/components/glass-panel';
import { Logo } from '@/components/logo';
import { Button, ErrorNote, Field, Input, SuccessNote } from '@/components/ui';
import { api } from '@/lib/api';
import { navigateWithTransition } from '@/lib/view-transition';

type Mode = 'sign-in' | 'sign-up';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [registered, setRegistered] = useState(false);

  // Sign-in state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);

  // Sign-up state
  const [displayName, setDisplayName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [staffId, setStaffId] = useState('');
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [signUpBusy, setSignUpBusy] = useState(false);

  async function submitSignIn() {
    setSignInBusy(true);
    setSignInError(null);
    try {
      await api.login(email, password);
      navigateWithTransition(() => router.push('/home'));
    } catch (cause) {
      setSignInError(cause instanceof Error ? cause.message : 'Sign in failed.');
    } finally {
      setSignInBusy(false);
    }
  }

  async function submitSignUp() {
    setSignUpError(null);
    if (signUpPassword !== confirmPassword) {
      setSignUpError('Passwords do not match.');
      return;
    }
    if (signUpPassword.length < 8) {
      setSignUpError('Password must be at least 8 characters.');
      return;
    }
    if (username.length < 3) {
      setSignUpError('Username must be at least 3 characters.');
      return;
    }
    setSignUpBusy(true);
    try {
      await api.register({
        displayName,
        email: signUpEmail,
        password: signUpPassword,
        username,
        staffId,
      });
      setRegistered(true);
    } catch (cause) {
      setSignUpError(
        cause instanceof Error && cause.message.toLowerCase().includes('already')
          ? cause.message
          : 'Registration failed. Please check your details and try again.',
      );
    } finally {
      setSignUpBusy(false);
    }
  }

  if (registered) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <GlassPanel className="w-full p-8 text-center">
          <Logo className="mx-auto size-8" />
          <h1 className="mt-4 text-lg font-semibold">Request submitted</h1>
          <p className="mt-2 text-sm text-muted">
            Your request has been submitted. An administrator will review it and assign your access.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigateWithTransition(() => router.push('/'))}>
            Back to home
          </Button>
        </GlassPanel>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 py-16">
      <GlassPanel className="w-full p-8">
        <Logo className="mx-auto size-8" />

        <div role="tablist" aria-label="Sign in or sign up" className="mt-6 flex rounded-full border border-line p-1">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-in'}
            onClick={() => setMode('sign-in')}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${mode === 'sign-in' ? 'bg-brand-soft text-brand' : 'text-muted'}`}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-up'}
            onClick={() => setMode('sign-up')}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${mode === 'sign-up' ? 'bg-brand-soft text-brand' : 'text-muted'}`}
          >
            Sign up
          </button>
        </div>

        {mode === 'sign-in' ? (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSignIn();
            }}
          >
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {signInError !== null && <ErrorNote>{signInError}</ErrorNote>}
            <Button type="submit" className="w-full" disabled={signInBusy}>
              {signInBusy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSignUp();
            }}
          >
            <Field label="Full name">
              <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" required value={signUpEmail} onChange={(e) => setSignUpEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                value={signUpPassword}
                onChange={(e) => setSignUpPassword(e.target.value)}
              />
            </Field>
            <Field label="Confirm password">
              <Input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
            <Field label="Username">
              <Input required value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="Staff ID">
              <Input required value={staffId} onChange={(e) => setStaffId(e.target.value)} />
            </Field>
            {signUpError !== null && <ErrorNote>{signUpError}</ErrorNote>}
            <Button type="submit" className="w-full" disabled={signUpBusy}>
              {signUpBusy ? 'Submitting…' : 'Sign up'}
            </Button>
          </form>
        )}
      </GlassPanel>
    </main>
  );
}
```

Adjust imports (`Field`, `Input`, `Button`, `ErrorNote`, `Logo`) to match the exact named exports already in `components/ui.tsx` and `components/logo.tsx` — this plan does not rename any existing export.

- [ ] **Step 2: Verify in the browser**

Register a new account, confirm the "request submitted" state renders and no session cookie is set, then attempt to sign in with those same credentials and confirm the refusal names administrator approval (Task 2's `403`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/login/page.tsx frontend/src/lib/api.ts
git commit -m "feat(auth): replace sign-in-only page with segmented sign-in/sign-up"
```

---

### Task 10 — Authenticated shell + Ask FinTalk AI panel

**Files:**
- Create: `frontend/src/components/ask-fintalk-ai.tsx`
- Modify: `frontend/src/app/(app)/layout.tsx`, `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 6's `<ThemeToggle />`, Task 7's `<GlassPanel>`, Task 5's history cap.
- Produces in `api.ts`: `type AskHistoryTurn = { role: 'user' | 'assistant'; content: string }`; `ask(question: string, history?: readonly AskHistoryTurn[]): Promise<AskAnswer>` (extends the existing `ask` signature with an optional second parameter — existing call sites passing only `question` are unaffected).

- [ ] **Step 1: Extend `api.ts`**

```ts
export type AskHistoryTurn = {
  role: 'user' | 'assistant';
  content: string;
};
```

Change the existing `ask` method:

```ts
  ask: (question: string, history?: readonly AskHistoryTurn[]) =>
    apiFetch<AskAnswer>('/knowledge/ask', json({ question, history })),
```

- [ ] **Step 2: Build the chat panel**

Create `frontend/src/components/ask-fintalk-ai.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GlassPanel } from '@/components/glass-panel';
import { Button, Input, Spinner } from '@/components/ui';
import { api, type AskCitation, type AskHistoryTurn } from '@/lib/api';

export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
  citations?: readonly AskCitation[];
};

const EXAMPLES: readonly string[] = [
  'Which meetings discuss a Murabahah facility?',
  'Summarise the open Shariah findings this month.',
  'What facilities are still awaiting settlement?',
];

// The cap here matches the backend's AskBody.history.max(10) (Task 5) so a
// send never fails on a bound the client could have respected itself.
const HISTORY_CAP = 10;

export function AskFinTalkAi({
  open,
  onClose,
  turns,
  onTurns,
}: {
  open: boolean;
  onClose: () => void;
  turns: readonly ChatTurn[];
  onTurns: (turns: readonly ChatTurn[]) => void;
}) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed === '' || busy) return;

    const history: AskHistoryTurn[] = turns.slice(-HISTORY_CAP).map((t) => ({ role: t.role, content: t.content }));
    const next = [...turns, { role: 'user' as const, content: trimmed }];
    onTurns(next);
    setQuestion('');
    setBusy(true);

    try {
      const answer = await api.ask(trimmed, history);
      onTurns([...next, { role: 'assistant', content: answer.answer, citations: answer.citations }]);
    } catch {
      onTurns([...next, { role: 'assistant', content: 'Something went wrong answering that. Please try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <button
        type="button"
        aria-label="Close Ask FinTalk AI"
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
      />
      <GlassPanel className="relative flex h-full w-full max-w-md flex-col p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">Ask FinTalk AI</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-text">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {turns.length === 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted">Try asking:</p>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void send(example)}
                  className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-raised"
                >
                  {example}
                </button>
              ))}
            </div>
          )}

          {turns.map((turn, index) => (
            <div key={index} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                  turn.role === 'user' ? 'bg-brand text-white' : 'bg-surface text-text'
                }`}
              >
                <p>{turn.content}</p>
                {turn.citations !== undefined && turn.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {turn.citations.map((citation) => (
                      <Link
                        key={citation.meetingId}
                        href={`/meetings/${citation.meetingId}`}
                        className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-muted hover:text-text"
                      >
                        {citation.title}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && <Spinner label="Thinking" />}
        </div>

        <form
          className="flex items-center gap-2 border-t border-line px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(question);
          }}
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about a meeting, facility, or finding…"
            className="flex-1"
          />
          <Button type="submit" disabled={busy}>
            Send
          </Button>
        </form>
      </GlassPanel>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the app shell**

In `frontend/src/app/(app)/layout.tsx`, add local state:

```tsx
const [chatOpen, setChatOpen] = useState(false);
const [chatTurns, setChatTurns] = useState<readonly ChatTurn[]>([]);
```

Insert `<ThemeToggle />` and the Ask trigger into the existing `<div className="ml-auto flex items-center gap-3">`, **before** the name/email block:

```tsx
<div className="ml-auto flex items-center gap-3">
  <ThemeToggle />
  {can(session, 'transcript:read') && (
    <button
      type="button"
      onClick={() => setChatOpen(true)}
      aria-label="Ask FinTalk AI"
      className="active:scale-[0.98] transition-transform inline-flex size-9 items-center justify-center rounded-full border border-line text-muted hover:bg-raised hover:text-text"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="size-4.5">
        <path d="M21 12c0 4.418-4.03 8-9 8-1.06 0-2.07-.153-3-.437L3 21l1.5-4.5A7.94 7.94 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
      </svg>
    </button>
  )}
  <div className="text-right">
    {/* ...existing name/email block, unchanged... */}
  </div>
  {/* ...existing Badge and sign-out Button, unchanged... */}
</div>
```

Render the panel once, as a sibling of the header (outside its `<div>` but still inside the root fragment):

```tsx
<AskFinTalkAi open={chatOpen} onClose={() => setChatOpen(false)} turns={chatTurns} onTurns={setChatTurns} />
```

`chatTurns` resets naturally on reload (it is component state, not persisted) and on sign-out (the layout unmounts on redirect to `/login`), matching spec §2's session-only requirement without extra code.

Import `ThemeToggle` from `@/components/theme-toggle`, `AskFinTalkAi` and `ChatTurn` from `@/components/ask-fintalk-ai`, and `can` from `@/lib/api` (it is already exported there per the existing file).

- [ ] **Step 4: Verify in the browser**

Sign in as a role holding `transcript:read` (e.g. MAKER), open the panel, ask a question, ask a follow-up referencing "the second one" and confirm it resolves using the prior turn, click a citation and confirm it navigates to the right meeting, navigate to another page and confirm the conversation is still there, then sign in as ADMIN and confirm the icon is absent.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ask-fintalk-ai.tsx frontend/src/app/\(app\)/layout.tsx frontend/src/lib/api.ts
git commit -m "feat(shell): add header theme toggle and Ask FinTalk AI slide-over chat"
```

---

### Task 11 — Home dashboard

**Files:**
- Modify: `frontend/src/app/(app)/home/page.tsx`, `frontend/src/lib/api.ts`
- Create: `frontend/tests/unit/home-grid.test.ts`

**Interfaces:**
- Produces in `api.ts`: `ManagedUser` extended with `role: Role | null`, `accountStatus: AccountStatus`, `username: string | null`, `staffId: string | null`. **This extension is defined here, once** — Task 16 references it as already-existing.
- Produces: `gridColumnClass(count: number): string`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/home-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { gridColumnClass } from '../../src/app/(app)/home/page';

describe('gridColumnClass', () => {
  it('returns a single-column class for one card', () => {
    expect(gridColumnClass(1)).toBe('grid-cols-1');
  });

  it('returns a two-column class for two cards', () => {
    expect(gridColumnClass(2)).toBe('sm:grid-cols-2');
  });

  it('returns the three-column class for three or more cards', () => {
    expect(gridColumnClass(3)).toBe('sm:grid-cols-2 lg:grid-cols-3');
    expect(gridColumnClass(5)).toBe('sm:grid-cols-2 lg:grid-cols-3');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm test -- home-grid`
Expected: FAIL — `gridColumnClass` is not exported.

- [ ] **Step 3: Extend `api.ts`**

Find the existing `ManagedUser` type and add the four fields (do not create a second type):

```ts
export type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role | null;
  accountStatus: AccountStatus;
  username: string | null;
  staffId: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  capabilities: readonly Capability[];
};
```

- [ ] **Step 4: Implement `gridColumnClass` and the stat tiles**

In `frontend/src/app/(app)/home/page.tsx`, export the pure helper so the test can import it directly:

```ts
export function gridColumnClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'sm:grid-cols-2';
  return 'sm:grid-cols-2 lg:grid-cols-3';
}
```

Use it in place of the current fixed `sm:grid-cols-2 lg:grid-cols-3`:

```tsx
<div className={`grid gap-4 ${gridColumnClass(cards.length)}`}>
```

Above that grid, add a role-specific stat row. Because hooks cannot be called conditionally, always call `useAsync`, keying and branching on the role:

```tsx
const roleKey = session.data?.role ?? 'pending';

const stats = useAsync(async () => {
  if (session.data === null) return null;
  switch (session.data.role) {
    case 'MAKER': {
      const meetings = await api.meetings();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const thisWeek = meetings.meetings.filter((m) => new Date(m.occurredAt).getTime() >= weekAgo).length;
      return [{ label: 'Captures this week', value: String(thisWeek) }];
    }
    case 'CHECKER': {
      const approvals = await api.approvals();
      const pendingApprovals = approvals.approvals.filter((a) => a.decision === 'PENDING_CHECKER').length;
      const pendingSettlements = approvals.approvals.filter(
        (a) => a.decision === 'APPROVED' && a.settlement === null,
      ).length;
      return [
        { label: 'Pending approvals', value: String(pendingApprovals) },
        { label: 'Pending settlements', value: String(pendingSettlements) },
      ];
    }
    case 'SHARIAH': {
      const meetings = await api.meetings();
      return [{ label: 'Open findings', value: String(meetings.meetings.filter((m) => m.shariahFlagCount > 0).length) }];
    }
    case 'SUPERVISOR': {
      const meetings = await api.meetings();
      return [{ label: 'Recent activity', value: String(meetings.meetings.length) }];
    }
    case 'ADMIN': {
      const users = await api.users();
      const pending = users.users.filter((u) => u.accountStatus === 'PENDING').length;
      const active = users.users.filter((u) => u.accountStatus === 'ACTIVE').length;
      return [
        { label: 'Pending registrations', value: String(pending) },
        { label: 'Active users', value: String(active) },
      ];
    }
    default: {
      const meetings = await api.meetings();
      return [{ label: 'Meetings visible', value: String(meetings.meetings.length) }];
    }
  }
}, `home-stats-${roleKey}`);
```

`useAsync`'s existing `[key, nonce]` effect dependency and `loadRef` pattern (unchanged) mean this fetch fires exactly once more when `roleKey` flips from `'pending'` to the real role — no modification to the hook itself. Render `stats.data` as a row of `Stat` tiles above the existing card grid, and skip rendering the row entirely while `stats.loading` to avoid a layout flash.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test -- home-grid`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Verify in the browser**

Sign in as each seeded role and confirm the tiles match the role and the numbers are plausible; confirm a two-card role's grid is visually balanced (two-up, not a sparse three-up).

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(app)/home/page.tsx" frontend/src/lib/api.ts frontend/tests/unit/home-grid.test.ts
git commit -m "feat(home): add role-specific stat tiles and an adaptive card grid"
```

---

### Task 12 — Knowledge becomes graph-only

**Files:**
- Modify: `frontend/src/app/(app)/knowledge/page.tsx`

**Interfaces:**
- Consumes: none new — this task only removes code.

- [ ] **Step 1: Delete the ask form**

In `frontend/src/app/(app)/knowledge/page.tsx`, delete the `EXAMPLES` constant, the `Answer` component, and the entire ask-form `Card` (state: `question`/`answer`/`busy`/`error`, and its submit handler). That surface now lives solely in Task 10's `ask-fintalk-ai.tsx` (which already carries its own `EXAMPLES`). What remains is the page's `PageHeader` and the `Section` wrapping `KnowledgeGraphView`; give that section the full page width (remove any width constraint that assumed a form sat beside it).

- [ ] **Step 2: Verify in the browser**

Open Knowledge and confirm the graph renders at full width and node/edge click interaction still works exactly as before.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(app)/knowledge/page.tsx"
git commit -m "refactor(knowledge): remove ask form now that Ask FinTalk AI lives in the header panel"
```

---

### Task 13 — Capture accordion

**Files:**
- Modify: `frontend/src/app/(app)/record/page.tsx`

**Interfaces:**
- Consumes: Task 7's controllable `Disclosure`.

- [ ] **Step 1: Add step state**

In `RecordPage()`, add:

```ts
const [openStep, setOpenStep] = useState<1 | 2 | 3>(1);
const [submitted, setSubmitted] = useState(false);
const step1Complete = title.trim() !== '';
const step2Complete = isFullyAcknowledged(ack);
```

(`isFullyAcknowledged` is the existing helper this file already uses to check both consent checkboxes — reuse it, do not redefine it.)

- [ ] **Step 2: Convert the three `Card`s to controlled `Disclosure`s**

Replace the first always-open `Card` ("1. What is this meeting?") with:

```tsx
<Disclosure
  summary={step1Complete && openStep !== 1 ? `1. ${title}` : '1. What is this meeting?'}
  open={openStep === 1}
  onToggle={(isOpen) => {
    if (isOpen) setOpenStep(1);
  }}
>
  {/* ...existing title/description/participants/occurredAt fields, unchanged... */}
  <Button
    type="button"
    disabled={!step1Complete}
    onClick={() => setOpenStep(2)}
    className="mt-4"
  >
    Continue
  </Button>
</Disclosure>
```

Replace the second ("2. Permission to record") the same way:

```tsx
<Disclosure
  summary={step2Complete && openStep !== 2 ? '2. Consent confirmed' : '2. Permission to record'}
  open={openStep === 2}
  onToggle={(isOpen) => {
    if (isOpen) setOpenStep(2);
  }}
>
  {/* ...existing TransferNotice and both checkboxes, unchanged... */}
  <Button type="button" disabled={!step2Complete} onClick={() => setOpenStep(3)} className="mt-4">
    Continue
  </Button>
</Disclosure>
```

Replace the third ("3. Capture the audio"):

```tsx
<Disclosure
  summary={submitted ? '3. Captured' : '3. Capture the audio'}
  open={openStep === 3 && !submitted}
  onToggle={(isOpen) => {
    if (isOpen) setOpenStep(3);
  }}
>
  {/* ...existing mode radio, recorder controls, file inputs, preview, and the
       existing submit button, unchanged... */}
</Disclosure>
```

In the existing `submit()` function, add `setSubmitted(true)` on success, immediately before (or alongside) the existing `router.push('/meetings/${meetingId}')` call — the collapse-to-confirmation state only needs to be reachable for the instant before navigation actually happens, so this is a one-line addition, not a restructuring of `submit()`.

`onToggle`'s `if (isOpen) setOpenStep(n)` intentionally does nothing on `isOpen === false`: a step can be reopened by clicking it, but never self-closes out from under the user (e.g., clicking elsewhere cannot collapse it).

No other change to `submit()`, the recorder hook usage, file inputs, or the `beforeunload` effect.

- [ ] **Step 3: Verify in the browser**

Walk the full flow: type a title, continue, tick both checkboxes, continue, record or upload, submit. Then start over and click step 1 after it has collapsed — confirm it reopens and the title is editable without losing step 2/3 state.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(app)/record/page.tsx"
git commit -m "feat(capture): convert the three capture cards into a sequential accordion"
```

---

### Task 14 — Review: numbered rows, More Details, archive

**Files:**
- Modify: `frontend/src/app/(app)/meetings/page.tsx`, `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 4's `PATCH /meetings/:id/archive` and `createdById` on `GET /meetings`.
- Produces in `api.ts`: `MeetingSummary.createdById: string` (added to the existing type); `archiveMeeting(id: string): Promise<void>`.

- [ ] **Step 1: Extend `api.ts`**

Add `createdById: string;` to the existing `MeetingSummary` type. Add to the `api` object:

```ts
  archiveMeeting: (id: string) => apiFetch<void>(`/meetings/${id}/archive`, { method: 'PATCH' }),
```

- [ ] **Step 2: Restructure the list**

In `frontend/src/app/(app)/meetings/page.tsx`, change the `<ul>` mapping from a whole-row `<Link>` to:

```tsx
<ul className="space-y-3">
  {meetings.data?.meetings.map((meeting, index) => (
    <li key={meeting.id} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-sm font-medium text-faint">{index + 1}</span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">{meeting.title}</h3>
          <p className="mt-1 text-xs text-muted">{/* ...existing date/badges, unchanged... */}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/meetings/${meeting.id}`}>
            <Button variant="secondary">More Details</Button>
          </Link>
          {meeting.createdById === session.data?.id && mayCreate && (
            <Button
              variant="danger"
              onClick={() => {
                void api.archiveMeeting(meeting.id).then(() => meetings.reload());
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
    </li>
  ))}
</ul>
```

Preserve the existing date-formatting and status-badge JSX inside the `<p>` — only the wrapping structure (whole-row link → numbered `<li>` with explicit buttons) changes. `index + 1` is the row's position in the currently-fetched list, not a stored identifier, so numbering reflows naturally whenever `meetings.reload()` re-fetches a shorter list after an archive.

- [ ] **Step 3: Verify in the browser**

As the MAKER who captured a meeting: confirm the Delete button is present, archiving it removes it from the list and reflows the numbering. As a different MAKER and as a VIEWER: confirm the Delete button does not render for a meeting they did not create.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(app)/meetings/page.tsx" frontend/src/lib/api.ts
git commit -m "feat(review): number rows, add More Details button, add creator-scoped archive"
```

---

### Task 15 — Decide: Approvals / Settlement split

**Files:**
- Modify: `frontend/src/app/(app)/approvals/page.tsx`

**Interfaces:**
- Consumes: the existing `/approvals` payload shape — no backend change in this task.

- [ ] **Step 1: Split the list**

In `frontend/src/app/(app)/approvals/page.tsx`, replace the single flat `<ul>` with two derived arrays and two `Section`s:

```tsx
const pendingApprovals = approvals.data?.approvals.filter((a) => a.decision === 'PENDING_CHECKER') ?? [];
const pendingSettlements =
  approvals.data?.approvals.filter((a) => a.decision === 'APPROVED' && a.settlement === null) ?? [];
const recentlySettled = approvals.data?.approvals.filter((a) => a.settlement !== null) ?? [];
```

```tsx
<Section title="Approvals" action={<Badge>{pendingApprovals.length}</Badge>}>
  <ul className="space-y-3">
    {pendingApprovals.map((approval) => (
      <li key={approval.id}>{/* ...existing Card with DecideForm, unchanged... */}</li>
    ))}
  </ul>
</Section>

<Section title="Settlement" action={<Badge>{pendingSettlements.length}</Badge>}>
  <ul className="space-y-3">
    {pendingSettlements.map((approval) => (
      <li key={approval.id}>{/* ...existing Card with SettleForm, unchanged... */}</li>
    ))}
  </ul>

  {recentlySettled.length > 0 && (
    <div className="mt-6">
      <h3 className="text-xs font-medium uppercase tracking-wide text-faint">Recently settled</h3>
      <ul className="mt-2 space-y-2">
        {recentlySettled.map((approval) => (
          <li key={approval.id}>{/* ...existing read-only settled-record view, unchanged... */}</li>
        ))}
      </ul>
    </div>
  )}
</Section>
```

Move `DecideForm` and `SettleForm` (and the existing read-only settled view) to render under their respective sections exactly as they render today — this task changes which section wraps each card, not the cards themselves. `mayDecide`, `mayDownload`, and `maySettle` continue to gate the same controls they gate today. REJECTED, WITHDRAWN, and DRAFT approvals are simply not included in either filter, so they no longer appear on this page.

- [ ] **Step 2: Verify in the browser**

Sign in as CHECKER with at least one term sheet awaiting approval and one already-settled facility. Confirm both count badges are correct, the Approvals section only shows pending decisions, the Settlement section shows the approved-but-unsettled one, and "Recently settled" shows the settled one without a badge.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/(app)/approvals/page.tsx"
git commit -m "feat(decide): split Approvals and Settlement into separate labeled sections"
```

---

### Task 16 — Admin: pending-registration queue

**Files:**
- Modify: `frontend/src/app/(app)/admin/users/page.tsx`, `frontend/src/app/(app)/admin/page.tsx`, `frontend/src/app/(app)/layout.tsx`, `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: Task 11's extended `ManagedUser` (already carries `accountStatus`, `username`, `staffId`, nullable `role`).
- Produces in `api.ts`: `approveUser(id: string, role: Role): Promise<void>`; `rejectUser(id: string): Promise<void>`.

- [ ] **Step 1: Extend `api.ts`**

```ts
  approveUser: (id: string, role: Role) =>
    apiFetch<void>(`/users/${id}/approve`, json({ role }, { method: 'PATCH' })),
  rejectUser: (id: string) => apiFetch<void>(`/users/${id}/reject`, { method: 'PATCH' }),
```

(Match the exact `json()` helper signature already used by this file's other `PATCH` calls, e.g. `setUserRole` — do not invent a different call shape.)

- [ ] **Step 2: Fix `UserRow`'s nullable-role narrowing**

In `frontend/src/app/(app)/admin/users/page.tsx`, inside `UserRow`, add immediately before its JSX:

```tsx
// Safe: this component only ever renders for rows the Accounts section has
// already filtered to accountStatus === 'ACTIVE' (Step 4 below), and every
// ACTIVE row was assigned a role at approval or admin-direct-create time.
const role = user.role!;
```

Replace the two sites that break under `Role | null` — `ROLE_MEANING[user.role]` → `ROLE_MEANING[role]`, and `<Select value={user.role}>` → `<Select value={role}>`. Leave `<Badge>{user.role}</Badge>` as-is; it stringifies harmlessly either way.

- [ ] **Step 3: Add `PendingUserRow`**

In the same file, add a new component:

```tsx
function PendingUserRow({ user, onChanged }: { user: ManagedUser; onChanged: () => void }) {
  const [role, setRole] = useState<Role | ''>('');
  const [busy, setBusy] = useState(false);

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{user.displayName}</p>
          <p className="text-xs text-muted">{user.email}</p>
          <p className="mt-1 text-xs text-faint">
            Username: {user.username} · Staff ID: {user.staffId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
            <option value="">Choose a role…</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Button
            disabled={role === '' || busy}
            onClick={() => {
              if (role === '') return;
              setBusy(true);
              void api
                .approveUser(user.id, role)
                .then(onChanged)
                .finally(() => setBusy(false));
            }}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api
                .rejectUser(user.id)
                .then(onChanged)
                .finally(() => setBusy(false));
            }}
          >
            Reject
          </Button>
        </div>
      </div>
    </li>
  );
}
```

(`ROLES`, `Select`, `Button`, `useState`, `Role`, `ManagedUser` are all already imported/defined in this file or its existing imports — reuse them, do not redeclare.)

- [ ] **Step 4: Add the "Pending approval" section and filter Accounts**

Above the existing Accounts `Section`, add:

```tsx
const pending = users.data?.users.filter((u) => u.accountStatus === 'PENDING') ?? [];
const active = users.data?.users.filter((u) => u.accountStatus === 'ACTIVE') ?? [];
```

```tsx
{pending.length > 0 && (
  <Section title="Pending approval" action={<Badge>{pending.length}</Badge>}>
    <ul className="space-y-3">
      {pending.map((user) => (
        <PendingUserRow key={user.id} user={user} onChanged={() => users.reload()} />
      ))}
    </ul>
  </Section>
)}
```

Change the existing Accounts `Section`'s mapping from `users.data?.users.map(...)` to `active.map(...)`.

- [ ] **Step 5: Surface the pending count on `/admin` and in the nav**

In `frontend/src/app/(app)/admin/page.tsx`, add a gated fetch:

```tsx
const pendingCount = useAsync(async () => {
  if (!can(session.data, 'user:manage')) return null;
  const users = await api.users();
  return users.users.filter((u) => u.accountStatus === 'PENDING').length;
}, `admin-pending-${can(session.data, 'user:manage')}`);
```

Render `pendingCount.data` as a small `Badge` on the "Users and roles" `AREAS` card when it is greater than 0.

In `frontend/src/app/(app)/layout.tsx`, add the identical gated fetch and render its count as a small `Badge` next to the "Administration" label in the `nav` map, only for the item whose `href === '/admin'` and only when the count is greater than 0.

Both fetches are gated on `can(session, 'user:manage')` specifically because SUPERVISOR reaches `/admin` (holding `audit:read`) without holding `user:manage`, and an ungated call would 403 for that role.

- [ ] **Step 6: Verify in the browser**

Register a new account. Confirm the pending count appears on both the nav's Administration entry and the `/admin` card. Open `/admin/users`, approve it with a role, confirm it moves into Accounts and the count decrements, and confirm that account can now sign in. Register a second account and reject it — confirm the row disappears and an audit entry with the snapshotted fields exists (spot-check via the Audit page or the API directly).

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/app/(app)/admin/users/page.tsx" "frontend/src/app/(app)/admin/page.tsx" "frontend/src/app/(app)/layout.tsx" frontend/src/lib/api.ts
git commit -m "feat(admin): add pending-registration queue with approve/reject and nav badge"
```

---

## Verification

**Every task, before commit:**

```bash
cd backend && npm run typecheck && npm run lint && npm test
```

```bash
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

Integration tests need `DATABASE_URL` against Postgres 16 with migrations **and** `npm run db:constraints` applied. **CI is the verification environment for anything touching the database** — this machine has no local Postgres, so Task 1's migration and Task 3's transactional delete are first genuinely exercised there.

**Spec-specific gates (spec §14):**

1. **Registration → approval:** register creates a `PENDING` row with no role; login while `PENDING` is refused with the specific message; approve grants the role and login then succeeds; reject deletes the row and leaves an audit entry carrying the snapshotted details.
2. **Archive:** archiving hides the meeting from `GET /meetings` while a `TermSheet` / `Approval` / `Settlement` / `ShariahFlag` referencing it still resolves; a non-creator MAKER is refused.
3. **RBAC unchanged:** the existing capability tests pass **unmodified**. If any of them needed editing, something in this plan overreached.
4. **Reduced motion:** with `prefers-reduced-motion: reduce`, navigation is instant and no button animates.
5. **Contrast:** text over every new glass surface clears 4.5:1 in both themes.
6. **Multi-turn Ask:** a follow-up resolves against prior turns; an over-cap history is rejected rather than silently dropping the newest turn.

**Browser verification is not optional.** Three bugs in this project passed CI and broke in production (Safari's third-party cookie, the SSR `/api/health` URL, raw-401 downloads). Every frontend task ends in a real browser, and after deploy the end-to-end path gets walked against `https://fintalk-ai.vercel.app` — not only against the build.

**End-to-end demo path:** land on the public page → toggle to dark → sign up → sign in as admin, see the pending badge, approve with role MAKER → sign in as that MAKER, walk the Capture accordion end to end → open Ask FinTalk AI from the header, ask a question, ask a follow-up, click a citation → Review, archive the capture, watch numbering reflow → sign in as CHECKER, approve in Approvals, settle in Settlement → confirm the audit chain still verifies intact.

---

## Risks

- **Typecheck is red between Task 1 and Task 2.** Making `User.role` nullable breaks five call sites at once (`/auth/login` token-signing, `/auth/me`, `/auth/refresh`, `GET /users`'s `capabilitiesOf`, and `UserRow`). Splitting the migration from its fixes is deliberate — the compiler enumerates the sites — but Task 1's commit must say so, or a bisect later looks like a broken build.
- **`POST /auth/register` leaks account existence** via its `409` on a duplicate email. Accepted: this is an internal staff tool where the spec already judges the PENDING login message safe to name, and a registrant who cannot be told their email is taken cannot proceed. Worth revisiting if the surface ever becomes genuinely public.
- **Archive is creator-only.** If SUPERVISOR or ADMIN turn out to need it for stray captures, that is a capability decision (`meeting:archive`), deliberately deferred rather than assumed.
- **Settlement's "recently settled" list has no cap.** Fine at demo scale — the same ceiling already accepted for in-process graph similarity — but it needs one before real volume.
- **View Transitions has partial support** (not Firefox at time of writing). Scoped as pure decoration for exactly this reason; its absence must never block navigation.
- **Four secrets still need rotating** before real data: the Postgres password, both JWT secrets, and `PII_VAULT_KEY` — all four appeared in a chat transcript. Independent of this plan and unchanged by it.
- **Subagent-driven execution may not be available.** The `Agent` tool failed twice earlier in this session with a model error. If it is still broken, execution has to run inline in this session; that is a pacing difference, not a plan change.
