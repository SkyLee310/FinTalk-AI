import type { PrismaClient } from '@prisma/client';
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

export interface ProcessResult {
  readonly transcriptId: string;
  readonly redactionCount: number;
  readonly segmentCount: number;
  readonly shariahFlagCount: number;
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
): Promise<ProcessResult> {
  const { prisma, provider, vaultKey } = deps;

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: 'PROCESSING', failureReason: null },
  });

  const failed = async (stage: FailureStage, cause: unknown): Promise<PipelineError> => {
    const error = new PipelineError(stage, cause);
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'FAILED', failureReason: error.persistableReason },
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
      const created = await prisma.shariahFlag.createMany({
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
      flagCount = created.count;
    }
  } catch (cause) {
    throw await failed('shariah', cause);
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
  };
}
