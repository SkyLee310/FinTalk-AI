-- Move existing VIEWER/SUPERVISOR accounts onto OVERSIGHT, preserving exactly
-- what each already had. Split from 20260813000000_oversight_role because
-- Postgres will not let a transaction use an enum value it just added with
-- ALTER TYPE ... ADD VALUE — this migration runs after that one has committed.
--
-- VIEWER granted meeting:read + transcript:read (see the pre-existing
-- CAPABILITIES table in src/auth/rbac.ts), which is exactly what
-- canViewMeetings now grants under OVERSIGHT.
UPDATE "User" SET "role" = 'OVERSIGHT', "canViewMeetings" = true WHERE "role" = 'VIEWER';

-- SUPERVISOR granted VIEWER's bundle plus audit:read, so it maps onto both
-- flags rather than just one.
UPDATE "User" SET "role" = 'OVERSIGHT', "canViewMeetings" = true, "canViewAuditTrail" = true WHERE "role" = 'SUPERVISOR';
