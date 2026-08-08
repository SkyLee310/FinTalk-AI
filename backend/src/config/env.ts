import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),

  TRANSCRIPTION_PROVIDER: z.enum(['gemini', 'local', 'fake']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_TRANSCRIBE: z.string().optional(),
  GEMINI_MODEL_VISION: z.string().optional(),
  GEMINI_MODEL_TEXT: z.string().optional(),

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
