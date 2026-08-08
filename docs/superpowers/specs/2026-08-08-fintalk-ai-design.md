# FinTalk AI — Design Specification

**Date:** 2026-08-08
**Source:** `Track 3 -Team Made In XHS Pitch Deck (1).pdf` (12 slides)
**Team:** Made in XHS — Tracia Ong Yen Wen (Technical Lead), Lee Ming Xuan (AI Engineer), Jacqueline Lim (Product Manager), Liew Hui Xuan (UI/UX Designer)
**Repo:** https://github.com/SkyLee310/FinTalk-AI
**Status:** approved for implementation planning

---

## 1. What we are building

FinTalk AI turns Malaysian financial-services meetings into audited, structured, execution-ready data. It captures mixed-language ("Bahasa Rojak") discussion and whiteboard content, masks personal data before anything is stored, flags potential Shariah issues for human ruling, and drafts a loan term sheet plus an ISO 20022 settlement payload behind a maker–checker approval gate.

### Decisions taken during design

| Decision | Choice |
|---|---|
| Build posture | Demo-grade product on a real spine — genuine schema, auth, RBAC, audit chain, tests. No throwaway code. |
| STT pipeline | Cloud STT via Gemini behind a `TranscriptionProvider` seam; local Whisper provider stubbed for on-prem. |
| v1 slice | Thin vertical slice through all four demo steps (slide 8), with the cross-cutting spine built properly. |
| Deployment | `frontend/` → Vercel, `backend/` → Railway. Two independent `package.json`, no monorepo tooling. |
| Payments | Generate payload for human download. **No auto-submit exists in the codebase.** |

### Out of scope for v1

Deferred to later cycles, each needing its own spec: NER-based redaction (v1 is regex + LLM), the full BNM rule library (v1 ships a starter set), historical meeting Q&A retrieval (deck Phase 2), auto follow-up scheduling (Phase 2), on-premise installer and NurAI/Zetrix Shariah API integration (Phase 3), multi-tenant organisation isolation, real-time streaming transcription (v1 is upload-then-process).

---

## 2. Contradictions found in the pitch deck

These were raised and resolved during design. Recording them so implementation does not silently reintroduce them.

### 2.1 The privacy claim did not survive the stack choice

Slide 11 states *"Raw audio never leaves your device. Only clean, redacted text proceeds"* with STT and redaction in an on-device box. Gemini is a cloud API and the backend runs on Railway, so as built, **audio containing spoken NRIC and account numbers reaches Google**.

- Honest claim for v1: *"Raw audio is never stored. PII is redacted before persistence. In on-premise mode the processing boundary is your own environment."*
- The residual cross-border transfer is tracked as **RISK-001** (§7.1), not claimed as solved.
- Slide 11 should be reworded before the deck is shown to a bank.

### 2.2 Slide 7 contradicts slide 6

Slide 6 flags "8% interest" as Riba. Slide 7 then shows `Interest Rate: 8% p.a.` next to a "Pre-Validate BNM / Shariah Parameters ✓" badge. An Islamic facility has no interest rate — it has a profit rate under a named contract. Fixed structurally in §5.3 by a database CHECK constraint, so the product cannot emit the violation it claims to detect.

### 2.3 "PayNet Sandbox API" is not callable by us

FPX/PayNet B2B access requires being a licensed participant under signed agreement. v1 generates a pre-validated ISO 20022 `pain.001` XML plus CSV for a human maker to download and submit through their existing corporate banking channel. See §6.4.

---

## 3. Repository structure

Two independent packages so Vercel and Railway builds cannot break each other.

```
FinTalk-AI/
├── frontend/                          → Vercel (root directory: frontend)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   └── (app)/
│   │   │       ├── meetings/
│   │   │       │   ├── page.tsx                 list
│   │   │       │   └── [id]/
│   │   │       │       ├── page.tsx             dual-track transcript
│   │   │       │       ├── whiteboard/page.tsx  image → Mermaid
│   │   │       │       ├── compliance/page.tsx  Shariah + PDPA alerts
│   │   │       │       └── term-sheet/page.tsx  facility + payload
│   │   │       ├── approvals/page.tsx           maker–checker queue
│   │   │       └── audit/page.tsx               audit-trail viewer
│   │   ├── components/
│   │   │   ├── transcript/   DualTrackTranscript · SpeakerTurn · RedactionBadge
│   │   │   ├── compliance/   ShariahAlertCard · PdpaMaskBadge · ConsentGate
│   │   │   ├── termsheet/    TermSheetForm · PayloadPreview · ApprovalActions
│   │   │   └── ui/           primitives
│   │   ├── lib/              api-client.ts · auth.ts · rbac.ts · format-money.ts
│   │   └── types/api.ts      GENERATED from backend zod schemas — do not hand-edit
│   ├── .env.example
│   ├── .gitignore
│   ├── vercel.json
│   └── package.json
│
├── backend/                           → Railway (root directory: backend)
│   ├── src/
│   │   ├── server.ts
│   │   ├── config/env.ts              zod-validated, fails fast on boot
│   │   ├── modules/
│   │   │   ├── auth/                  login · JWT · rbac.middleware.ts
│   │   │   ├── meetings/              upload · list · get · retention-purge
│   │   │   ├── transcription/
│   │   │   │   ├── provider.ts        TranscriptionProvider interface
│   │   │   │   ├── gemini.provider.ts
│   │   │   │   ├── local.provider.ts  on-prem stub (Whisper)
│   │   │   │   └── fake.provider.ts   test double
│   │   │   ├── redaction/
│   │   │   │   ├── types.ts           branded RedactedText
│   │   │   │   ├── patterns/          nric · bank-account · phone · email · card
│   │   │   │   ├── llm-detector.ts    names/addresses regex cannot catch
│   │   │   │   └── redactor.ts        the ONLY minter of RedactedText
│   │   │   ├── shariah/
│   │   │   │   ├── rules/             riba · gharar · maysir · haram-sector
│   │   │   │   │                      · contract-mismatch · late-payment-penalty
│   │   │   │   ├── engine.ts
│   │   │   │   └── llm-detector.ts
│   │   │   ├── vision/                whiteboard → Mermaid + JSON schema
│   │   │   ├── termsheet/             facility model · validation
│   │   │   ├── payload/               iso20022.ts (pain.001) · csv.ts
│   │   │   ├── approvals/             state machine · SoD enforcement
│   │   │   └── audit/                 chain.ts · verify.ts
│   │   ├── ai/
│   │   │   ├── gemini.client.ts       ONLY file that talks to Gemini
│   │   │   └── prompts/               versioned templates
│   │   └── db/  schema.prisma · migrations/ · seed.ts
│   ├── tests/  unit/ · integration/ · fixtures/
│   ├── .env.example
│   ├── .gitignore
│   ├── railway.json
│   └── package.json
│
├── docs/
│   ├── superpowers/specs/
│   ├── ARCHITECTURE.md
│   └── COMPLIANCE.md                  control → regulation matrix
├── .github/workflows/ci.yml
├── .gitignore
└── README.md
```

**Type sharing.** Backend zod schemas are the single source of truth. A `npm run gen:types` script emits `frontend/src/types/api.ts`. CI regenerates and fails on diff, so drift cannot merge.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 App Router, TypeScript, Tailwind | Vercel-native |
| Backend | Fastify + TypeScript | fast, first-class zod schema validation |
| Database | Railway Postgres + Prisma | matches the deploy target; CHECK constraints and rules available |
| Auth | own JWT (argon2, httpOnly cookies, access + refresh) | avoids adding a third-party data processor to the PDPA register |
| AI | Gemini via `@google/genai` | model IDs from env, never hardcoded |
| Test | Vitest · Supertest · Playwright | |

---

## 4. Secrets and environment

Requirement: contributors must be able to key in their own credentials, and no secret may ever enter git history.

- `.env.example` in both `frontend/` and `backend/`, fully commented, committed.
- `.gitignore` at root and in both packages ignores `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`. Only `.env.example` is tracked.
- **`gitleaks` runs in CI** as a required check, so a leaked key fails the build rather than sitting in history.
- `config/env.ts` validates every variable with zod at boot and exits non-zero on a missing or malformed value. No `process.env` access anywhere else in the codebase.

### `backend/.env.example`

```
# --- Server ---
NODE_ENV=development
PORT=8080
CORS_ORIGIN=http://localhost:3000

# --- Database (Railway provides DATABASE_URL in production) ---
DATABASE_URL=postgresql://user:password@localhost:5432/fintalk

# --- Gemini ---
# Get a key: https://aistudio.google.com/apikey
GEMINI_API_KEY=
# Confirm current model IDs against Google's model list before setting these.
GEMINI_MODEL_TRANSCRIBE=
GEMINI_MODEL_VISION=
GEMINI_MODEL_TEXT=

# --- Auth ---
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# --- PII vault encryption (AES-256-GCM; 32-byte key, base64) ---
PII_VAULT_KEY=

# --- Transcription provider: gemini | local | fake ---
TRANSCRIPTION_PROVIDER=gemini

# --- Retention (PDPA Retention Principle) ---
MEETING_RETENTION_DAYS=90
```

### `frontend/.env.example`

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

**Model IDs are deliberately blank.** WebSearch and WebFetch were unavailable during design, so Gemini's current model list could not be confirmed from source. Implementation must read Google's live model list and fill these in; no model string is hardcoded anywhere.

---

## 5. Data model

### 5.1 Roles

`VIEWER` · `MAKER` · `CHECKER` · `SHARIAH` · `SUPERVISOR` · `ADMIN` — one per user in v1. Multi-role assignment is a v2 item; the per-transaction segregation-of-duties constraint (§5.5) is the actual control either way.

### 5.2 Capture and redaction

| Model | Key fields | Notes |
|---|---|---|
| `Meeting` | `title`, `occurredAt`, `createdById`, `status` | `CAPTURED → PROCESSING → READY \| FAILED` |
| `Transcript` | `rawRedacted`, `summaryEn`, `languages[]`, `modelId`, `promptVersion` | dual-track per slide 5 |
| `TranscriptSegment` | `startMs`, `endMs`, `speakerLabel`, `textRedacted` | speaker-attributed |
| `Redaction` | `piiType`, `placeholder`, `startOffset`, `endOffset`, `detectedBy`, `confidence`, `vaultId?` | the redaction log in stage 6 of the slide-11 diagram |
| `PiiVault` | `ciphertext`, `iv`, `authTag` | AES-256-GCM. **No plaintext column exists.** |
| `Whiteboard` | `mermaid`, `structuredJson`, `modelId`, `promptVersion` | slide 5. **The source image is never persisted** — processed in memory, only derived artifacts stored. Same rule as audio. |

`PiiType`: `NRIC · BANK_ACCOUNT · PHONE · EMAIL · PERSON_NAME · ADDRESS · CARD`

#### The write barrier

```ts
// modules/redaction/types.ts
declare const brand: unique symbol;
export type RedactedText = string & { readonly [brand]: 'redacted' };
```

Only `redactor.ts` can mint a `RedactedText`. Every transcript persistence signature accepts `RedactedText` and nothing else, so unredacted text is not a valid argument to any write path. Raw transcript exists only inside request scope; audio buffers are never written to disk. This makes the privacy property a compile-time invariant rather than a convention.

### 5.3 Term sheet — Islamic and conventional are mutually exclusive

```prisma
enum FacilityKind    { CONVENTIONAL, ISLAMIC }
enum IslamicContract { MURABAHAH, TAWARRUQ, IJARAH, MUSHARAKAH, MUDHARABAH, ISTISNA, SALAM }

model TermSheet {
  id              String       @id @default(cuid())
  meetingId       String
  applicantName   String
  currency        String                        // "MYR"
  principalMinor  BigInt                        // minor units — never a float
  tenureMonths    Int
  facilityKind    FacilityKind
  interestRateBps Int?                          // CONVENTIONAL only
  profitRateBps   Int?                          // ISLAMIC only
  islamicContract IslamicContract?              // required iff ISLAMIC
  status          ApprovalStatus @default(DRAFT)
}
```

Enforced in the database, not in application code that a caller can bypass:

```sql
ALTER TABLE "TermSheet" ADD CONSTRAINT term_sheet_rate_kind_exclusive CHECK (
  (facility_kind = 'CONVENTIONAL'
     AND interest_rate_bps IS NOT NULL
     AND profit_rate_bps   IS NULL
     AND islamic_contract  IS NULL)
  OR
  (facility_kind = 'ISLAMIC'
     AND profit_rate_bps   IS NOT NULL
     AND interest_rate_bps IS NULL
     AND islamic_contract  IS NOT NULL)
);
```

Money is `BigInt` minor units; rates are integer basis points. No floating-point value touches money or rates anywhere in the system.

### 5.4 Shariah flags — the AI never rules

```prisma
enum ShariahIssueType { RIBA, GHARAR, MAYSIR, HARAM_SECTOR, CONTRACT_MISMATCH, LATE_PAYMENT_PENALTY }
enum ShariahStatus    { FLAGGED, UNDER_REVIEW, CLEARED, CONFIRMED_VIOLATION }
```

`ShariahFlag` carries `issueType`, redacted `excerpt`, `detectedBy` (`rule:riba.interest-rate-mention` or `llm`), `confidence`, `reference` (the policy or parameter cited), `status`, and human resolution fields `reviewedById` / `reviewedAt` / `reviewNote`.

**Invariant:** the service layer rejects any transition out of `FLAGGED` unless the actor holds role `SHARIAH`. The engine writes flags; only the Shariah Committee resolves them. This implements slide 6's *"All flagged risks are queued for final human Shariah Board review"* and is a hard line — the system does not issue Shariah rulings.

The **starter rule set for v1 is exactly the six rules** listed in §3: `riba`, `gharar`, `maysir`, `haram-sector`, `contract-mismatch`, `late-payment-penalty`. Extending the library is a Shariah Committee task, not an engineering one.

### 5.5 Maker–checker

```prisma
enum ApprovalStatus { DRAFT, PENDING_CHECKER, APPROVED, REJECTED, WITHDRAWN }
```

```
DRAFT ──submit(maker)──▶ PENDING_CHECKER ──authorize(checker≠maker)──▶ APPROVED  (terminal)
  │                             └─────────reject(checker≠maker)─────▶ REJECTED
  └──withdraw(maker)──▶ WITHDRAWN
```

- `Approval` records `makerId`, `submittedAt`, `checkerId`, `decidedAt`, `decision`, `note`, with `checkerId != makerId` enforced.
- `submit` throws **409** if any `ShariahFlag` on the meeting is still `FLAGGED` or `UNDER_REVIEW` — the compliance gate of slide 11 §4.
- Payload generation (§6.4) is reachable **only** from `APPROVED`.
- `APPROVED` is terminal; there is no transition out.

### 5.6 Audit chain

```
hash = sha256( prevHash ‖ canonicalJson({ at, actorId, actorRole, action, entityType, entityId, payload }) )
```

`AuditEntry` has a monotonic `BigInt` id and is append-only, with Postgres rules rejecting `UPDATE` and `DELETE`. `GET /audit/verify` walks the chain and reports the first break. `payload` is always already-redacted.

Covers all six items in the slide-11 audit strip: uploader identity, redaction log, AI output snapshot (`AiOutputSnapshot`: `modelId`, `promptVersion`, `promptRedacted`, `responseRaw`), human edits (`HumanEdit`: `fieldPath`, `aiValue`, `humanValue`), approver identity, immutable store.

Audited actions include `meeting.uploaded`, `transcript.created`, `pii.unmasked`, `shariah.flagged`, `shariah.resolved`, `termsheet.edited`, `approval.submitted`, `approval.authorized`, `payload.generated`.

---

## 6. Pipeline

### 6.1 Capture

Consent gate first: recording is blocked until the uploader confirms all participants were notified (PDPA Notice & Choice). The confirmation is an audited event.

### 6.2 Transcribe → redact

```
audio (memory only)
  → TranscriptionProvider.transcribe()      gemini | local | fake
  → raw transcript (request scope only, never persisted)
  → redactor.redact()                       regex patterns, then LLM pass for names/addresses
  → RedactedText + Redaction[] + PiiVault[]
  → persist
```

Redaction runs before the first write. If it throws, nothing is persisted and the meeting goes `FAILED`.

#### Why the `gemini` provider is the v1 default

Local STT was evaluated and rejected for v1. Bahasa Rojak is three-way code-switching (English / Malay / Hokkien), the hardest case in speech recognition:

| Candidate | Verdict |
|---|---|
| Whisper `large-v3` (whisper.cpp / faster-whisper) | Locks onto one language per segment; Malay is low-resource in its training mix; **Hokkien (Min Nan) is effectively unsupported**. |
| Whisper in-browser (transformers.js / WASM) | As above, plus 40 MB–1.5 GB download and slower-than-realtime CPU inference. |
| Malaysian fine-tuned Whisper (e.g. Mesolitica's Malaysian Whisper family) | **The credible local path.** Trained on Malaysian audio including code-switched Malay-English. Requires a GPU, 1–3 GB weights, slow cold start — not available on Railway's standard containers. Model availability unverified (no web access at design time). |
| Vosk / wav2vec2 Malay fine-tunes | Fast and small, accuracy below demo bar. |

Large multimodal models outperform small specialist models precisely on code-switching, and Gemini accepts audio natively with no separate STT stage.

**`local.provider.ts` therefore targets Malaysian fine-tuned Whisper on a GPU host**, not vanilla Whisper. It is the on-prem answer to RISK-001 (§7.1) and the reason the provider seam exists. Implementing it is a separate spec; v1 ships it as an interface-conforming stub that throws a clear "not configured" error rather than silently degrading.

### 6.3 Analyse

From redacted text only: English summary, action items, intent, MY→EN translation, whiteboard → Mermaid, and the Shariah rule engine plus LLM detector. Every AI call records an `AiOutputSnapshot`.

### 6.4 Term sheet and payload

Extracted facility fields populate a `TermSheet` draft. Human maker edits (each edit recorded as a `HumanEdit` diff against the AI value) and submits. Checker authorizes. Only then can the payload be generated: ISO 20022 `pain.001` XML plus CSV, schema-validated, offered as a download.

**The system never transmits a payment instruction.** No auto-submit code path exists, so none can be enabled by misconfiguration.

---

## 7. Compliance

`docs/COMPLIANCE.md` holds the live matrix. Every row is labelled **implemented-and-tested**, **implemented-not-verified**, or **documented-gap**.

| Control | Location | Maps to |
|---|---|---|
| PII detect + mask before persistence | `modules/redaction` | PDPA Security Principle |
| Branded `RedactedText` write barrier | `redaction/types.ts` | PDPA Security Principle |
| Redaction log with confidence | `Redaction` | PDPA Data Integrity / Access |
| Encrypted vault, supervisor-only, every read audited | `PiiVault` + role gate | PDPA Security · BNM RMiT access control |
| Consent gate before recording | capture flow | PDPA Notice & Choice |
| Retention window + purge job | `modules/meetings` | PDPA Retention Principle |
| Breach-notification runbook | `docs/COMPLIANCE.md` | PDPA (Amendment) Act 2024 |
| AI flags, humans rule | `ShariahFlag` role gate | BNM Shariah Governance Policy |
| Rules cite their source | `shariah/rules/*.reference` | BNM SGP · IFSA 2013 s.28–29 |
| Islamic ⊥ conventional rates | DB CHECK constraint | BNM Islamic contract policy documents |
| Maker–checker, checker ≠ maker | `Approval` | segregation of duties (RMiT) |
| Hash-chained append-only audit | `AuditEntry` | RMiT audit-trail integrity |
| AES-256-GCM at rest, TLS in transit | vault + platform | RMiT cryptography |
| Model provenance + human-edit diff | `AiOutputSnapshot`, `HumanEdit` | auditability of AI-assisted decisions |

### Limits of this document

This specification describes controls **designed to align with** published regulatory expectations. It is not a compliance certification and must not be represented as one. Sign-off requires the institution's Shariah Committee, legal counsel, and where applicable engagement with Bank Negara Malaysia. Regulatory citations here were written from prior knowledge because web access was unavailable during design; **every citation must be verified against the current published text before external use**, and rows are marked *requires legal confirmation* until that happens.

The system also does not provide investment or financial advice. It summarises, flags, and drafts for human decision.

### 7.1 Risk register

| ID | Risk | Severity | v1 mitigation | Production path |
|---|---|---|---|---|
| RISK-001 | Audio containing PII crosses borders to Google before redaction — a PDPA cross-border transfer | **High** | Consent gate; privacy notice naming Google as processor; paid-tier Gemini (no training on submitted data); documented as an open gap | Vertex AI pinned to `asia-southeast1`, or the `local` provider. Backend in Railway Singapore. The provider seam makes this a config change. |
| RISK-002 | Redaction miss leaks PII into storage | **High** | 100%-recall gate on the golden corpus; fail-closed on error; regex + LLM layers | Add NER layer; human review queue for low-confidence segments |
| RISK-003 | LLM hallucinates a term-sheet figure | Medium | Human maker edits before submit; `HumanEdit` diff; checker authorizes | Field-level confidence display; dual extraction with disagreement flagging |
| RISK-004 | Shariah rule set incomplete | Medium | Starter rule set; every flag cites its reference; unresolved flags block approval | Shariah Committee reviews and extends the rule library; NurAI integration |
| RISK-005 | Regulatory citations unverified (no web access at design time) | Medium | Rows marked *requires legal confirmation* | Legal counsel verifies against published text |
| RISK-006 | Vault key compromise exposes all PII | Medium | Key from env only, never in git; gitleaks in CI | KMS / managed secret store with rotation |

---

## 8. Error handling

**Principle: no failure path is more permissive than the success path.**

- Redaction throws → persist nothing, meeting `FAILED`. There is no fallback that stores unredacted text.
- Shariah engine throws → write a `FLAGGED` flag with `detectedBy: "engine-error"`. A broken detector blocks approval; it never passes one through.
- Gemini `429`/`503` → bounded retry, jittered backoff, circuit breaker. Invalid-input `4xx` → no retry. Final failure → `FAILED` plus audit entry.
- Idempotency keys on upload and approval endpoints, so a network retry cannot double-authorize.
- Errors surface as RFC 9457 `problem+json` from one central mapper. Internal detail is never leaked to clients.
- No bare `catch {}` in `redaction/`, `shariah/`, or `payload/` — lint-enforced.

---

## 9. Testing and quality gates

| Layer | Coverage |
|---|---|
| Redaction units | Golden corpus of **synthetic** Malaysian PII: NRIC `YYMMDD-PB-###G`, MY bank account lengths, `+60 1x-xxx xxxx`, `0x-xxxx xxxx`, emails. Adversarial cases: digits spelled as words, values split across speaker turns, values embedded mid-Malay-sentence. **Gate: 100% recall (pass/fail). Precision tracked as a metric.** |
| Shariah units | Per rule, positive · negative · boundary. `"8% interest"`, `"faedah 8%"`, `"bunga"` flag; `"8% profit rate under Murabahah"` does not. Bahasa Rojak fixtures. |
| Term sheet units | CHECK-constraint violations rejected; BigInt money arithmetic; bps rounding. |
| Audit units | Chain construction; tamper detection; canonical JSON stability. |
| Contract | zod schemas both directions; `gen:types` output diff fails CI. |
| Integration | Real Postgres. Full RBAC matrix (every role × endpoint). SoD: self-approval → 403. Compliance gate: submit with open flag → 409. Audit tamper → verify detects. Vault: non-supervisor → 403; supervisor read → audit entry created. |
| AI boundary | `fake.provider.ts` and recorded fixtures by default. A `@live` suite hits the real API and is excluded from CI — tests stay deterministic, fast, and free. |
| E2E | Playwright spec walking slide 8's four steps: discuss → whiteboard → redact/check → term sheet. Green means the demo works. |

**CI required checks:** `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) · ESLint + Prettier · **gitleaks** · `npm audit` · coverage threshold · custom rule banning `any` in `redaction`/`shariah`/`payload`.

Each module is reviewed against this checklist as it lands, not in one pass at the end. Modules touching PII, auth, or money get an explicit security review pass.

**No real personal data enters the repository.** All fixtures are synthetic and generated to format, never sampled from real records.

---

## 10. Definition of done for v1

1. `frontend/` deploys to Vercel; `backend/` deploys to Railway; both boot from `.env.example` with keys filled in.
2. Slide 8's four-step demo runs end to end against seeded data, covered by a green Playwright spec.
3. Redaction golden corpus at 100% recall.
4. RBAC matrix and SoD constraints covered by integration tests.
5. `/audit/verify` detects a deliberately tampered row.
6. A Shariah flag cannot be cleared by any role other than `SHARIAH`; an unresolved flag blocks approval.
7. A term sheet cannot be persisted with both an interest rate and a profit rate.
8. `docs/COMPLIANCE.md` complete, every row status-labelled, risk register current.
9. CI green on every required check, `gitleaks` included.
10. No `.env` file tracked in git; both `.env.example` files complete and commented.

---

## 11. Audio preprocessing: FFmpeg + VAD (open decision, affects Plan 3)

Proposed 2026-08-08: preprocess audio locally with FFmpeg and voice activity
detection, redact personal data, and only then send to Gemini — so that
"sensitive voice data won't leak".

### 11.1 Why the stated goal is not met by VAD alone

Voice activity detection reports **where** speech occurs. It does not report
**what** was said. Removing a spoken NRIC from audio requires knowing that an
NRIC was spoken, which requires speech-to-text. So the ordering
`FFmpeg → VAD → redact → Gemini` cannot work as written: at the redaction step
there is no text to redact, and the transcript is precisely what Gemini is
being asked to produce.

The voice itself is also biometric personal data. Speech cannot be stripped of
the speaker's voiceprint while remaining speech. RISK-001 (§7.1) is unchanged
by preprocessing.

### 11.2 What FFmpeg + VAD does buy, and is worth building regardless

- **Data minimisation**, a PDPA principle in its own right: downmix to 16 kHz
  mono and drop non-speech spans. Meeting recordings are commonly 30–40%
  silence and room noise, none of which needs to be transmitted.
- **Reliable segment boundaries** for the dual-track log, derived locally
  rather than trusted from the model.
- **Format determinism**: one codec and sample rate reaching the provider,
  so a caller's recording format cannot cause a mid-pipeline failure.
- **Lower cost and latency**, since billing follows audio duration.

### 11.3 The two designs that do meet the goal

**Option A — local STT; audio never leaves the host.**
`FFmpeg + VAD → local Whisper (Malaysian fine-tune) → redact text → send only
redacted text to Gemini for summarisation and Shariah analysis.` This is the
only design under which the claim "voice data does not leave" is true. Costs:
a GPU host, which Railway's standard containers do not provide; lower Bahasa
Rojak accuracy than Gemini; Hokkien effectively unsupported. Reachable today
through the existing `local` provider seam (§6.2) with no rework.

**Option B — local PII pre-screen, then Gemini (recommended).**
`FFmpeg + VAD → small local STT pass used only to locate spoken digit strings
and identifiers → mute those audio spans → send minimised, muted audio to
Gemini → redact the returned text as a second layer.`

The asymmetry that makes this practical: **locating digits is a far easier
task than transcribing Bahasa Rojak correctly.** No usable transcript is
required, only spans to silence, which a small CPU model can do. The NRIC and
account number then reach Google as neither audio nor text, while Gemini still
performs the multilingual work it is actually better at.

Two constraints on Option B:

- The pre-screen is a filter, not a guarantee. Text redaction remains the
  second layer, and the pipeline stays fail-closed: a pre-screen error must
  abort the upload, never silently skip muting.
- Muting destroys evidence of what was said. Every muted span must be recorded
  in the audit log with its time range and the reason, so the dual-track log
  stays truthful about what was removed.

### 11.4 Decision

**Option B is adopted** (decided 2026-08-08). The capture pipeline becomes:

```
FFmpeg normalise (16 kHz mono) → VAD segment + drop non-speech
  → local digit-only pre-screen → mute identifier spans
  → Gemini transcription → text redaction (second layer) → persist
```

Binding consequences for Plan 3:

1. **The pre-screen is a filter, never a guarantee.** Text redaction through
   the `RedactedText` barrier (§5.2) remains mandatory. A pre-screen failure
   aborts the upload; it must never fall through to an unmuted send.
2. **Every muted span is audited.** An `AuditEntry` records the time range and
   the reason, so the dual-track log stays truthful about what was removed
   rather than silently presenting a gap as speech that never happened.
3. **Muting is destructive and not reversible.** The muted audio is still
   never persisted (§2); only the span record survives.
4. **RISK-001 is reduced, not closed.** Speech content and the speaker's
   voiceprint still reach Google for the non-muted spans. The honest claim
   remains the one in §2 — raw audio is never stored, personal data is
   redacted before persistence — not that audio never leaves the device.

Option A (local STT, audio never leaves) stays reachable through the `local`
provider seam (§6.2) with no rework, and remains the answer if a bank requires
that audio not cross a border at all.

Plan 1 is unaffected — it contains no audio path.

### 11.5 Implementation status of Option B

**Deferred, 2026-08-09, by the product owner's decision.** The capture pipeline
currently sends audio straight to Gemini. Neither the FFmpeg/VAD preprocessing
nor the local digit pre-screen is built.

What this changes, precisely:

- **Unaffected:** the storage guarantee. Text-layer redaction through the
  `RedactedText` barrier is fully enforced and tested, so no unredacted
  identifier is persisted, and no identifier reaches the summarising model.
- **Outstanding:** the transfer guarantee. A spoken NRIC still reaches Google as
  audio, and is transcribed before being redacted. RISK-001 stands at its
  original severity and must not be described as mitigated.

Reason for deferral: the digit pre-screen needs local STT model weights, which
were not obtainable in the build environment. §11.4's four binding constraints
remain in force for whenever it is built; nothing in the current pipeline
contradicts them, because the pipeline does not yet include that stage.
