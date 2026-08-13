-- AlterTable
ALTER TABLE "User" ALTER COLUMN "canViewMeetings" SET DEFAULT true;

-- Deactivate legacy demo viewer and supervisor accounts so they cannot log in without violating FK constraints
UPDATE "User"
SET "deactivatedAt" = NOW()
WHERE "email" IN ('viewer@fintalk.test', 'supervisor@fintalk.test');

-- Ensure all existing OVERSIGHT accounts are granted full oversight visibility by default
UPDATE "User"
SET "canViewMeetings" = true, "canViewAuditTrail" = true
WHERE "role"::text = 'OVERSIGHT';
