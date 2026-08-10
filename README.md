# FinTalk AI

Audited, Shariah-aware meeting capture for Malaysian financial institutions.

A credit committee meets, argues in three languages at once, and reaches a decision. Minutes get written from memory, the whiteboard is photographed and forgotten, and the customer's IC number ends up in a chat thread. FinTalk AI records what was actually said, masks the personal data before anything is stored, raises Shariah concerns for a qualified reviewer, and turns the outcome into a term sheet that a second person has to approve.

---

## What it does

| | |
|---|---|
| **Capture** | Upload a recording. It is transcribed with speaker labels and timings, across mixed English/Malay ("Bahasa Rojak") speech. |
| **Redact** | NRIC, bank account, card, phone and email are replaced with stable placeholders and sealed into an encrypted vault **before** anything reaches the database. |
| **Screen** | Six Shariah rules run over the redacted transcript and raise findings — riba, gharar, maysir, prohibited sector, contract mismatch, late-payment penalty. |
| **Decide** | A maker drafts a term sheet; a different person approves it. Every step is written to a hash-chained audit log. |
| **Connect** | Meetings discussing the same things are linked automatically, and you can ask a question across the whole corpus. Answers cite the meetings they came from, or say nothing was found. |
| **Settle** | The approving checker records a **simulated** DuitNow/FPX transfer. No money moves, no bank is contacted, and a database constraint makes a row claiming otherwise unstorable. |
| **Export** | An approved facility produces a CSV handoff of the approved figures, for a human to complete in their own banking channel. Never a payment instruction. |

### Four guarantees, and how each is enforced

These are not conventions. Each one fails loudly if broken.

**Personal data cannot be stored unredacted.** `RedactedText` is a branded type minted in exactly one file. The persistence layer accepts nothing else, so an unredacted write does not compile. A test scans the source and fails the build if any other module casts to that type.

**An Islamic facility cannot carry an interest rate.** A Postgres `CHECK` constraint makes the combination unstorable, so the product cannot emit the violation it claims to detect.

**The AI never issues a Shariah ruling.** A finding can only leave `FLAGGED` via a user holding the `SHARIAH` role — enforced in the capability matrix, in the service, and by a database constraint requiring reviewer attribution. An administrator cannot do it either.

**One person cannot approve their own work.** The checker is never the maker, enforced in the capability matrix, the service, and a `CHECK` constraint. A term sheet cannot even be submitted while any Shariah finding on its meeting is unresolved.

### Honest limits

Read these before showing the app to a bank.

- **Audio reaches Google.** Transcription uses the Gemini API, so speech — including a spoken NRIC — leaves the host before it is redacted. Raw audio is never *stored*, and personal data is redacted before *persistence*, but the transfer itself is real. Tracked as RISK-001 in the design spec. The app states this in plain words and requires an explicit acknowledgement before it will accept a recording. **There is no on-premise option.** A `local` provider was carried as a stub and withdrawn on 2026-08-10: it named a capability the product did not have.
- **Not a compliance certification.** Every regulatory reference in the code is marked *requires legal confirmation*. Shariah findings are advisory input for a qualified reviewer.
- **No payment is ever submitted.** The export module contains no function that transmits anything, and a test asserts that absence.
- **Names and addresses are not detected.** Regex handles the deterministic identifiers listed above. Person names and addresses need a model pass, which is not built — a regex guessing at names would put false confidence into a log an auditor is meant to trust.

---

## Architecture

Two independent packages, so the Vercel and Railway builds cannot break each other.

```
FinTalk-AI/
├── backend/                    → Railway (root directory: backend)
│   ├── src/
│   │   ├── config/env.ts       the only reader of process.env; fails at boot on a bad value
│   │   ├── auth/               argon2, split-audience JWTs, capability matrix
│   │   ├── pdpa/               detectors · AES-256-GCM vault · redactor · transcript store
│   │   ├── ai/                 provider seam: gemini | fake
│   │   ├── pipeline/           transcribe → redact → summarise → persist → screen
│   │   ├── shariah/            six rules and the engine
│   │   ├── compliance/         Shariah review · term sheet · maker–checker
│   │   ├── audit/              hash-chained append-only log
│   │   ├── export/             CSV handoff of an approved facility
│   │   └── routes/
│   ├── prisma/                 schema · migrations · sql/constraints.sql · seed
│   └── tests/                  unit and integration
├── frontend/                   → Vercel (root directory: frontend)
│   └── src/
│       ├── app/                login · meetings · transcript · approvals · audit
│       ├── components/         design system and primitives
│       └── lib/                typed API client
└── docs/superpowers/specs/     the design specification
```

### Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, Tailwind 4 |
| Backend | Fastify 5, TypeScript 5 (`strict` + `noUncheckedIndexedAccess`) |
| Database | PostgreSQL 16, Prisma 6 |
| Auth | Own JWT via `jose`, argon2id, httpOnly cookies |
| AI | Gemini via `@google/genai`; model IDs from environment, never hardcoded |
| Tests | Vitest |

### Two decisions worth knowing

**Compliance rules live in the database, not only in application code.** `prisma/sql/constraints.sql` holds the `CHECK` constraints and the append-only audit triggers. No caller can bypass them — including a future one written by someone who has not read this file. The deploy applies it on every start.

**Money never touches a float.** Amounts are `BigInt` minor units, rates are integer basis points, and both cross HTTP as strings. Above 2^53 a JSON number silently drops cents, and `JSON.stringify` cannot serialise a `BigInt` at all.

### Roles

| Role | Can |
|---|---|
| `VIEWER` | Read meetings and transcripts |
| `MAKER` | Capture meetings, draft and submit term sheets |
| `CHECKER` | Approve or reject a term sheet — and nothing else |
| `SHARIAH` | Resolve a Shariah finding — the only role that can |
| `SUPERVISOR` | Read the audit trail |
| `ADMIN` | Manage users, read the audit trail. **Cannot** clear a finding or approve a facility. |

---

## Running it locally

### Prerequisites

- Node 20 or newer
- A PostgreSQL 16 database
- A Gemini API key — **optional**, see below

### 1. Database

Any Postgres 16 will do. With Docker:

```bash
docker run -d --name fintalk-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fintalk -p 5432:5432 postgres:16
```

### 2. Backend

```bash
cd backend && npm install && cp .env.example .env
```

Edit `.env`. The three values you must generate:

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('PII_VAULT_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

`PII_VAULT_KEY` must be exactly 32 bytes base64 — it is the AES-256-GCM key for the personal-data vault. The server refuses to start otherwise, and names the offending variable.

Then create the schema and load the demo data:

```bash
cd backend && npm run db:migrate && npm run db:constraints && npm run db:seed
```

`db:constraints` is not optional. Prisma migrations do not contain the `CHECK` constraints or the audit triggers, so skipping it leaves you with a database that accepts an Islamic facility carrying an interest rate.

```bash
cd backend && npm run dev
```

### 3. Frontend

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

Open <http://localhost:3000>.

### Demo accounts

Created by `npm run db:seed`, all with password `Demo!2345`:

`maker@fintalk.test` · `checker@fintalk.test` · `shariah@fintalk.test` · `viewer@fintalk.test` · `supervisor@fintalk.test` · `admin@fintalk.test`

Sign in as the **maker** to upload, the **shariah** reviewer to clear findings, then the **checker** to approve. All seeded content is synthetic.

### Do you need a Gemini key?

Not to run, develop or test. `TRANSCRIPTION_PROVIDER=fake` returns a deterministic Bahasa Rojak fixture containing synthetic identifiers, which exercises the entire pipeline — redaction, Shariah screening, approvals, audit — without any API call. The whole test suite runs this way.

For real transcription, set:

```
TRANSCRIPTION_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL_TRANSCRIBE=...
GEMINI_MODEL_VISION=...
GEMINI_MODEL_TEXT=...
GEMINI_MODEL_EMBEDDING=...   # optional
```

`GEMINI_MODEL_EMBEDDING` is the one optional value. Without it the knowledge graph links meetings by shared topics only and Ask FinTalk AI reports itself unavailable — both degrade honestly rather than the server refusing to boot.

Model IDs come from [AI Studio](https://aistudio.google.com/apikey) and are never hardcoded. All four are required when the provider is `gemini`; the process refuses to start if any is missing.

> `.env` and `.env.local` are gitignored. Only `.env.example` is tracked, CI runs `gitleaks`, and a CI step fails the build if any `.env` file is ever committed.

---

## Testing

```bash
cd backend && npm test
```

Unit tests need nothing. Integration tests need `DATABASE_URL` pointing at a Postgres with migrations **and** constraints applied — several of them assert that the database rejects a bad write, so they fail without `db:constraints`.

```bash
cd backend && npm run typecheck && npm run lint
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
```

`typecheck` covers the tests as well as `src`, which is what lets a `@ts-expect-error` prove the redaction write barrier holds.

CI runs all of it against a real Postgres 16, plus `gitleaks`, on every push.

---

## Deploying

### Backend → Railway

Root directory `backend`.

> **The pre-deploy command must apply migrations.** Set it, in the Railway dashboard, to:
>
> ```
> npm run db:deploy && npm run db:constraints
> ```
>
> Dashboard settings override `railway.json`, and on 2026-08-10 this service was configured to run `npm run db:seed:deploy` there instead — seeding but never migrating. Five consecutive deploys failed with Prisma `P2022`, because the pre-deploy seed used a client that knew about new columns against a database no migration had touched. The server never started, and Railway kept serving the last good build, so the app looked healthy while running stale code.
>
> Two rules follow from that. **Migrations run before anything else touches the database** — `constraints.sql` ALTERs tables the migrations create, so it cannot go first. And **seeding must never gate a deploy**: demo data failing to load is not a reason to refuse to serve.

Required variables: `DATABASE_URL`, `CORS_ORIGIN` (your Vercel URL), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PII_VAULT_KEY`, `TRANSCRIPTION_PROVIDER`, and the four `GEMINI_*` values if using Gemini. `GEMINI_MODEL_EMBEDDING` is optional.

Give the Postgres service a persistent volume at `/var/lib/postgresql/data`. Without one, the database is wiped whenever the container is recreated.

### Frontend → Vercel

Root directory `frontend`. Set `NEXT_PUBLIC_API_BASE_URL` to the Railway backend URL.

`CORS_ORIGIN` on the backend must exactly match the Vercel origin, or the browser will silently drop the session cookie. Session cookies use `SameSite=None; Secure` in production because the two halves are a cross-site pair.

---

## Project status

Built and tested: in-browser recording and file upload, whiteboard capture with the diagram drawn, per-segment transcription confidence with human confirmation, PDPA redaction, Shariah screening resolved by an explicit human yes/no, maker–checker approval, simulated DuitNow/FPX settlement, a cross-meeting knowledge graph, an assistant that answers only from the corpus and cites it, user administration, hash-chained audit, CSV handoff, and the screens for all of it.

Not built: name and address detection in free-flowing speech (declared fields such as a participant's name *are* masked), self-service password reset, and the full BNM rule library — this ships a starter set of six rules.

**Scale ceiling, stated plainly.** The knowledge graph compares every pair of meetings in memory and holds every embedding at once. That is milliseconds for the tens-to-low-hundreds a demo or pilot has, and wrong for a real deployment, which needs pgvector or a vector store with an indexed nearest-neighbour query.

Withdrawn: on-device transcription and on-device audio pre-screening, both removed on 2026-08-10. They were interfaces without implementations.

The design specification, including the contradictions found in the original pitch deck and how each was resolved, is in `docs/superpowers/specs/`.
