-- Records that the operator acknowledged the cross-border transfer to Google
-- before the recording was accepted (spec §12.3).
--
-- Existing rows take false and keep it. That is not a gap to backfill: those
-- meetings genuinely were uploaded before the disclosure existed, and setting
-- them true would fabricate evidence of a consent nobody gave.
--
-- The DEFAULT is kept rather than dropped, unlike the NOT NULL columns added in
-- 20260809000000. There the default existed only to satisfy existing rows and
-- leaving it would have let a caller omit a required value. Here false IS the
-- correct value for an omitted acknowledgement, so the default is the safe
-- outcome rather than a silent one.
ALTER TABLE "Meeting"
  ADD COLUMN "transferAcknowledged" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "Meeting"."transferAcknowledged" IS
  'Operator acknowledged the cross-border transfer to Google before upload. Distinct from consentConfirmed, which records participant consent to being recorded. False on rows predating 2026-08-10 by design.';
