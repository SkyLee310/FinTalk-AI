-- Phase 4: administrator-managed user access.
--
-- Deactivation rather than deletion. A User is referenced by AuditEntry,
-- Approval, Settlement, HumanEdit and TranscriptSegment.confirmedById, so
-- deleting the row would orphan attribution the record depends on — and an audit
-- trail that cannot say who did something is not an audit trail.
--
-- Nullable with no default: NULL means active, which is already the correct state
-- for every user that exists, so there is nothing to backfill and nothing to
-- invent.
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

COMMENT ON COLUMN "User"."deactivatedAt" IS
  'Set when an administrator revokes access. NULL means active. Login refuses a deactivated account. Users are never deleted, because audit entries, approvals and settlements reference them.';
