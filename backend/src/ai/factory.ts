import type { Env } from '../config/env.js';
import { FakeTranscriptionProvider } from './fake.provider.js';
import { FallbackTranscriptionProvider } from './fallback.provider.js';
import { GeminiTranscriptionProvider } from './gemini.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';
import type { TranscriptionProvider } from './provider.js';

/**
 * Selects the provider named by TRANSCRIPTION_PROVIDER.
 *
 * The env schema already refuses to start when the provider is `gemini` and any
 * credential is missing, so the guard below should be unreachable. It exists
 * because the alternative is constructing a client with an undefined key and
 * discovering it on the first upload — after audio has been read into memory.
 */
export function createTranscriptionProvider(env: Env): TranscriptionProvider {
  switch (env.TRANSCRIPTION_PROVIDER) {
    case 'fake':
      return new FakeTranscriptionProvider();

    case 'gemini': {
      const {
        GEMINI_API_KEY,
        GEMINI_MODEL_TRANSCRIBE,
        GEMINI_MODEL_TEXT,
        GEMINI_MODEL_VISION,
      } = env;
      if (
        GEMINI_API_KEY === undefined
        || GEMINI_API_KEY === ''
        || GEMINI_MODEL_TRANSCRIBE === undefined
        || GEMINI_MODEL_TRANSCRIBE === ''
        || GEMINI_MODEL_TEXT === undefined
        || GEMINI_MODEL_TEXT === ''
        || GEMINI_MODEL_VISION === undefined
        || GEMINI_MODEL_VISION === ''
      ) {
        throw new Error(
          'TRANSCRIPTION_PROVIDER=gemini requires GEMINI_API_KEY, '
          + 'GEMINI_MODEL_TRANSCRIBE, GEMINI_MODEL_TEXT and GEMINI_MODEL_VISION.',
        );
      }
      const gemini = new GeminiTranscriptionProvider({
        apiKey: GEMINI_API_KEY,
        transcribeModel: GEMINI_MODEL_TRANSCRIBE,
        textModel: GEMINI_MODEL_TEXT,
        visionModel: GEMINI_MODEL_VISION,
        /**
         * Optional. An empty string means no embedding model is configured, and
         * the knowledge features degrade rather than the server refusing to boot:
         * the graph falls back to topic overlap and the assistant answers 501.
         */
        embeddingModel: env.GEMINI_MODEL_EMBEDDING ?? '',
      });

      /**
       * OPENROUTER_API_KEY is the only switch for this. Unset, boot behaviour
       * is byte-for-byte what it was before this fallback existed — Gemini
       * alone. Set, every Gemini call gets one retry against OpenRouter
       * before the caller ever sees a failure.
       */
      if (env.OPENROUTER_API_KEY === undefined || env.OPENROUTER_API_KEY === '') {
        return gemini;
      }
      const openRouter = new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_MODEL,
        transcribeModel: env.OPENROUTER_MODEL_TRANSCRIBE,
      });
      return new FallbackTranscriptionProvider(gemini, openRouter);
    }
  }
}
