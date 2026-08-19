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
  type ActionItemInput,
  type DecisionInput,
  storeIntelligence,
  storeTranscript,
  type TranscriptSegmentInput,
} from '../pdpa/transcript-store.js';
import { isStorableTopicLabel } from '../knowledge/graph.js';
import { rescaleSegmentTimestamps } from '../ai/timestamps.js';
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

/**
 * How meeting-intelligence derivation went. Never fatal — a meeting with none
 * of the three outputs had a provider that does not support them, or output
 * that failed its PII check, not a failed capture.
 */
export interface IntelligenceOutcome {
  readonly decisionCount: number;
  readonly actionItemCount: number;
  readonly hasProjectDraft: boolean;
  readonly followUpCount: number;
  /** Names of the three outputs that failed their PII check and were skipped. */
  readonly skipped: readonly string[];
  /** Stage and error class, PII-free like PipelineError.persistableReason. */
  readonly failure: string | null;
}

export interface ProcessResult {
  readonly transcriptId: string;
  readonly redactionCount: number;
  readonly segmentCount: number;
  readonly shariahFlagCount: number;
  readonly indexing: IndexingOutcome;
  readonly intelligence: IntelligenceOutcome;
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

/**
 * Resolves a character offset in the joined transcript to the id of the
 * segment that contains it, by walking the same cumulative lengths
 * `redactTranscript` used to place its own redaction records.
 *
 * `storedIds` must be TranscriptSegment ids fetched back in `startMs`
 * ascending order — the same order `segments` (and therefore this pipeline's
 * `document.segments`) was created in — so index `i` in both arrays names the
 * same segment. Returns null rather than throwing if the offset falls
 * outside every segment (should not happen, but a finding is still valid
 * without a segment link — see ShariahFlag.segmentId).
 *
 * Exported because shariah/reconcile.ts calls this same math against
 * TranscriptSegment rows read back from the database, to link up a meeting's
 * pre-existing findings that were raised before this column existed. The
 * parameter type only asks for `textRedacted`, which is all either caller
 * has in common — a freshly transcribed segment here, a stored row there.
 */
export function segmentIdAtOffset(
  segments: readonly { readonly textRedacted: string }[],
  storedIds: readonly string[],
  offset: number,
): string | null {
  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (index > 0) cursor += SEGMENT_SEPARATOR.length;
    const start = cursor;
    const end = start + segment.textRedacted.length;
    if (offset >= start && offset < end) return storedIds[index] ?? null;
    cursor = end;
  }
  return null;
}

export async function processMeeting(
  deps: PipelineDeps,
  meetingId: string,
  audio: AudioInput,
  actor: AuditActor,
): Promise<ProcessResult> {
  const { prisma, provider } = deps;
  const startedAt = Date.now();

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', failureReason: null },
  });

  const failed = async (stage: FailureStage, cause: unknown): Promise<PipelineError> => {
    const error = new PipelineError(stage, cause);
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

  transcription = {
    ...transcription,
    segments: rescaleSegmentTimestamps(transcription.segments, audio.durationMs),
  };

  return processTranscriptDirectly(deps, meetingId, transcription, actor, startedAt);
}

export async function processTranscriptDirectly(
  deps: PipelineDeps,
  meetingId: string,
  transcriptionInput: TranscriptionResult,
  actor: AuditActor,
  startedAt: number = Date.now(),
): Promise<ProcessResult> {
  const { prisma, provider, vaultKey } = deps;

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', failureReason: null },
  });

  const failed = async (stage: FailureStage, cause: unknown): Promise<PipelineError> => {
    const error = new PipelineError(stage, cause);

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

  const transcription = transcriptionInput;

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
      processingMs: Date.now() - startedAt,
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
      // Fetched in the same startMs order the segments were created in (see
      // segmentIdAtOffset), so a finding's matchStart can be resolved to the
      // real row that raised it — that's what "jump to transcript" follows.
      const storedSegments = await prisma.transcriptSegment.findMany({
        where: { transcriptId },
        orderBy: { startMs: 'asc' },
        select: { id: true },
      });
      const storedSegmentIds = storedSegments.map((segment) => segment.id);

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
            segmentId: segmentIdAtOffset(document.segments, storedSegmentIds, finding.matchStart),
            highlights: [...finding.highlights],
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

  /**
   * The final decision each debated point reached, a who/what/when action
   * list, and an instant project draft — deliberately last and deliberately
   * non-fatal, on the same reasoning as indexing just above: a meeting whose
   * intelligence step failed is a meeting with a transcript, redactions and
   * Shariah findings intact, not a lost capture.
   */
  let intelligence: IntelligenceOutcome;
  try {
    intelligence = await deriveIntelligence(
      deps,
      meetingId,
      transcriptId,
      document.rawRedacted,
      document.context,
      actor,
    );
  } catch (cause) {
    const causeName = cause instanceof Error ? cause.name : typeof cause;
    intelligence = {
      decisionCount: 0,
      actionItemCount: 0,
      hasProjectDraft: false,
      followUpCount: 0,
      skipped: [],
      failure: `intelligence:${causeName}`,
    };
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
    intelligence,
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

/**
 * Verifies one piece of derived text against the transcript's redaction
 * context and returns the storable, branded form.
 *
 * `clean` is false when the model produced real personal data from redacted
 * input. The caller discards the *whole* output that field belongs to, not
 * just this one field — see deriveIntelligence below.
 */
function verifyDerivedField(
  text: string,
  vaultKey: Buffer,
  context: RedactionContext,
): { readonly text: RedactedText; readonly clean: boolean } {
  const verified = redactDerived(text, vaultKey, context);
  return { text: verified.text, clean: verified.records.length === 0 };
}

/**
 * Distils a final decision, a who/what/when action list, and an instant
 * project draft from the redacted transcript.
 *
 * All three provider methods are optional, like extractTopics and embed
 * above. Each output is verified as a whole: if any field the model returned
 * for that output carries real personal data, the whole output is discarded —
 * never patched and stored — and its name is recorded in `skipped`, on the
 * same fail-closed reasoning as the summary check in processMeeting. A
 * provider that supports none of the three writes nothing and appends no
 * audit entry, since nothing ran.
 */
async function deriveIntelligence(
  deps: PipelineDeps,
  meetingId: string,
  transcriptId: string,
  redactedText: RedactedText,
  context: RedactionContext,
  actor: AuditActor,
): Promise<IntelligenceOutcome> {
  const { prisma, provider, vaultKey } = deps;

  // Bound once, for the same reason indexForKnowledge binds extractTopics/embed.
  const arbitrateDecisions = provider.arbitrateDecisions?.bind(provider);
  const extractActionItems = provider.extractActionItems?.bind(provider);
  const draftProject = provider.draftProject?.bind(provider);

  if (
    arbitrateDecisions === undefined
    && extractActionItems === undefined
    && draftProject === undefined
  ) {
    return {
      decisionCount: 0,
      actionItemCount: 0,
      hasProjectDraft: false,
      followUpCount: 0,
      skipped: [],
      failure: null,
    };
  }

  const skipped: string[] = [];

  let decisions: DecisionInput[] = [];
  if (arbitrateDecisions !== undefined) {
    const drafts = await arbitrateDecisions(redactedText);
    const verified = drafts.map((draft) => ({
      topic: verifyDerivedField(draft.topic, vaultKey, context),
      decision: verifyDerivedField(draft.decision, vaultKey, context),
      rationale: verifyDerivedField(draft.rationale, vaultKey, context),
    }));
    if (verified.every((v) => v.topic.clean && v.decision.clean && v.rationale.clean)) {
      decisions = verified.map((v) => ({
        topic: v.topic.text,
        decision: v.decision.text,
        rationale: v.rationale.text,
      }));
    } else {
      skipped.push('decisions');
    }
  }

  let actionItems: ActionItemInput[] = [];
  if (extractActionItems !== undefined) {
    const drafts = await extractActionItems(redactedText);
    const verified = drafts.map((draft) => ({
      owner: verifyDerivedField(draft.owner, vaultKey, context),
      task: verifyDerivedField(draft.task, vaultKey, context),
      dueDate:
        draft.dueDate === undefined ? null : verifyDerivedField(draft.dueDate, vaultKey, context),
    }));
    if (verified.every((v) => v.owner.clean && v.task.clean && (v.dueDate === null || v.dueDate.clean))) {
      actionItems = verified.map((v) => ({
        owner: v.owner.text,
        task: v.task.text,
        dueDate: v.dueDate?.text ?? null,
      }));
    } else {
      skipped.push('actionItems');
    }
  }

  let projectKickoff: RedactedText | null = null;
  let followUps: RedactedText[] = [];
  if (draftProject !== undefined) {
    const draft = await draftProject(redactedText);
    if (draft.kickoff.trim() !== '' || draft.followUps.length > 0) {
      const kickoff = verifyDerivedField(draft.kickoff, vaultKey, context);
      const items = draft.followUps.map((line) => verifyDerivedField(line, vaultKey, context));
      if (kickoff.clean && items.every((v) => v.clean)) {
        projectKickoff = draft.kickoff.trim() === '' ? null : kickoff.text;
        followUps = items.map((v) => v.text);
      } else {
        skipped.push('project');
      }
    }
  }

  await storeIntelligence(prisma, {
    meetingId,
    transcriptId,
    decisions,
    actionItems,
    projectKickoff,
    followUps,
    skipped,
    actor,
  });

  return {
    decisionCount: decisions.length,
    actionItemCount: actionItems.length,
    hasProjectDraft: projectKickoff !== null,
    followUpCount: followUps.length,
    skipped,
    failure: null,
  };
}
