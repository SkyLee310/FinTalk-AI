import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  type AudioInput,
  type GroundedAnswer,
  type GroundingExcerpt,
  type ImageInput,
  type TopicDraft,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
  type WhiteboardExtraction,
} from './provider.js';

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

// v2 adds the per-segment confidence request. Bumped because promptVersion is
// stored on every transcript as provenance — a version that no longer
// identifies the prompt that produced the output makes the column a lie.
const PROMPT_VERSION = 'gemini-transcribe-v2';
const SUMMARY_PROMPT_VERSION = 'gemini-summary-v1';

const TRANSCRIBE_PROMPT = `You are transcribing a recorded credit committee meeting at a Malaysian bank.

Rules:
- Transcribe only what is spoken. Never infer, complete or correct a figure, a name, or an identifier.
- Speakers mix English, Malay and Chinese dialects within a single sentence. Keep the words as spoken. Do not translate.
- Write spoken numbers as digits.
- Where a passage is unclear, emit the token [inaudible]. Never guess at it.
- Attribute each segment to a speaker label such as "Speaker 1", or a role if one is stated.
- Give each segment a "confidence" between 0 and 1: how certain you are that you transcribed those exact words correctly. Base it on audio clarity, overlapping speech, and unfamiliar terms. Score a segment you partly guessed at below 0.6. Do not inflate it — a low score sends a human to check, and a wrong high score sends nobody.

Return JSON only, in exactly this shape:
{"languages":["en","ms"],"segments":[{"startMs":0,"endMs":6000,"speaker":"Speaker 1","text":"...","confidence":0.94}]}`;

const SUMMARY_PROMPT = `Summarise this credit committee transcript in English, in under 120 words.

The transcript has already had personal data replaced with placeholders such as [NRIC_1]. Keep those placeholders exactly as they appear. Never invent a value to fill one.

State the facility amount, tenure and pricing basis only if the transcript states them. If pricing was disputed or left unresolved, say so explicitly. Add nothing that is not in the transcript.

Return the summary as plain text, with no preamble.`;

const ResponseSchema = z.object({
  languages: z.array(z.string().min(1)).min(1),
  segments: z
    .array(
      z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        speaker: z.string().min(1),
        text: z.string(),
        /**
         * Optional, and out-of-range values are dropped rather than clamped.
         *
         * A model that answers 1.4 or -0.2 has not understood the scale, and
         * clamping to 1.0 would turn that misunderstanding into a maximally
         * confident score. Absent is honest; invented is not.
         */
        confidence: z.number().min(0).max(1).optional().catch(undefined),
      }),
    )
    .min(1),
});

const ANSWER_PROMPT_VERSION = 'gemini-answer-v1';

const TOPICS_PROMPT = `Read this credit-meeting summary and list the topics it discusses.

Rules:
- Between 3 and 8 topics. Fewer is better than padding the list.
- Each label is 1-4 words, lower case, and describes a subject rather than an event. Examples: "murabahah", "working capital", "late payment penalty", "manufacturing sector".
- "kind" is one of CONTRACT, SECTOR, PRODUCT, ISSUE, TERM.
- "weight" is 0 to 1: how central the topic is to the discussion.
- Never name a person, a company, or any individual. These labels are shared across meetings, and a name would link records that have nothing to do with each other.
- The text contains placeholders such as [NRIC_1]. Never return one as a label, and never build a label from one.
- Use only what the summary says. Do not infer a sector or a contract that is not stated.

Return JSON only:
{"topics":[{"label":"murabahah","kind":"CONTRACT","weight":0.9}]}`;

const ANSWER_PROMPT = `Answer the question using ONLY the meeting transcripts supplied below.

Rules, in order of importance:
- Use nothing but the supplied transcripts. No outside knowledge, not even well-known facts about Islamic finance or Malaysian regulation.
- If the transcripts do not answer the question, set "unanswerable" to true and say plainly what is missing. This is a correct and useful outcome, not a failure.
- Never give a Shariah ruling, a compliance opinion, or financial advice. If asked whether something is permissible or advisable, report what the meeting participants said about it and set "unanswerable" to true. A qualified human decides; you report.
- Cite every meeting you used in "citedMeetingIds", using the id attribute exactly as given. Never cite a meeting you were not given.
- The transcripts contain placeholders such as [NRIC_1] in place of personal data. Keep them exactly as they appear. Never invent a value to fill one, and never guess who a placeholder refers to.
- Quote figures only as they appear. Do not calculate, convert, or round.
- Be brief. Under 150 words unless the question genuinely needs more.

Return JSON only:
{"answer":"...","citedMeetingIds":["..."],"unanswerable":false}`;

const TopicsSchema = z.object({
  topics: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        kind: z.enum(['CONTRACT', 'SECTOR', 'PRODUCT', 'ISSUE', 'TERM']),
        weight: z.number().min(0).max(1),
      }),
    )
    .max(12),
});

const AnswerSchema = z.object({
  answer: z.string(),
  citedMeetingIds: z.array(z.string()).default([]),
  unanswerable: z.boolean(),
});

export interface GeminiConfig {
  readonly apiKey: string;
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
}

/** Models sometimes wrap JSON in a markdown fence even when asked not to. */
function parseJsonLoosely(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/**
 * Every node label must be double-quoted, and that requirement is not
 * cosmetic. Redaction runs after extraction and rewrites identifiers into
 * bracketed placeholders — `[NRIC_1]`, `[PHONE_1]` — and Mermaid delimits
 * node text with those same square brackets. An unquoted label carrying a
 * placeholder is a parse error, so without this rule the boards that fail to
 * draw are precisely the ones holding personal data: the compliance-relevant
 * case. The renderer still falls back to the source, but a fallback is a net,
 * not a plan.
 */
const WHITEBOARD_PROMPT =
  'This is a photograph of a whiteboard from a credit meeting. Return JSON with '
  + 'two keys. "mermaid": a Mermaid flowchart of the diagram, using graph TD '
  + 'syntax, transcribing every label verbatim including any numbers. Wrap '
  + 'every node label in double quotes, and write any double quote inside a '
  + 'label as #quot;. "structured": an object of the facts written on the '
  + 'board, one key per labelled value. Transcribe what is written. Do not '
  + 'infer, complete or correct anything, and do not add keys that are not on '
  + 'the board.';

const WhiteboardSchema = z.object({
  mermaid: z.string().min(1),
  structured: z.record(z.string(), z.unknown()),
});

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'gemini' as const;

  private readonly client: GoogleGenAI;
  private readonly config: GeminiConfig;

  constructor(config: GeminiConfig) {
    this.config = config;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    if (audio.bytes.byteLength === 0) {
      throw new TranscriptionError('gemini', 'received empty audio');
    }

    let raw: string;
    try {
      const response = await this.client.models.generateContent({
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
      });
      raw = response.text ?? '';
    } catch (cause) {
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
      const response = await this.client.models.generateContent({
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
      });
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
      mermaid: result.data.mermaid,
      structured: result.data.structured,
      modelId: this.config.visionModel,
      promptVersion: 'gemini-whiteboard-v1',
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
      const response = await this.client.models.generateContent({
        model: this.config.textModel,
        contents: [{ role: 'user', parts: [{ text: TOPICS_PROMPT }, { text: redactedSummary }] }],
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      raw = response.text ?? '';
    } catch (cause) {
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
      const response = await this.client.models.embedContent({
        model: this.config.embeddingModel,
        contents: [{ role: 'user', parts: [{ text: redactedText }] }],
      });
      const values = response.embeddings?.[0]?.values;
      if (values === undefined || values.length === 0) {
        throw new TranscriptionError('gemini', 'embedding response carried no vector');
      }
      return values;
    } catch (cause) {
      if (cause instanceof TranscriptionError) throw cause;
      throw new TranscriptionError(
        'gemini',
        cause instanceof Error ? `embedding failed (${cause.name})` : 'embedding failed',
      );
    }
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
      .map((excerpt) => `<meeting id="${excerpt.meetingId}">\n${excerpt.text}\n</meeting>`)
      .join('\n\n');

    let raw: string;
    try {
      const response = await this.client.models.generateContent({
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
      });
      raw = response.text ?? '';
    } catch (cause) {
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

  async summarize(redactedText: string): Promise<string> {
    try {
      const response = await this.client.models.generateContent({
        model: this.config.textModel,
        contents: [
          { role: 'user', parts: [{ text: `${SUMMARY_PROMPT}\n\n---\n${redactedText}` }] },
        ],
        config: { temperature: 0 },
      });

      const summary = (response.text ?? '').trim();
      if (summary === '') {
        throw new TranscriptionError('gemini', 'returned an empty summary');
      }
      return summary;
    } catch (cause) {
      if (cause instanceof TranscriptionError) throw cause;
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
