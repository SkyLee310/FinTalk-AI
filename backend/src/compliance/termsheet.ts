import type {
  Approval,
  FacilityKind,
  IslamicContract,
  PrismaClient,
  Role,
  ShariahStatus,
  TermSheet,
} from '@prisma/client';
import { appendAuditWithin } from '../audit/chain.js';
import { detectPii } from '../pdpa/detectors.js';
import { ComplianceError } from './errors.js';

/**
 * Term sheets and the maker–checker gate.
 *
 * Three rules are enforced here and, where possible, in the database too, so
 * neither layer is the only thing between a bad state and storage:
 *
 * 1. An Islamic facility carries a profit rate under a named contract; a
 *    conventional one carries an interest rate. Never both, never neither.
 * 2. A term sheet cannot be submitted while any Shariah finding on its meeting
 *    is unresolved — or resolved as a confirmed violation.
 * 3. The checker is never the maker.
 */

export interface Actor {
  readonly id: string;
  readonly role: Role;
}

export interface FacilityInput {
  readonly facilityKind: FacilityKind;
  readonly interestRateBps?: number | null;
  readonly profitRateBps?: number | null;
  readonly islamicContract?: IslamicContract | null;
  readonly principalMinor: bigint;
  readonly tenureMonths: number;
}

export interface DraftInput extends FacilityInput {
  readonly meetingId: string;
  readonly applicantName: string;
  readonly currency?: string;
}

/**
 * Any Shariah status other than CLEARED blocks submission.
 *
 * CONFIRMED_VIOLATION blocks permanently and deliberately: a facility a reviewer
 * has judged non-compliant cannot be approved, it has to be restructured into a
 * new term sheet. Treating a confirmed violation as merely "reviewed" would make
 * the review a formality.
 */
const SUBMITTABLE_FLAG_STATUS: ShariahStatus = 'CLEARED';

/**
 * Mirrors the term_sheet_rate_kind_exclusive CHECK constraint so a caller gets a
 * readable message instead of a raw constraint violation. The database remains
 * the authority; this is a courtesy, not the guarantee.
 */
export function validateFacility(input: FacilityInput): string | null {
  if (input.principalMinor <= 0n) {
    return 'The principal must be greater than zero.';
  }
  if (!Number.isInteger(input.tenureMonths) || input.tenureMonths <= 0) {
    return 'The tenure must be a whole number of months greater than zero.';
  }

  const hasInterest = input.interestRateBps !== null && input.interestRateBps !== undefined;
  const hasProfit = input.profitRateBps !== null && input.profitRateBps !== undefined;
  const hasContract = input.islamicContract !== null && input.islamicContract !== undefined;

  if (input.facilityKind === 'ISLAMIC') {
    if (hasInterest) {
      return 'An Islamic facility cannot carry an interest rate. Use a profit rate '
        + 'under a named Shariah contract.';
    }
    if (!hasProfit) return 'An Islamic facility requires a profit rate in basis points.';
    if (!hasContract) {
      return 'An Islamic facility requires a named contract, such as MURABAHAH.';
    }
  } else {
    if (hasProfit) {
      return 'A conventional facility carries an interest rate, not a profit rate.';
    }
    if (hasContract) return 'A conventional facility cannot name a Shariah contract.';
    if (!hasInterest) {
      return 'A conventional facility requires an interest rate in basis points.';
    }
  }

  if ((input.interestRateBps ?? 0) < 0 || (input.profitRateBps ?? 0) < 0) {
    return 'A rate cannot be negative.';
  }

  return null;
}

function assertRole(actor: Actor, required: Role, action: string): void {
  if (actor.role !== required) {
    throw new ComplianceError(
      'forbidden-role',
      403,
      `Only the ${required} role may ${action}.`,
    );
  }
}

function assertNoteIsClean(note: string): void {
  if (detectPii(note).length > 0) {
    throw new ComplianceError(
      'note-contains-personal-data',
      422,
      'A decision note must not contain personal data. Reference the placeholder '
      + 'from the transcript instead, for example [NRIC_1].',
    );
  }
}

export async function draftTermSheet(
  prisma: PrismaClient,
  actor: Actor,
  input: DraftInput,
): Promise<TermSheet> {
  assertRole(actor, 'MAKER', 'draft a term sheet');

  const problem = validateFacility(input);
  if (problem !== null) throw new ComplianceError('invalid-facility', 422, problem);

  return prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.findUnique({ where: { id: input.meetingId } });
    if (meeting === null) {
      throw new ComplianceError('not-found', 404, 'No meeting exists with that id.');
    }

    const at = new Date();

    const sheet = await tx.termSheet.create({
      data: {
        meetingId: input.meetingId,
        applicantName: input.applicantName,
        currency: input.currency ?? 'MYR',
        principalMinor: input.principalMinor,
        tenureMonths: input.tenureMonths,
        facilityKind: input.facilityKind,
        interestRateBps: input.interestRateBps ?? null,
        profitRateBps: input.profitRateBps ?? null,
        islamicContract: input.islamicContract ?? null,
        status: 'DRAFT',
      },
    });

    await appendAuditWithin(tx, {
      at,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'termsheet.drafted',
      entityType: 'TermSheet',
      entityId: sheet.id,
      payload: {
        meetingId: sheet.meetingId,
        facilityKind: sheet.facilityKind,
        principalMinor: sheet.principalMinor,
        tenureMonths: sheet.tenureMonths,
        interestRateBps: sheet.interestRateBps,
        profitRateBps: sheet.profitRateBps,
        islamicContract: sheet.islamicContract,
      },
    });

    return sheet;
  });
}

export async function submitForApproval(
  prisma: PrismaClient,
  actor: Actor,
  termSheetId: string,
): Promise<Approval> {
  assertRole(actor, 'MAKER', 'submit a term sheet for approval');

  return prisma.$transaction(async (tx) => {
    const sheet = await tx.termSheet.findUnique({
      where: { id: termSheetId },
      include: { approval: true },
    });
    if (sheet === null) {
      throw new ComplianceError('not-found', 404, 'No term sheet exists with that id.');
    }
    if (sheet.status !== 'DRAFT' || sheet.approval !== null) {
      throw new ComplianceError(
        'invalid-state',
        409,
        `This term sheet is ${sheet.status} and cannot be submitted again.`,
      );
    }

    const blocking = await tx.shariahFlag.findMany({
      where: { meetingId: sheet.meetingId, status: { not: SUBMITTABLE_FLAG_STATUS } },
      select: { issueType: true, status: true },
    });

    if (blocking.length > 0) {
      const summary = blocking.map((flag) => `${flag.issueType} (${flag.status})`).join(', ');
      throw new ComplianceError(
        'unresolved-shariah-flags',
        409,
        `This meeting has ${String(blocking.length)} Shariah finding(s) that are not `
        + `cleared: ${summary}. A Shariah reviewer must resolve them before approval.`,
      );
    }

    const at = new Date();

    const approval = await tx.approval.create({
      data: {
        termSheetId: sheet.id,
        makerId: actor.id,
        submittedAt: at,
        decision: 'PENDING_CHECKER',
      },
    });

    await tx.termSheet.update({
      where: { id: sheet.id },
      data: { status: 'PENDING_CHECKER' },
    });

    await appendAuditWithin(tx, {
      at,
      actorId: actor.id,
      actorRole: actor.role,
      action: 'termsheet.submitted',
      entityType: 'TermSheet',
      entityId: sheet.id,
      payload: { approvalId: approval.id, meetingId: sheet.meetingId },
    });

    return approval;
  });
}

export type Decision = 'APPROVED' | 'REJECTED';

export async function decideApproval(
  prisma: PrismaClient,
  actor: Actor,
  approvalId: string,
  decision: Decision,
  note: string,
): Promise<Approval> {
  assertRole(actor, 'CHECKER', 'approve or reject a term sheet');
  assertNoteIsClean(note);

  if (decision === 'REJECTED' && note.trim() === '') {
    throw new ComplianceError(
      'note-required',
      422,
      'A rejection must record the reason, so the maker knows what to change.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const approval = await tx.approval.findUnique({
      where: { id: approvalId },
      include: { termSheet: true },
    });
    if (approval === null) {
      throw new ComplianceError('not-found', 404, 'No approval exists with that id.');
    }
    if (approval.decision !== 'PENDING_CHECKER') {
      throw new ComplianceError(
        'invalid-state',
        409,
        `This approval was already decided as ${approval.decision}.`,
      );
    }

    /**
     * Segregation of duties. The DB constraint approval_checker_not_maker also
     * refuses this, but a readable 409 beats surfacing a constraint name, and the
     * rule matters enough to state in both places.
     */
    if (approval.makerId === actor.id) {
      throw new ComplianceError(
        'self-approval',
        409,
        'The checker cannot be the maker. A second person must decide.',
      );
    }

    const at = new Date();

    const decided = await tx.approval.update({
      where: { id: approvalId },
      data: { checkerId: actor.id, decidedAt: at, decision, note },
    });

    await tx.termSheet.update({
      where: { id: approval.termSheetId },
      data: { status: decision },
    });

    await appendAuditWithin(tx, {
      at,
      actorId: actor.id,
      actorRole: actor.role,
      action: `termsheet.${decision.toLowerCase()}`,
      entityType: 'TermSheet',
      entityId: approval.termSheetId,
      payload: {
        approvalId,
        makerId: approval.makerId,
        checkerId: actor.id,
        decision,
        note,
      },
    });

    return decided;
  });
}
