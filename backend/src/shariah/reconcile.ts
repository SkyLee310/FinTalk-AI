import type { PrismaClient, ShariahFlag } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import { segmentIdAtOffset } from '../pipeline/process-meeting.js';
import { analyseTranscript } from './engine.js';

/**
 * Self-heals a meeting's Shariah flags on read, for rows written before the
 * sentence-dedup / segment-link / highlight fix landed.
 *
 * The capture pipeline (process-meeting.ts) only ever computes segmentId,
 * highlights and deduped findings once, at upload time — a meeting
 * processed before this fix shipped keeps its old flag rows forever unless
 * something re-derives them. Nothing about the original audio needs to be
 * replayed to do that: the findings came from `Transcript.rawRedacted`,
 * which is already sitting in the database, so re-running the current
 * engine against it reproduces exactly what capture would have written
 * today. GET /meetings/:id calls this before building its response, so the
 * fix reaches every existing meeting the next time it is opened — no
 * migration script, no manual reprocessing step.
 */

interface StaleCheckFlag {
  readonly status: string;
  readonly highlights: readonly string[];
}

/**
 * True when a meeting's flags are worth reconciling: at least one predates
 * the highlights/segmentId column (highlights is empty — the current engine
 * can never produce a finding with none, since a finding only exists
 * because of a match, and highlights always includes that match's own
 * text), and nothing has moved past FLAGGED yet. The second condition is
 * what makes replacement safe: reconciling would delete and recreate every
 * flag row on the meeting, and a status or reviewNote a Shariah officer
 * already recorded must never be discarded to fix a cosmetic gap.
 */
export function needsReconciliation(flags: readonly StaleCheckFlag[]): boolean {
  return (
    flags.length > 0
    && flags.every((flag) => flag.status === 'FLAGGED')
    && flags.some((flag) => flag.highlights.length === 0)
  );
}

/**
 * Re-runs Shariah analysis against a transcript's already-stored redacted
 * text and segments, replacing the meeting's flag rows with the deduped,
 * segment-linked, highlighted set the current engine produces. Callers must
 * check `needsReconciliation` first — this function does not re-check
 * review status, so calling it on a reviewed meeting would discard that
 * review.
 */
export async function reconcileStaleFlags(
  prisma: PrismaClient,
  meetingId: string,
  transcript: { readonly id: string; readonly rawRedacted: string },
  actor: AuditActor,
): Promise<ShariahFlag[]> {
  const segments = await prisma.transcriptSegment.findMany({
    where: { transcriptId: transcript.id },
    orderBy: { startMs: 'asc' },
    select: { id: true, textRedacted: true },
  });
  const storedIds = segments.map((segment) => segment.id);

  const findings = analyseTranscript(transcript.rawRedacted);

  return prisma.$transaction(async (tx) => {
    await tx.shariahFlag.deleteMany({ where: { meetingId } });

    const created = findings.length === 0
      ? []
      : await Promise.all(
          findings.map((finding) =>
            tx.shariahFlag.create({
              data: {
                meetingId,
                issueType: finding.issueType,
                excerpt: finding.excerpt,
                detectedBy: finding.detectedBy,
                confidence: finding.confidence,
                reference: finding.reference,
                status: 'FLAGGED' as const,
                segmentId: segmentIdAtOffset(segments, storedIds, finding.matchStart),
                highlights: [...finding.highlights],
              },
            }),
          ),
        );

    /**
     * Distinct action name from shariah.flagged: this is a repair of
     * existing rows triggered by a read, not new findings raised by
     * capture, and an auditor should be able to tell the two apart.
     */
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: actor.id,
      actorRole: actor.role,
      action: 'shariah.reconciled',
      entityType: 'Meeting',
      entityId: meetingId,
      payload: { count: created.length },
    });

    return created;
  });
}
