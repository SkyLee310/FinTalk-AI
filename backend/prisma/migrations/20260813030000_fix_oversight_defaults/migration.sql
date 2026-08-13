-- Delete legacy demo viewer and supervisor accounts so they no longer exist
DELETE FROM "User" WHERE "email" IN ('viewer@fintalk.test', 'supervisor@fintalk.test');

-- Ensure all existing OVERSIGHT accounts are granted full oversight visibility by default
UPDATE "User"
SET "canViewMeetings" = true, "canViewAuditTrail" = true
WHERE "role" = 'OVERSIGHT';
