-- Phase 3: simulated DuitNow / FPX settlement.
--
-- Hand-written, like the migrations before it: there is no local Postgres, so
-- `prisma migrate dev` cannot generate one. `migrate deploy` checksums this file
-- as written, and CI's Postgres 16 is where it first executes.

CREATE TYPE "SettlementRail" AS ENUM ('DUITNOW', 'FPX');

CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "termSheetId" TEXT NOT NULL,
    "rail" "SettlementRail" NOT NULL,
    "mockReference" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "settledById" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "simulated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- One settlement per facility, enforced by the index rather than by a service
-- check: "we already paid this" is not a race to lose.
CREATE UNIQUE INDEX "Settlement_termSheetId_key" ON "Settlement"("termSheetId");
CREATE UNIQUE INDEX "Settlement_mockReference_key" ON "Settlement"("mockReference");
CREATE INDEX "Settlement_settledById_idx" ON "Settlement"("settledById");

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_termSheetId_fkey"
  FOREIGN KEY ("termSheetId") REFERENCES "TermSheet"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not SET NULL: a settlement must always name who recorded it, so the
-- settler cannot be deleted out from under the record.
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_settledById_fkey"
  FOREIGN KEY ("settledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restated from prisma/sql/constraints.sql so a database that is migrated but not
-- yet constrained is not permissive in the window between the two steps. These
-- three are the entire reason this table is safe to have at all.
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_is_simulated CHECK (
  simulated = true
);
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_reference_is_marked_mock CHECK (
  "mockReference" LIKE 'MOCK-%'
);
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_amount_positive CHECK (
  "amountMinor" > 0
);

COMMENT ON TABLE "Settlement" IS
  'SIMULATED settlements only. No money moves and no bank is contacted. simulated is CHECK-constrained to true and mockReference must start with MOCK-.';
