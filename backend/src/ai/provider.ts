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

export type ProviderName = 'gemini' | 'fake';

export interface AudioInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

export interface ImageInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/**
 * A whiteboard as the vision model read it.
 *
 * `mermaid` and `structured` are raw model output — unredacted by construction,
 * exactly like SegmentDraft.text. Neither may reach the database before passing
 * through redact().
 */
export interface WhiteboardExtraction {
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
