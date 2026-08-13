-- Add the OVERSIGHT role and its two per-user grant flags.
--
-- VIEWER and SUPERVISOR are not retired here — see src/auth/rbac.ts for why:
-- merging SUPERVISOR into ADMIN would let one role both manage permissions and
-- read the audit trail meant to catch abuse of them, which the product owner
-- rejected as a separation-of-duties violation. Instead VIEWER and SUPERVISOR
-- are superseded going forward by this one new role, OVERSIGHT, which is not a
-- fixed capability list but two independent per-account grants: seeing
-- meetings/transcripts, and seeing the audit trail. An administrator picks
-- either, both, or neither when creating or editing an OVERSIGHT account.
--
-- The "Role" enum only ever grows. AuditEntry.actorRole is append-only and
-- hash-chained (see prisma/sql/constraints.sql), so VIEWER and SUPERVISOR stay
-- valid enum values forever — historical rows already name them — even though
-- neither is assignable to a new or changed account after this migration
-- (see users.routes.ts's ROLES const).
--
-- ADD VALUE cannot be used in the same transaction that later reads it, so the
-- data backfill that moves existing VIEWER/SUPERVISOR accounts onto OVERSIGHT
-- is a separate migration (20260813000001_oversight_role_backfill) that runs
-- after this one commits.
ALTER TYPE "Role" ADD VALUE 'OVERSIGHT';

-- Meaningful only when role = 'OVERSIGHT'. False, and ignored, for every
-- other role — see capabilitiesOf in src/auth/rbac.ts, the only reader.
ALTER TABLE "User" ADD COLUMN "canViewMeetings" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "canViewAuditTrail" BOOLEAN NOT NULL DEFAULT false;
