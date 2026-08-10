-- Phase 2: in-browser recording metadata, and per-segment transcription
-- confidence.
--
-- Written by hand: there is no local Postgres, so `prisma migrate dev` cannot
-- generate it. `migrate deploy` checksums this file as written, and CI's
-- Postgres 16 is where it first actually executes.

-- ---------------------------------------------------------------------------
-- Meeting description
-- ---------------------------------------------------------------------------
-- Nullable, not NOT NULL DEFAULT ''. An empty string and "the operator wrote
-- none" are different facts, and the UI renders them differently.
ALTER TABLE "Meeting" ADD COLUMN "description" TEXT;

-- ---------------------------------------------------------------------------
-- Transcript segment confidence and human confirmation
-- ---------------------------------------------------------------------------
-- All three nullable. Every segment already stored was transcribed before
-- scoring existed, and NULL says exactly that. A DEFAULT of 1.0 would backfill
-- every historical segment as maximally trustworthy — the precise opposite of
-- the truth, and invisible once written.
ALTER TABLE "TranscriptSegment" ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER TABLE "TranscriptSegment" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "TranscriptSegment" ADD COLUMN "confirmedAt" TIMESTAMP(3);

ALTER TABLE "TranscriptSegment"
  ADD CONSTRAINT "TranscriptSegment_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON COLUMN "TranscriptSegment"."confidence" IS
  'Model self-reported certainty, 0-1. NOT a calibrated probability: Gemini returns no logprobs for audio, so this is the model asked how sure it is. NULL means not scored, never scored zero or one.';

-- ---------------------------------------------------------------------------
-- Meeting participants
-- ---------------------------------------------------------------------------
-- nameRedacted holds a placeholder such as [PERSON_NAME_1]. The name itself is
-- sealed in PiiVault with a Redaction row pointing at this participant, which is
-- why Redaction gains a third parent below.
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "nameRedacted" TEXT NOT NULL,
    "role" TEXT,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeetingParticipant_meetingId_ordinal_idx"
  ON "MeetingParticipant"("meetingId", "ordinal");

ALTER TABLE "MeetingParticipant"
  ADD CONSTRAINT "MeetingParticipant_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Redaction gains a third parent
-- ---------------------------------------------------------------------------
ALTER TABLE "Redaction" ADD COLUMN "participantId" TEXT;

CREATE INDEX "Redaction_participantId_idx" ON "Redaction"("participantId");

ALTER TABLE "Redaction"
  ADD CONSTRAINT "Redaction_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "MeetingParticipant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The exactly-one-parent invariant also lives in prisma/sql/constraints.sql,
-- which db:constraints applies on every deploy. It is restated here so a
-- database that is migrated but not yet constrained is not silently permissive
-- in the window between the two steps.
--
-- Counting, not chained XOR: `a <> b <> c` is also true when all three are set.
ALTER TABLE "Redaction" DROP CONSTRAINT IF EXISTS redaction_single_parent;
ALTER TABLE "Redaction" ADD CONSTRAINT redaction_single_parent CHECK (
  (("transcriptId" IS NOT NULL)::int
   + ("whiteboardId" IS NOT NULL)::int
   + ("participantId" IS NOT NULL)::int) = 1
);
