-- PENDING is reachable only through POST /auth/register.
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE');

-- Every existing account was admin-created with a role already assigned,
-- so ACTIVE is correct for all of them and no backfill is needed.
ALTER TABLE "User" ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- Nullable on purpose (spec §6.3): requiring these at the schema level would
-- force a fake backfill onto admin-created accounts that never collected them.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "staffId" TEXT;

-- Postgres allows many NULLs under a unique index, which is what lets every
-- pre-existing account keep username = NULL.
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- A PENDING registration has no role until an admin approves it.
ALTER TABLE "User" ALTER COLUMN "role" DROP NOT NULL;

-- Archive, never delete: the row and everything referencing it stay resolvable.
ALTER TABLE "Meeting" ADD COLUMN "archivedAt" TIMESTAMP(3);
