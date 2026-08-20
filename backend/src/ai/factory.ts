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
      let provider: TranscriptionProvider = new GeminiTranscriptionProvider({
        auth: { mode: 'api-key', apiKey: GEMINI_API_KEY },
        transcribeModel: GEMINI_MODEL_TRANSCRIBE,
        textModel: GEMINI_MODEL_TEXT,
        visionModel: GEMINI_MODEL_VISION,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        /**
         * Optional. An empty string means no embedding model is configured, and
         * the knowledge features degrade rather than the server refusing to boot:
         * the graph falls back to topic overlap and the assistant answers 501.
         */
        embeddingModel: env.GEMINI_MODEL_EMBEDDING ?? '',
      });

      // Optional Vertex AI fallback if service account credentials are provided
      if (
        env.VERTEX_PROJECT_ID
        && env.VERTEX_LOCATION
        && env.GCP_SERVICE_ACCOUNT_KEY
      ) {
        try {
          const credentials = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
          const vertexFallback = new GeminiTranscriptionProvider({
            auth: {
              mode: 'vertex',
              project: env.VERTEX_PROJECT_ID,
              location: env.VERTEX_LOCATION,
              credentials,
            },
            transcribeModel: env.VERTEX_MODEL_TRANSCRIBE || GEMINI_MODEL_TRANSCRIBE,
            textModel: env.VERTEX_MODEL_TEXT || GEMINI_MODEL_TEXT,
            visionModel: env.VERTEX_MODEL_VISION || GEMINI_MODEL_VISION,
            timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
            embeddingModel: env.VERTEX_MODEL_EMBEDDING ?? env.GEMINI_MODEL_EMBEDDING ?? '',
          });
          provider = new FallbackTranscriptionProvider(provider, vertexFallback);
        } catch {
          // Ignore invalid JSON in optional fallback
        }
      }

      return withOpenRouterFallback(provider, env);
    }

    case 'vertex': {
      const {
        VERTEX_PROJECT_ID,
        VERTEX_LOCATION,
        GCP_SERVICE_ACCOUNT_KEY,
        VERTEX_MODEL_TRANSCRIBE,
        VERTEX_MODEL_TEXT,
        VERTEX_MODEL_VISION,
      } = env;
      if (
        VERTEX_PROJECT_ID === undefined
        || VERTEX_PROJECT_ID === ''
        || VERTEX_LOCATION === undefined
        || VERTEX_LOCATION === ''
        || GCP_SERVICE_ACCOUNT_KEY === undefined
        || GCP_SERVICE_ACCOUNT_KEY === ''
        || VERTEX_MODEL_TRANSCRIBE === undefined
        || VERTEX_MODEL_TRANSCRIBE === ''
        || VERTEX_MODEL_TEXT === undefined
        || VERTEX_MODEL_TEXT === ''
        || VERTEX_MODEL_VISION === undefined
        || VERTEX_MODEL_VISION === ''
      ) {
        throw new Error(
          'TRANSCRIPTION_PROVIDER=vertex requires VERTEX_PROJECT_ID, VERTEX_LOCATION, '
          + 'GCP_SERVICE_ACCOUNT_KEY, VERTEX_MODEL_TRANSCRIBE, VERTEX_MODEL_TEXT and '
          + 'VERTEX_MODEL_VISION.',
        );
      }
      // env.ts's superRefine already rejects a GCP_SERVICE_ACCOUNT_KEY that
      // doesn't parse, so this JSON.parse cannot throw for a process that
      // passed getEnv().
      let provider: TranscriptionProvider = new GeminiTranscriptionProvider({
        auth: {
          mode: 'vertex',
          project: VERTEX_PROJECT_ID,
          location: VERTEX_LOCATION,
          credentials: JSON.parse(GCP_SERVICE_ACCOUNT_KEY),
        },
        transcribeModel: VERTEX_MODEL_TRANSCRIBE,
        textModel: VERTEX_MODEL_TEXT,
        visionModel: VERTEX_MODEL_VISION,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        embeddingModel: env.VERTEX_MODEL_EMBEDDING ?? '',
      });

      // Optional Gemini AI Studio API key fallback when GEMINI_API_KEY is provided
      if (env.GEMINI_API_KEY && env.GEMINI_API_KEY !== '') {
        const geminiApiKeyFallback = new GeminiTranscriptionProvider({
          auth: { mode: 'api-key', apiKey: env.GEMINI_API_KEY },
          transcribeModel: env.GEMINI_MODEL_TRANSCRIBE || VERTEX_MODEL_TRANSCRIBE,
          textModel: env.GEMINI_MODEL_TEXT || VERTEX_MODEL_TEXT,
          visionModel: env.GEMINI_MODEL_VISION || VERTEX_MODEL_VISION,
          timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
          embeddingModel: env.GEMINI_MODEL_EMBEDDING ?? env.VERTEX_MODEL_EMBEDDING ?? '',
        });
        provider = new FallbackTranscriptionProvider(provider, geminiApiKeyFallback);
      }

      return withOpenRouterFallback(provider, env);
    }
  }
}

/**
 * OPENROUTER_API_KEY is the only switch for this, regardless of which Gemini
 * auth transport is active. Unset, boot behaviour is byte-for-byte what it
 * was before this fallback existed. Set, every call gets one retry against
 * OpenRouter before the caller ever sees a failure.
 */
function withOpenRouterFallback(
  provider: TranscriptionProvider,
  env: Env,
): TranscriptionProvider {
  if (env.OPENROUTER_API_KEY === undefined || env.OPENROUTER_API_KEY === '') {
    return provider;
  }
  const openRouter = new OpenRouterProvider({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    transcribeModel: env.OPENROUTER_MODEL_TRANSCRIBE,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
  });
  return new FallbackTranscriptionProvider(provider, openRouter);
}
