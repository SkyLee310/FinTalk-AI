# Google Meet Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a FinTalk AI user paste a Google Meet link and automatically receive the meeting's transcript and recording after the call ends, feeding it through the existing PDPA redaction → Shariah screening → audit pipeline.

**Architecture:** Two-phase approach. **Phase 1 (this plan):** Use the Google Meet REST API + Workspace Events API to subscribe to meeting-end events, then fetch the post-meeting transcript artifact from Google and pipe it through FinTalk AI's existing `processMeeting` pipeline. No bot joins the call — Google's own infrastructure generates the transcript. **Phase 2 (future):** Graduate to the Meet Media API for real-time audio streaming via WebRTC when the Developer Preview Program opens to general availability.

**Tech Stack:** Google Meet REST API v2, Google Workspace Events API, OAuth 2.0 (Google), googleapis npm package, Prisma, Fastify, Next.js

---

## Global Constraints

- All existing files in `backend/prisma/migrations/` are immutable history — never edit.
- `backend/scripts/fix-failed-migrations.mjs` documents a past production incident — never edit.
- `docs/superpowers/plans/*.md` are historical planning records — never edit existing ones.
- `Button` in `frontend/src/components/ui.tsx` only accepts `variant?: 'primary' | 'secondary' | 'danger'` — no `ghost` or `size` prop.
- Audio/transcript data must pass through PDPA redaction before storage. No exceptions.
- All database writes must be audited via `appendAuditWithin`.
- Test with `npx vitest run` in backend, `npm run build` with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080` in frontend.

---

## Proposed Changes

### Phase 1: Post-Meeting Artifact Pipeline

The approach:
1. User links their Google account (OAuth) in Settings
2. User pastes a Google Meet link when starting a meeting capture
3. FinTalk AI subscribes to that meeting's lifecycle events via Google Workspace Events API
4. When the meeting ends and Google generates the transcript, a webhook notifies our backend
5. Backend fetches the transcript text, converts it to our segment format, and runs it through the existing `processMeeting` pipeline (PDPA redaction → Shariah screening → decisions → action items → audit)

---

### Component 1: Dependencies & Environment Config

#### [MODIFY] `backend/package.json`
- Add `googleapis` dependency

#### [MODIFY] `backend/src/config/env.ts`
- Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (optional)
- Add `GOOGLE_WEBHOOK_SECRET` (optional)

---

### Component 2: Google OAuth Module & Token Storage

#### [NEW] `backend/src/auth/google-oauth.ts`
- Google OAuth 2.0 client setup using `googleapis` package
- Token exchange, refresh, and revocation helpers
- Scopes: `meetings.space.readonly`, `meetings.conference.media.readonly`

#### [MODIFY] `backend/prisma/schema.prisma`
- Add `GoogleToken` model to store encrypted OAuth refresh tokens per user
- Add `googleLinked Boolean @default(false)` to `User` model
- Add `CaptureSource` enum: `MICROPHONE`, `UPLOAD`, `GOOGLE_MEET`
- Add `captureSource CaptureSource @default(MICROPHONE)` to `Meeting`
- Add `meetLink String?` to `Meeting`
- Add `googleConferenceId String?` to `Meeting`

#### [NEW] `backend/prisma/migrations/20260819200000_google_meet_integration/migration.sql`
- Migration for GoogleToken table, User.googleLinked column, and Meeting capture fields

---

### Component 3: Google Auth & Webhook Routes

#### [NEW] `backend/src/routes/google-auth.routes.ts`
- `GET /auth/google/url` — returns OAuth consent URL
- `GET /auth/google/callback` — handles OAuth redirect, stores tokens
- `DELETE /auth/google/link` — revokes and removes stored tokens
- `GET /auth/google/status` — returns whether user has linked Google

#### [NEW] `backend/src/pipeline/google-meet-fetcher.ts`
- `fetchMeetTranscript(conferenceRecordName, accessToken)`: calls `conferenceRecords.transcripts.entries.list`
- `convertToSegments(googleEntries)`: maps Google entries to `SegmentDraft[]`

#### [NEW] `backend/src/routes/google-webhook.routes.ts`
- `POST /webhooks/google-meet` — receives Workspace Events notifications
- On transcript available: fetches transcript, triggers `processMeeting`

#### [MODIFY] `backend/src/routes/meetings.routes.ts`
- Add `POST /meetings/connect-meet` endpoint

#### [MODIFY] `backend/src/server.ts`
- Register `googleAuthRoutes` and `googleWebhookRoutes`

---

### Component 4: Frontend Settings & Record Page

#### [MODIFY] `frontend/src/lib/api.ts`
- Add Google OAuth and `connectMeet` API client methods

#### [MODIFY] `frontend/src/app/(app)/settings/page.tsx`
- Add Google Account linking card

#### [MODIFY] `frontend/src/app/(app)/record/page.tsx`
- Add third CaptureMode `'meet'` with Meet link input and validation
