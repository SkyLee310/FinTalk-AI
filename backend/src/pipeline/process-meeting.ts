import type { PrismaClient } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import type {
  AudioInput,
  TranscriptionProvider,
  TranscriptionResult,
} from '../ai/provider.js';
import type { RedactedText } from '../pdpa/redacted-text.js';
import {
  createRedactionContext,
  joinRedacted,
  redact,
  redactDerived,
  type RedactionContext,
  type RedactionRecord,
} from '../pdpa/redactor.js';
import {
  storeTranscript,
  type TranscriptSegmentInput,
} from '../pdpa/transcript-store.js';
import { isStorableTopicLabel } from '../knowledge/graph.js';
import { analyseTranscript } from '../shariah/engine.js';

/**
 * Capture pipeline: transcribe, redact, summarise, persist.
 *
 * The ordering is the point. A provider hands back plain strings; nothing
 * reaches the database until it has been through redact(), and the type system
 * rather than a convention is what enforces it.
 */

export type FailureStage =
  | 'transcription'
  | 'redaction'
  | 'summary'
  | 'persistence'
  | 'shariah';

/**
 * Carries the stage and the underlying error's class, never its message.
 *
 * A provider or database error can quote the text that caused it, and that text
 * is the transcript. Persisting the message would put unredacted personal data
 * into Meeting.failureReason — a column nobody thinks of as sensitive, which is
 * exactly why it would stay there.
 */
export class PipelineError extends Error {
  readonly stage: FailureStage;
  readonly causeName: string;

  constructor(stage: FailureStage, cause: unknown) {
    const causeName = cause instanceof Error ? cause.name : typeof cause;
    super(`Meeting processing failed during ${stage} (${causeName})`);
    this.name = 'PipelineError';
    this.stage = stage;
    this.causeName = causeName;
    this.cause = cause;
  }

  /** Safe to store: stage and error class only. */
  get persistableReason(): string {
    return `${this.stage}:${this.causeName}`;
  }
}

export interface PipelineDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
  readonly vaultKey: Buffer;
}

/**
 * How knowledge indexing went. Never fatal — a meeting with no topics is a meeting
 * with fewer graph edges, not a failed capture.
 */
export interface IndexingOutcome {
  readonly topicCount: number;
  readonly embedded: boolean;
  /** Stage and error class, PII-free like PipelineError.persistableReason. */
  readonly failure: string | null;
}

export interface ProcessResult {
  readonly transcriptId: string;
  readonly redactionCount: number;
  readonly segmentCount: number;
  readonly shariahFlagCount: number;
  readonly indexing: IndexingOutcome;
}

export const SEGMENT_SEPARATOR = '\n';

interface RedactedDocument {
  readonly rawRedacted: RedactedText;
  readonly segments: readonly TranscriptSegmentInput[];
  readonly records: readonly RedactionRecord[];
  readonly context: RedactionContext;
}

/**
 * Redacts every segment under one shared context, so a person who speaks in
 * three segments keeps one placeholder across all of them.
 *
 * Record offsets are rebased onto the joined document, because that is the text
 * `rawRedacted` holds and the offsets an auditor will resolve against.
 */
function redactTranscript(
  transcription: TranscriptionResult,
  vaultKey: Buffer,
): RedactedDocument {
  const context = createRedactionContext();
  const parts: RedactedText[] = [];
  const segments: TranscriptSegmentInput[] = [];
  const records: RedactionRecord[] = [];
  let offset = 0;

  transcription.segments.forEach((segment, index) => {
    const { text, records: segmentRecords } = redact(segment.text, vaultKey, context);

    if (index > 0) offset += SEGMENT_SEPARATOR.length;
    const base = offset;
    offset += text.length;

    parts.push(text);
    segments.push({
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel: segment.speakerLabel,
      textRedacted: text,
      // Carried through redaction unchanged. Redaction rewrites the text but
      // says nothing about how well the audio was heard, so the score stands.
      confidence: segment.confidence,
    });

    for (const record of segmentRecords) {
      records.push({
        ...record,
        startOffset: record.startOffset + base,
        endOffset: record.endOffset + base,
      });
    }
  });

  return {
    rawRedacted: joinRedacted(parts, SEGMENT_SEPARATOR),
    segments,
    records,
    context,
  };
}

export async function processMeeting(
  deps: PipelineDeps,
  meetingId: string,
  audio: AudioInput,
  actor: AuditActor,
): Promise<ProcessResult> {
  const { prisma, provider, vaultKey } = deps;

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', failureReason: null },
  });

  const failed = async (stage: FailureStage, cause: unknown): Promise<PipelineError> => {
    const error = new PipelineError(stage, cause);

    /**
     * The FAILED status and its audit entry commit together. A meeting that
     * shows FAILED with no record of the failure would leave an operator
     * guessing; persistableReason is PII-free by construction, carrying the
     * stage and the error's class rather than the provider's message.
     */
    await prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: meetingId },
        data: { status: 'FAILED', failureReason: error.persistableReason },
      });

      await appendAuditWithin(tx, {
        at: new Date(),
        actorId: actor.id,
        actorRole: actor.role,
        action: 'meeting.failed',
        entityType: 'Meeting',
        entityId: meetingId,
        payload: { stage, reason: error.persistableReason },
      });
    });

    return error;
  };

  let transcription: TranscriptionResult;
  try {
    transcription = await provider.transcribe(audio);
  } catch (cause) {
    throw await failed('transcription', cause);
  }

  let document: RedactedDocument;
  try {
    document = redactTranscript(transcription, vaultKey);
  } catch (cause) {
    throw await failed('redaction', cause);
  }

  let summary: RedactedText;
  try {
    const draft = provider.summarize
      ? await provider.summarize(document.rawRedacted)
      : 'No summary was generated for this meeting.';

    // Verified, not trusted. The summariser was handed placeholders, so a real
    // identifier here means it invented one or leaked it from somewhere else.
    const verified = redactDerived(draft, vaultKey, document.context);
    if (verified.records.length > 0) {
      // Fail closed rather than store a quietly patched summary. Repairing it
      // would hide a model that produced personal data from redacted input,
      // which is a fault worth surfacing, and the redaction log has no offset
      // space for spans that belong to the summary rather than the transcript.
      const kinds = [...new Set(verified.records.map((r) => r.piiType))].sort();
      throw new Error(
        `the summariser produced personal data (${kinds.join(', ')}) from `
        + 'redacted input; the summary was discarded',
      );
    }
    summary = verified.text;
  } catch (cause) {
    throw await failed('summary', cause);
  }

  let transcriptId: string;
  try {
    transcriptId = await storeTranscript(prisma, {
      meetingId,
      rawRedacted: document.rawRedacted,
      summaryEn: summary,
      languages: transcription.languages,
      modelId: transcription.modelId,
      promptVersion: transcription.promptVersion,
      segments: document.segments,
      redactions: document.records,
      actor,
    });
  } catch (cause) {
    throw await failed('persistence', cause);
  }

  /**
   * Shariah analysis runs last, over the stored redacted text.
   *
   * Findings are raised as FLAGGED and nothing more. The engine cannot resolve
   * one, and the approval gate refuses to submit a term sheet while any finding
   * on the meeting is not CLEARED — so a flag raised here genuinely blocks the
   * facility until a qualified reviewer acts on it.
   */
  let flagCount = 0;
  try {
    const findings = analyseTranscript(document.rawRedacted);
    if (findings.length > 0) {
      flagCount = await prisma.$transaction(async (tx) => {
        const created = await tx.shariahFlag.createMany({
          data: findings.map((finding) => ({
            meetingId,
            issueType: finding.issueType,
            excerpt: finding.excerpt,
            detectedBy: finding.detectedBy,
            confidence: finding.confidence,
            reference: finding.reference,
            status: 'FLAGGED' as const,
          })),
        });

        /**
         * Records that findings were raised and which rule raised each one.
         * The excerpts are left to the flag rows: they are already-redacted
         * transcript text, and duplicating them here would give the same
         * quotation two homes with only one of them reviewable.
         */
        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: actor.id,
          actorRole: actor.role,
          action: 'shariah.flagged',
          entityType: 'Meeting',
          entityId: meetingId,
          payload: {
            count: created.count,
            findings: findings.map((finding) => ({
              issueType: finding.issueType,
              detectedBy: finding.detectedBy,
              confidence: finding.confidence,
            })),
          },
        });

        return created.count;
      });
    }
  } catch (cause) {
    throw await failed('shariah', cause);
  }

  /**
   * Topics and the summary embedding, for cross-meeting connections.
   *
   * Deliberately last, and deliberately non-fatal. A meeting whose topics failed to
   * extract is a meeting with fewer graph edges; a meeting marked FAILED because a
   * topic list did not parse would have lost its transcript, its redactions and its
   * Shariah findings over a convenience feature. The stage is indexing, not capture.
   *
   * Both inputs are the already-redacted summary, so the extractor and the
   * embedding model see placeholders — never identifiers.
   */
  let indexing: IndexingOutcome;
  try {
    indexing = await indexForKnowledge(deps, meetingId, transcriptId, summary);
  } catch (cause) {
    /**
     * Reported, not swallowed. The stage name and error class are returned to the
     * caller, which logs them — a failure nobody can see is how "the graph looks
     * empty" becomes an afternoon of guessing.
     */
    const causeName = cause instanceof Error ? cause.name : typeof cause;
    indexing = { topicCount: 0, embedded: false, failure: `indexing:${causeName}` };
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'READY', failureReason: null },
  });

  return {
    transcriptId,
    redactionCount: document.records.length,
    segmentCount: document.segments.length,
    shariahFlagCount: flagCount,
    indexing,
  };
}

/**
 * Extracts topics and embeds the summary, so this meeting can be connected to
 * others and searched by the assistant.
 *
 * Both provider methods are optional. A provider without them is not an error — the
 * graph falls back to whatever topics exist and the assistant reports itself
 * unavailable, which is honest. Silently writing an empty topic list as though
 * extraction had succeeded would not be.
 */
async function indexForKnowledge(
  deps: PipelineDeps,
  meetingId: string,
  transcriptId: string,
  summary: RedactedText,
): Promise<IndexingOutcome> {
  const { prisma, provider } = deps;

  // Bound once: `?.` does not narrow across an await, and a bare reference to a
  // method loses `this`.
  const extractTopics = provider.extractTopics?.bind(provider);
  const embed = provider.embed?.bind(provider);

  let topicCount = 0;
  if (extractTopics !== undefined) {
    const drafts = await extractTopics(summary);

    /**
     * Placeholder-shaped labels are dropped here, whatever the model returned.
     *
     * A topic becomes a node in a graph shared across meetings, and `[NRIC_1]`
     * means a different person in every meeting — so a placeholder node would
     * link people who have nothing to do with each other. The prompt forbids it
     * and this filter enforces it, because a prompt is a request and a filter is
     * a guarantee.
     */
    const usable = drafts.filter((draft) => isStorableTopicLabel(draft.label));

    /**
     * Upsert rather than create, keyed on (meetingId, label).
     *
     * Re-running the pipeline for a meeting must not double its topics: duplicate
     * rows would inflate the shared-topic count and make an edge look stronger
     * than its evidence.
     */
    for (const draft of usable) {
      const label = draft.label.trim().toLowerCase();
      await prisma.meetingTopic.upsert({
        where: { meetingId_label: { meetingId, label } },
        create: { meetingId, label, kind: draft.kind, weight: draft.weight },
        update: { kind: draft.kind, weight: draft.weight },
      });
    }
    topicCount = usable.length;
  }

  let embedded = false;
  if (embed !== undefined) {
    const vector = await embed(summary);
    if (vector.length > 0) {
      await prisma.transcript.update({
        where: { id: transcriptId },
        data: { summaryEmbedding: [...vector] },
      });
      embedded = true;
    }
  }

  return { topicCount, embedded, failure: null };
}
