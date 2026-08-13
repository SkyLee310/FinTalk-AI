-- Phase D: meeting intelligence — the final decision each debated point
-- reached, a who/what/when action list, and an instant project-kickoff draft
-- with its follow-ups. All four are best-effort AI output, re-verified with
-- redactDerived before storage; see deriveIntelligence in
-- src/pipeline/process-meeting.ts.

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------
-- A decision the meeting reached, distilled by the arbiter from the debate.
-- topic/decision/rationale are model output, re-verified before storage, so
-- they hold placeholders where they reference a person, never a name.
CREATE TABLE "MeetingDecision" (
    "id"        TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "topic"     TEXT NOT NULL,
    "decision"  TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "ordinal"   INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingDecision_meetingId_ordinal_idx"
  ON "MeetingDecision"("meetingId", "ordinal");

ALTER TABLE "MeetingDecision"
  ADD CONSTRAINT "MeetingDecision_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Action items
-- ---------------------------------------------------------------------------
-- A follow-up action, attributed to a role or speaker label — never a name.
-- owner/task/dueDate are model output, re-verified before storage. `owner` is
-- a meeting role or speaker label by construction: the prompt attributes by
-- role, and names are placeholders in the input anyway.
CREATE TABLE "ActionItem" (
    "id"        TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "owner"     TEXT NOT NULL,
    "task"      TEXT NOT NULL,
    "dueDate"   TEXT,
    "ordinal"   INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActionItem_meetingId_ordinal_idx"
  ON "ActionItem"("meetingId", "ordinal");

ALTER TABLE "ActionItem"
  ADD CONSTRAINT "ActionItem_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Project kickoff + follow-ups
-- ---------------------------------------------------------------------------
-- Same derivation and re-verification as the two tables above. Null/empty
-- when no provider produced one or a PII check skipped it — never a reason to
-- fail the capture.
ALTER TABLE "Transcript" ADD COLUMN "projectKickoffRedacted" TEXT;
ALTER TABLE "Transcript" ADD COLUMN "followUpsRedacted" TEXT[] NOT NULL DEFAULT '{}';
