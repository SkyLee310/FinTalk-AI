-- A redaction may now belong to a whiteboard instead of a transcript.
ALTER TABLE "Redaction" ALTER COLUMN "transcriptId" DROP NOT NULL;
ALTER TABLE "Redaction" ADD COLUMN "whiteboardId" TEXT;

-- Existing rows all belong to transcripts, so the new column stays NULL and the
-- single-parent CHECK in prisma/sql/constraints.sql holds without a backfill.

-- Whiteboard may already hold rows on a deployed database, so the column is
-- added with a default and the default is then dropped: ADD COLUMN ... NOT NULL
-- with no default fails outright on a non-empty table.
ALTER TABLE "Whiteboard" ADD COLUMN "rawRedacted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Whiteboard" ALTER COLUMN "rawRedacted" DROP DEFAULT;

-- Recreated because the column it references is now nullable.
ALTER TABLE "Redaction" DROP CONSTRAINT "Redaction_transcriptId_fkey";
ALTER TABLE "Redaction"
  ADD CONSTRAINT "Redaction_transcriptId_fkey"
  FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Redaction"
  ADD CONSTRAINT "Redaction_whiteboardId_fkey"
  FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Redaction_whiteboardId_idx" ON "Redaction"("whiteboardId");
