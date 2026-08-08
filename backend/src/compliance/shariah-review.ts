import type { PrismaClient, Role, ShariahFlag, ShariahStatus } from '@prisma/client';
import { appendAuditWithin } from '../audit/chain.js';
import { detectPii } from '../pdpa/detectors.js';
import { ComplianceError } from './errors.js';

/**
 * Resolution of a Shariah finding.
 *
 * This is the only path by which a flag leaves FLAGGED, and it is gated on the
 * SHARIAH role in three independent places: the capability matrix, the check
 * below, and a DB constraint requiring reviewer attribution on any resolved
 * status. The AI cannot reach this function at all.
 */

export type ReviewStatus = Extract<
  ShariahStatus,
  'UNDER_REVIEW' | 'CLEARED' | 'CONFIRMED_VIOLATION'
>;

/** Terminal. A resolved finding is a matter of record and cannot be revisited. */
const TERMINAL: readonly ShariahStatus[] = ['CLEARED', 'CONFIRMED_VIOLATION'];

export interface Reviewer {
  readonly id: string;
  readonly role: Role;
}

export interface ReviewInput {
  readonly flagId: string;
  readonly reviewer: Reviewer;
  readonly status: ReviewStatus;
  readonly note: string;
}

export async function reviewShariahFlag(
  prisma: PrismaClient,
  input: ReviewInput,
): Promise<ShariahFlag> {
  if (input.reviewer.role !== 'SHARIAH') {
    throw new ComplianceError(
      'forbidden-role',
      403,
      'Only a Shariah reviewer may resolve a Shariah finding.',
    );
  }

  /**
   * A note containing personal data is refused outright rather than quietly
   * redacted. The reviewer has the placeholder in front of them and should cite
   * it; rewriting their words would alter a record they are accountable for, and
   * storing the original would put an identifier in a column with no vault entry
   * behind it.
   */
  if (detectPii(input.note).length > 0) {
    throw new ComplianceError(
      'note-contains-personal-data',
      422,
      'A review note must not contain personal data. Reference the placeholder '
      + 'from the transcript instead, for example [NRIC_1].',
    );
  }

  if (TERMINAL.includes(input.status) && input.note.trim() === '') {
    throw new ComplianceError(
      'note-required',
      422,
      "Clearing or confirming a finding must record the reviewer's reasoning.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const flag = await tx.shariahFlag.findUnique({ where: { id: input.flagId } });
    if (flag === null) {
      throw new ComplianceError('not-found', 404, 'No Shariah finding exists with that id.');
    }

    if (TERMINAL.includes(flag.status)) {
      throw new ComplianceError(
        'already-resolved',
        409,
        `This finding was already resolved as ${flag.status} and cannot be changed. `
        + 'Raise a new finding if circumstances have changed.',
      );
    }

    const at = new Date();

    const updated = await tx.shariahFlag.update({
      where: { id: input.flagId },
      data: {
        status: input.status,
        reviewedById: input.reviewer.id,
        reviewedAt: at,
        reviewNote: input.note,
      },
    });

    await appendAuditWithin(tx, {
      at,
      actorId: input.reviewer.id,
      actorRole: input.reviewer.role,
      action: `shariah.flag.${input.status.toLowerCase()}`,
      entityType: 'ShariahFlag',
      entityId: flag.id,
      payload: {
        issueType: flag.issueType,
        detectedBy: flag.detectedBy,
        from: flag.status,
        to: input.status,
        note: input.note,
      },
    });

    return updated;
  });
}
