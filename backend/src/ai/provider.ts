/**
 * The transcription seam.
 *
 * Providers return plain `string` text, never `RedactedText`. That is
 * deliberate: model output is untrusted personal data, and the type system will
 * not let it reach storeTranscript without passing through redact() first.
 *
 * Keeping this an interface is what would make the cross-border transfer in
 * RISK-001 reversible: a host-local implementation would be a configuration
 * change here rather than a rewrite. No such implementation exists. A `local`
 * variant was carried as a stub and withdrawn on 2026-08-10 — it named a
 * capability the product did not have, which is worse than an honest gap.
 */

export type ProviderName = 'gemini' | 'fake' | 'openrouter';

/**
 * Below this, a segment is surfaced for a human to confirm or correct.
 *
 * 0.6 is a judgement, not a calibrated cutoff — it cannot be one, because the
 * scores it compares against are self-reported rather than measured. It is set
 * where it is because the cost of asking a reviewer to glance at a correct
 * segment is a few seconds, and the cost of a wrong figure reaching a credit
 * decision unchallenged is the thing this product exists to prevent.
 *
 * Defined once here, and mirrored by LOW_CONFIDENCE_THRESHOLD in the frontend's
 * lib/api.ts. Two thresholds that drifted apart would mark a segment for review
 * in one place and not the other.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface AudioInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ImageInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** What kind of capture a whiteboard row represents. Mirrors Prisma's WhiteboardKind. */
export type WhiteboardKind = 'WHITEBOARD' | 'SLIDE' | 'DOCUMENT';

/**
 * A whiteboard as the vision model read it.
 *
 * `mermaid` and `structured` are raw model output — unredacted by construction,
 * exactly like SegmentDraft.text. Neither may reach the database before passing
 * through redact(). `mermaid` is empty when the model found no diagram to
 * transcribe — a text-only page, for instance — which is a valid result, not
 * a failure.
 */
export interface WhiteboardExtraction {
  readonly kind: WhiteboardKind;
  readonly mermaid: string;
  readonly structured: Record<string, unknown>;
  readonly modelId: string;
  readonly promptVersion: string;
}

export interface SegmentDraft {
  readonly startMs: number;
  readonly endMs: number;
  readonly speakerLabel: string;
  /** Raw model output. Unredacted by construction — see the note above. */
  readonly text: string;
  /**
   * How sure the model says it is about this segment, 0–1.
   *
   * **Self-reported, not measured.** No calibrated probability is available:
   * Gemini returns no token logprobs for audio, so this is the model's own
   * opinion of its output, obtained by asking for it. It correlates with
   * correctness loosely at best, and a segment at 0.95 can still be wrong.
   *
   * It is therefore useful for *directing attention* and useless as assurance.
   * Anything rendering this value must say "model self-reported confidence"
   * and never "accuracy" — a made-up number presented as a measurement is
   * worse than no number, because it invites trust it cannot support.
   *
   * `undefined` when the provider does not report one. Deliberately not
   * defaulted to 1: a missing score is not a high score.
   *
   * Explicitly `| undefined` because this project runs with
   * `exactOptionalPropertyTypes`, which otherwise distinguishes an absent key
   * from a present-but-undefined one. Both mean "not scored" here, and a
   * provider mapping a field that may be missing should not have to care.
   */
  readonly confidence?: number | undefined;
}

export interface TranscriptionResult {
  readonly segments: readonly SegmentDraft[];
  /** Language tags the model reported, e.g. ["en", "ms"]. */
  readonly languages: readonly string[];
  /** Recorded on the transcript so an auditor can tie output to a model. */
  readonly modelId: string;
  readonly promptVersion: string;
}

export interface TranscriptionProvider {
  readonly name: ProviderName;
  transcribe(audio: AudioInput): Promise<TranscriptionResult>;

  /**
   * Optional English summary of the discussion.
   *
   * The argument is already-redacted text, so the summarising model never sees
   * an identifier — only placeholders. Its output is re-redacted anyway: a
   * model handed "[NRIC_1]" has no identifier to leak, but a model is not a
   * thing to take on trust at a boundary like this one.
   */
  summarize?(redactedText: string): Promise<string>;

  /**
   * Optional whiteboard extraction. A provider with no vision model omits it,
   * and the route answers 501 rather than pretending it captured something.
   */
  extractWhiteboard?(image: ImageInput): Promise<WhiteboardExtraction>;

  /**
   * Optional topic extraction from already-redacted text.
   *
   * Returns plain strings, like every other provider method — the labels are
   * model output and get re-redacted before storage, on the same reasoning as
   * `summarize`: a model handed placeholders has no identifier to leak, but a
   * model is not a thing to trust at a boundary like this one.
   */
  extractTopics?(redactedSummary: string): Promise<readonly TopicDraft[]>;

  /**
   * Optional embedding of already-redacted text, for similarity.
   *
   * A provider without an embedding model omits it, and the graph falls back to
   * topic overlap alone rather than reporting relationships it cannot compute.
   */
  embed?(redactedText: string): Promise<readonly number[]>;

  /**
   * Optional arbiter over an already-redacted transcript: for each point the
   * meeting debated, states the decision actually reached, or that it was
   * left unresolved.
   *
   * Returns plain strings, like every other provider method — model output,
   * re-verified with redactDerived before storage on the same reasoning as
   * `summarize`: a model handed placeholders has no identifier to leak, but
   * is not trusted at this boundary regardless.
   */
  arbitrateDecisions?(redactedText: string): Promise<readonly DecisionDraft[]>;

  /**
   * Optional who/what/when extraction from an already-redacted transcript.
   *
   * `owner` must be a meeting role or speaker label, never a person's name.
   * The input holds no names to begin with — only placeholders — so the
   * prompt attributes by role for the same reason topic labels are forbidden
   * from naming anyone in `extractTopics`.
   */
  extractActionItems?(redactedText: string): Promise<readonly ActionItemDraft[]>;

  /**
   * Optional instant project-kickoff draft plus probable follow-ups, from an
   * already-redacted transcript. Same derivation and re-verification as the
   * other two: model output, never trusted at this boundary.
   */
  draftProject?(redactedText: string): Promise<ProjectDraft>;

  /**
   * Optional grounded answer over already-redacted excerpts.
   *
   * `excerpts` are redacted transcripts. The implementation must instruct the
   * model to answer only from them and to say so when they do not contain the
   * answer — an assistant that fills a gap with general knowledge would be
   * issuing exactly the kind of unsourced financial or Shariah opinion this
   * product exists not to issue.
   */
  answerFromContext?(
    question: string,
    excerpts: readonly GroundingExcerpt[],
  ): Promise<GroundedAnswer>;
}

/** A topic as the extractor read it. Raw model output — unredacted by construction. */
export interface TopicDraft {
  readonly label: string;
  readonly kind: 'CONTRACT' | 'SECTOR' | 'PRODUCT' | 'ISSUE' | 'TERM';
  readonly weight: number;
}

/**
 * A decision as the arbiter read it. Raw model output — unredacted by
 * construction, exactly like SegmentDraft.text.
 */
export interface DecisionDraft {
  /** The point that was debated. */
  readonly topic: string;
  /** The final decision reached, or a statement that it was left unresolved. */
  readonly decision: string;
  /** The reasoning, or the competing positions where it stayed unresolved. */
  readonly rationale: string;
}

/**
 * A follow-up action as the extractor read it. Raw model output — unredacted
 * by construction, exactly like SegmentDraft.text.
 */
export interface ActionItemDraft {
  /** A meeting role or speaker label. Never a personal name. */
  readonly owner: string;
  /** What is to be done. */
  readonly task: string;
  /**
   * A due date as stated in the meeting, free text, or absent if none was
   * given. Written `| undefined` for the same exactOptionalPropertyTypes
   * reason as SegmentDraft.confidence: absent and "not stated" are the same
   * thing, and a provider that never saw a date should not have to care.
   */
  readonly dueDate?: string | undefined;
}

/**
 * An instant project-kickoff draft as the model wrote it. Raw model output —
 * unredacted by construction, exactly like SegmentDraft.text.
 */
export interface ProjectDraft {
  readonly kickoff: string;
  readonly followUps: readonly string[];
}

export interface GroundingExcerpt {
  readonly meetingId: string;
  /** So the model can name the meeting in prose instead of falling back to `meetingId`. */
  readonly title: string;
  /** ISO timestamp. Prompted to render as a calendar date, not the raw ISO string. */
  readonly occurredAt: string;
  /** Already redacted. Placeholders only. */
  readonly text: string;
}

export interface GroundedAnswer {
  /** Raw model output. Re-redacted before it reaches a user. */
  readonly answer: string;
  /** Meeting ids the model says it used. Verified against what was supplied. */
  readonly citedMeetingIds: readonly string[];
  /** True when the model reports the corpus does not answer the question. */
  readonly unanswerable: boolean;
  readonly modelId: string;
  readonly promptVersion: string;
}

/** Raised when a provider cannot produce a transcript. Carries no audio or text. */
export class TranscriptionError extends Error {
  readonly provider: ProviderName;

  constructor(provider: ProviderName, message: string) {
    super(`${provider} provider failed: ${message}`);
    this.name = 'TranscriptionError';
    this.provider = provider;
  }
}
