import type { FastifyInstance } from 'fastify';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';
import type { TranscriptionProvider } from '../ai/provider.js';
import { TranscriptionError } from '../ai/provider.js';
import { createRedactionContext, redact } from '../pdpa/redactor.js';

/**
 * A rough, live transcript while a meeting is still being recorded.
 *
 * This is not the meeting's record. Nothing here is stored: no Meeting exists
 * yet at this point in the capture flow (that row is only created once the
 * user finishes and uploads), so there is nothing to attach a
 * TranscriptSegment, a RedactionRecord, or an audit-chain entry to, and
 * nothing durable happens for one to describe. The real transcript is still
 * produced exactly as before, once, by processMeeting after upload.
 *
 * Every response is redacted before it leaves this server, on the same
 * non-negotiable rule as everywhere else a provider's raw output exists (see
 * ai/provider.ts): model output is untrusted personal data until redact() has
 * run over it, whether or not the result is ever going to be stored.
 */

const RATE_GUARD_MS = 4_000;

export interface LivePreviewRouteDeps {
  readonly provider: TranscriptionProvider;
  readonly vaultKey: Buffer;
}

export function registerLivePreviewRoutes(
  app: FastifyInstance,
  deps: LivePreviewRouteDeps,
): void {
  const { provider, vaultKey } = deps;

  /**
   * Per-user last-call timestamp, scoped to this one registration rather than
   * module scope — each buildServer() call (one per test file, one at boot)
   * gets its own guard, so unrelated tests in the same worker process never
   * share rate-limit state.
   */
  const lastCallAt = new Map<string, number>();

  app.post(
    '/meetings/live-preview',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const now = Date.now();
      const last = lastCallAt.get(actor.id);
      if (last !== undefined && now - last < RATE_GUARD_MS) {
        return sendProblem(
          reply,
          429,
          'Too many requests',
          'Live preview was called again too soon after the last one.',
        );
      }
      lastCallAt.set(actor.id, now);

      const fields = new Map<string, string>();
      let audioBytes: Buffer | undefined;
      let audioMimeType = 'application/octet-stream';

      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname !== 'audio') {
              // Drain unexpected files rather than leaving the stream stalled.
              part.file.resume();
              continue;
            }
            audioBytes = await part.toBuffer();
            audioMimeType = part.mimetype;
          } else {
            fields.set(part.fieldname, String(part.value));
          }
        }
      } catch {
        return sendProblem(
          reply,
          413,
          'Upload rejected',
          'The clip was malformed or exceeded the size limit.',
        );
      }

      /**
       * The same two-part consent gate as the real upload
       * (meetings.routes.ts), re-checked on every call. There is no Meeting
       * row yet to read these off of — recording happens before one exists —
       * so the client resends its current in-memory acknowledgement state
       * each cycle, and this still refuses to call Gemini unless both are
       * true: a client-side check alone protects nothing an operator can
       * reach with curl.
       */
      if (fields.get('consentConfirmed') !== 'true') {
        return sendProblem(
          reply,
          422,
          'Consent required',
          'Participant consent must be confirmed before a recording can be processed.',
        );
      }
      if (fields.get('transferAcknowledged') !== 'true') {
        return sendProblem(
          reply,
          422,
          'Transfer acknowledgement required',
          'This recording is transcribed by Google Gemini, so the audio leaves '
          + 'Malaysia before any personal data is removed from it. That transfer '
          + 'must be acknowledged before the recording can be processed.',
        );
      }

      if (audioBytes === undefined || audioBytes.byteLength === 0) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'An audio clip is required in the "audio" field.',
        );
      }

      let result;
      try {
        result = await provider.transcribe({ bytes: audioBytes, mimeType: audioMimeType });
      } catch (cause) {
        request.log.error(
          { err: cause, provider: cause instanceof TranscriptionError ? cause.provider : 'unknown' },
          'live preview transcription failed',
        );
        return sendProblem(
          reply,
          502,
          'Live preview unavailable',
          'The live preview could not be transcribed. The next refresh will try again.',
        );
      }

      // One fresh context per call — placeholder numbering is not meant to
      // stay consistent across independent rolling windows, only within one.
      const context = createRedactionContext();
      const segments = result.segments.map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerLabel: segment.speakerLabel,
        textRedacted: redact(segment.text, vaultKey, context).text,
        confidence: segment.confidence,
      }));

      return reply.send({ segments, languages: result.languages });
    },
  );
}
