import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import {
  type AudioInput,
  TranscriptionError,
  type TranscriptionProvider,
  type TranscriptionResult,
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

const PROMPT_VERSION = 'gemini-transcribe-v1';
const SUMMARY_PROMPT_VERSION = 'gemini-summary-v1';

const TRANSCRIBE_PROMPT = `You are transcribing a recorded credit committee meeting at a Malaysian bank.

Rules:
- Transcribe only what is spoken. Never infer, complete or correct a figure, a name, or an identifier.
- Speakers mix English, Malay and Chinese dialects within a single sentence. Keep the words as spoken. Do not translate.
- Write spoken numbers as digits.
- Where a passage is unclear, emit the token [inaudible]. Never guess at it.
- Attribute each segment to a speaker label such as "Speaker 1", or a role if one is stated.

Return JSON only, in exactly this shape:
{"languages":["en","ms"],"segments":[{"startMs":0,"endMs":6000,"speaker":"Speaker 1","text":"..."}]}`;

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
      }),
    )
    .min(1),
});

export interface GeminiConfig {
  readonly apiKey: string;
  readonly transcribeModel: string;
  readonly textModel: string;
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
      })),
      languages: parsed.data.languages,
      modelId: this.config.transcribeModel,
      promptVersion: PROMPT_VERSION,
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
