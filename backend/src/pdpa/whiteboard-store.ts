import type { PrismaClient } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import type { RedactedText } from './redacted-text.js';
import type { RedactionRecord } from './redactor.js';
import { sealedToRow } from './vault.js';

export interface StoreWhiteboardInput {
  readonly meetingId: string;
  /** The canonical document. Every record's offsets index into this. */
  readonly rawRedacted: RedactedText;
  readonly mermaid: RedactedText;
  /** Already-redacted structured fields, safe to persist as JSON. */
  readonly structuredJson: unknown;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly redactions: readonly RedactionRecord[];
  readonly actor: AuditActor;
}

/**
 * The only write path for a whiteboard.
 *
 * Every text field is typed RedactedText, so a caller holding raw vision output
 * cannot reach this function — the compiler refuses the call. That is the point
 * of the branded type: the rule is not "remember to redact first", it is "you
 * cannot express the unredacted write".
 *
 * Board, vault rows, redaction log and the audit entry go in one transaction. A
 * board stored beside a partial redaction log would assert that its personal
 * data had been accounted for when some of it had not, which is worse than
 * storing nothing.
 */
export async function storeWhiteboard(
  prisma: PrismaClient,
  input: StoreWhiteboardInput,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const board = await tx.whiteboard.create({
      data: {
        meetingId: input.meetingId,
        rawRedacted: input.rawRedacted,
        mermaid: input.mermaid,
        structuredJson: input.structuredJson as never,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
      },
    });

    for (const record of input.redactions) {
      const vault = await tx.piiVault.create({ data: sealedToRow(record.sealed) });

      await tx.redaction.create({
        data: {
          whiteboardId: board.id,
          piiType: record.piiType,
          placeholder: record.placeholder,
          startOffset: record.startOffset,
          endOffset: record.endOffset,
          detectedBy: record.detectedBy,
          confidence: record.confidence,
          vaultId: vault.id,
        },
      });
    }

    /**
     * Appended last, so the advisory lock inside appendAuditWithin is held for
     * the commit rather than for the vault loop above.
     *
     * The payload carries counts and provenance, never board text. The types of
     * identifier found are enough to reconcile against the redaction log, which
     * holds the offsets and the sealed values.
     */
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'whiteboard.captured',
      entityType: 'Whiteboard',
      entityId: board.id,
      payload: {
        meetingId: input.meetingId,
        redactionCount: input.redactions.length,
        redactionTypes: [...new Set(input.redactions.map((r) => r.piiType))].sort(),
        modelId: input.modelId,
        promptVersion: input.promptVersion,
      },
    });

    return board.id;
  });
}
