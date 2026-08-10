-- Phase 5: cross-meeting topics and summary embeddings.
--
-- Hand-written, as the others were: no local Postgres, so `migrate deploy`
-- checksums this file as written and CI's Postgres 16 executes it first.

-- ---------------------------------------------------------------------------
-- Summary embeddings
-- ---------------------------------------------------------------------------
-- A plain double-precision array, deliberately not pgvector. Railway's Postgres
-- image cannot be assumed to carry the extension, and cosine similarity over a
-- demo-sized corpus is a millisecond loop in application code. That is a real
-- scale ceiling, documented where someone would hit it rather than discovered at
-- a thousand meetings.
--
-- DEFAULT '{}' so existing transcripts get an empty array rather than NULL. The
-- distinction between "no embedding" and "an embedding of nothing" has no meaning
-- here, and an empty array keeps every read path free of null checks.
ALTER TABLE "Transcript"
  ADD COLUMN "summaryEmbedding" DOUBLE PRECISION[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN "Transcript"."summaryEmbedding" IS
  'Embedding of summaryEn, which is already redacted — so this encodes placeholders, never identifiers. Empty when not yet embedded.';

-- ---------------------------------------------------------------------------
-- Meeting topics
-- ---------------------------------------------------------------------------
-- The material a knowledge-graph edge is made of. Never a person: redaction
-- contexts are per-meeting, so [NRIC_1] in two meetings is two different people,
-- and an edge between them would assert a relationship that does not exist.
CREATE TABLE "MeetingTopic" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MeetingTopic_pkey" PRIMARY KEY ("id")
);

-- One row per label per meeting, so re-running extraction cannot double-count a
-- topic and inflate an edge's strength.
CREATE UNIQUE INDEX "MeetingTopic_meetingId_label_key"
  ON "MeetingTopic"("meetingId", "label");

-- The join that finds meetings sharing a topic.
CREATE INDEX "MeetingTopic_label_idx" ON "MeetingTopic"("label");

ALTER TABLE "MeetingTopic"
  ADD CONSTRAINT "MeetingTopic_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Weight is a proportion, like every other confidence in this schema.
ALTER TABLE "MeetingTopic" ADD CONSTRAINT topic_weight_range CHECK (
  weight >= 0 AND weight <= 1
);

-- Labels are normalised to lower case on write, and enforced here too — so a
-- future caller cannot introduce "Murabahah" alongside "murabahah" and split one
-- topic into two nodes that never link to each other.
ALTER TABLE "MeetingTopic" ADD CONSTRAINT topic_label_normalised CHECK (
  label = lower(label) AND length(trim(label)) > 0
);
