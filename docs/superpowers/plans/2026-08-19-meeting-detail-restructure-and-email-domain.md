# Meeting Detail Restructure + Per-Meeting AI & Demo Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the meeting detail page into 3 focused tabs (`Summary`, `Transcript`, `Term Sheet`), embed a per-meeting AI Q&A assistant backed by a new endpoint `POST /meetings/:id/ask`, update demo account email domains from `@fintalk.test` to `@fintalk.ai`, and provide a safe migration script for live data.

**Architecture:** 
- Split the monolithic `meetings/[id]/page.tsx` into modular sibling components in `frontend/src/components/meeting-detail/` (`summary-section.tsx`, `transcript-section.tsx`, `term-sheet-section.tsx`, and `meeting-chat.tsx`).
- Extend `assistant.ts` with optional `meetingId` to provide single-meeting direct retrieval without corpus ranking, exposed via `POST /meetings/:id/ask` with `assistant.queried.meeting` audit logging.
- Update demo email addresses across database seeds, login UI presets, test fixtures, and documentation, with a standalone execution script `rename-demo-emails.mjs`.

**Tech Stack:** Next.js (App Router), React, Tailwind CSS, Fastify, Prisma, TypeScript, Vitest.

## Global Constraints

- Preserve PDPA redaction guarantees: vault is never touched, answers only cite provided excerpts, PII detector scans generated text before return.
- Do not edit historical migrations (`backend/prisma/migrations/20260813030000_fix_oversight_defaults/migration.sql`) or incident records (`backend/scripts/fix-failed-migrations.mjs`).
- Isolate all changes to the worktree branch.

---

### Task 1: Fix Prisma Schema Default for `summaryEmbedding` and Update Unit Tests

**Files:**
- Modify: `backend/prisma/schema.prisma:314`
- Modify: `backend/src/pdpa/transcript-store.ts:60-70`

**Interfaces:**
- Consumes: Prisma schema
- Produces: `Transcript.summaryEmbedding` with default `[]`

- [ ] **Step 1: Update schema.prisma and transcript-store.ts**
Add `@default([])` to `summaryEmbedding Float[]` in `schema.prisma` and ensure `transcript-store.ts` passes `summaryEmbedding: input.summaryEmbedding ?? []`.

- [ ] **Step 2: Generate Prisma Client & Run unit tests**
Run: `npm run db:generate && npm test`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add backend/prisma/schema.prisma backend/src/pdpa/transcript-store.ts
git commit -m "fix(db): add default empty array to summaryEmbedding on Transcript"
```

---

### Task 2: Backend Per-Meeting AI Assistant & `POST /meetings/:id/ask` Route

**Files:**
- Modify: `backend/src/knowledge/assistant.ts`
- Modify: `backend/src/routes/meetings.routes.ts`
- Modify: `backend/src/audit/events.ts` (if action enum/type needs updating)
- Test: `backend/tests/integration/meetings.routes.test.ts`
- Test: `backend/tests/unit/knowledge/assistant.test.ts` (or integration test)

**Interfaces:**
- Consumes: `AssistantDeps`, `AskInput { question, actor, history?, meetingId? }`
- Produces: `POST /meetings/:id/ask` endpoint returning `AskResult`

- [ ] **Step 1: Extend `ask()` in `assistant.ts` to support `meetingId`**
When `input.meetingId` is supplied:
- Fetch the single transcript for `{ meetingId: input.meetingId, meeting: { status: 'READY', archivedAt: null } }`.
- If not found: return unanswerable with informative message.
- If found: pass directly as sole excerpt to `answerFromContext(composite, [excerpt])`.
- Audit with action `'assistant.queried.meeting'`, `entityType: 'Meeting'`, `entityId: input.meetingId`.

- [ ] **Step 2: Add `POST /meetings/:id/ask` route to `meetings.routes.ts`**
- Validate user capabilities (`meeting:read`, `transcript:read`).
- Parse request body `{ question: string, history?: AskHistoryEntry[] }`.
- Call `ask(deps, { question, actor, history, meetingId })`.

- [ ] **Step 3: Write tests and verify**
Run: `npx vitest run tests/integration/meetings.routes.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add backend/src/knowledge/assistant.ts backend/src/routes/meetings.routes.ts backend/tests/
git commit -m "feat(backend): add per-meeting AI assistant route POST /meetings/:id/ask"
```

---

### Task 3: Demo Account Email Domain Migration (`@fintalk.test` → `@fintalk.ai`)

**Files:**
- Modify: `backend/prisma/seed.ts`
- Modify: `frontend/src/app/login/page.tsx`
- Modify: `README.md`
- Modify: Integration tests (`auth.routes.test.ts`, `users.routes.test.ts`, `meetings.routes.test.ts`, `feedback.routes.test.ts`, `segment-review.test.ts`, `settlement.test.ts`, `whiteboards.routes.test.ts`, `compliance.test.ts`, `live-caption.routes.test.ts`)
- Create: `backend/scripts/rename-demo-emails.mjs`

- [ ] **Step 1: Update demo emails across seed, login page, and README**
Replace all `@fintalk.test` references with `@fintalk.ai`.

- [ ] **Step 2: Update all test templates**
Update email generators in `backend/tests/integration/*.test.ts`.

- [ ] **Step 3: Create `backend/scripts/rename-demo-emails.mjs`**
Idempotent script using `pg` to execute:
`UPDATE "User" SET email = REPLACE(email, '@fintalk.test', '@fintalk.ai') WHERE email LIKE '%@fintalk.test';`

- [ ] **Step 4: Run integration tests to verify**
Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add backend/prisma/seed.ts frontend/src/app/login/page.tsx README.md backend/tests/ backend/scripts/rename-demo-emails.mjs
git commit -m "feat: migrate demo account emails from @fintalk.test to @fintalk.ai"
```

---

### Task 4: Frontend Meeting Detail Page Restructure & Per-Meeting AI Chat

**Files:**
- Create: `frontend/src/components/meeting-detail/tabs.tsx`
- Create: `frontend/src/components/meeting-detail/summary-section.tsx`
- Create: `frontend/src/components/meeting-detail/transcript-section.tsx`
- Create: `frontend/src/components/meeting-detail/term-sheet-section.tsx`
- Create: `frontend/src/components/meeting-detail/meeting-chat.tsx`
- Modify: `frontend/src/app/(app)/meetings/[id]/page.tsx`
- Modify: `frontend/src/lib/api.ts` (add `api.meetings.ask(meetingId, query, history)`)

- [ ] **Step 1: Add API client method `api.meetings.ask`**
In `frontend/src/lib/api.ts`, add `ask(id: string, question: string, history?: ChatMessage[])`.

- [ ] **Step 2: Create tab components and sections in `frontend/src/components/meeting-detail/`**
- `tabs.tsx`: Accessible tab bar (`Summary`, `Transcript`, `Term Sheet`) with smooth active indicator and keyboard navigation.
- `summary-section.tsx`: Displays overview, participation, Shariah flags, decisions, action items, kickoff, attachments, and embeds `MeetingChat`.
- `meeting-chat.tsx`: Per-meeting AI Q&A panel with turn history, suggested quick prompts, and citation badges.
- `transcript-section.tsx`: Audio player, transcript segments with speaker labels, and redaction log.
- `term-sheet-section.tsx`: Extracted term sheet suggestion & interactive drafting form.

- [ ] **Step 3: Refactor `frontend/src/app/(app)/meetings/[id]/page.tsx`**
Replace the 1,504-line monolithic layout with the new tabbed structure importing the modular section components.

- [ ] **Step 4: Verify frontend builds without errors**
Run: `npm --prefix frontend run build` or `npm --prefix frontend run lint`
Expected: PASS

- [ ] **Step 5: Commit and Push**
```bash
git add frontend/
git commit -m "feat(frontend): restructure meeting detail page into 3 tabs and embed per-meeting AI"
git push -u origin feat/meeting-detail-restructure-and-email-domain
```
