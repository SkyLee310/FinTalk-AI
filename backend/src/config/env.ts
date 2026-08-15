import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),

  /**
   * `local` was withdrawn on 2026-08-10 and is now a hard boot failure rather
   * than a silently ignored value. An existing deployment still carrying it
   * will refuse to start and name the variable — which is the outcome to want.
   * Accepting it and falling through to another provider would transcribe
   * meetings somewhere the operator did not choose.
   */
  TRANSCRIPTION_PROVIDER: z.enum(['gemini', 'fake']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_TRANSCRIBE: z.string().optional(),
  GEMINI_MODEL_VISION: z.string().optional(),
  GEMINI_MODEL_TEXT: z.string().optional(),
  /**
   * Optional, unlike the other three.
   *
   * Without it the knowledge graph falls back to topic overlap alone and the
   * assistant answers 501 — both degrade honestly. Making it required would stop
   * every existing deployment from booting to enable a feature they had not asked
   * for, which is a worse trade than a graph with fewer edges.
   */
  GEMINI_MODEL_EMBEDDING: z.string().optional(),

  /**
   * Optional automatic fallback. With TRANSCRIPTION_PROVIDER=gemini, setting
   * OPENROUTER_API_KEY wraps Gemini so a failed call retries once against
   * OpenRouter before the request fails. Leaving it unset leaves behavior
   * exactly as it was before this fallback existed: Gemini only.
   *
   * The two model ids default to widely available OpenRouter models so
   * setting the key alone is enough — no model research required to turn
   * this on. embed() has no OpenRouter equivalent and is never a fallback
   * target: two embedding models produce vectors that are not comparable,
   * so mixing them would silently corrupt cross-meeting similarity.
   */
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('openai/gpt-4o'),
  OPENROUTER_MODEL_TRANSCRIBE: z.string().default('openai/whisper-large-v3'),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  PII_VAULT_KEY: z.string().refine(
    (v) => {
      try { return Buffer.from(v, 'base64').length === 32; } catch { return false; }
    },
    'must be exactly 32 bytes encoded as base64 (openssl rand -base64 32)',
  ),

  MEETING_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

/**
 * Gemini credentials are required only when Gemini is the active provider,
 * so the test suite and CI run with TRANSCRIPTION_PROVIDER=fake and no key.
 */
const EnvSchema = base.superRefine((val, ctx) => {
  if (val.TRANSCRIPTION_PROVIDER !== 'gemini') return;

  const required = [
    'GEMINI_API_KEY',
    'GEMINI_MODEL_TRANSCRIBE',
    'GEMINI_MODEL_VISION',
    'GEMINI_MODEL_TEXT',
  ] as const;

  for (const key of required) {
    if (!val[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'required when TRANSCRIPTION_PROVIDER=gemini',
      });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

/** Pure and testable. Throws with every offending variable listed. */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(raw);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

let cached: Env | undefined;

/** The only place in the codebase that reads process.env. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
