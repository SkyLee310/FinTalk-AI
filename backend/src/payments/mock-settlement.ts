import { randomBytes } from 'node:crypto';
import type { PrismaClient, Settlement, SettlementRail } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import { ComplianceError } from '../compliance/errors.js';

/**
 * A simulated DuitNow / FPX settlement.
 *
 * **Nothing in this module contacts anything.** No fetch, no HTTP client, no bank
 * SDK, no import that could reach a network — a test asserts that absence by
 * reading this file's own source, so "mock" is verified rather than promised. The
 * no-transmitter assertion on the export module is untouched; this is a second,
 * separate guarantee rather than a hole in the first.
 *
 * Three things keep it from being mistaken for real:
 *
 * 1. **The reference says so.** `MOCK-DUITNOW-…`, never a format that could pass
 *    for a genuine reference in a screenshot, a CSV, or an email.
 * 2. **The database says so.** `Settlement.simulated` carries a
 *    `CHECK (simulated = true)`, so a row cannot be edited to look real without a
 *    migration that shows up in review.
 * 3. **The audit log says so.** The action is `payment.settled.mock`, not
 *    `payment.settled`, so a log reader cannot mistake one for the other and a
 *    future real action cannot silently inherit this one's history.
 *
 * The CHECKER settles, per your decision. That keeps ADMIN out of the money path
 * entirely: ADMIN governs access and reads the record, and never touches a credit
 * decision.
 */

/** Documented beside its use, rather than only in the Prisma enum. */
export const SETTLEMENT_RAILS: readonly SettlementRail[] = ['DUITNOW', 'FPX'];

export interface SettleInput {
  readonly termSheetId: string;
  readonly rail: SettlementRail;
  readonly actor: AuditActor;
}

/**
 * A reference that announces itself as fake.
 *
 * Crypto-random rather than sequential: a predictable reference invites someone
 * to read meaning into it. Collisions are caught by the unique index regardless.
 */
export function mockReference(rail: SettlementRail): string {
  const suffix = randomBytes(12)
    .toString('base64')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 12);
  return `MOCK-${rail}-${suffix}`;
}

/**
 * Records a simulated settlement against an approved term sheet.
 *
 * Refused unless the facility is APPROVED. Settling a draft or a rejected
 * facility would assert that money moved on a decision nobody made — the worst
 * thing a payments surface can do, mock or not.
 */
export async function settleMock(
  prisma: PrismaClient,
  input: SettleInput,
): Promise<Settlement> {
  if (input.actor.role !== 'CHECKER') {
    throw new ComplianceError(
      'forbidden-role',
      403,
      'Only a checker may record a settlement.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const sheet = await tx.termSheet.findUnique({
      where: { id: input.termSheetId },
      include: { approval: true },
    });

    if (sheet === null) {
      throw new ComplianceError('not-found', 404, 'No term sheet exists with that id.');
    }

    if (sheet.status !== 'APPROVED') {
      throw new ComplianceError(
        'invalid-state',
        409,
        `This facility is ${sheet.status}. Only an APPROVED facility can be settled.`,
      );
    }

    /**
     * The settler must be the checker who approved it — the four-eyes reasoning
     * applied one step later. Letting any checker settle another's approval would
     * mean the person releasing the money never had to look at the decision.
     */
    if (sheet.approval?.checkerId !== input.actor.id) {
      throw new ComplianceError(
        'forbidden-role',
        403,
        'A settlement is recorded by the checker who approved the facility.',
      );
    }

    const existing = await tx.settlement.findUnique({ where: { termSheetId: sheet.id } });
    if (existing !== null) {
      throw new ComplianceError(
        'already-settled',
        409,
        `This facility was already settled as ${existing.mockReference}. `
        + 'A second settlement is not recorded.',
      );
    }

    const at = new Date();
    const reference = mockReference(input.rail);

    const settlement = await tx.settlement.create({
      data: {
        termSheetId: sheet.id,
        rail: input.rail,
        mockReference: reference,
        // Copied from the approved sheet, never taken from the request. An
        // amount supplied by a caller could differ from what was approved, and
        // this is precisely the seam where that must be impossible.
        amountMinor: sheet.principalMinor,
        currency: sheet.currency,
        settledById: input.actor.id,
        settledAt: at,
        simulated: true,
      },
    });

    await appendAuditWithin(tx, {
      at,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      // Not 'payment.settled'. A future real action must not inherit the history
      // of a simulated one.
      action: 'payment.settled.mock',
      entityType: 'Settlement',
      entityId: settlement.id,
      payload: {
        termSheetId: sheet.id,
        meetingId: sheet.meetingId,
        rail: input.rail,
        mockReference: reference,
        // A string, like every money value crossing a boundary here:
        // JSON.stringify cannot serialise a BigInt at all.
        amountMinor: sheet.principalMinor.toString(),
        currency: sheet.currency,
        simulated: true,
      },
    });

    return settlement;
  });
}
