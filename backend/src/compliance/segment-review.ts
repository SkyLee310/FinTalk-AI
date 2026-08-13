import type { PrismaClient, TranscriptSegment } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import { detectPii } from '../pdpa/detectors.js';
import { ComplianceError } from './errors.js';

/**
 * Human review of a low-confidence transcript segment.
 *
 * **The model's text is never overwritten.** A correction is stored as a
 * HumanEdit row beside it, and `textRedacted` keeps saying what the model
 * actually produced. Three reasons, in order of weight:
 *
 * 1. `Transcript.rawRedacted` is the segments joined together, and every
 *    `Redaction.startOffset`/`endOffset` indexes into that joined string. Editing
 *    one segment shifts every offset after it, so an in-place edit would silently
 *    invalidate the redaction log — the one record an auditor uses to prove a
 *    given identifier was accounted for.
 * 2. The product's stated design keeps every AI output beside the human edit.
 *    Overwriting the output destroys the comparison, and with it any later
 *    ability to measure how often the model was wrong.
 * 3. An edit that replaced the original would make the transcript
 *    unfalsifiable: nobody could tell afterwards whether a figure came from the
 *    recording or from someone's memory of it.
 *
 * A confirmation is the other half, and deliberately not an edit: it records that
 * a named person read the segment and found it right. "Nobody has looked" and
 * "someone looked and it was fine" are different states, and a system that cannot
 * tell them apart cannot claim the transcript was reviewed.
 */

export interface ConfirmInput {
  readonly segmentId: string;
  readonly actor: AuditActor;
}

export interface CorrectInput extends ConfirmInput {
  /** What the reviewer says was actually said. Placeholders must be preserved. */
  readonly correctedText: string;
}

/**
 * VIEWER has transcript:read so they can see transcripts, but confirming or
 * correcting a segment is a write action. The route's capability gate lets
 * them through (transcript:read is required to see the page at all), so
 * this service-level check is the one that enforces "can see, cannot do".
 */
function rejectViewer(actor: AuditActor): void {
  if (actor.role === 'VIEWER' || actor.role === 'OVERSIGHT') {
    throw new ComplianceError(
      'viewer-read-only',
      403,
      'A viewer may read transcripts but may not confirm or correct segments.',
    );
  }
}

async function loadSegment(
  tx: Pick<PrismaClient, 'transcriptSegment'>,
  segmentId: string,
): Promise<TranscriptSegment> {
  const segment = await tx.transcriptSegment.findUnique({ where: { id: segmentId } });
  if (segment === null) {
    throw new ComplianceError('not-found', 404, 'No transcript segment exists with that id.');
  }
  return segment;
}

/**
 * Records that a person read this segment and found the text correct.
 *
 * A second confirmation is refused rather than absorbed: the first names a
 * different person at a different time, and quietly replacing it would erase an
 * attribution somebody is accountable for.
 */
export async function confirmSegment(
  prisma: PrismaClient,
  input: ConfirmInput,
): Promise<TranscriptSegment> {
  rejectViewer(input.actor);

  return prisma.$transaction(async (tx) => {
    const segment = await loadSegment(tx, input.segmentId);

    if (segment.confirmedById !== null) {
      throw new ComplianceError(
        'already-confirmed',
        409,
        'This segment has already been confirmed. Submit a correction instead if '
        + 'the text is wrong.',
      );
    }

    const at = new Date();

    const updated = await tx.transcriptSegment.update({
      where: { id: segment.id },
      data: { confirmedById: input.actor.id, confirmedAt: at },
    });

    await appendAuditWithin(tx, {
      at,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'transcript.segment.confirmed',
      entityType: 'TranscriptSegment',
      entityId: segment.id,
      payload: {
        transcriptId: segment.transcriptId,
        startMs: segment.startMs,
        endMs: segment.endMs,
        // The score that sent it for review, so the log shows why someone looked.
        modelConfidence: segment.confidence,
      },
    });

    return updated;
  });
}

/**
 * Records a reviewer's correction beside the model's text.
 *
 * A correction carrying raw personal data is refused, not redacted. The reviewer
 * is looking at text where identifiers are already placeholders — if the model
 * misheard the words *around* `[NRIC_1]`, they retype those and leave the
 * placeholder alone. Retyping the identifier itself would assert a different
 * value for something sealed in the vault: a separate and far more consequential
 * action than fixing a transcription, which this route deliberately does not
 * offer. Silently redacting their words instead would alter a record they are
 * accountable for, and mint a vault entry with no redaction row able to point
 * at it.
 */
export async function correctSegment(
  prisma: PrismaClient,
  input: CorrectInput,
): Promise<TranscriptSegment> {
  rejectViewer(input.actor);

  const corrected = input.correctedText.trim();

  if (corrected === '') {
    throw new ComplianceError(
      'correction-empty',
      422,
      'A correction cannot be empty. Confirm the segment instead if it is right.',
    );
  }

  const found = detectPii(corrected);
  if (found.length > 0) {
    const kinds = [...new Set(found.map((f) => f.kind))].sort().join(', ');
    throw new ComplianceError(
      'correction-contains-personal-data',
      422,
      `A correction must not contain personal data (${kinds}). Keep the `
      + 'placeholder exactly as it appears — for example [NRIC_1] — and correct '
      + 'only the words around it.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const segment = await loadSegment(tx, input.segmentId);

    if (corrected === segment.textRedacted) {
      throw new ComplianceError(
        'correction-identical',
        422,
        'That is the text the model already produced. Confirm the segment instead.',
      );
    }

    const at = new Date();

    /**
     * The edit, and the fact that a human has now looked. Both, because a
     * corrected segment has certainly been reviewed — leaving confirmedAt null
     * would keep reporting it as unexamined.
     */
    await tx.humanEdit.create({
      data: {
        entityType: 'TranscriptSegment',
        entityId: segment.id,
        editorId: input.actor.id,
        fieldPath: 'textRedacted',
        aiValue: segment.textRedacted,
        humanValue: corrected,
        editedAt: at,
      },
    });

    const updated = await tx.transcriptSegment.update({
      where: { id: segment.id },
      data: { confirmedById: input.actor.id, confirmedAt: at },
    });

    /**
     * The payload carries no text at all — not the model's, not the human's.
     *
     * Both are already stored in rows this entry points at, and copying
     * transcript text into an append-only log would give the same words a second
     * home that no redaction offset describes and no retention sweep can reach.
     * Lengths convey the scale of the change without the words.
     */
    await appendAuditWithin(tx, {
      at,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'transcript.segment.corrected',
      entityType: 'TranscriptSegment',
      entityId: segment.id,
      payload: {
        transcriptId: segment.transcriptId,
        startMs: segment.startMs,
        endMs: segment.endMs,
        modelConfidence: segment.confidence,
        aiLength: segment.textRedacted.length,
        humanLength: corrected.length,
      },
    });

    return updated;
  });
}
