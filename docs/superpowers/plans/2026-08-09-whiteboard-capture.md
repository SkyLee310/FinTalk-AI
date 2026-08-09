# Whiteboard Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a photographed whiteboard into a meeting record as a Mermaid diagram plus structured JSON, redacted before storage and logged in the audit chain.

**Architecture:** A whiteboard photo is untrusted text at a trust boundary, exactly like audio. The vision model returns plain `string`, `redact()` mints `RedactedText`, and `storeWhiteboard` accepts nothing else — the same compile-time write barrier the transcript uses. Extraction, redaction, persistence and the audit entry happen in one transaction so a whiteboard can never be stored beside a partial redaction log.

**Tech Stack:** Fastify 5, Prisma 6, Postgres 16, zod, `@google/genai` v2.16.0 (`GEMINI_MODEL_VISION`), Vitest, Next.js 15.

## Global Constraints

- `RedactedText` may be minted **only** in `backend/src/pdpa/redactor.ts`. `tests/unit/pdpa/architecture.test.ts` fails the build otherwise.
- Providers return plain `string`, never `RedactedText`.
- Raw images, like raw audio, are **never written to disk** — spec §2. Hold bytes in memory for the request only. A temp file is storage.
- Audit entries are appended with `appendAuditWithin(tx, …)` inside the transaction that writes the data they describe.
- Compliance invariants live in the database: raw SQL in `backend/prisma/sql/constraints.sql`, applied by `npm run db:constraints`.
- Audit payloads carry counts, provenance and rule ids — **never** extracted text, and never operator-typed free text.
- The AI never issues a Shariah ruling. Whiteboard capture raises no Shariah findings in this plan.
- Money stays `BigInt` minor units. This plan touches no money.
- No local Postgres exists. Migrations are hand-written SQL applied by `npx prisma migrate deploy`; CI's Postgres 16 service is the verification environment.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/schema.prisma` | `Redaction` gains a nullable `transcriptId` + `whiteboardId`; `Whiteboard` gains `rawRedacted` and a `redactions` back-relation. |
| `backend/prisma/migrations/20260809000000_whiteboard_redactions/migration.sql` | Hand-written DDL for the above. |
| `backend/prisma/sql/constraints.sql` | Adds the `redaction_single_parent` CHECK. |
| `backend/src/ai/provider.ts` | Adds `ImageInput`, `WhiteboardExtraction`, optional `extractWhiteboard?()`. |
| `backend/src/ai/gemini.provider.ts` | Implements `extractWhiteboard` with `visionModel`. |
| `backend/src/ai/fake.provider.ts` | Deterministic extraction fixture containing a synthetic NRIC. |
| `backend/src/pdpa/whiteboard-store.ts` | The only write path for a whiteboard. Mirrors `transcript-store.ts`. |
| `backend/src/routes/whiteboards.routes.ts` | `POST /meetings/:id/whiteboards`, `GET /meetings/:id/whiteboards`. |
| `frontend/src/app/(app)/meetings/[id]/page.tsx` | Renders the Mermaid source and structured fields. |

**Deviation from the approved sketch, and why:** `Whiteboard` also gains `rawRedacted`. Redaction offsets must index into exactly one canonical text, and the model has two text fields (`mermaid`, `structuredJson`) with no single offset space. `Transcript.rawRedacted` already solves this; copying the pattern removes the ambiguity rather than inventing a second convention.

---

### Task 1: Schema, migration and the single-parent CHECK

**Files:**
- Modify: `backend/prisma/schema.prisma` (`model Redaction` at :139, `model Whiteboard` at :168)
- Create: `backend/prisma/migrations/20260809000000_whiteboard_redactions/migration.sql`
- Modify: `backend/prisma/sql/constraints.sql`
- Test: `backend/tests/integration/whiteboard-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Redaction.whiteboardId: string | null`, `Redaction.transcriptId: string | null`, `Whiteboard.rawRedacted: string`, `Whiteboard.redactions: Redaction[]`, and the DB constraint named `redaction_single_parent`.

- [ ] **Step 1: Write the failing test**

`backend/tests/integration/whiteboard-schema.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, resetDb, seedMeeting, seedUser } from '../helpers/db.js';

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

async function freshWhiteboard() {
  const user = await seedUser('MAKER');
  const meeting = await seedMeeting(user.id);
  return prisma.whiteboard.create({
    data: {
      meetingId: meeting.id,
      rawRedacted: 'Director [NRIC_1] approves',
      mermaid: 'graph TD;A-->B;',
      structuredJson: { nodes: ['A', 'B'] },
      modelId: 'test-fixture',
      promptVersion: 'v1',
    },
  });
}

describe('Redaction parentage', () => {
  it('accepts a redaction owned by a whiteboard', async () => {
    const whiteboard = await freshWhiteboard();

    const row = await prisma.redaction.create({
      data: {
        whiteboardId: whiteboard.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 9,
        endOffset: 17,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    });

    expect(row.transcriptId).toBeNull();
    expect(row.whiteboardId).toBe(whiteboard.id);
  });

  /**
   * A redaction with no parent is an orphaned claim that some personal data was
   * accounted for, with nothing to reconcile it against.
   */
  it('refuses a redaction with no parent', async () => {
    await expect(prisma.redaction.create({
      data: {
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 0,
        endOffset: 8,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    })).rejects.toThrow(/redaction_single_parent/);
  });

  it('refuses a redaction claiming both parents', async () => {
    const whiteboard = await freshWhiteboard();
    const transcript = await prisma.transcript.create({
      data: {
        meetingId: whiteboard.meetingId,
        rawRedacted: 'x',
        summaryEn: 'x',
        languages: ['en'],
        modelId: 'test-fixture',
        promptVersion: 'v1',
      },
    });

    await expect(prisma.redaction.create({
      data: {
        transcriptId: transcript.id,
        whiteboardId: whiteboard.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 0,
        endOffset: 8,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    })).rejects.toThrow(/redaction_single_parent/);
  });

  it('cascades to redactions when the whiteboard is deleted', async () => {
    const whiteboard = await freshWhiteboard();
    await prisma.redaction.create({
      data: {
        whiteboardId: whiteboard.id,
        piiType: 'NRIC',
        placeholder: '[NRIC_1]',
        startOffset: 9,
        endOffset: 17,
        detectedBy: 'regex:nric',
        confidence: 0.99,
      },
    });

    await prisma.whiteboard.delete({ where: { id: whiteboard.id } });
    expect(await prisma.redaction.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && npx vitest run tests/integration/whiteboard-schema.test.ts
```

Expected: fails — `Unknown argument 'whiteboardId'`, because the column does not exist yet.

- [ ] **Step 3: Edit the schema**

In `backend/prisma/schema.prisma`, replace `model Redaction` with:

```prisma
/// Exactly one of transcriptId or whiteboardId is set — see
/// prisma/sql/constraints.sql, constraint redaction_single_parent.
model Redaction {
  id           String  @id @default(cuid())
  transcriptId String?
  whiteboardId String?
  piiType      PiiType
  placeholder  String
  startOffset  Int
  endOffset    Int
  detectedBy   String
  confidence   Float
  vaultId      String? @unique

  transcript Transcript? @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
  whiteboard Whiteboard? @relation(fields: [whiteboardId], references: [id], onDelete: Cascade)
  vault      PiiVault?   @relation(fields: [vaultId], references: [id])

  @@index([transcriptId])
  @@index([whiteboardId])
}
```

And in `model Whiteboard`, add `rawRedacted` and the back-relation:

```prisma
model Whiteboard {
  id             String   @id @default(cuid())
  meetingId      String
  /// The canonical redacted text. Redaction offsets index into this field, the
  /// same contract Transcript.rawRedacted carries.
  rawRedacted    String
  mermaid        String
  structuredJson Json
  modelId        String
  promptVersion  String
  createdAt      DateTime @default(now())

  meeting    Meeting     @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  redactions Redaction[]

  @@index([meetingId])
}
```

- [ ] **Step 4: Hand-write the migration**

There is no local Postgres, so the migration is written by hand and applied by `migrate deploy`, which checksums the file as-is.

Create `backend/prisma/migrations/20260809000000_whiteboard_redactions/migration.sql`:

```sql
-- A redaction may now belong to a whiteboard instead of a transcript.
ALTER TABLE "Redaction" ALTER COLUMN "transcriptId" DROP NOT NULL;
ALTER TABLE "Redaction" ADD COLUMN "whiteboardId" TEXT;

-- Existing rows all belong to transcripts, so the new column stays NULL and the
-- single-parent CHECK holds for them without a backfill.

ALTER TABLE "Whiteboard" ADD COLUMN "rawRedacted" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Whiteboard" ALTER COLUMN "rawRedacted" DROP DEFAULT;

ALTER TABLE "Redaction" DROP CONSTRAINT "Redaction_transcriptId_fkey";
ALTER TABLE "Redaction"
  ADD CONSTRAINT "Redaction_transcriptId_fkey"
  FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Redaction"
  ADD CONSTRAINT "Redaction_whiteboardId_fkey"
  FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Redaction_whiteboardId_idx" ON "Redaction"("whiteboardId");
```

The `DEFAULT ''` then `DROP DEFAULT` pair is deliberate: `Whiteboard` may already hold rows on a deployed database, and `ADD COLUMN … NOT NULL` without a default would fail on them.

- [ ] **Step 5: Add the CHECK to constraints.sql**

Append to `backend/prisma/sql/constraints.sql`, following the drop-then-add idiom already used in that file so it stays idempotent:

```sql
-- A redaction accounts for personal data found in exactly one document. Both
-- parents set would double-count it; neither would leave the claim orphaned,
-- with nothing to reconcile against.
ALTER TABLE "Redaction" DROP CONSTRAINT IF EXISTS redaction_single_parent;
ALTER TABLE "Redaction" ADD CONSTRAINT redaction_single_parent
  CHECK (("transcriptId" IS NOT NULL) <> ("whiteboardId" IS NOT NULL));
```

`<>` on two booleans is exclusive or, which is exactly "one and only one".

- [ ] **Step 6: Regenerate the client and run the test**

```bash
cd backend && npm run db:generate && npx vitest run tests/integration/whiteboard-schema.test.ts
```

Expected: 4 passed. The constraint only exists after `npm run db:constraints` has run against the database; CI runs it at step 8 of the backend job, before `npm test`.

- [ ] **Step 7: Confirm nothing else regressed**

```bash
cd backend && npm run typecheck && npm run lint && npm run test:unit
```

Expected: typecheck and lint clean, 169 unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma docs && git commit -m "feat(db): let a redaction belong to a whiteboard, with a single-parent CHECK"
```

---

### Task 2: `extractWhiteboard` on the provider seam

**Files:**
- Modify: `backend/src/ai/provider.ts`
- Modify: `backend/src/ai/gemini.provider.ts` (`GeminiConfig` at :61, class at :78)
- Modify: `backend/src/ai/factory.ts:23-43`
- Modify: `backend/src/ai/fake.provider.ts`
- Test: `backend/tests/unit/ai/fake.provider.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `interface ImageInput { readonly bytes: Uint8Array; readonly mimeType: string }`
  - `interface WhiteboardExtraction { readonly mermaid: string; readonly structured: Record<string, unknown>; readonly modelId: string; readonly promptVersion: string }`
  - `TranscriptionProvider.extractWhiteboard?(image: ImageInput): Promise<WhiteboardExtraction>`
  - `GeminiConfig.visionModel: string`
  - `FakeTranscriptionProvider.extractWhiteboard` returning a fixture whose text contains `880101-14-5678`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/ai/fake.provider.test.ts`:

```ts
describe('FakeTranscriptionProvider.extractWhiteboard', () => {
  it('returns mermaid and structured fields', async () => {
    const provider = new FakeTranscriptionProvider();
    const result = await provider.extractWhiteboard!({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    });

    expect(result.mermaid).toContain('graph');
    expect(result.modelId).toBe('fake-vision');
    expect(Object.keys(result.structured).length).toBeGreaterThan(0);
  });

  /**
   * The fixture must carry an identifier, or every downstream redaction test
   * would pass by having nothing to redact.
   */
  it('carries a synthetic identifier so redaction has something to find', async () => {
    const provider = new FakeTranscriptionProvider();
    const result = await provider.extractWhiteboard!({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
    });

    const all = `${result.mermaid}\n${JSON.stringify(result.structured)}`;
    expect(all).toMatch(/\d{6}-\d{2}-\d{4}/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && npx vitest run tests/unit/ai/fake.provider.test.ts
```

Expected: fails — `extractWhiteboard` is not a function.

- [ ] **Step 3: Extend the seam**

In `backend/src/ai/provider.ts`, add below `AudioInput`:

```ts
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
```

And add to `interface TranscriptionProvider`:

```ts
  /**
   * Optional whiteboard extraction. A provider without a vision model omits it,
   * and the route answers 501 rather than pretending.
   */
  extractWhiteboard?(image: ImageInput): Promise<WhiteboardExtraction>;
```

- [ ] **Step 4: Implement the fake**

In `backend/src/ai/fake.provider.ts`, add `type WhiteboardExtraction` to the existing import from `./provider.js`, then add to the class:

```ts
  /**
   * Deterministic fixture. The NRIC is synthetic and deliberately present: a
   * redaction test whose input holds no identifier passes vacuously.
   */
  extractWhiteboard(): Promise<WhiteboardExtraction> {
    return Promise.resolve({
      mermaid:
        'graph TD;\n'
        + '  A[Applicant 880101-14-5678] --> B[Murabahah 500k];\n'
        + '  B --> C[Tenure 60 months];',
      structured: {
        facility: 'Murabahah',
        principalMyr: 500_000,
        tenureMonths: 60,
        applicantNric: '880101-14-5678',
      },
      modelId: 'fake-vision',
      promptVersion: 'fake-whiteboard-v1',
    });
  }
```

- [ ] **Step 5: Implement Gemini's version**

In `backend/src/ai/gemini.provider.ts`, add `visionModel` to `GeminiConfig`:

```ts
export interface GeminiConfig {
  readonly apiKey: string;
  readonly transcribeModel: string;
  readonly textModel: string;
  readonly visionModel: string;
}
```

Add the prompt and response schema beside the existing ones:

```ts
const WHITEBOARD_PROMPT =
  'This is a photograph of a whiteboard from a credit meeting. Return JSON with '
  + 'two keys. "mermaid": a Mermaid flowchart of the diagram, using graph TD '
  + 'syntax, transcribing every label verbatim including any numbers. '
  + '"structured": an object of the facts written on the board, one key per '
  + 'labelled value. Transcribe what is written. Do not infer, complete or '
  + 'correct anything, and do not add keys that are not on the board.';

const WhiteboardSchema = z.object({
  mermaid: z.string().min(1),
  structured: z.record(z.string(), z.unknown()),
});
```

Add `type ImageInput` and `type WhiteboardExtraction` to the import from `./provider.js`, then add the method:

```ts
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
        // temperature 0 for the same reason transcription uses it: two runs of
        // one photograph should not give an auditor two different diagrams.
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      raw = response.text ?? '';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'unknown failure';
      throw new TranscriptionError('gemini', `whiteboard extraction failed: ${message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TranscriptionError('gemini', 'whiteboard response was not JSON');
    }

    const result = WhiteboardSchema.safeParse(parsed);
    if (!result.success) {
      // The zod message is not included: a schema error quotes the offending
      // value, and that value is whiteboard content.
      throw new TranscriptionError('gemini', 'whiteboard response did not match the schema');
    }

    return {
      mermaid: result.data.mermaid,
      structured: result.data.structured,
      modelId: this.config.visionModel,
      promptVersion: 'gemini-whiteboard-v1',
    };
  }
```

- [ ] **Step 6: Wire the factory**

`backend/src/ai/factory.ts` — extend the `gemini` branch to require the vision model, matching how the other two are handled:

```ts
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
      return new GeminiTranscriptionProvider({
        apiKey: GEMINI_API_KEY,
        transcribeModel: GEMINI_MODEL_TRANSCRIBE,
        textModel: GEMINI_MODEL_TEXT,
        visionModel: GEMINI_MODEL_VISION,
      });
    }
```

`GEMINI_MODEL_VISION` is already declared at `backend/src/config/env.ts:12` and already set in Railway, so no environment change is needed. Check whether it is already in the required-when-gemini list around `env.ts:40`; if it is not, add it there so startup fails fast rather than on the first upload.

- [ ] **Step 7: Run the tests**

```bash
cd backend && npx vitest run tests/unit/ai && npm run typecheck && npm run lint
```

Expected: all pass, clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/tests && git commit -m "feat(ai): add whiteboard extraction to the provider seam"
```

---

### Task 3: The write path and the upload route

**Files:**
- Create: `backend/src/pdpa/whiteboard-store.ts`
- Create: `backend/src/routes/whiteboards.routes.ts`
- Modify: `backend/src/server.ts` (register beside `registerMeetingRoutes`)
- Test: `backend/tests/integration/whiteboards.routes.test.ts`

**Interfaces:**
- Consumes: `Redaction.whiteboardId` and `Whiteboard.rawRedacted` from Task 1; `ImageInput`, `WhiteboardExtraction`, `extractWhiteboard?` from Task 2; `redact()`, `joinRedacted()`, `createRedactionContext()`, `RedactionRecord` from `../pdpa/redactor.js`; `sealedToRow` from `../pdpa/vault.js`; `appendAuditWithin` and `AuditActor` from `../audit/chain.js`.
- Produces:
  - `storeWhiteboard(prisma: PrismaClient, input: StoreWhiteboardInput): Promise<string>`
  - `interface StoreWhiteboardInput { meetingId: string; rawRedacted: RedactedText; mermaid: RedactedText; structuredJson: unknown; modelId: string; promptVersion: string; redactions: readonly RedactionRecord[]; actor: AuditActor }`
  - `registerWhiteboardRoutes(app: FastifyInstance, deps: WhiteboardRouteDeps): void`
  - Audit action `whiteboard.captured`.

**The redaction contract for two text fields.** The extraction has a Mermaid string and a JSON object. Both are redacted under **one shared `RedactionContext`**, so one identifier appearing in both gets one placeholder. `rawRedacted` is the canonical document — `joinRedacted([mermaidRedacted, jsonRedacted], '\n')` — and the JSON half's offsets are rebased onto it, exactly as `redactTranscript` rebases segment offsets in `process-meeting.ts`. This is why Task 1 added the column.

- [ ] **Step 1: Write the failing test**

`backend/tests/integration/whiteboards.routes.test.ts`:

```ts
import type { Role } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeTranscriptionProvider } from '../../src/ai/fake.provider.js';
import { ACCESS_COOKIE } from '../../src/auth/middleware.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildServer } from '../../src/server.js';
import { prisma, resetDb } from '../helpers/db.js';

const PASSWORD = 'Demo!2345';
const app = buildServer({ prisma, provider: new FakeTranscriptionProvider() });

beforeEach(async () => {
  await app.backgroundJobs.drain();
  await resetDb();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function sessionFor(role: Role): Promise<string> {
  const email = `${role.toLowerCase()}@fintalk.test`;
  await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Demo ${role}`,
      role,
    },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: PASSWORD },
  });

  const cookies = (login as unknown as { cookies: { name: string; value: string }[] }).cookies;
  return `${ACCESS_COOKIE}=${cookies.find((c) => c.name === ACCESS_COOKIE)!.value}`;
}

/** Builds a multipart body without pulling in a form-data dependency. */
function multipart(file: { filename: string; contentType: string; body: Buffer }) {
  const boundary = '----FinTalkWhiteboardBoundary';
  const chunks = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; `
      + `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const IMAGE = {
  filename: 'board.png',
  contentType: 'image/png',
  body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
};

/** A meeting owned by the seeded MAKER, which sessionFor has already created. */
async function meetingForMaker(): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { role: 'MAKER' } });
  const meeting = await prisma.meeting.create({
    data: {
      title: 'Whiteboard meeting',
      occurredAt: new Date('2026-08-09T02:00:00Z'),
      consentConfirmed: true,
      createdById: user.id,
    },
  });
  return meeting.id;
}

function upload(cookie: string, meetingId: string) {
  const { payload, headers } = multipart(IMAGE);
  return app.inject({
    method: 'POST',
    url: `/meetings/${meetingId}/whiteboards`,
    headers: { ...headers, cookie },
    payload,
  });
}

describe('POST /meetings/:id/whiteboards — access control', () => {
  it('refuses an unauthenticated upload', async () => {
    await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    const { payload, headers } = multipart(IMAGE);

    const response = await app.inject({
      method: 'POST',
      url: `/meetings/${meetingId}/whiteboards`,
      headers,
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(await prisma.whiteboard.count()).toBe(0);
  });

  it('refuses a viewer, who cannot create', async () => {
    await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await upload(await sessionFor('VIEWER'), meetingId);
    expect(response.statusCode).toBe(403);
    expect(await prisma.whiteboard.count()).toBe(0);
  });
});

describe('POST /meetings/:id/whiteboards — the capture round trip', () => {
  /**
   * The anti-vacuity case. The fixture writes an NRIC on the board, so a pass
   * here means redaction actually ran rather than finding nothing to do.
   */
  it('stores the board with the identifier replaced, sealed and logged', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await upload(cookie, meetingId);
    expect(response.statusCode).toBe(201);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: { include: { vault: true } } },
    });

    expect(board.rawRedacted).toContain('[NRIC_1]');
    expect(board.rawRedacted).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(board.mermaid).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(JSON.stringify(board.structuredJson)).not.toMatch(/\d{6}-\d{2}-\d{4}/);

    expect(board.redactions.length).toBeGreaterThan(0);
    for (const redaction of board.redactions) {
      expect(redaction.transcriptId).toBeNull();
      expect(redaction.vault).not.toBeNull();
    }
  });

  it('points every offset at the placeholder inside rawRedacted', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: true },
    });

    for (const redaction of board.redactions) {
      const slice = board.rawRedacted.slice(redaction.startOffset, redaction.endOffset);
      expect(slice).toBe(redaction.placeholder);
    }
  });

  it('gives one placeholder to an identifier written in both fields', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const board = await prisma.whiteboard.findFirstOrThrow({
      include: { redactions: true },
    });

    // The fixture puts the same NRIC in the diagram and in structured.
    const placeholders = new Set(board.redactions.map((r) => r.placeholder));
    expect(placeholders.has('[NRIC_1]')).toBe(true);
    expect(placeholders.has('[NRIC_2]')).toBe(false);
  });

  it('audits the capture without the board text', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const entry = await prisma.auditEntry.findFirstOrThrow({
      where: { action: 'whiteboard.captured' },
    });

    expect(entry.actorRole).toBe('MAKER');
    const payload = JSON.stringify(entry.payload);
    expect(payload).not.toMatch(/\d{6}-\d{2}-\d{4}/);
    expect(payload).not.toContain('graph TD');
    expect(payload).not.toContain('[NRIC_1]');
  });

  it('answers 404 for an unknown meeting', async () => {
    const cookie = await sessionFor('MAKER');
    const response = await upload(cookie, 'does-not-exist');
    expect(response.statusCode).toBe(404);
    expect(await prisma.whiteboard.count()).toBe(0);
  });

  it('rejects a request carrying no image', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();

    const response = await app.inject({
      method: 'POST',
      url: `/meetings/${meetingId}/whiteboards`,
      headers: { 'content-type': 'multipart/form-data; boundary=----Empty', cookie },
      payload: Buffer.from('------Empty--\r\n'),
    });

    expect(response.statusCode).toBe(400);
    expect(await prisma.whiteboard.count()).toBe(0);
  });
});

describe('GET /meetings/:id/whiteboards', () => {
  it('serves the boards back with no vault ciphertext', async () => {
    const cookie = await sessionFor('MAKER');
    const meetingId = await meetingForMaker();
    await upload(cookie, meetingId);

    const response = await app.inject({
      method: 'GET',
      url: `/meetings/${meetingId}/whiteboards`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('[NRIC_1]');
    expect(response.body).not.toContain('ciphertext');
    expect(response.body).not.toContain('authTag');
    expect(response.body).not.toContain('vaultId');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend && npx vitest run tests/integration/whiteboards.routes.test.ts
```

Expected: fails with 404 on every upload — the route does not exist.

- [ ] **Step 3: Write the store**

Create `backend/src/pdpa/whiteboard-store.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { appendAuditWithin, type AuditActor } from '../audit/chain.js';
import type { RedactedText } from './redacted-text.js';
import type { RedactionRecord } from './redactor.js';
import { sealedToRow } from './vault.js';

export interface StoreWhiteboardInput {
  readonly meetingId: string;
  /** The canonical document. Every record's offsets index into this. */
  readonly rawRedacted: RedactedText;
  readonly mermaid: RedactedText;
  /** Already-redacted structured fields, safe to persist as JSON. */
  readonly structuredJson: unknown;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly redactions: readonly RedactionRecord[];
  readonly actor: AuditActor;
}

/**
 * The only write path for a whiteboard.
 *
 * Every text field is typed RedactedText, so a caller holding raw vision output
 * cannot reach this function — the compiler refuses the call. Board, vault rows,
 * redaction log and the audit entry go in one transaction: a board stored beside
 * a partial redaction log would assert that its personal data had been accounted
 * for when some of it had not, which is worse than storing nothing.
 */
export async function storeWhiteboard(
  prisma: PrismaClient,
  input: StoreWhiteboardInput,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const board = await tx.whiteboard.create({
      data: {
        meetingId: input.meetingId,
        rawRedacted: input.rawRedacted,
        mermaid: input.mermaid,
        structuredJson: input.structuredJson as never,
        modelId: input.modelId,
        promptVersion: input.promptVersion,
      },
    });

    for (const record of input.redactions) {
      const vault = await tx.piiVault.create({ data: sealedToRow(record.sealed) });

      await tx.redaction.create({
        data: {
          whiteboardId: board.id,
          piiType: record.piiType,
          placeholder: record.placeholder,
          startOffset: record.startOffset,
          endOffset: record.endOffset,
          detectedBy: record.detectedBy,
          confidence: record.confidence,
          vaultId: vault.id,
        },
      });
    }

    // Appended last so the advisory lock is held for the commit rather than for
    // the vault loop above. Counts and provenance only — never board text.
    await appendAuditWithin(tx, {
      at: new Date(),
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'whiteboard.captured',
      entityType: 'Whiteboard',
      entityId: board.id,
      payload: {
        meetingId: input.meetingId,
        redactionCount: input.redactions.length,
        redactionTypes: [...new Set(input.redactions.map((r) => r.piiType))].sort(),
        modelId: input.modelId,
        promptVersion: input.promptVersion,
      },
    });

    return board.id;
  });
}
```

- [ ] **Step 4: Write the route**

Create `backend/src/routes/whiteboards.routes.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { ImageInput, TranscriptionProvider } from '../ai/provider.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';
import {
  createRedactionContext,
  joinRedacted,
  redact,
  type RedactionRecord,
} from '../pdpa/redactor.js';
import { storeWhiteboard } from '../pdpa/whiteboard-store.js';

/**
 * Whiteboard capture.
 *
 * The image is held in memory for the request and never written to disk, for the
 * same reason audio is not: spec §2, and a temp file survives a crash.
 *
 * Unlike audio this runs inside the request. Vision extraction on one still
 * image takes seconds, not the minutes transcription takes, so it stays well
 * inside the platform's 300-second ceiling and the caller gets the result
 * directly instead of a poll URL.
 */

export interface WhiteboardRouteDeps {
  readonly prisma: PrismaClient;
  readonly provider: TranscriptionProvider;
  readonly vaultKey: Buffer;
}

const SEPARATOR = '\n';

export function registerWhiteboardRoutes(
  app: FastifyInstance,
  deps: WhiteboardRouteDeps,
): void {
  const { prisma, provider, vaultKey } = deps;

  app.post<{ Params: { id: string } }>(
    '/meetings/:id/whiteboards',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const extract = provider.extractWhiteboard?.bind(provider);
      if (extract === undefined) {
        return sendProblem(
          reply,
          501,
          'Not supported',
          'The configured transcription provider has no vision model.',
        );
      }

      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }

      let image: ImageInput | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'image') {
              // Drain unexpected files rather than leaving the stream stalled.
              part.file.resume();
              continue;
            }
            image = { bytes: await part.toBuffer(), mimeType: part.mimetype };
          }
        }
      } catch {
        return sendProblem(
          reply,
          413,
          'Upload rejected',
          'The upload was malformed or exceeded the size limit.',
        );
      }

      if (image === undefined || image.bytes.byteLength === 0) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'An image file is required in the "image" field.',
        );
      }

      const extraction = await extract(image);

      /**
       * One context across both fields, so an identifier written once on the
       * board gets one placeholder whether it surfaces in the diagram, the
       * structured fields, or both.
       */
      const context = createRedactionContext();
      const mermaid = redact(extraction.mermaid, vaultKey, context);
      const structured = redact(JSON.stringify(extraction.structured), vaultKey, context);

      /**
       * The JSON half's offsets are rebased onto the joined document, because
       * that is what rawRedacted holds and what an auditor resolves against —
       * the same rebasing redactTranscript does across segments.
       */
      const base = mermaid.text.length + SEPARATOR.length;
      const records: RedactionRecord[] = [
        ...mermaid.records,
        ...structured.records.map((record) => ({
          ...record,
          startOffset: record.startOffset + base,
          endOffset: record.endOffset + base,
        })),
      ];

      const whiteboardId = await storeWhiteboard(prisma, {
        meetingId: meeting.id,
        rawRedacted: joinRedacted([mermaid.text, structured.text], SEPARATOR),
        mermaid: mermaid.text,
        structuredJson: JSON.parse(structured.text),
        modelId: extraction.modelId,
        promptVersion: extraction.promptVersion,
        redactions: records,
        actor,
      });

      return reply.code(201).send({ whiteboardId, redactionCount: records.length });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/meetings/:id/whiteboards',
    { preHandler: [requireAuth, requireCapability('transcript:read')] },
    async (request, reply) => {
      const boards = await prisma.whiteboard.findMany({
        where: { meetingId: request.params.id },
        orderBy: { createdAt: 'asc' },
        include: {
          // The vault relation is deliberately excluded. Recovering a stored
          // identifier is a separate, separately-audited action.
          redactions: {
            select: {
              id: true,
              piiType: true,
              placeholder: true,
              startOffset: true,
              endOffset: true,
              detectedBy: true,
              confidence: true,
            },
          },
        },
      });

      return reply.send({
        whiteboards: boards.map((board) => ({
          id: board.id,
          rawRedacted: board.rawRedacted,
          mermaid: board.mermaid,
          structuredJson: board.structuredJson,
          modelId: board.modelId,
          promptVersion: board.promptVersion,
          createdAt: board.createdAt.toISOString(),
          redactions: board.redactions,
        })),
      });
    },
  );
}
```

Two details that are load-bearing. `provider.extractWhiteboard?.bind(provider)` is captured once: calling `provider.extractWhiteboard(...)` after a separate `undefined` check does not narrow under `exactOptionalPropertyTypes`, and an unbound reference would lose `this`. And `JSON.parse(structured.text)` is safe because placeholders replace digits inside JSON string values, so the document stays valid JSON — the round trip is what guarantees `structuredJson` holds only redacted values.

- [ ] **Step 5: Register the routes**

In `backend/src/server.ts`, add the import and register beside the existing routes:

```ts
import { registerWhiteboardRoutes } from './routes/whiteboards.routes.js';
```

```ts
  registerMeetingRoutes(app, { prisma, provider, vaultKey, jobs });
  registerWhiteboardRoutes(app, { prisma, provider, vaultKey });
```

The multipart plugin's `limits.files` is already `1`, which suits one image per request; leave it.

- [ ] **Step 6: Run the tests**

```bash
cd backend && npx vitest run tests/integration/whiteboards.routes.test.ts && npm run typecheck && npm run lint
```

Expected: 9 passed, clean.

- [ ] **Step 7: Confirm the write barrier still holds**

```bash
cd backend && npx vitest run tests/unit/pdpa/architecture.test.ts
```

Expected: passes. `whiteboard-store.ts` must not mint `RedactedText`; it only accepts it.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/tests && git commit -m "feat: capture a whiteboard, redacted before storage and audited"
```

---

### Task 4: Show the board on the meeting page

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/app/(app)/meetings/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /meetings/:id/whiteboards` from Task 3.
- Produces: `api.whiteboards(meetingId)`, `interface WhiteboardRow`.

- [ ] **Step 1: Add the typed client**

In `frontend/src/lib/api.ts`, beside `RedactionRow`:

```ts
export interface WhiteboardRow {
  id: string;
  rawRedacted: string;
  mermaid: string;
  structuredJson: unknown;
  modelId: string;
  promptVersion: string;
  createdAt: string;
  redactions: RedactionRow[];
}
```

And in the `api` object:

```ts
  whiteboards: (meetingId: string) =>
    apiFetch<{ whiteboards: WhiteboardRow[] }>(`/meetings/${meetingId}/whiteboards`),
```

- [ ] **Step 2: Render it**

In `frontend/src/app/(app)/meetings/[id]/page.tsx`, load alongside the existing calls:

```tsx
const whiteboards = useAsync(() => api.whiteboards(meetingId), `whiteboards:${meetingId}`);
```

Add a section after the transcript:

```tsx
<section className="space-y-3">
  <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
    Whiteboards
  </h2>

  {whiteboards.loading && <Spinner label="Loading whiteboards" />}
  {whiteboards.error !== null && <ErrorNote>{whiteboards.error}</ErrorNote>}

  {whiteboards.data?.whiteboards.length === 0 && (
    <EmptyState
      title="No whiteboard captured"
      body="Upload a photograph of the board to have its diagram extracted and redacted."
    />
  )}

  {whiteboards.data?.whiteboards.map((board) => (
    <Card key={board.id}>
      <CardHeader
        title="Extracted diagram"
        description={`Model ${board.modelId} · prompt ${board.promptVersion}`}
      />
      <div className="space-y-4 px-5 py-4">
        {/*
          The Mermaid source is shown rather than rendered. Rendering needs a
          client-side diagram library, and the source is already the auditable
          artefact — it is exactly what was stored.
        */}
        <pre className="overflow-x-auto rounded-lg border border-line bg-raised p-4 text-xs leading-relaxed">
          <code>{board.mermaid}</code>
        </pre>

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {Object.entries(board.structuredJson as Record<string, unknown>).map(
            ([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-faint">{key}</dt>
                <dd className="font-medium">{String(value)}</dd>
              </div>
            ),
          )}
        </dl>

        {board.redactions.length > 0 && (
          <p className="text-xs text-faint">
            {board.redactions.length} identifier
            {board.redactions.length === 1 ? '' : 's'} masked before storage.
          </p>
        )}
      </div>
    </Card>
  ))}
</section>
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run typecheck && npm run lint && npm run build
```

Expected: clean, 8 static pages generated.

- [ ] **Step 4: Commit**

```bash
git add frontend/src && git commit -m "feat(ui): show the extracted whiteboard on the meeting page"
```

---

### Task 5: Close the loop and correct the copy

**Files:**
- Modify: `README.md` (the "not built yet" line)
- Modify: `docs/superpowers/specs/2026-08-08-fintalk-ai-design.md` (§5.6 audited actions, line 308)

- [ ] **Step 1: Run the whole backend suite**

```bash
cd backend && npm run typecheck && npm run lint && npm test
```

Expected: every unit and integration suite passes. If `redaction_single_parent` is missing, run `npm run db:constraints` first — CI does this at step 8 of the backend job.

- [ ] **Step 2: Push and confirm CI is green**

```bash
git push origin main
```

Then check all three jobs:

```bash
curl -s "https://api.github.com/repos/SkyLee310/FinTalk-AI/actions/runs?per_page=1"
```

Expected: `"status": "completed"` with `"conclusion": "success"`. If the backend job fails and the log is not readable without a token, the job's annotations carry the assertion text: `/repos/SkyLee310/FinTalk-AI/check-runs/<job_id>/annotations`.

- [ ] **Step 3: Correct the honest-limits copy**

`README.md` and `frontend/src/app/page.tsx` both currently claim whiteboard capture is not built. Replace that claim with what is now true and what is still missing: the diagram is extracted, redacted, stored and displayed as Mermaid source, but it is not rendered as a diagram, and there is no upload control in the UI — capture is API-only.

In the spec, add `whiteboard.captured` to the audited-actions list at §5.6 line 308, which currently names nine actions and omits it.

- [ ] **Step 4: Commit**

```bash
git add README.md frontend/src docs && git commit -m "docs: whiteboard capture is built; record what is still missing"
```

---

## Self-Review

**1. Spec coverage.** §2 raw-media-never-stored: Task 3 holds the image in memory only. §5.6 audit chain: Task 3 appends `whiteboard.captured` inside the write transaction; Task 5 adds it to the spec's list. Whiteboard extraction to Mermaid plus structured JSON, from the slide-11 capture strip: Tasks 2–4. PDPA redaction before persistence: Tasks 1 and 3, with the CHECK making an unaccounted-for redaction impossible to store. **Gap accepted deliberately:** no Shariah analysis of board text. The engine reads transcripts, and a board saying "interest 8%" arguably should flag — but extending the engine changes what blocks an approval, which is a decision to take openly rather than fold into this plan.

**2. Placeholder scan.** No TBDs; every code step carries its code. One judgement call is left explicit rather than hidden: whether `GEMINI_MODEL_VISION` already appears in the required-when-gemini list near `env.ts:40`, written as a check with an action either way.

**3. Type consistency.** `WhiteboardExtraction.structured` is `Record<string, unknown>` in Task 2 and consumed by `JSON.stringify` in Task 3. `StoreWhiteboardInput.structuredJson` is `unknown` because it holds the reparsed redacted value, and is cast `as never` at the Prisma `Json` boundary exactly as `transcript-store.ts` does for `Bytes`. `rawRedacted` and `mermaid` are `RedactedText` in the store and plain `string` over HTTP in Task 4. `AuditActor` matches `request.authUser`'s `{ id, role }`, which is why the route forwards it unchanged.

**4. Known risk, stated because it cannot be verified locally.** The migration drops `NOT NULL` from `transcriptId` and adds the CHECK against a database that already holds transcript redactions. Those rows have a non-null `transcriptId` and a null `whiteboardId`, so the exclusive-or holds and no backfill is needed. This is reasoned, not executed — there is no local Postgres, so CI is the first place it runs. If it fails there, the cause will be in the `db:constraints` step, not in `migrate deploy`.
