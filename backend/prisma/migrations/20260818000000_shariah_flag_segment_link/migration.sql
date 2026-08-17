-- A Shariah finding used to be just a quoted excerpt with nowhere to jump to
-- in the transcript, and the rule engine raised one finding per regex match
-- rather than per sentence — so a sentence quoting two trigger phrases (an
-- interest rate figure and the words "interest rate" in the same breath, for
-- instance) read as two occurrences of the same rule. segmentId lets a
-- finding point at the line that raised it; highlights carries the phrases
-- the engine actually matched, for underlining them inside the excerpt.

ALTER TABLE "ShariahFlag" ADD COLUMN "segmentId" TEXT;
ALTER TABLE "ShariahFlag" ADD COLUMN "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ShariahFlag"
  ADD CONSTRAINT "ShariahFlag_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "TranscriptSegment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ShariahFlag_segmentId_idx" ON "ShariahFlag"("segmentId");
