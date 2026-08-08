# FinTalk AI — Plan 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the two deployable packages, a boot-time-validated environment, and a database whose schema makes the spec's compliance invariants structurally impossible to violate.

**Architecture:** `backend/` (Fastify + Prisma + Postgres) and `frontend/` (Next.js) are independent npm packages with no shared build step, so Vercel and Railway deploys cannot break each other. Environment variables are parsed once through a zod schema that fails the process on a bad value. The Islamic/conventional rate exclusivity and audit-log immutability live in raw SQL migrations rather than application code, so no caller can bypass them.

**Tech Stack:** TypeScript 5, Node 20, Fastify 5, Prisma 6, PostgreSQL 16, Vitest 2, Next.js 15, Tailwind 4, GitHub Actions, gitleaks.

**Spec:** [`docs/superpowers/specs/2026-08-08-fintalk-ai-design.md`](../specs/2026-08-08-fintalk-ai-design.md) §3, §4, §5

## Global Constraints

- Money is `BigInt` minor units. Rates are integer basis points. **No floating-point value may touch money or a rate anywhere.**
- No `process.env` access outside `backend/src/config/env.ts`.
- No hardcoded AI model IDs. Model names come from env only.
- Only `.env.example` is tracked by git. `.env` must never be committed.
- All test fixtures are synthetic. **No real personal data enters the repository.**
- Conventional Commits for every commit: `type(scope): subject`. Types: `feat` `fix` `docs` `test` `refactor` `chore` `ci` `build`. Scopes used here: `backend` `frontend` `db` `ci`.
- Every commit ends with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- TypeScript `strict: true` plus `noUncheckedIndexedAccess: true` in both packages.

## File Structure

| File | Responsibility |
|---|---|
| `backend/package.json` | backend deps and scripts |
| `backend/tsconfig.json` | strict TS config |
| `backend/vitest.config.ts` | test runner config |
| `backend/.env.example` | documented env template (tracked) |
| `backend/.gitignore` | package-level secret guard |
| `backend/railway.json` | Railway build/start config |
| `backend/src/config/env.ts` | the **only** reader of `process.env`; zod schema + `parseEnv` + `getEnv` |
| `backend/src/server.ts` | Fastify bootstrap, `/health` route |
| `backend/prisma/schema.prisma` | all models and enums |
| `backend/prisma/migrations/*/migration.sql` | generated DDL |
| `backend/prisma/sql/constraints.sql` | CHECK constraints + audit immutability triggers |
| `backend/prisma/seed.ts` | one user per role + the demo SME loan meeting |
| `backend/tests/unit/config/env.test.ts` | env schema behaviour |
| `backend/tests/integration/constraints.test.ts` | DB-level invariants |
| `backend/tests/helpers/db.ts` | test DB connect/reset |
| `frontend/package.json` | frontend deps and scripts |
| `frontend/tsconfig.json` | strict TS config |
| `frontend/next.config.ts` | Next config |
| `frontend/.env.example` | documented env template (tracked) |
| `frontend/.gitignore` | package-level secret guard |
| `frontend/vercel.json` | Vercel config |
| `frontend/src/lib/api-client.ts` | typed fetch wrapper to the backend |
| `frontend/src/app/layout.tsx` | root layout |
| `frontend/src/app/page.tsx` | health page proving the two halves talk |
| `.github/workflows/ci.yml` | lint, typecheck, test, gitleaks |

---

## Task 1: Backend scaffold with fail-fast environment validation

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/.gitignore`, `backend/.env.example`, `backend/railway.json`
- Create: `backend/src/config/env.ts`, `backend/src/server.ts`
- Test: `backend/tests/unit/config/env.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `parseEnv(raw: NodeJS.ProcessEnv): Env` — pure, throws on invalid. `getEnv(): Env` — memoised singleton. `type Env` with fields `NODE_ENV`, `PORT: number`, `CORS_ORIGIN`, `DATABASE_URL`, `GEMINI_API_KEY?: string`, `GEMINI_MODEL_TRANSCRIBE?: string`, `GEMINI_MODEL_VISION?: string`, `GEMINI_MODEL_TEXT?: string`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `PII_VAULT_KEY`, `TRANSCRIPTION_PROVIDER: 'gemini'|'local'|'fake'`, `MEETING_RETENTION_DAYS: number`.

**Why `GEMINI_API_KEY` is optional in the schema:** it is required *only* when `TRANSCRIPTION_PROVIDER=gemini`. CI and the whole test suite run with `TRANSCRIPTION_PROVIDER=fake`, so no Gemini key is needed to build or test this project. That conditional requirement is enforced by `superRefine` below.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "fintalk-backend",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": {
    "@prisma/client": "^6.2.0",
    "fastify": "^5.2.0",
    "@fastify/cors": "^10.0.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "prisma": "^6.2.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.live.test.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**'] },
  },
});
```

The `exclude` line is what keeps the opt-in live-Gemini suite out of CI.

- [ ] **Step 4: Create `backend/.gitignore`**

```
.env
.env.*
!.env.example
node_modules/
dist/
coverage/
*.log
```

- [ ] **Step 5: Create `backend/.env.example`**

```
# ---------------------------------------------------------------
# Copy to .env and fill in. .env is gitignored — never commit it.
# ---------------------------------------------------------------

# --- Server ---
NODE_ENV=development
PORT=8080
CORS_ORIGIN=http://localhost:3000

# --- Database (Railway injects DATABASE_URL in production) ---
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fintalk

# --- Transcription provider: gemini | local | fake ---
# Use "fake" for tests and local work with no API key.
TRANSCRIPTION_PROVIDER=fake

# --- Gemini (required only when TRANSCRIPTION_PROVIDER=gemini) ---
# Key: https://aistudio.google.com/apikey
GEMINI_API_KEY=
# Read the current model IDs from AI Studio's model list and paste them here.
# Never hardcode a model ID in source.
GEMINI_MODEL_TRANSCRIBE=
GEMINI_MODEL_VISION=
GEMINI_MODEL_TEXT=

# --- Auth (min 32 chars each; generate: openssl rand -base64 48) ---
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# --- PII vault (AES-256-GCM; exactly 32 bytes, base64) ---
# Generate: openssl rand -base64 32
PII_VAULT_KEY=

# --- PDPA retention window ---
MEETING_RETENTION_DAYS=90
```

- [ ] **Step 6: Create `backend/railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "npm ci && npm run db:generate && npm run build" },
  "deploy": { "startCommand": "npm run db:deploy && npm start", "healthcheckPath": "/health", "restartPolicyType": "ON_FAILURE" }
}
```

- [ ] **Step 7: Write the failing test — `backend/tests/unit/config/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../src/config/env.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '8080',
  CORS_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/fintalk',
  TRANSCRIPTION_PROVIDER: 'fake',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PII_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'),
} as NodeJS.ProcessEnv;

describe('parseEnv', () => {
  it('accepts a valid environment and coerces PORT to a number', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('applies defaults for optional values', () => {
    const { MEETING_RETENTION_DAYS, ...rest } = valid;
    expect(parseEnv(rest).MEETING_RETENTION_DAYS).toBe(90);
  });

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' }))
      .toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a PII_VAULT_KEY that is not exactly 32 bytes', () => {
    expect(() => parseEnv({ ...valid, PII_VAULT_KEY: Buffer.alloc(16).toString('base64') }))
      .toThrow(/PII_VAULT_KEY/);
  });

  it('requires GEMINI_API_KEY when the provider is gemini', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'gemini', GEMINI_API_KEY: '' }))
      .toThrow(/GEMINI_API_KEY/);
  });

  it('does NOT require GEMINI_API_KEY when the provider is fake', () => {
    expect(() => parseEnv({ ...valid, TRANSCRIPTION_PROVIDER: 'fake' })).not.toThrow();
  });

  it('requires the three model IDs when the provider is gemini', () => {
    expect(() => parseEnv({
      ...valid,
      TRANSCRIPTION_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key',
    })).toThrow(/GEMINI_MODEL_TRANSCRIBE/);
  });

  it('names every offending variable in one error', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'x', CORS_ORIGIN: 'not-a-url' }))
      .toThrow(/CORS_ORIGIN[\s\S]*JWT_ACCESS_SECRET|JWT_ACCESS_SECRET[\s\S]*CORS_ORIGIN/);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

```bash
cd backend && npm install && npm run test:unit
```

Expected: FAIL — `Cannot find module '../../../src/config/env.js'`.

- [ ] **Step 9: Implement `backend/src/config/env.ts`**

```ts
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
```

- [ ] **Step 10: Run the test to verify it passes**

```bash
cd backend && npm run test:unit
```

Expected: PASS, 8 tests.

- [ ] **Step 11: Implement `backend/src/server.ts`**

```ts
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { getEnv } from './config/env.js';

export function buildServer() {
  const env = getEnv();
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });

  app.get('/health', async () => ({
    status: 'ok',
    provider: env.TRANSCRIPTION_PROVIDER,
  }));

  return app;
}

// Only auto-start outside tests, so tests can import buildServer freely.
if (process.env.NODE_ENV !== 'test') {
  const env = getEnv();
  const app = buildServer();
  app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
}
```

Note `/health` deliberately reports the provider but **never** echoes a secret.

- [ ] **Step 12: Verify the server boots and fails loudly on bad env**

```bash
cd backend && cp .env.example .env
```

Fill `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PII_VAULT_KEY` in `.env`, leave `TRANSCRIPTION_PROVIDER=fake`, then:

```bash
cd backend && npm run typecheck && npm run dev
```

Expected: server listens on 8080; `curl localhost:8080/health` returns `{"status":"ok","provider":"fake"}`. Then blank out `PII_VAULT_KEY` and restart — expected: process exits non-zero naming `PII_VAULT_KEY`.

- [ ] **Step 13: Commit**

```bash
git add backend/ && git commit -m "$(cat <<'EOF'
feat(backend): scaffold Fastify server with fail-fast env validation

Adds the backend package with strict TypeScript, Vitest, and a zod
environment schema that is the only reader of process.env. Gemini
credentials are required only when TRANSCRIPTION_PROVIDER=gemini, so the
test suite and CI run with the fake provider and no API key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Prisma schema with database-enforced compliance invariants

**Files:**
- Create: `backend/prisma/schema.prisma`, `backend/prisma/sql/constraints.sql`
- Create: `backend/tests/helpers/db.ts`, `backend/tests/integration/constraints.test.ts`
- Modify: `backend/package.json` (add `db:constraints` and `db:reset` scripts)

**Interfaces:**
- Consumes: `getEnv()` from Task 1 for `DATABASE_URL`.
- Produces: generated Prisma client with models `User`, `Meeting`, `Transcript`, `TranscriptSegment`, `Redaction`, `PiiVault`, `Whiteboard`, `ShariahFlag`, `TermSheet`, `Approval`, `AiOutputSnapshot`, `HumanEdit`, `AuditEntry`; enums `Role`, `MeetingStatus`, `PiiType`, `ShariahIssueType`, `ShariahStatus`, `FacilityKind`, `IslamicContract`, `ApprovalStatus`. Test helpers `prisma`, `resetDb(): Promise<void>`, `seedUser(role): Promise<User>`, `seedMeeting(createdById): Promise<Meeting>`.

**Deviation from spec §5.6, deliberately:** the spec said "Postgres rules" for audit immutability. Rules using `DO INSTEAD NOTHING` fail *silently*, which cannot be asserted in a test. This task uses `BEFORE UPDATE/DELETE` triggers that `RAISE EXCEPTION` instead — loud, and testable.

- [ ] **Step 1: Create `backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role            { VIEWER MAKER CHECKER SHARIAH SUPERVISOR ADMIN }
enum MeetingStatus   { CAPTURED PROCESSING READY FAILED }
enum PiiType         { NRIC BANK_ACCOUNT PHONE EMAIL PERSON_NAME ADDRESS CARD }
enum ShariahIssueType { RIBA GHARAR MAYSIR HARAM_SECTOR CONTRACT_MISMATCH LATE_PAYMENT_PENALTY }
enum ShariahStatus   { FLAGGED UNDER_REVIEW CLEARED CONFIRMED_VIOLATION }
enum FacilityKind    { CONVENTIONAL ISLAMIC }
enum IslamicContract { MURABAHAH TAWARRUQ IJARAH MUSHARAKAH MUDHARABAH ISTISNA SALAM }
enum ApprovalStatus  { DRAFT PENDING_CHECKER APPROVED REJECTED WITHDRAWN }

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  displayName  String
  role         Role
  createdAt    DateTime @default(now())

  meetings         Meeting[]
  shariahReviews   ShariahFlag[] @relation("ShariahReviewer")
  approvalsMade    Approval[]    @relation("Maker")
  approvalsChecked Approval[]    @relation("Checker")
  humanEdits       HumanEdit[]
}

model Meeting {
  id               String        @id @default(cuid())
  title            String
  occurredAt       DateTime
  status           MeetingStatus @default(CAPTURED)
  failureReason    String?
  consentConfirmed Boolean       @default(false)
  createdById      String
  createdAt        DateTime      @default(now())

  createdBy    User          @relation(fields: [createdById], references: [id])
  transcript   Transcript?
  whiteboards  Whiteboard[]
  shariahFlags ShariahFlag[]
  termSheets   TermSheet[]

  @@index([createdById])
}

/// rawRedacted and summaryEn are only ever written with redacted content.
/// The RedactedText branded type (Plan 2) enforces this at the call site.
model Transcript {
  id            String   @id @default(cuid())
  meetingId     String   @unique
  rawRedacted   String
  summaryEn     String
  languages     String[]
  modelId       String
  promptVersion String
  createdAt     DateTime @default(now())

  meeting    Meeting             @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  segments   TranscriptSegment[]
  redactions Redaction[]
}

model TranscriptSegment {
  id           String @id @default(cuid())
  transcriptId String
  startMs      Int
  endMs        Int
  speakerLabel String
  textRedacted String

  transcript Transcript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)

  @@index([transcriptId, startMs])
}

model Redaction {
  id           String  @id @default(cuid())
  transcriptId String
  piiType      PiiType
  placeholder  String
  startOffset  Int
  endOffset    Int
  detectedBy   String
  confidence   Float
  vaultId      String? @unique

  transcript Transcript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
  vault      PiiVault?  @relation(fields: [vaultId], references: [id])

  @@index([transcriptId])
}

/// AES-256-GCM only. There is deliberately no plaintext column.
model PiiVault {
  id         String   @id @default(cuid())
  ciphertext Bytes
  iv         Bytes
  authTag    Bytes
  createdAt  DateTime @default(now())

  redaction Redaction?
}

/// The source image is never persisted — only derived artifacts.
model Whiteboard {
  id             String   @id @default(cuid())
  meetingId      String
  mermaid        String
  structuredJson Json
  modelId        String
  promptVersion  String
  createdAt      DateTime @default(now())

  meeting Meeting @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  @@index([meetingId])
}

/// status may only leave FLAGGED via a user holding Role.SHARIAH (Plan 4).
model ShariahFlag {
  id         String           @id @default(cuid())
  meetingId  String
  issueType  ShariahIssueType
  excerpt    String
  detectedBy String
  confidence Float
  reference  String
  status     ShariahStatus    @default(FLAGGED)
  createdAt  DateTime         @default(now())

  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?

  meeting    Meeting @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  reviewedBy User?   @relation("ShariahReviewer", fields: [reviewedById], references: [id])

  @@index([meetingId, status])
}

/// interestRateBps and profitRateBps are mutually exclusive.
/// Enforced by term_sheet_rate_kind_exclusive in prisma/sql/constraints.sql.
model TermSheet {
  id              String           @id @default(cuid())
  meetingId       String
  applicantName   String
  currency        String           @default("MYR")
  principalMinor  BigInt
  tenureMonths    Int
  facilityKind    FacilityKind
  interestRateBps Int?
  profitRateBps   Int?
  islamicContract IslamicContract?
  status          ApprovalStatus   @default(DRAFT)
  createdAt       DateTime         @default(now())

  meeting  Meeting   @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  approval Approval?

  @@index([meetingId])
}

/// checkerId != makerId is enforced by approval_checker_not_maker.
model Approval {
  id          String         @id @default(cuid())
  termSheetId String         @unique
  makerId     String
  submittedAt DateTime       @default(now())
  checkerId   String?
  decidedAt   DateTime?
  decision    ApprovalStatus @default(PENDING_CHECKER)
  note        String?

  termSheet TermSheet @relation(fields: [termSheetId], references: [id], onDelete: Cascade)
  maker     User      @relation("Maker", fields: [makerId], references: [id])
  checker   User?     @relation("Checker", fields: [checkerId], references: [id])
}

model AiOutputSnapshot {
  id             String   @id @default(cuid())
  entityType     String
  entityId       String
  modelId        String
  promptVersion  String
  promptRedacted String
  responseRaw    Json
  createdAt      DateTime @default(now())

  @@index([entityType, entityId])
}

model HumanEdit {
  id         String   @id @default(cuid())
  entityType String
  entityId   String
  editorId   String
  fieldPath  String
  aiValue    String
  humanValue String
  editedAt   DateTime @default(now())

  editor User @relation(fields: [editorId], references: [id])

  @@index([entityType, entityId])
}

/// Append-only. UPDATE and DELETE raise via triggers in constraints.sql.
model AuditEntry {
  id         BigInt   @id @default(autoincrement())
  at         DateTime @default(now())
  actorId    String?
  actorRole  Role?
  action     String
  entityType String
  entityId   String
  payload    Json
  prevHash   String
  hash       String   @unique

  @@index([entityType, entityId])
  @@index([at])
}
```

- [ ] **Step 2: Create `backend/prisma/sql/constraints.sql`**

```sql
-- Invariants that must not be bypassable by application code.
-- Idempotent so it can be re-run after any migration.

-- Spec §5.3 — an Islamic facility has a profit rate under a named contract;
-- a conventional facility has an interest rate. Never both.
ALTER TABLE "TermSheet" DROP CONSTRAINT IF EXISTS term_sheet_rate_kind_exclusive;
ALTER TABLE "TermSheet" ADD CONSTRAINT term_sheet_rate_kind_exclusive CHECK (
  (   "facilityKind" = 'CONVENTIONAL'
  AND "interestRateBps" IS NOT NULL
  AND "profitRateBps"   IS NULL
  AND "islamicContract" IS NULL )
  OR
  (   "facilityKind" = 'ISLAMIC'
  AND "profitRateBps"   IS NOT NULL
  AND "interestRateBps" IS NULL
  AND "islamicContract" IS NOT NULL )
);

-- Money and rates are non-negative integers.
ALTER TABLE "TermSheet" DROP CONSTRAINT IF EXISTS term_sheet_amounts_non_negative;
ALTER TABLE "TermSheet" ADD CONSTRAINT term_sheet_amounts_non_negative CHECK (
  "principalMinor" > 0
  AND "tenureMonths" > 0
  AND COALESCE("interestRateBps", 0) >= 0
  AND COALESCE("profitRateBps", 0) >= 0
);

-- Spec §5.5 — segregation of duties.
ALTER TABLE "Approval" DROP CONSTRAINT IF EXISTS approval_checker_not_maker;
ALTER TABLE "Approval" ADD CONSTRAINT approval_checker_not_maker CHECK (
  "checkerId" IS NULL OR "checkerId" <> "makerId"
);

-- Confidence values are probabilities.
ALTER TABLE "Redaction" DROP CONSTRAINT IF EXISTS redaction_confidence_range;
ALTER TABLE "Redaction" ADD CONSTRAINT redaction_confidence_range CHECK (
  confidence >= 0 AND confidence <= 1
);
ALTER TABLE "ShariahFlag" DROP CONSTRAINT IF EXISTS shariah_flag_confidence_range;
ALTER TABLE "ShariahFlag" ADD CONSTRAINT shariah_flag_confidence_range CHECK (
  confidence >= 0 AND confidence <= 1
);

-- A resolved Shariah flag must record who resolved it and when.
ALTER TABLE "ShariahFlag" DROP CONSTRAINT IF EXISTS shariah_flag_resolution_attributed;
ALTER TABLE "ShariahFlag" ADD CONSTRAINT shariah_flag_resolution_attributed CHECK (
  status IN ('FLAGGED', 'UNDER_REVIEW')
  OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL)
);

-- Spec §5.6 — audit log is append-only. Triggers raise so tests can assert.
CREATE OR REPLACE FUNCTION audit_entry_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEntry is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_entry_no_update ON "AuditEntry";
CREATE TRIGGER audit_entry_no_update BEFORE UPDATE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION audit_entry_append_only();

DROP TRIGGER IF EXISTS audit_entry_no_delete ON "AuditEntry";
CREATE TRIGGER audit_entry_no_delete BEFORE DELETE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION audit_entry_append_only();
```

- [ ] **Step 3: Add the constraints scripts to `backend/package.json`**

Insert into `"scripts"`, after `"db:deploy"`:

```json
"db:constraints": "psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f prisma/sql/constraints.sql",
"db:reset": "prisma migrate reset --force && npm run db:constraints",
```

- [ ] **Step 4: Create the test helper `backend/tests/helpers/db.ts`**

```ts
import { PrismaClient, type Role } from '@prisma/client';

export const prisma = new PrismaClient();

/** Truncate every table. AuditEntry needs the append-only triggers disabled. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEntry" DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEntry", "HumanEdit", "AiOutputSnapshot", "Approval", "TermSheet",
      "ShariahFlag", "Whiteboard", "Redaction", "PiiVault",
      "TranscriptSegment", "Transcript", "Meeting", "User"
    RESTART IDENTITY CASCADE
  `);
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditEntry" ENABLE TRIGGER USER');
}

export async function seedUser(role: Role) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}@example.test`,
      passwordHash: 'not-a-real-hash',
      displayName: role,
      role,
    },
  });
}

export async function seedMeeting(createdById: string) {
  return prisma.meeting.create({
    data: {
      title: 'Test meeting',
      occurredAt: new Date('2026-08-08T02:00:00Z'),
      createdById,
    },
  });
}
```

- [ ] **Step 5: Write the failing test — `backend/tests/integration/constraints.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb, seedMeeting, seedUser } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('TermSheet rate exclusivity (spec §5.3)', () => {
  it('accepts a conventional facility with an interest rate', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'SME Tech Solutions Sdn Bhd',
        principalMinor: 5_000_000n, // MYR 50,000.00
        tenureMonths: 60,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 800,
      },
    });
    expect(sheet.principalMinor).toBe(5_000_000n);
    expect(sheet.profitRateBps).toBeNull();
  });

  it('accepts an Islamic facility with a profit rate and a named contract', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'SME Tech Solutions Sdn Bhd',
        principalMinor: 5_000_000n,
        tenureMonths: 60,
        facilityKind: 'ISLAMIC',
        profitRateBps: 800,
        islamicContract: 'MURABAHAH',
      },
    });
    expect(sheet.islamicContract).toBe('MURABAHAH');
    expect(sheet.interestRateBps).toBeNull();
  });

  // This is the slide 6 / slide 7 contradiction, made impossible.
  it('rejects an Islamic facility carrying an interest rate', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'SME Tech Solutions Sdn Bhd',
        principalMinor: 5_000_000n,
        tenureMonths: 60,
        facilityKind: 'ISLAMIC',
        interestRateBps: 800,
        profitRateBps: 800,
        islamicContract: 'MURABAHAH',
      },
    })).rejects.toThrow(/term_sheet_rate_kind_exclusive/);
  });

  it('rejects an Islamic facility with no named contract', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 1_000_000n,
        tenureMonths: 12,
        facilityKind: 'ISLAMIC',
        profitRateBps: 500,
      },
    })).rejects.toThrow(/term_sheet_rate_kind_exclusive/);
  });

  it('rejects a zero principal', async () => {
    const user = await seedUser('MAKER');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 0n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    })).rejects.toThrow(/term_sheet_amounts_non_negative/);
  });
});

describe('Approval segregation of duties (spec §5.5)', () => {
  it('rejects a checker who is also the maker', async () => {
    const maker = await seedUser('MAKER');
    const meeting = await seedMeeting(maker.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 1_000_000n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    });
    await expect(prisma.approval.create({
      data: { termSheetId: sheet.id, makerId: maker.id, checkerId: maker.id },
    })).rejects.toThrow(/approval_checker_not_maker/);
  });

  it('accepts a distinct checker', async () => {
    const maker = await seedUser('MAKER');
    const checker = await seedUser('CHECKER');
    const meeting = await seedMeeting(maker.id);
    const sheet = await prisma.termSheet.create({
      data: {
        meetingId: meeting.id,
        applicantName: 'X Sdn Bhd',
        principalMinor: 1_000_000n,
        tenureMonths: 12,
        facilityKind: 'CONVENTIONAL',
        interestRateBps: 500,
      },
    });
    const approval = await prisma.approval.create({
      data: { termSheetId: sheet.id, makerId: maker.id, checkerId: checker.id },
    });
    expect(approval.checkerId).toBe(checker.id);
  });
});

describe('ShariahFlag resolution attribution (spec §5.4)', () => {
  it('rejects a CLEARED flag with no reviewer recorded', async () => {
    const user = await seedUser('SHARIAH');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.shariahFlag.create({
      data: {
        meetingId: meeting.id,
        issueType: 'RIBA',
        excerpt: 'fixed interest rate of 8% per annum',
        detectedBy: 'rule:riba.interest-rate-mention',
        confidence: 0.9,
        reference: 'BNM SGP',
        status: 'CLEARED',
      },
    })).rejects.toThrow(/shariah_flag_resolution_attributed/);
  });

  it('rejects a confidence above 1', async () => {
    const user = await seedUser('SHARIAH');
    const meeting = await seedMeeting(user.id);
    await expect(prisma.shariahFlag.create({
      data: {
        meetingId: meeting.id,
        issueType: 'RIBA',
        excerpt: 'x',
        detectedBy: 'llm',
        confidence: 1.5,
        reference: 'BNM SGP',
      },
    })).rejects.toThrow(/shariah_flag_confidence_range/);
  });
});

describe('AuditEntry is append-only (spec §5.6)', () => {
  async function insertEntry() {
    return prisma.auditEntry.create({
      data: {
        action: 'meeting.uploaded',
        entityType: 'Meeting',
        entityId: 'm1',
        payload: { note: 'synthetic' },
        prevHash: 'GENESIS',
        hash: `h-${Date.now()}-${Math.random()}`,
      },
    });
  }

  it('allows insert', async () => {
    const entry = await insertEntry();
    expect(entry.id).toBeGreaterThan(0n);
  });

  it('rejects update', async () => {
    const entry = await insertEntry();
    await expect(
      prisma.auditEntry.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects delete', async () => {
    const entry = await insertEntry();
    await expect(
      prisma.auditEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow(/append-only/);
  });

  it('rejects a duplicate hash', async () => {
    const hash = 'fixed-hash-value';
    await prisma.auditEntry.create({
      data: { action: 'a', entityType: 'T', entityId: '1', payload: {}, prevHash: 'GENESIS', hash },
    });
    await expect(prisma.auditEntry.create({
      data: { action: 'b', entityType: 'T', entityId: '2', payload: {}, prevHash: hash, hash },
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Start Postgres and run the test to verify it fails**

```bash
docker run -d --name fintalk-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fintalk -p 5432:5432 postgres:16
```

```bash
cd backend && npm run test:integration
```

Expected: FAIL — Prisma client not generated / tables do not exist.

- [ ] **Step 7: Generate the client, run the migration, apply the constraints**

```bash
cd backend && npm run db:generate && npx prisma migrate dev --name init && npm run db:constraints
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd backend && npm run test:integration
```

Expected: PASS, 12 tests. If `term_sheet_rate_kind_exclusive` does not appear in a rejection message, `constraints.sql` did not apply — re-run `npm run db:constraints` and check for a psql error.

- [ ] **Step 9: Commit**

```bash
git add backend/prisma backend/tests backend/package.json && git commit -m "$(cat <<'EOF'
feat(db): add schema with database-enforced compliance invariants

Islamic and conventional rate fields are mutually exclusive via a CHECK
constraint, so a term sheet cannot carry an interest rate alongside a
Shariah contract — the contradiction between deck slides 6 and 7 is now
unrepresentable. Adds segregation-of-duties, confidence-range, and
resolution-attribution constraints.

AuditEntry immutability uses BEFORE UPDATE/DELETE triggers that raise,
rather than the rules named in the spec: rules with DO INSTEAD NOTHING
fail silently and cannot be asserted in a test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Seed the demo scenario

**Files:**
- Create: `backend/prisma/seed.ts`
- Test: `backend/tests/integration/seed.test.ts`
- Modify: `backend/package.json` (add `argon2` dependency)

**Interfaces:**
- Consumes: Prisma client and enums from Task 2; `prisma` and `resetDb` from `tests/helpers/db.ts`.
- Produces: `seedDatabase(prisma: PrismaClient): Promise<void>` — idempotent, safe to re-run. Creates six users (one per role, password `Demo!2345`, emails `<role>@fintalk.test`) and the SME loan meeting from deck slide 8.

- [ ] **Step 1: Add argon2 to `backend/package.json` dependencies**

```json
"argon2": "^0.41.1"
```

Then:

```bash
cd backend && npm install
```

- [ ] **Step 2: Write the failing test — `backend/tests/integration/seed.test.ts`**

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../prisma/seed.js';
import { prisma, resetDb } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('seedDatabase', () => {
  it('creates one user per role', async () => {
    await seedDatabase(prisma);
    const roles = (await prisma.user.findMany({ select: { role: true } })).map((u) => u.role).sort();
    expect(roles).toEqual(['ADMIN', 'CHECKER', 'MAKER', 'SHARIAH', 'SUPERVISOR', 'VIEWER']);
  });

  it('creates the demo SME loan meeting with a redacted transcript', async () => {
    await seedDatabase(prisma);
    const meeting = await prisma.meeting.findFirst({
      where: { title: { contains: 'SME' } },
      include: { transcript: { include: { segments: true, redactions: true } } },
    });
    expect(meeting?.status).toBe('READY');
    expect(meeting?.consentConfirmed).toBe(true);
    expect(meeting?.transcript?.segments.length).toBeGreaterThan(0);
    expect(meeting?.transcript?.redactions.length).toBeGreaterThan(0);
  });

  it('never stores an unmasked NRIC in the transcript', async () => {
    await seedDatabase(prisma);
    const t = await prisma.transcript.findFirst();
    expect(t?.rawRedacted).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(t?.rawRedacted).toContain('[NRIC_1]');
  });

  it('creates an open Shariah flag for the riba mention', async () => {
    await seedDatabase(prisma);
    const flag = await prisma.shariahFlag.findFirst({ where: { issueType: 'RIBA' } });
    expect(flag?.status).toBe('FLAGGED');
    expect(flag?.reviewedById).toBeNull();
  });

  it('is idempotent', async () => {
    await seedDatabase(prisma);
    await seedDatabase(prisma);
    expect(await prisma.user.count()).toBe(6);
    expect(await prisma.meeting.count()).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npm run test:integration -- seed
```

Expected: FAIL — cannot resolve `../../prisma/seed.js`.

- [ ] **Step 4: Implement `backend/prisma/seed.ts`**

```ts
import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';

const DEMO_PASSWORD = 'Demo!2345';
const ROLES: Role[] = ['VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN'];

/**
 * All content below is synthetic. The NRIC placeholder stands in for a value
 * that in production would live encrypted in PiiVault — the seed deliberately
 * stores no vault row, because there is no real identifier to protect.
 */
const SEGMENTS = [
  { speakerLabel: 'Credit Officer', startMs: 0, endMs: 6_000,
    textRedacted: 'Okay boss, we nak discuss the SME working capital facility for SME Tech Solutions.' },
  { speakerLabel: 'Credit Manager', startMs: 6_000, endMs: 14_000,
    textRedacted: 'Amount berapa? I think RM 50,000 cukup for their expansion, tenure five years.' },
  { speakerLabel: 'Credit Officer', startMs: 14_000, endMs: 22_000,
    textRedacted: 'Betul. Director punya IC is [NRIC_1], account [BANK_ACCOUNT_1] at Maybank.' },
  { speakerLabel: 'Credit Manager', startMs: 22_000, endMs: 31_000,
    textRedacted: 'For the pricing, we quote fixed interest rate of 8% per annum lah.' },
  { speakerLabel: 'Shariah Officer', startMs: 31_000, endMs: 40_000,
    textRedacted: 'Wait — kalau Islamic facility, cannot pakai interest. Kena guna Murabahah profit rate.' },
];

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const users = await Promise.all(
    ROLES.map((role) =>
      prisma.user.upsert({
        where: { email: `${role.toLowerCase()}@fintalk.test` },
        update: {},
        create: {
          email: `${role.toLowerCase()}@fintalk.test`,
          passwordHash,
          displayName: `Demo ${role}`,
          role,
        },
      }),
    ),
  );

  const maker = users.find((u) => u.role === 'MAKER');
  if (!maker) throw new Error('seed: MAKER user was not created');

  const existing = await prisma.meeting.findFirst({ where: { title: { contains: 'SME' } } });
  if (existing) return;

  const meeting = await prisma.meeting.create({
    data: {
      title: 'SME Loan Approval Meeting — Tech Solutions Sdn Bhd',
      occurredAt: new Date('2026-08-07T02:30:00Z'),
      status: 'READY',
      consentConfirmed: true,
      createdById: maker.id,
    },
  });

  const rawRedacted = SEGMENTS
    .map((s) => `[${s.startMs / 1000}s] ${s.speakerLabel}: ${s.textRedacted}`)
    .join('\n');

  const transcript = await prisma.transcript.create({
    data: {
      meetingId: meeting.id,
      rawRedacted,
      summaryEn:
        'Credit committee discussed a MYR 50,000 SME working capital facility for Tech Solutions Sdn Bhd '
        + 'over a five-year tenure. Pricing was initially quoted as an 8% per annum interest rate; the Shariah '
        + 'officer objected that an Islamic facility requires a Murabahah profit rate instead. '
        + 'Pricing basis is unresolved.',
      languages: ['en', 'ms'],
      modelId: 'seed-fixture',
      promptVersion: 'seed-v1',
      segments: { create: SEGMENTS },
    },
  });

  const nricAt = rawRedacted.indexOf('[NRIC_1]');
  const acctAt = rawRedacted.indexOf('[BANK_ACCOUNT_1]');

  await prisma.redaction.createMany({
    data: [
      { transcriptId: transcript.id, piiType: 'NRIC', placeholder: '[NRIC_1]',
        startOffset: nricAt, endOffset: nricAt + '[NRIC_1]'.length,
        detectedBy: 'regex:nric', confidence: 0.99 },
      { transcriptId: transcript.id, piiType: 'BANK_ACCOUNT', placeholder: '[BANK_ACCOUNT_1]',
        startOffset: acctAt, endOffset: acctAt + '[BANK_ACCOUNT_1]'.length,
        detectedBy: 'regex:bank-account', confidence: 0.95 },
    ],
  });

  await prisma.shariahFlag.create({
    data: {
      meetingId: meeting.id,
      issueType: 'RIBA',
      excerpt: 'fixed interest rate of 8% per annum',
      detectedBy: 'rule:riba.interest-rate-mention',
      confidence: 0.93,
      reference: 'BNM Shariah Governance Policy — requires legal confirmation',
      status: 'FLAGGED',
    },
  });
}

// Allow `npm run db:seed`.
if (process.argv[1]?.endsWith('seed.ts')) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then(() => { console.log('Seed complete.'); })
    .catch((err: unknown) => { console.error(err); process.exit(1); })
    .finally(() => void prisma.$disconnect());
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && npm run test:integration -- seed
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/seed.ts backend/tests/integration/seed.test.ts backend/package.json backend/package-lock.json && git commit -m "$(cat <<'EOF'
feat(db): seed demo SME loan scenario with synthetic data

Creates one user per role and the slide 8 meeting: a Bahasa Rojak
transcript with NRIC and account number already masked, matching
redaction log rows, and an open RIBA flag that blocks approval until a
SHARIAH reviewer resolves it.

All content is synthetic. A test asserts no unmasked NRIC pattern can
appear in the seeded transcript.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend scaffold that proves the two halves talk

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/next.config.ts`, `frontend/postcss.config.mjs`, `frontend/.gitignore`, `frontend/.env.example`, `frontend/vercel.json`
- Create: `frontend/src/app/layout.tsx`, `frontend/src/app/globals.css`, `frontend/src/app/page.tsx`, `frontend/src/lib/api-client.ts`
- Test: `frontend/tests/unit/api-client.test.ts`

**Interfaces:**
- Consumes: the backend `/health` route from Task 1, shape `{ status: string; provider: string }`.
- Produces: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — prefixes `NEXT_PUBLIC_API_BASE_URL`, sends credentials, throws `ApiError` on non-2xx. `class ApiError extends Error { readonly status: number; readonly detail: string }`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "fintalk-frontend",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^15.1.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "allowJs": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "incremental": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create the remaining config files**

`frontend/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = { reactStrictMode: true };

export default nextConfig;
```

`frontend/postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`frontend/.gitignore`:

```
.env
.env.*
!.env.example
node_modules/
.next/
out/
coverage/
.vercel
*.tsbuildinfo
next-env.d.ts
```

`frontend/.env.example`:

```
# Copy to .env.local and adjust. .env.local is gitignored.
# In Vercel, set this to your Railway backend URL.
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

`frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm ci"
}
```

- [ ] **Step 4: Write the failing test — `frontend/tests/unit/api-client.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../../src/lib/api-client';

const BASE = 'http://localhost:8080';
process.env.NEXT_PUBLIC_API_BASE_URL = BASE;

afterEach(() => { vi.unstubAllGlobals(); });

function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('apiFetch', () => {
  it('prefixes the base URL and sends credentials', async () => {
    const spy = stubFetch(new Response(JSON.stringify({ status: 'ok' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await apiFetch('/health');
    expect(spy).toHaveBeenCalledWith(
      `${BASE}/health`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('returns the parsed body', async () => {
    stubFetch(new Response(JSON.stringify({ status: 'ok', provider: 'fake' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await expect(apiFetch<{ status: string; provider: string }>('/health'))
      .resolves.toEqual({ status: 'ok', provider: 'fake' });
  });

  it('throws ApiError carrying status and problem detail', async () => {
    stubFetch(new Response(JSON.stringify({ detail: 'unresolved Shariah flag' }), {
      status: 409, headers: { 'content-type': 'application/problem+json' },
    }));
    await expect(apiFetch('/approvals')).rejects.toMatchObject({
      name: 'ApiError', status: 409, detail: 'unresolved Shariah flag',
    });
  });

  it('throws ApiError when the body is not JSON', async () => {
    stubFetch(new Response('gateway timeout', { status: 504 }));
    const err = await apiFetch('/health').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(504);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
cd frontend && npm install && npm test
```

Expected: FAIL — cannot resolve `../../src/lib/api-client`.

- [ ] **Step 6: Implement `frontend/src/lib/api-client.ts`**

```ts
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`API error ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_API_BASE_URL is not set');
  return url.replace(/\/$/, '');
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'detail' in body) {
        detail = String((body as { detail: unknown }).detail);
      }
    } catch {
      // Non-JSON error body: keep statusText. Nothing to recover here.
    }
    throw new ApiError(response.status, detail);
  }

  return (await response.json()) as T;
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd frontend && npm test
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Create the app shell**

`frontend/src/app/globals.css`:

```css
@import 'tailwindcss';
```

`frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FinTalk AI',
  description: 'Audited meeting capture for Malaysian financial institutions',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
```

`frontend/src/app/page.tsx`:

```tsx
import { apiFetch } from '@/lib/api-client';

type Health = { status: string; provider: string };

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let health: Health | null = null;
  let error: string | null = null;

  try {
    health = await apiFetch<Health>('/health');
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : 'unknown error';
  }

  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-3xl font-bold">FinTalk AI</h1>
      <p className="mt-2 text-slate-400">Foundation deploy check.</p>

      <dl className="mt-8 space-y-2 rounded-lg border border-slate-800 p-6">
        <div className="flex justify-between">
          <dt className="text-slate-400">Backend</dt>
          <dd className={health ? 'text-emerald-400' : 'text-rose-400'}>
            {health ? 'reachable' : 'unreachable'}
          </dd>
        </div>
        {health && (
          <div className="flex justify-between">
            <dt className="text-slate-400">Transcription provider</dt>
            <dd className="font-mono">{health.provider}</dd>
          </div>
        )}
        {error && <p className="pt-2 font-mono text-sm text-rose-400">{error}</p>}
      </dl>
    </main>
  );
}
```

- [ ] **Step 9: Verify both halves run together**

With the backend running from Task 1:

```bash
cd frontend && cp .env.example .env.local && npm run typecheck && npm run dev
```

Expected: `http://localhost:3000` shows "Backend: reachable" and "Transcription provider: fake".

- [ ] **Step 10: Commit**

```bash
git add frontend/ && git commit -m "$(cat <<'EOF'
feat(frontend): scaffold Next.js app with typed API client

Adds the frontend package with strict TypeScript and Tailwind, plus an
apiFetch wrapper that maps non-2xx responses to a typed ApiError
carrying the RFC 9457 problem detail. The landing page calls the backend
health route so a broken deploy is visible immediately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CI with secret scanning

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:generate`, `npm run db:constraints` from Tasks 1–4.
- Produces: status checks `backend`, `frontend`, `secrets`.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: fintalk_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      # No Gemini key: the suite runs on the fake provider by design.
      NODE_ENV: test
      PORT: '8080'
      CORS_ORIGIN: http://localhost:3000
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/fintalk_test
      TRANSCRIPTION_PROVIDER: fake
      JWT_ACCESS_SECRET: ci-access-secret-that-is-long-enough-32
      JWT_REFRESH_SECRET: ci-refresh-secret-that-is-long-enough-32
      PII_VAULT_KEY: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
      MEETING_RETENTION_DAYS: '90'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm run db:generate
        working-directory: backend
      - run: npx prisma migrate deploy
        working-directory: backend
      - run: npm run db:constraints
        working-directory: backend
      - run: npm run typecheck
        working-directory: backend
      - run: npm run lint
        working-directory: backend
      - run: npm test
        working-directory: backend

  frontend:
    runs-on: ubuntu-latest
    env:
      NEXT_PUBLIC_API_BASE_URL: http://localhost:8080
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run typecheck
        working-directory: frontend
      - run: npm test
        working-directory: frontend
      - run: npm run build
        working-directory: frontend

  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`PII_VAULT_KEY` above is 32 zero bytes — a throwaway CI value, never a real key.

- [ ] **Step 2: Verify gitleaks actually catches a secret**

Write a probe file containing a fake AWS-shaped key:

```bash
printf 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n' > ./leak-probe.txt
```

```bash
gitleaks detect --no-git --source ./leak-probe.txt --verbose
```

Expected: exit code 1, one finding reported. Then remove the probe:

```bash
rm ./leak-probe.txt
```

If gitleaks is not installed locally, skip to Step 3 and confirm on the first push instead.

- [ ] **Step 3: Verify `.env` cannot be committed**

```bash
git check-ignore -v backend/.env frontend/.env.local
```

Expected: both paths reported as ignored. Then confirm nothing sensitive is tracked:

```bash
git ls-files | grep -E '\.env$|\.env\.local$' || echo "clean: no env files tracked"
```

Expected: `clean: no env files tracked`.

- [ ] **Step 4: Commit**

```bash
git add .github/ && git commit -m "$(cat <<'EOF'
ci: add typecheck, lint, test, and gitleaks workflow

Backend job runs against a real Postgres service with migrations and the
raw-SQL constraints applied, so the compliance invariants are verified in
CI rather than only locally. The suite uses TRANSCRIPTION_PROVIDER=fake,
so no Gemini API key is required to run CI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Definition of done for Plan 1

1. `cd backend && npm test` passes: 8 env unit tests, 12 constraint tests, 5 seed tests.
2. `cd frontend && npm test && npm run build` passes.
3. Backend boots, and exits non-zero naming the offending variable when env is invalid.
4. `http://localhost:3000` reports the backend reachable and the provider as `fake`.
5. A term sheet with both an interest rate and a profit rate is rejected by the database.
6. `UPDATE` or `DELETE` on `AuditEntry` raises.
7. An approval whose checker equals its maker is rejected by the database.
8. `git ls-files` lists no `.env` file; `git check-ignore` confirms both are ignored.
9. No Gemini API key was needed at any point in this plan.

## Self-review notes

**Spec coverage:** §3 structure → Tasks 1, 4. §4 env and secrets → Task 1 Steps 4–5, Task 4 Step 3, Task 5. §5.1–5.2 models → Task 2 Step 1. §5.3 rate exclusivity → Task 2 Steps 2, 5. §5.4 flag attribution → Task 2. §5.5 SoD → Task 2. §5.6 audit immutability → Task 2. §9 CI gates → Task 5.

**Deferred to later plans, intentionally:** the `RedactedText` branded type and redaction engine (Plan 2 — nothing in Plan 1 writes a transcript outside the seed). Auth routes and RBAC middleware (Plan 3). The `gen:types` script (Plan 3, once real endpoints exist). The `any` ban and swallowed-error lint rules (Plan 2, where those modules first exist).

**Known gap, flagged not silently reordered:** Task 5 Step 1 runs `npm run lint` before any ESLint config exists. **Plan 2 Task 1 must create `backend/eslint.config.js`**, or that CI step fails on first run. Alternative if Plan 2 slips: drop the `npm run lint` step from `ci.yml` and re-add it with the config.
