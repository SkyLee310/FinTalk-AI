import {
  type ActionItemDraft,
  type AudioInput,
  type DecisionDraft,
  type GroundedAnswer,
  type GroundingExcerpt,
  type ImageInput,
  type ProjectDraft,
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
  SUMMARY_PROMPT,
  TOPICS_PROMPT,
  TopicsSchema,
  WHITEBOARD_PROMPT,
  WhiteboardSchema,
} from './prompts.js';

/**
 * OpenRouter-backed transcription — the fallback used when Gemini fails.
 *
 * Same two rules as gemini.provider.ts: upstream error messages never
 * forwarded (only an HTTP status crosses this boundary), and a response that
 * doesn't match the expected shape is a failure, not something to salvage.
 *
 * No embed(): OpenRouter's chat/audio models don't expose the embedding
 * endpoint this app uses, and even if they did, an embedding from a
 * different model is not comparable to a Gemini one — mixing them would
 * silently corrupt cross-meeting similarity. A provider without an
 * embedding model omits it, same as any other TranscriptionProvider.
 *
 * No speaker diarization: OpenRouter's transcription endpoint returns one
 * block of text with no per-speaker split, so transcribe() reports the
 * whole clip as a single segment under one generic label rather than
 * guessing who said what.
 */

const BASE_URL = 'https://openrouter.ai/api/v1';

const PROMPT_VERSION = 'openrouter-transcribe-v1';
const SUMMARY_PROMPT_VERSION = 'openrouter-summary-v1';
const ANSWER_PROMPT_VERSION = 'openrouter-answer-v1';
const WHITEBOARD_PROMPT_VERSION = 'openrouter-whiteboard-v1';

export interface OpenRouterConfig {
  readonly apiKey: string;
  /** Text + vision model, used for every JSON/text task including whiteboard reading. */
  readonly model: string;
  readonly transcribeModel: string;
  readonly timeoutMs?: number;
}

/** Mirrors gemini.provider.ts's logApiErrorStatus: a status code carries no request content. */
function logHttpErrorStatus(stage: string, status: number): void {
  console.error(`[openrouter:${stage}] HTTP status=${String(status)}`);
}

async function postOpenRouter(
  apiKey: string,
  path: string,
  body: unknown,
  stage: string,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new TranscriptionError(
      'openrouter',
      cause instanceof Error && cause.name === 'TimeoutError'
        ? `${stage} timed out after ${String(timeoutMs)}ms`
        : cause instanceof Error ? `request failed (${cause.name})` : 'request failed',
    );
  }

  if (!response.ok) {
    logHttpErrorStatus(stage, response.status);
    throw new TranscriptionError('openrouter', `${stage} failed (HTTP ${String(response.status)})`);
  }

  try {
    return await response.json();
  } catch {
    throw new TranscriptionError('openrouter', `${stage} response was not JSON`);
  }
}

/** MediaRecorder/upload mime types this app produces, mapped to OpenRouter's short format token. */
function audioFormatFor(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-m4a') return 'm4a';
  return subtype || 'wav';
}

async function chatJson(
  apiKey: string,
  model: string,
  prompt: string,
  input: string,
  stage: string,
  timeoutMs: number = 30_000
): Promise<string> {
  const body = await postOpenRouter(apiKey, '/chat/completions', {
    model,
    messages: [{ role: 'user', content: input === '' ? prompt : `${prompt}\n\n---\n${input}` }],
    response_format: { type: 'json_object' },
    temperature: 0,
  }, stage,timeoutMs);
  const choices = (body as { choices?: { message?: { content?: string } }[] }).choices;
  return choices?.[0]?.message?.content ?? '';
}

export class OpenRouterProvider implements TranscriptionProvider {
  readonly name = 'openrouter' as const;

  private readonly config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    if (audio.bytes.byteLength === 0) {
      throw new TranscriptionError('openrouter', 'received empty audio');
    }

    const body = await postOpenRouter(this.config.apiKey, '/audio/transcriptions', {
      model: this.config.transcribeModel,
      input_audio: {
        data: Buffer.from(audio.bytes).toString('base64'),
        format: audioFormatFor(audio.mimeType),
      },
    }, 'transcribe', this.config.timeoutMs ?? 30_000);

    const { text: rawText, usage } = body as { text?: string; usage?: { seconds?: number } };
    const text = (rawText ?? '').trim();
    if (text === '') {
      throw new TranscriptionError('openrouter', 'returned an empty response');
    }

    return {
      segments: [
        {
          startMs: 0,
          endMs: Math.max(0, Math.round((usage?.seconds ?? 0) * 1000)),
          speakerLabel: 'Speaker 1',
          text,
          confidence: undefined,
        },
      ],
      // Not reported outside verbose_json's per-segment detail, which this
      // provider deliberately doesn't parse (see the module doc comment on
      // why an unconfirmed nested shape isn't worth the risk of a silent
      // misparse). Absent is honest; a guessed language code is not.
      languages: [],
      modelId: this.config.transcribeModel,
      promptVersion: PROMPT_VERSION,
    };
  }

  async extractWhiteboard(image: ImageInput): Promise<WhiteboardExtraction> {
    if (image.bytes.byteLength === 0) {
      throw new TranscriptionError('openrouter', 'received an empty image');
    }

    const base64 = Buffer.from(image.bytes).toString('base64');
    const body = await postOpenRouter(this.config.apiKey, '/chat/completions', {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: WHITEBOARD_PROMPT },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${base64}` } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }, 'extractWhiteboard', this.config.timeoutMs ?? 30_000);

    const choices = (body as { choices?: { message?: { content?: string } }[] }).choices;
    const raw = choices?.[0]?.message?.content ?? '';

    const parsed = WhiteboardSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) {
      throw new TranscriptionError('openrouter', 'whiteboard response did not match the schema');
    }

    return {
      kind: parsed.data.kind,
      mermaid: parsed.data.mermaid,
      structured: parsed.data.structured,
      modelId: this.config.model,
      promptVersion: WHITEBOARD_PROMPT_VERSION,
    };
  }

  async extractTopics(redactedSummary: string): Promise<readonly TopicDraft[]> {
    if (redactedSummary.trim() === '') return [];

    const raw = await chatJson(
      this.config.apiKey,
      this.config.model,
      TOPICS_PROMPT,
      redactedSummary,
      'extractTopics', this.config.timeoutMs ?? 30_000,
    );
    const parsed = TopicsSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) return [];

    return parsed.data.topics.map((topic) => ({
      label: topic.label.trim().toLowerCase(),
      kind: topic.kind,
      weight: topic.weight,
    }));
  }

  async arbitrateDecisions(redactedText: string): Promise<readonly DecisionDraft[]> {
    if (redactedText.trim() === '') return [];

    const raw = await chatJson(
      this.config.apiKey,
      this.config.model,
      DECISIONS_PROMPT,
      redactedText,
      'arbitrateDecisions',
    );
    const parsed = DecisionsSchema.safeParse(parseJsonLoosely(raw));
    return parsed.success ? parsed.data.decisions : [];
  }

  async extractActionItems(redactedText: string): Promise<readonly ActionItemDraft[]> {
    if (redactedText.trim() === '') return [];

    const raw = await chatJson(
      this.config.apiKey,
      this.config.model,
      ACTION_ITEMS_PROMPT,
      redactedText,
      'extractActionItems',
    );
    const parsed = ActionItemsSchema.safeParse(parseJsonLoosely(raw));
    return parsed.success ? parsed.data.actionItems : [];
  }

  async draftProject(redactedText: string): Promise<ProjectDraft> {
    if (redactedText.trim() === '') return { kickoff: '', followUps: [] };

    const raw = await chatJson(
      this.config.apiKey,
      this.config.model,
      PROJECT_DRAFT_PROMPT,
      redactedText,
      'draftProject',
    );
    const parsed = ProjectDraftSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) return { kickoff: '', followUps: [] };
    return { kickoff: parsed.data.kickoff, followUps: parsed.data.followUps };
  }

  async answerFromContext(
    question: string,
    excerpts: readonly GroundingExcerpt[],
  ): Promise<GroundedAnswer> {
    const context = excerpts
      .map((excerpt) =>
        `<meeting id="${excerpt.meetingId}" title="${excerpt.title}" date="${excerpt.occurredAt}">\n`
        + `${excerpt.text}\n</meeting>`)
      .join('\n\n');

    const raw = await chatJson(
      this.config.apiKey,
      this.config.model,
      ANSWER_PROMPT,
      `Question: ${question}\n\nMeetings:\n${context}`,
      'answerFromContext',
    );
    const parsed = AnswerSchema.safeParse(parseJsonLoosely(raw));
    if (!parsed.success) {
      throw new TranscriptionError('openrouter', 'answer did not match the expected shape');
    }

    return {
      answer: parsed.data.answer,
      citedMeetingIds: parsed.data.citedMeetingIds,
      unanswerable: parsed.data.unanswerable,
      modelId: this.config.model,
      promptVersion: ANSWER_PROMPT_VERSION,
    };
  }

  async summarize(redactedText: string): Promise<string> {
    const body = await postOpenRouter(this.config.apiKey, '/chat/completions', {
      model: this.config.model,
      messages: [{ role: 'user', content: `${SUMMARY_PROMPT}\n\n---\n${redactedText}` }],
      temperature: 0,
    }, 'summarize', this.config.timeoutMs ?? 30_000);

    const choices = (body as { choices?: { message?: { content?: string } }[] }).choices;
    const summary = (choices?.[0]?.message?.content ?? '').trim();
    if (summary === '') {
      throw new TranscriptionError('openrouter', 'returned an empty summary');
    }
    return summary;
  }

  /** Recorded alongside output so an auditor can tie a transcript to a prompt. */
  static get promptVersions(): { transcribe: string; summary: string } {
    return { transcribe: PROMPT_VERSION, summary: SUMMARY_PROMPT_VERSION };
  }
}
