import { ApiError, GoogleGenAI } from '@google/genai';
import type { JWTInput } from 'google-auth-library';
import {
  type ActionItemDraft,
  type AudioInput,
  type DecisionDraft,
  type GroundedAnswer,
  type GroundingExcerpt,
  type ImageInput,
  type ProjectDraft,
  type TermSheetSuggestion,
  type TopicDraft,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
  type WhiteboardExtraction,
} from './provider.js';
import {
  ACTION_ITEMS_PROMPT,
  ActionItemsSchema,
  ANSWER_PROMPT,
  AnswerSchema,
  DECISIONS_PROMPT,
  DecisionsSchema,
  parseJsonLoosely,
  PROJECT_DRAFT_PROMPT,
  ProjectDraftSchema,
  ResponseSchema,
  SUMMARY_PROMPT,
  TERM_SHEET_PROMPT,
  TermSheetSuggestionSchema,
  TOPICS_PROMPT,
  TopicsSchema,
  TRANSCRIBE_PROMPT,
  WHITEBOARD_PROMPT,
  WhiteboardSchema,
} from './prompts.js';
import { withAiTimeout } from './timeout.js';

/**
 * Gemini-backed transcription.
 *
 * Two rules govern everything here.
 *
 * Upstream error messages are never forwarded. A failed request can quote the
 * payload it was sent, and that payload is meeting audio; only the error's class
 * crosses this boundary.
 *
 * A response that does not match the expected shape is a failure, not something
 * to salvage. Guessing at a malformed transcript would put invented figures into
 * a credit record.
 */

// v2 adds the per-segment confidence request. v3 adds explicit elapsed-time
// grounding for startMs/endMs. Bumped because promptVersion is stored on
// every transcript as provenance — a version that no longer identifies the
// prompt that produced the output makes the column a lie.
const PROMPT_VERSION = 'gemini-transcribe-v3';
const SUMMARY_PROMPT_VERSION = 'gemini-summary-v1';
const ANSWER_PROMPT_VERSION = 'gemini-answer-v1';
const TERM_SHEET_PROMPT_VERSION = 'gemini-termsheet-v1';

/**
 * Two ways to authenticate against the same model family. `api-key` is the
 * Gemini Developer API (a bearer token from AI Studio); `vertex` is the same
 * models reached through a GCP service account's IAM identity. Nothing past
 * the constructor cares which one is active — every method below calls
 * `this.client` the same way regardless.
 */
export type GeminiAuth =
  | { readonly mode: 'api-key'; readonly apiKey: string }
  | {
    readonly mode: 'vertex';
    readonly project: string;
    readonly location: string;
    readonly credentials: JWTInput;
  };

export interface GeminiConfig {
  readonly auth: GeminiAuth;
  readonly transcribeModel: string;
  readonly textModel: string;
  readonly visionModel: string;
  /**
   * Embedding model, for cross-meeting similarity.
   *
   * Separate from textModel because embedding and generation are different model
   * families with different ids — and an id that happens to work for one is not
   * guaranteed to work for the other.
   */
  readonly embeddingModel: string;
  readonly timeoutMs?: number;
}

/**
 * Every catch block below keeps only `cause.name` — never the message — for
 * the reason at the top of this file: a failed request can quote the payload
 * it was sent. An HTTP status code carries no such risk (it's a number, not
 * text echoed from the request), so it's logged here before that message is
 * discarded, giving the server log a way to tell a rate limit (429) from an
 * outage (5xx) from anything else, without ever writing transcript or image
 * content to a log.
 */
function logApiErrorStatus(stage: string, cause: unknown): void {
  if (cause instanceof ApiError) {
    console.error(`[gemini:${stage}] ApiError status=${cause.status}`);
  }
}

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'gemini' as const;

  private readonly client: GoogleGenAI;
  private readonly config: GeminiConfig;

  constructor(config: GeminiConfig) {
    this.config = config;
    this.client = config.auth.mode === 'vertex'
      ? new GoogleGenAI({
        vertexai: true,
        project: config.auth.project,
        location: config.auth.location,
        googleAuthOptions: { credentials: config.auth.credentials },
      })
      : new GoogleGenAI({ apiKey: config.auth.apiKey });
  }

  private request<T>(stage: string, operation: Promise<T>): Promise<T> {
  return withAiTimeout('gemini', stage, this.config.timeoutMs ?? 30_000, operation);
}

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    if (audio.bytes.byteLength === 0) {
      throw new TranscriptionError('gemini', 'received empty audio');
    }

    let raw: string;
    try {
      const response = await this.request('transcribe', this.client.models.generateContent({
        model: this.config.transcribeModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: audio.mimeType,
                  data: Buffer.from(audio.bytes).toString('base64'),
                },
              },
              { text: TRANSCRIBE_PROMPT },
            ],
          },
        ],
        // temperature 0: a transcript should not vary between runs of the same
        // audio, and an auditor comparing two runs should see one answer.
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('transcribe', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error ? `request failed (${cause.name})` : 'request failed',
      );
    }

    if (raw.trim() === '') {
      throw new TranscriptionError('gemini', 'returned an empty response');
    }

    const parsed = ResponseSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) {
      throw new TranscriptionError(
        'gemini',
        'response did not match the expected transcript shape',
      );
    }

    const invalidSpan = parsed.data.segments.find((s) => s.endMs < s.startMs);
    if (invalidSpan !== undefined) {
      throw new TranscriptionError('gemini', 'returned a segment ending before it starts');
    }

    return {
      segments: parsed.data.segments.map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerLabel: segment.speaker,
        text: segment.text,
        // Passed through as reported, or left absent. Substituting a value for a
        // model that declined to give one would fabricate the very signal a
        // reviewer is meant to act on.
        confidence: segment.confidence,
      })),
      languages: parsed.data.languages,
      modelId: this.config.transcribeModel,
      promptVersion: PROMPT_VERSION,
    };
  }

  async extractWhiteboard(image: ImageInput): Promise<WhiteboardExtraction> {
    if (image.bytes.byteLength === 0) {
      throw new TranscriptionError('gemini', 'received an empty image');
    }

    let raw: string;
    try {
      const response = await this.request('extractWhiteboard', this.client.models.generateContent({
        model: this.config.visionModel,
        contents: [
          {
            role: 'user',
            parts: [
              { text: WHITEBOARD_PROMPT },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: Buffer.from(image.bytes).toString('base64'),
                },
              },
            ],
          },
        ],
        // temperature 0 for the same reason transcription uses it: two runs over
        // one photograph should not hand an auditor two different diagrams.
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      /**
       * The class only, never the message.
       *
       * This previously forwarded `cause.message`, contradicting the rule at the
       * top of this file: a failed request can quote the payload it was sent, and
       * here that payload is a photograph of a whiteboard. The transcribe path
       * always got this right; this branch did not.
       */
      logApiErrorStatus('extractWhiteboard', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error
          ? `whiteboard extraction failed (${cause.name})`
          : 'whiteboard extraction failed',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TranscriptionError('gemini', 'whiteboard response was not JSON');
    }

    const result = WhiteboardSchema.safeParse(parsed);
    if (!result.success) {
      // The zod message is deliberately not included: a schema error quotes the
      // offending value, and that value is whiteboard content.
      throw new TranscriptionError(
        'gemini',
        'whiteboard response did not match the schema',
      );
    }

    return {
      kind: result.data.kind,
      mermaid: result.data.mermaid,
      structured: result.data.structured,
      modelId: this.config.visionModel,
      promptVersion: 'gemini-whiteboard-v2',
    };
  }

  /**
   * Topic labels from an already-redacted summary.
   *
   * The prompt forbids naming a person and forbids returning a placeholder,
   * because a topic becomes a node in a shared graph — and `[NRIC_1]` means a
   * different person in every meeting, so a placeholder node would link people who
   * have nothing to do with each other. `isStorableTopicLabel` rejects them
   * anyway; asking is cheaper than filtering.
   */
  async extractTopics(redactedSummary: string): Promise<readonly TopicDraft[]> {
    if (redactedSummary.trim() === '') return [];

    let raw: string;
    try {
      const response = await this.request('extractTopics', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [{ role: 'user', parts: [{ text: TOPICS_PROMPT }, { text: redactedSummary }] }],
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('extractTopics', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error
          ? `topic extraction failed (${cause.name})`
          : 'topic extraction failed',
      );
    }

    const parsed = TopicsSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) {
      // A malformed topic list loses the graph edges for one meeting, not the
      // meeting. Returning none is honest; guessing would put invented topics
      // into a shared graph.
      return [];
    }

    return parsed.data.topics.map((topic) => ({
      label: topic.label.trim().toLowerCase(),
      kind: topic.kind,
      weight: topic.weight,
    }));
  }

  /**
   * Embeds already-redacted text for similarity.
   *
   * Uses the text model's embedding sibling via the same client. A failure throws
   * rather than returning a zero vector: a zero vector is similar to nothing, so it
   * would silently exclude the meeting from the graph and look like a corpus with
   * no relationships rather than an embedding that failed.
   */
  async embed(redactedText: string): Promise<readonly number[]> {
    /**
     * Unconfigured is a first-class failure, not a silent one.
     *
     * `embed` is a class method, so it exists on the instance whether or not a
     * model id was supplied — the assistant's `=== undefined` check cannot see the
     * difference. Throwing here is what turns a missing GEMINI_MODEL_EMBEDDING into
     * an honest "the assistant is unavailable" rather than an opaque upstream 400.
     */
    if (this.config.embeddingModel === '') {
      throw new TranscriptionError(
        'gemini',
        'no embedding model is configured (set GEMINI_MODEL_EMBEDDING)',
      );
    }

    try {
      const response = await this.request('embed', this.client.models.embedContent({
        model: this.config.embeddingModel,
        contents: [{ role: 'user', parts: [{ text: redactedText }] }],
      }));
      const values = response.embeddings?.[0]?.values;
      if (values === undefined || values.length === 0) {
        throw new TranscriptionError('gemini', 'embedding response carried no vector');
      }
      return values;
    } catch (cause) {
      if (cause instanceof TranscriptionError) throw cause;
      logApiErrorStatus('embed', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error ? `embedding failed (${cause.name})` : 'embedding failed',
      );
    }
  }

  /**
   * States the decision each debated point reached, or that it was left
   * unresolved, from an already-redacted transcript.
   */
  async arbitrateDecisions(redactedText: string): Promise<readonly DecisionDraft[]> {
    if (redactedText.trim() === '') return [];

    let raw: string;
    try {
      const response = await this.request('arbitrateDecisions', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [{ role: 'user', parts: [{ text: DECISIONS_PROMPT }, { text: redactedText }] }],
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('arbitrateDecisions', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error
          ? `decision arbitration failed (${cause.name})`
          : 'decision arbitration failed',
      );
    }

    const parsed = DecisionsSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) {
      // A malformed decision list loses this meeting's distilled decisions,
      // not the meeting. Returning none is honest; guessing would invent a
      // decision nobody made.
      return [];
    }

    return parsed.data.decisions;
  }

  /**
   * Who/what/when, attributed by role — the transcript holds no names to draw
   * from in the first place, only placeholders.
   */
  async extractActionItems(redactedText: string): Promise<readonly ActionItemDraft[]> {
    if (redactedText.trim() === '') return [];

    let raw: string;
    try {
      const response = await this.request('extractActionItems', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [{ role: 'user', parts: [{ text: ACTION_ITEMS_PROMPT }, { text: redactedText }] }],
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('extractActionItems', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error
          ? `action item extraction failed (${cause.name})`
          : 'action item extraction failed',
      );
    }

    const parsed = ActionItemsSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) return [];

    return parsed.data.actionItems;
  }

  /**
   * An instant kickoff draft plus probable follow-ups, from an
   * already-redacted transcript.
   */
  async draftProject(redactedText: string): Promise<ProjectDraft> {
    if (redactedText.trim() === '') return { kickoff: '', followUps: [] };

    let raw: string;
    try {
      const response = await this.request('draftProject', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [{ role: 'user', parts: [{ text: PROJECT_DRAFT_PROMPT }, { text: redactedText }] }],
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('draftProject', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error ? `project draft failed (${cause.name})` : 'project draft failed',
      );
    }

    const parsed = ProjectDraftSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) return { kickoff: '', followUps: [] };

    return { kickoff: parsed.data.kickoff, followUps: parsed.data.followUps };
  }

  /**
   * Answers strictly from the excerpts supplied.
   *
   * The prompt is the enforcement for the rule the assistant module documents: no
   * outside knowledge, no Shariah or financial opinion, cite or say nothing was
   * found. `unanswerable` is a field the model sets rather than something inferred
   * from the prose, so "I could not find this" cannot be mistaken for an answer.
   */
  async answerFromContext(
    question: string,
    excerpts: readonly GroundingExcerpt[],
  ): Promise<GroundedAnswer> {
    const context = excerpts
      .map((excerpt) =>
        `<meeting id="${excerpt.meetingId}" title="${excerpt.title}" date="${excerpt.occurredAt}">\n`
        + `${excerpt.text}\n</meeting>`)
      .join('\n\n');

    let raw: string;
    try {
      const response = await this.request('answerFromContext', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [
          {
            role: 'user',
            parts: [
              { text: ANSWER_PROMPT },
              { text: `Question: ${question}` },
              { text: `Meetings:\n${context}` },
            ],
          },
        ],
        // temperature 0: the same question over the same corpus should not give a
        // reviewer two different answers on two days.
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('answerFromContext', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error ? `answer failed (${cause.name})` : 'answer failed',
      );
    }

    const parsed = AnswerSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) {
      throw new TranscriptionError('gemini', 'answer did not match the expected shape');
    }

    return {
      answer: parsed.data.answer,
      citedMeetingIds: parsed.data.citedMeetingIds,
      unanswerable: parsed.data.unanswerable,
      modelId: this.config.textModel,
      promptVersion: ANSWER_PROMPT_VERSION,
    };
  }

  /**
   * Proposed term sheet fields from a meeting's already-redacted transcript
   * and attachment text. Every field is optional on the way in, and a
   * response that fails the schema is treated the same as one that named
   * nothing — an empty suggestion, not a thrown error, on the same
   * best-effort reasoning as arbitrateDecisions above.
   */
  async suggestTermSheet(redactedContext: string): Promise<TermSheetSuggestion> {
    const empty = { modelId: this.config.textModel, promptVersion: TERM_SHEET_PROMPT_VERSION };
    if (redactedContext.trim() === '') return empty;

    let raw: string;
    try {
      const response = await this.request('suggestTermSheet', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [
          { role: 'user', parts: [{ text: TERM_SHEET_PROMPT }, { text: redactedContext }] },
        ],
        config: { responseMimeType: 'application/json', temperature: 0 },
      }));
      raw = response.text ?? '';
    } catch (cause) {
      logApiErrorStatus('suggestTermSheet', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error
          ? `term sheet suggestion failed (${cause.name})`
          : 'term sheet suggestion failed',
      );
    }

    const parsed = TermSheetSuggestionSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) return empty;

    return {
      ...parsed.data,
      modelId: this.config.textModel,
      promptVersion: TERM_SHEET_PROMPT_VERSION,
    };
  }

  async summarize(redactedText: string): Promise<string> {
    try {
      const response = await this.request('summarize', this.client.models.generateContent({
        model: this.config.textModel,
        contents: [
          { role: 'user', parts: [{ text: `${SUMMARY_PROMPT}\n\n---\n${redactedText}` }] },
        ],
        config: { temperature: 0 },
      }));

      const summary = (response.text ?? '').trim();
      if (summary === '') {
        throw new TranscriptionError('gemini', 'returned an empty summary');
      }
      return summary;
    } catch (cause) {
      if (cause instanceof TranscriptionError) throw cause;
      logApiErrorStatus('summarize', cause);
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error ? `summary failed (${cause.name})` : 'summary failed',
      );
    }
  }

  /** Recorded alongside output so an auditor can tie a transcript to a prompt. */
  static get promptVersions(): { transcribe: string; summary: string } {
    return { transcribe: PROMPT_VERSION, summary: SUMMARY_PROMPT_VERSION };
  }
}
