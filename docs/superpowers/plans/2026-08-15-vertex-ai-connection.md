# Vertex AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Google Cloud Vertex AI as the primary AI engine on Railway with OpenRouter fallback, eliminating fake/AI Studio providers.

**Architecture:** Initialize `@google/genai` in Vertex AI mode using service account JSON credentials or Vertex project/location. Provide a resilient fallback wrapper to OpenRouter.

**Tech Stack:** Node.js, TypeScript, `@google/genai`, `@fastify`, `zod`, `vitest`.

## Global Constraints
- No dummy/fake provider in production.
- Upstream error messages must never echo prompt/audio/image contents to preserve PDPA privacy.
- Deterministic output (temperature 0).
- Zod schema runtime validation for all LLM outputs.

---

### Task 1: Environment Schema & Credential Resolver
**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/.env.example`
- Modify: `backend/tests/unit/config/env.test.ts`

**Interfaces:**
- Produces: `Env` schema containing `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `GCP_SERVICE_ACCOUNT_KEY`, `VERTEX_API_KEY`, `VERTEX_MODEL_*`, `OPENROUTER_*`.

- [ ] **Step 1: Write failing unit test for Vertex AI env validation**
- [ ] **Step 2: Run test to verify it fails (`npm run test:unit tests/unit/config/env.test.ts`)**
- [ ] **Step 3: Update `env.ts` and `.env.example` with Vertex AI configuration and JSON credential parser**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit changes**

---

### Task 2: Implement `VertexTranscriptionProvider`
**Files:**
- Create: `backend/src/ai/vertex.provider.ts`
- Modify: `backend/src/ai/gemini.provider.ts` (deprecate/remove or redirect)
- Test: `backend/tests/unit/ai/vertex.provider.test.ts`

**Interfaces:**
- Consumes: `Env`
- Produces: `VertexTranscriptionProvider implements TranscriptionProvider`

- [ ] **Step 1: Write unit test for `VertexTranscriptionProvider` construction and methods**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `VertexTranscriptionProvider` using `@google/genai` in Vertex AI mode with service account key parsing**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 3: Update Factory & OpenRouter Fallback
**Files:**
- Modify: `backend/src/ai/factory.ts`
- Modify: `backend/src/ai/fallback.provider.ts`

**Interfaces:**
- Produces: `createTranscriptionProvider(env: Env): TranscriptionProvider`

- [ ] **Step 1: Update `factory.ts` to instantiate `VertexTranscriptionProvider` and wire `FallbackTranscriptionProvider`**
- [ ] **Step 2: Run existing AI unit & integration tests (`npm run test`)**
- [ ] **Step 3: Verify build and typechecks (`npm run typecheck && npm run lint`)**
- [ ] **Step 4: Commit changes**
