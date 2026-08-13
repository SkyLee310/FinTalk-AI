-- Wall-clock milliseconds the capture pipeline took, from entry to the
-- transcript-writing transaction: transcription, redaction, summarisation and
-- persistence. Nullable on purpose — transcripts written before this column
-- existed have no timing, and the seed fixture inserts none. Surfaced on the
-- meeting page as "processing time" (request: an estimate of how long, in
-- minutes and seconds, processing a recording took).
ALTER TABLE "Transcript" ADD COLUMN "processingMs" INTEGER;
