-- Invariants that must not be bypassable by application code.
-- Idempotent so it can be re-run after any migration.

-- Spec §5.3 — an Islamic facility has a profit rate under a named contract;
-- a conventional facility has an interest rate. Never both.
ALTER TABLE "TermSheet" DROP CONSTRAINT IF EXISTS term_sheet_rate_kind_exclusive;
ALTER TABLE "TermSheet" ADD CONSTRAINT term_sheet_rate_kind_exclusive CHECK (
  (   "facilityKind" = 'CONVENTIONAL'
  AND "interestRateBps" IS NOT NULL
  AND "profitRateBps"   IS NULL
  AND "islamicContract" IS NULL )
  OR
  (   "facilityKind" = 'ISLAMIC'
  AND "profitRateBps"   IS NOT NULL
  AND "interestRateBps" IS NULL
  AND "islamicContract" IS NOT NULL )
);

-- Money and rates are non-negative integers.
ALTER TABLE "TermSheet" DROP CONSTRAINT IF EXISTS term_sheet_amounts_non_negative;
ALTER TABLE "TermSheet" ADD CONSTRAINT term_sheet_amounts_non_negative CHECK (
  "principalMinor" > 0
  AND "tenureMonths" > 0
  AND COALESCE("interestRateBps", 0) >= 0
  AND COALESCE("profitRateBps", 0) >= 0
);

-- Spec §5.5 — segregation of duties.
ALTER TABLE "Approval" DROP CONSTRAINT IF EXISTS approval_checker_not_maker;
ALTER TABLE "Approval" ADD CONSTRAINT approval_checker_not_maker CHECK (
  "checkerId" IS NULL OR "checkerId" <> "makerId"
);

-- Confidence values are probabilities.
ALTER TABLE "Redaction" DROP CONSTRAINT IF EXISTS redaction_confidence_range;
ALTER TABLE "Redaction" ADD CONSTRAINT redaction_confidence_range CHECK (
  confidence >= 0 AND confidence <= 1
);
ALTER TABLE "ShariahFlag" DROP CONSTRAINT IF EXISTS shariah_flag_confidence_range;
ALTER TABLE "ShariahFlag" ADD CONSTRAINT shariah_flag_confidence_range CHECK (
  confidence >= 0 AND confidence <= 1
);

-- A resolved Shariah flag must record who resolved it and when.
ALTER TABLE "ShariahFlag" DROP CONSTRAINT IF EXISTS shariah_flag_resolution_attributed;
ALTER TABLE "ShariahFlag" ADD CONSTRAINT shariah_flag_resolution_attributed CHECK (
  status IN ('FLAGGED', 'UNDER_REVIEW')
  OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)
);

-- Spec §5.6 — audit log is append-only. Triggers raise so tests can assert.
CREATE OR REPLACE FUNCTION audit_entry_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEntry is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_entry_no_update ON "AuditEntry";
CREATE TRIGGER audit_entry_no_update BEFORE UPDATE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION audit_entry_append_only();

DROP TRIGGER IF EXISTS audit_entry_no_delete ON "AuditEntry";
CREATE TRIGGER audit_entry_no_delete BEFORE DELETE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION audit_entry_append_only();
