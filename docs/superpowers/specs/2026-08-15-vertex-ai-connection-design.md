# Vertex AI Integration Design Specification

## Overview
FinTalk AI is transitioning its core AI infrastructure from Google AI Studio / Gemini API to **Google Cloud Vertex AI** on the backend running on **Railway**, with **OpenRouter** as the automatic resilient fallback. The legacy `fake` provider and direct Gemini AI Studio keys are eliminated in favor of real Vertex AI integration backed by Google Cloud Service Account credentials and project configuration.

---

## Authentication & Credentials Architecture

### 1. Service Account JSON in Railway
Railway environment variables can hold the full Google Cloud Service Account JSON string in `GCP_SERVICE_ACCOUNT_KEY` or `GOOGLE_APPLICATION_CREDENTIALS_JSON`.

The credential loader:
1. Parses the JSON object if provided as a string.
2. Automatically extracts `project_id`, `client_email`, and `private_key`.
3. Injects credentials into `@google/genai` (with `vertexai: true`, `project`, `location`).
4. Alternatively, accepts `VERTEX_PROJECT_ID` and `VERTEX_LOCATION` along with `VERTEX_API_KEY` or default GCP environment auth.

---

## Configuration & Environment Variables (`backend/src/config/env.ts`, `backend/.env.example`)

### Primary Vertex AI Configuration
* `VERTEX_PROJECT_ID`: GCP Project ID (e.g. `fintalk-ai-prod`). Optional if contained inside `GCP_SERVICE_ACCOUNT_KEY`.
* `VERTEX_LOCATION`: GCP Region (default: `us-central1` or `asia-southeast1`).
* `GCP_SERVICE_ACCOUNT_KEY`: Service account key JSON string.
* `VERTEX_API_KEY`: Optional Vertex AI express key.
* `VERTEX_MODEL_TRANSCRIBE`: Model for audio transcription (default: `gemini-2.0-flash`).
* `VERTEX_MODEL_TEXT`: Model for text summarization, Q&A, decisions, action items (default: `gemini-2.0-flash`).
* `VERTEX_MODEL_VISION`: Model for whiteboard diagram extraction (default: `gemini-2.0-flash`).
* `VERTEX_MODEL_EMBEDDING`: Model for knowledge graph and vector similarity (default: `text-embedding-004`).

### Fallback Configuration
* `OPENROUTER_API_KEY`: Optional API key for automatic failover.
* `OPENROUTER_MODEL`: Model for general AI tasks (default: `openai/gpt-4o`).
* `OPENROUTER_MODEL_TRANSCRIBE`: Model for audio transcription (default: `openai/whisper-large-v3`).

---

## Provider Architecture

### 1. `VertexTranscriptionProvider` (`backend/src/ai/vertex.provider.ts`)
Implements `TranscriptionProvider` interface with zero-temperature, strict type guards, and error masking:
- `transcribe(audio: AudioInput)`: Structured segment-level speech transcription with speaker diarization.
- `summarize(redactedText: string)`: Meeting executive summaries.
- `extractTopics(redactedSummary: string)`: Topic graph node identification.
- `extractWhiteboard(image: ImageInput)`: Mermaid diagram and entity extraction from board photos.
- `arbitrateDecisions(redactedText: string)`: Structured decision & debate outcome analysis.
- `extractActionItems(redactedText: string)`: Action item and owner extraction.
- `draftProject(redactedText: string)`: Kickoff draft and follow-up plan generation.
- `answerFromContext(question: string, excerpts: readonly GroundingExcerpt[])`: Grounded RAG assistant answers strictly from meeting context.
- `embed(redactedText: string)`: Vector embeddings for cross-meeting semantic graph.

### 2. Provider Factory & Fallback (`backend/src/ai/factory.ts`)
- Instantiates `VertexTranscriptionProvider`.
- If `OPENROUTER_API_KEY` is provided, wraps it with `FallbackTranscriptionProvider(vertex, openRouter)` to retry any transient Vertex AI failure against OpenRouter before failing.

---

## Error Handling & Privacy Guarantees
- **Data Privacy**: Input transcripts, meeting audio, and whiteboard images are never logged or quoted in upstream error messages.
- **Auditability**: All prompts maintain version tags (`PROMPT_VERSION = 'vertex-transcribe-v1'`, etc.) stored with records for compliance provenance.
- **Fail-safe**: Structured parsing via Zod ensures malformed upstream responses fail cleanly rather than producing hallucinations.

---

## Testing & Verification Plan
- Unit tests validating `env.ts` schema with valid/invalid Vertex credentials and service account JSON parser.
- Unit tests verifying `VertexTranscriptionProvider` constructor and fallback routing logic.
- Typecheck & linter passing with zero errors (`npm run typecheck`, `npm run lint`).
