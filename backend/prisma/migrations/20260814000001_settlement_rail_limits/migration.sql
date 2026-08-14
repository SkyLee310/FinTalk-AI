-- The real per-transaction limits behind the DuitNow Business / RENTAS
-- split: DuitNow Business handles up to RM10,000,000; RENTAS requires at
-- least RM10,000. There is no shared size cutoff between "small" and
-- "large" facilities — the two ranges overlap, and a facility between
-- RM10,000 and RM10,000,000 is valid on either rail.
--
-- Scoped to MYR: these are Malaysian payment-rail limits, and
-- Settlement.currency is not constrained to MYR elsewhere, so a non-MYR row
-- (should one ever exist) is not subject to either.
--
-- Restated in prisma/sql/constraints.sql, like every other Settlement CHECK,
-- so it survives even a caller that bypasses src/payments/mock-settlement.ts.
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_duitnow_business_ceiling CHECK (
  rail != 'DUITNOW' OR currency != 'MYR' OR "amountMinor" <= 1000000000
);
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_rentas_floor CHECK (
  rail != 'RENTAS' OR currency != 'MYR' OR "amountMinor" >= 1000000
);
