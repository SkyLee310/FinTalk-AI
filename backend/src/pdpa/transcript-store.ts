import type { PrismaClient } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import type { RedactedText } from './redacted-text.js';
import type { RedactionRecord } from './redactor.js';
import { sealedToRow } from './vault.js';

export interface TranscriptSegmentInput {
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerLabel: string;
  readonly textRedacted: RedactedText;
}

export interface StoreTranscriptInput {
  readonly meetingId: string;
  readonly rawRedacted: RedactedText;
  readonly summaryEn: RedactedText;
  readonly languages: readonly string[];
  readonly modelId: string;
  readonly promptVersion: string;
  readonly segments: readonly TranscriptSegmentInput[];
  readonly redactions: readonly RedactionRecord[];
  /** Attributed in the audit log as the uploader this transcript came from. */
  readonly actor: AuditActor;
}

/**
 * The only write path for a transcript.
 *
 * Every text field is typed RedactedText, so a caller holding raw
 * transcription output cannot reach this function at all — the compiler
 * refuses the call. That is the point of the branded type: the rule is not
 * "remember to redact first", it is "you cannot express the unredacted write".
 *
 * Transcript, segments, vault rows, redaction log and the audit entry go in one
 * transaction. A transcript stored beside a partial redaction log would assert
 * that its personal data had been accounted for when some of it had not, which
 * is worse than storing nothing.
 */
export async function storeTranscript(
  prisma: PrismaClient,
  input: StoreTranscriptInput,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const transcript = await tx.transcript.create({
      data: {
        meetingId: input.meetingId,
        rawRedacted: input.rawRedacted,
        summaryEn: input.summaryEn,
        languages: [...input.languages],
        modelId: input.modelId,
        promptVersion: input.promptVersion,
        segments: {
          create: input.segments.map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            speakerLabel: segment.speakerLabel,
            textRedacted: segment.textRedacted,
          })),
        },
      },
    });

    for (const record of input.redactions) {
      const vault = await tx.piiVault.create({ data: sealedToRow(record.sealed) });

      await tx.redaction.create({
        data: {
          transcriptId: transcript.id,
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
     * the commit rather than for the whole vault loop above.
     *
     * The payload carries counts and provenance, never transcript text. The
     * types of identifier found are enough to reconcile against the redaction
     * log, which holds the offsets and the sealed values.
     */
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'transcript.created',
      entityType: 'Transcript',
      entityId: transcript.id,
      payload: {
        meetingId: input.meetingId,
        segmentCount: input.segments.length,
        redactionCount: input.redactions.length,
        redactionTypes: [...new Set(input.redactions.map((r) => r.piiType))].sort(),
        languages: [...input.languages],
        modelId: input.modelId,
        promptVersion: input.promptVersion,
      },
    });

    return transcript.id;
  });
}
