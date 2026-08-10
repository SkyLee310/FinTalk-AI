# FinTalk AI — UX Redesign & Self-Service Onboarding — Design Specification

**Date:** 2026-08-10
**Source:** Product-testing feedback from the app owner, following on from `docs/superpowers/specs/2026-08-08-fintalk-ai-design.md` and the eight-item program that restructured the IA into Capture/Review/Decide/Knowledge/Administration.
**Status:** proposed — awaiting review

---

## 1. What this changes

The app now works end to end, but three things are missing: a visual language (today's UI is functionally correct but flat — no theming choice, no depth, near-uniform styling), a way for a new person to get an account without an admin typing their password for them, and a clearer shape to four of the five sections a tester called confusing. This spec covers all three, as one redesign built on top of the existing spine — nothing here touches the RBAC model, the audit chain, the redaction pipeline, or the mock-settlement guard.

Everything below was walked through and agreed section by section before being written up here; this document is the durable record of that conversation, not a new proposal.

## 2. Decisions made during design

| Decision | Choice |
|---|---|
| Theme mechanism | User-controlled toggle (`data-theme` on `<html>` + `localStorage`), not OS-preference-only. CSS custom properties throughout — no animation/JS-theming library. |
| Glassmorphism | Native CSS `backdrop-filter` + translucent background + border, as a new `GlassPanel` component layered over the existing `Card`, not a replacement for it. |
| Transitions | Tailwind transition utilities for click feedback; View Transitions API for page navigation, with instant-navigation fallback where unsupported. Both respect `prefers-reduced-motion`. |
| Deleting a captured meeting | Archive (`archivedAt` timestamp), never a hard delete — mirrors the existing deactivate-never-delete pattern for `User`. Restricted to the MAKER who captured that meeting. |
| Ask FinTalk AI history | Session-only (resets on reload/sign-out). No new persistence tables for v1. |
| Username / Staff ID | Collected at sign-up for the approving admin to cross-check manually. Not a login identifier — login stays email + password, unchanged. |
| Rejecting a registration | A real, permanent delete of the pending row (safe here specifically because nothing in the system can yet reference an unapproved account), with an audit entry that snapshots the submitted details before the row goes. |
| Sign-up data model | Extend `User` in place (`username`, `staffId` nullable; `AccountStatus` enum; `role` nullable) rather than a separate request table. Internal admin-approved tool, not a public signup surface — the extra isolation a separate table buys isn't needed. |
| Admin-direct-create flow | Kept as-is (`POST /users`) alongside the new self-service path — this redesign adds a second on-ramp, it doesn't remove the first. |

## 3. Out of scope

- A restore/unarchive screen for archived meetings. The row is untouched in the database, so this can be added later without a migration; nothing here forecloses it.
- Persisting Ask FinTalk AI conversations across sessions, or letting a user browse past conversations.
- Any change to what a login identifier can be (still only email + password).
- Any change to who holds which `Capability` (`backend/src/auth/rbac.ts` is unmodified by this spec).

## 4. Global constraints

Carried forward from the original spec and still binding, unchanged by this redesign: `RedactedText` is the only write path for AI-derived text; audit entries append inside the transaction that writes the data they describe; money is `BigInt` minor units; the AI never issues a Shariah ruling; there is no real payment transmission; four-eyes holds (no role gains both `termsheet:submit` and `termsheet:approve`); `.env` is never committed.

New constraints this redesign introduces:

- **A `PENDING` account never receives a session.** Login checks `accountStatus` immediately after password verification — the same point, and the same reasoning, as the existing `deactivatedAt` check in `backend/src/routes/auth.routes.ts`.
- **Nothing may reference a `PENDING` registration.** It has no role and no capability, so it cannot appear in an audit entry as an actor beyond `user.registered` itself, cannot own a meeting, and cannot be party to an approval. This is precisely why rejecting one can be a real delete without touching the app's no-hard-delete precedent for `User` and `Meeting`.
- **Archiving a meeting must never remove or orphan a referencing row.** `TermSheet`, `Approval`, `Settlement`, `ShariahFlag`, and `Transcript` all continue to resolve their `meetingId` after the meeting they point to is archived.
- **New surfaces meet the existing contrast floor.** `globals.css` already requires `--faint` to clear 4.5:1 because it's used at `text-xs`; any new glass surface needs its own floor for text drawn over a blurred, semi-transparent background, since blur can quietly erode effective contrast that a flat color wouldn't.
- **`prefers-reduced-motion` continues to zero every transition**, including the new View Transitions API navigation — it is decoration, and must be able to disappear completely.

---

## 5. Design system foundation

**Theme toggle.** An icon button (sun/moon) in the header writes `data-theme="light"` or `"dark"` to `<html>` and to `localStorage`. A small inline script in the document head reads the stored value before first paint, so there's no flash of the wrong theme. A user who has never chosen keeps today's behavior — `prefers-color-scheme` decides — which the CSS expresses by keeping the existing `@media (prefers-color-scheme: dark)` block as the fallback beneath a new `:root[data-theme='dark']` block that wins once a choice exists. The toggle appears both on the public landing page and in the authenticated header, sharing the same storage key, so a preference set before signing in still holds after.

**Glassmorphism.** New tokens — `--glass-bg`, `--glass-border`, `--glass-highlight` — defined per-theme alongside the existing semantic tokens. A `GlassPanel` component (`frontend/src/components/glass-panel.tsx`) wraps content in `backdrop-blur-xl`, the translucent background, and a 1px border using these tokens. It's additive: the opaque `Card` is unchanged and stays the right choice for dense data (tables, transcript segments, audit rows) where blur would hurt legibility. `GlassPanel` is used for the landing hero, the new chat panel, and the collapsible Capture steps.

**Transitions.** Buttons get a short scale/opacity press-state via Tailwind's transition utilities — no new dependency. Full-page navigation crossfades using `document.startViewTransition()` where the browser supports it; where it doesn't (or `prefers-reduced-motion` is set), navigation is instant, exactly as it is today. This is why it's described as decoration rather than a feature: the app must be fully usable with it silently absent.

---

## 6. Public landing page & self-service onboarding

### 6.1 Landing page (`frontend/src/app/page.tsx`)

- Logo top-left; theme toggle top-right. No nav — there's nothing to navigate to before signing in.
- Hero: a `GlassPanel` over a soft abstract gradient background (no photography — keeps the page honest to "clean and minimalist" without needing an image asset) holding a headline, one-line subhead, and two buttons: **Sign in** and **Sign up**, both routing to `/login`.
- The existing four-pillar (Capture/Review/Decide/Administration) section and the guarantees section stay, restyled with the new tokens; content unchanged.
- **System status moves to the bottom** as a slim full-width bar — a live dot plus text sourced from the same `/health` fetch that powers today's mid-page card, with an optional disclosure for the raw detail. Moving it to the footer is a deliberate demotion: it's reference information for someone checking whether the service is up, not something that belongs in the first thing a visitor reads.

### 6.2 Sign in / Sign up (`frontend/src/app/login/page.tsx`)

One page, one `GlassPanel` card, a segmented control at the top switches between **Sign in** and **Sign up** — not two separate routes, so the two forms read as one identity flow rather than disconnected pages.

- **Sign in**: unchanged fields (email, password). Behavior changes only in what the server can now say back (see §6.4).
- **Sign up**: full name, email, password, confirm password, username, staff ID. Confirm password is a client-side match check only — it is never sent to the server, exactly like every other password-confirmation field. Client-side validation otherwise mirrors what the server enforces (see §6.3); submitting shows a full-page confirmation — *"Your request has been submitted. An administrator will review it and assign your access."* — rather than signing the user in, because there is nothing to grant a session for yet: no role exists until approval.

### 6.3 Data model

`backend/prisma/schema.prisma`, on `User`:

- `username String?` — unique when present, nullable at the schema level.
- `staffId String?` — nullable, no uniqueness constraint (an employer's staff ID scheme is not this app's to enforce).
- New enum `AccountStatus { PENDING ACTIVE }`; `accountStatus AccountStatus @default(ACTIVE)` — existing rows are unaffected by the migration.
- `role Role?` — becomes nullable; a `PENDING` user has none yet.

`username` and `staffId` are nullable in the database but required by the `/auth/register` endpoint's own validation. This is deliberate, not an oversight: making them required at the schema level would force a backfill value onto every existing admin-created account that never collected one, and would require the admin-direct-create endpoint (`POST /users`, unchanged by this spec) to start collecting fields it has no need for. The rule lives at the boundary that actually needs it.

### 6.4 Routes

- **`POST /auth/register`** (public, unauthenticated) — validates the five fields (email and username uniqueness checked against existing users; the same password policy as today's admin-created accounts), hashes the password, creates a `User` with `accountStatus: PENDING` and `role: null`. Audited as `user.registered`.
- **`POST /auth/login`** (`backend/src/routes/auth.routes.ts:42`) — gains a status check immediately after password verification, alongside the existing `deactivatedAt` check: a `PENDING` account is refused with a message naming the reason ("awaiting administrator approval") rather than the generic invalid-credentials response, since — unlike a wrong password — this isn't a case the timing-safe/enumeration-safe comparison needs to hide.
- **`PATCH /users/:id/approve`** (`user:manage`) — body `{ role }`. One transaction: set the role, flip `accountStatus` to `ACTIVE`, audit `user.approved`.
- **`PATCH /users/:id/reject`** (`user:manage`) — valid only while `accountStatus === 'PENDING'`. Writes an audit entry capturing the row's current fields (name, email, username, staffId) as `user.registration.rejected`, then deletes the row inside the same transaction.

### 6.5 Admin approval UI

Rather than a new nav destination, `frontend/src/app/(app)/admin/users/page.tsx` gains a **"Pending approval"** list above the existing active-user list — each row shows name, email, username, staff ID, a role picker, and **Approve**/**Reject** buttons (Approve disabled until a role is picked). The role picker offers the same full role set as the existing admin-direct-create form (`POST /users`) — no new restriction on which roles can be granted through this path. The Administration card on `/admin` and the nav's Administration entry both show the pending count, so an admin notices without opening the page speculatively.

---

## 7. Authenticated shell & Home dashboard

### 7.1 Header (`frontend/src/app/(app)/layout.tsx`)

Two new icon buttons join the right-hand cluster, ordered left-to-right before the existing name/role/sign-out group: **theme toggle**, then **Ask FinTalk AI**. Both sit in the same top-right region as the rest of the account cluster — "top right corner" without displacing sign-out from the corner position people already expect it in.

The Ask FinTalk AI icon is visible only to sessions holding `transcript:read` — the same gate as Review and Knowledge. This isn't an arbitrary restriction: the assistant answers from redacted transcripts, so a role without read access to that corpus (ADMIN, by design — see `backend/src/auth/rbac.ts`) shouldn't gain a side door to it through chat.

### 7.2 Home (`frontend/src/app/(app)/home/page.tsx`)

Two concrete problems with today's version, and their fixes:

- **It's a menu, not a page.** Above the existing section-card grid, add a row of small stat tiles specific to what the signed-in role actually does: a MAKER sees a "Start a new capture" call-to-action plus a meetings-captured-this-week count; a CHECKER sees pending-approvals and pending-settlements counts; SHARIAH sees an open-findings count; SUPERVISOR sees a recent-activity count; ADMIN sees pending-registrations and active-user counts; VIEWER sees what they currently have access to view. Every number is computed client-side from data the existing list endpoints already return — no new stats endpoint.
- **The grid looks unbalanced for roles with few sections.** Today's fixed `sm:grid-cols-2 lg:grid-cols-3` leaves visible empty space for a role with only two visible cards. The grid's column count adapts to how many cards that role actually has, so a two-card role gets a balanced two-up row instead of a sparse three-up one.

The result reads as "here's what's happening, here's where to go," which is also the direct fix for the "looks like a tutorial" complaint — a tutorial has no live numbers in it.

---

## 8. Ask FinTalk AI (chatbot)

- Clicking the header icon slides a `GlassPanel` in from the right, over whatever page is open, with a dismissible backdrop scrim — never a navigation, so the user never loses their place.
- Standard chat layout: user turns right-aligned, assistant turns left-aligned, each answer's citations rendered as small linked chips beneath it pointing at the cited meeting's detail page — the same citation data the current single-shot Ask feature already returns, restyled as chat bubbles.
- Empty state shows two or three clickable example questions instead of blank space.
- Conversation state is an array of `{ role, content, citations? }` held in the app shell (`(app)/layout.tsx`), so it survives navigating between pages within a session and resets on reload or sign-out, per §2.
- Backend: `POST /knowledge/ask` (`backend/src/routes/knowledge.routes.ts:40`) gains an optional `history` field (prior turns). Retrieval reformulates its search using the last few turns rather than only the newest message, so a follow-up like "what about the second one" resolves against the conversation instead of being evaluated alone. History sent per request is capped (last ~10 turns) to bound token usage. The route's path doesn't need to change just because its frontend entry point moved — the backend concept is still "ask a question of the transcript corpus."

---

## 9. Knowledge (`frontend/src/app/(app)/knowledge/page.tsx`)

Becomes graph-only. The Ask form is deleted from this page entirely — it now lives solely in the header panel (§8). The page is the header plus the existing `KnowledgeGraphView`, now given the full page width instead of sharing it with a form above.

---

## 10. Capture — collapsible steps (`frontend/src/app/(app)/record/page.tsx`)

Reuses the existing `Disclosure` component (`frontend/src/components/ui.tsx`, built on native `<details>`) rather than adding new accordion logic:

- **Step 1 — "What is this meeting?"** open by default. A **Continue** button, enabled once the title is non-empty, collapses it to a one-line summary (the title) and opens step 2.
- **Step 2 — "Permission to record"** opens automatically when step 1 collapses. Continue, enabled once both the participant-consent and cross-border-transfer checkboxes are ticked, collapses it to "Consent confirmed" and opens step 3.
- **Step 3 — "Capture the audio"** opens automatically and stays open through recording — the elapsed timer and level meter need to stay visible while it runs. It collapses only after a successful submit, replaced by a confirmation state.
- Every collapsed step remains clickable to reopen and edit — a mistyped title doesn't require starting the flow over.

No change to the underlying recording, upload, or whiteboard logic; this is a presentation restructuring of the same three existing `Card` sections into sequential disclosures.

---

## 11. Review — numbered, archivable list (`frontend/src/app/(app)/meetings/page.tsx`)

- Each row gains a leading number — its position in the currently visible list, not a stored identifier, so numbering simply reflows when a row is archived.
- The row's title/date/badges are no longer themselves the link. An explicit **More Details** button navigates to the detail page; the rest of the row is plain content.
- A delete control archives: it calls a new **`PATCH /meetings/:id/archive`** route, which sets `Meeting.archivedAt` (new nullable `DateTime?` field) inside a transaction with a `meeting.archived` audit entry. `GET /meetings` (`backend/src/routes/meetings.routes.ts:314`) adds a `WHERE archivedAt IS NULL` filter.
- The archive route is gated to the meeting's own creator (`createdById === session.id`) holding `meeting:create` — in practice, the MAKER who captured it. This keeps archiving a low-stakes personal-cleanup action rather than letting any Review viewer hide an item from what is otherwise a shared list; once archived, though, it's hidden for everyone, since it's the record being marked, not a personal filter.
- Archiving is safe regardless of what points at the meeting — a `TermSheet`, `Approval`, `Settlement`, or `ShariahFlag` keeps resolving its `meetingId` normally; only the Review list's own query excludes it.

---

## 12. Decide — Approvals / Settlement split (`frontend/src/app/(app)/approvals/page.tsx`)

Two labeled sections replace today's single merged list, each with its own count badge:

- **Approvals** — term sheets awaiting a decision. Count badge is the number awaiting one. A decided term sheet leaves this section either way: rejected ones are finished, approved ones move into Settlement.
- **Settlement** — approved term sheets awaiting settlement. Count badge is the number still pending settlement. Beneath it, a short "recently settled" list (no badge) shows what's already been settled, using data the existing settlements endpoint already returns, so a checker can see what they just did without leaving the page.

Capability gating is unchanged from today (`mayDecide`, `mayDownload`, `maySettle` continue to drive what's interactive) — this section is a layout change, not a permissions change.

---

## 13. Role-by-role summary

| Role | Home | Capture | Review | Decide | Knowledge | Ask FinTalk AI | Administration |
|---|---|---|---|---|---|---|---|
| VIEWER | stat: meetings visible | — | view only, no archive control shown | — | graph, read-only | ✓ | — |
| MAKER | stat: captures this week + CTA | ✓ full accordion flow | view + archive own meetings | own submissions, read-only, in whichever section they currently sit (unchanged from today) | ✓ | ✓ | — |
| CHECKER | stat: pending approvals/settlements | — | view only | both sections, fully interactive | ✓ | ✓ | — |
| SHARIAH | stat: open findings | — | view + Shariah review action (unchanged) | — | ✓ | ✓ | — |
| SUPERVISOR | stat: recent activity | — | view only | — | ✓ | ✓ | audit trail (unchanged) |
| ADMIN | stat: pending registrations + active users | — | — (no `transcript:read`, unchanged) | — | — (same reason) | — (same reason, §7.1) | users, registrations, audit |

Every cell is a visibility/layout change; no cell changes which `Capability` a role holds.

---

## 14. Testing considerations

- **Registration → approval flow**: register creates a `PENDING` row with no role; login while `PENDING` is refused with the specific message; approve grants the chosen role and login then succeeds; reject deletes the row and leaves an audit entry with the snapshotted details.
- **Archive**: archiving hides a meeting from `GET /meetings` but a `TermSheet`/`Approval`/`Settlement`/`ShariahFlag` referencing it still resolves; a non-creator MAKER (or any other role) attempting to archive someone else's meeting is refused.
- **Four-eyes / RBAC unchanged**: existing capability tests continue to pass unmodified — this redesign adds no capability and removes none.
- **Reduced motion**: a test asserting the View Transitions call is skipped (or degrades to instant navigation) under `prefers-reduced-motion: reduce`.
- **Contrast**: any new glass-surface text token meets 4.5:1 against its blurred background in both themes.
- **Multi-turn Ask**: a follow-up question resolves using prior turns' context; history beyond the cap is dropped, not silently truncating the newest turn.

## 15. Risks / open questions

- **Archive is scoped to the creator only.** If it turns out SUPERVISOR or ADMIN also need to archive stray/duplicate captures on someone else's behalf, that's a capability decision (likely a new `meeting:archive` grant) deliberately deferred rather than assumed here.
- **Settlement's "recently settled" list has no cap or pagination specified.** Fine at demo scale (the same scale ceiling already accepted for in-process knowledge-graph similarity in the original spec); would need one before real transaction volume.
- **The View Transitions API has partial browser support** (notably not in Firefox at time of writing). It is scoped as pure enhancement for exactly this reason — its absence must never block navigation.
