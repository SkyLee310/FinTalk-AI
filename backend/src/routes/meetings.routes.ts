import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditWithin } from '../audit/chain.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { ComplianceError } from '../compliance/errors.js';
import { sendProblem } from '../http/problem.js';
import { ask } from '../knowledge/assistant.js';
import { createRedactionContext, redactDeclaredValue } from '../pdpa/redactor.js';
import { sealedToRow } from '../pdpa/vault.js';
import type { BackgroundJobs } from '../pipeline/background-jobs.js';
import {
  PipelineError,
  type PipelineDeps,
  processMeeting,
  processTranscriptDirectly,
} from '../pipeline/process-meeting.js';
import {
  convertToSegments,
  extractMeetingCode,
  fetchMeetTranscript,
} from '../pipeline/google-meet-fetcher.js';
import { getUserGoogleClient } from '../auth/google-oauth.js';
import { getEnv, type Env } from '../config/env.js';
import { needsReconciliation, reconcileStaleFlags } from '../shariah/reconcile.js';
import { SHARIAH_RULES } from '../shariah/rules.js';

/**
 * Meeting capture.
 *
 * Audio is held in memory for the duration of the request and never written to
 * disk. Spec §2 states raw audio is never stored, and a temp file is storage —
 * one that survives a crash and lands in a backup.
 */

const MetadataSchema = z.object({
  title: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
  description: z.string().max(2_000).optional(),
});

/**
 * Participants arrive as one JSON field rather than indexed form fields.
 *
 * `participants[0][name]` style keys would need parsing and ordering logic in a
 * multipart loop that is already doing two other jobs. One JSON string is
 * validated in one place.
 */
const ParticipantsSchema = z.array(
  z.object({
    name: z.string().min(1).max(120),
    role: z.string().max(120).optional(),
  }),
).max(40);

function parseParticipants(raw: string | undefined): z.infer<typeof ParticipantsSchema> {
  if (raw === undefined || raw.trim() === '') return [];
  try {
    const parsed = ParticipantsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    // A malformed list loses the participants, not the recording. The audio is
    // the irreplaceable half; refusing the whole upload over a bad side field
    // would throw away the thing that cannot be re-recorded.
    return [];
  }
}

export interface MeetingRouteDeps extends PipelineDeps {
  readonly prisma: PrismaClient;
  readonly jobs: BackgroundJobs;
  readonly env?: Env;
}

export function registerMeetingRoutes(
  app: FastifyInstance,
  deps: MeetingRouteDeps,
): void {
  const { prisma } = deps;

  app.post(
    '/meetings',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

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
          'The upload was malformed or exceeded the size limit.',
        );
      }

      const metadata = MetadataSchema.safeParse({
        title: fields.get('title'),
        occurredAt: fields.get('occurredAt'),
        description: fields.get('description'),
      });
      if (!metadata.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'A title and an ISO-8601 occurredAt are required.',
        );
      }

      /**
       * PDPA consent gate. Processing means sending audio to a third-party
       * model, so this is refused before the audio is looked at rather than
       * recorded as a caveat afterwards.
       */
      if (fields.get('consentConfirmed') !== 'true') {
        return sendProblem(
          reply,
          422,
          'Consent required',
          'Participant consent must be confirmed before a recording can be processed.',
        );
      }

      /**
       * Cross-border transfer gate — a separate refusal, not a second reading of
       * the same one.
       *
       * Consenting to be recorded is not the same act as accepting that the
       * recording leaves Malaysia for Google and is redacted only after it
       * arrives. Collapsing the two into one checkbox would leave the audit log
       * unable to show which was actually agreed to (spec §12.3).
       */
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
          'An audio file is required in the "audio" field.',
        );
      }

      /**
       * The meeting row and its audit entry commit together.
       *
       * Spec §5.6 lists meeting.uploaded among the audited actions, and §4
       * makes the consent confirmation itself an audited event. The record
       * that consent was claimed must not be able to go missing while the
       * recording is accepted anyway.
       *
       * The title is deliberately left out of the payload: it is free text an
       * operator typed, it can name a person, and nothing redacts it. It stays
       * in Meeting.title, which entityId points at.
       */
      /**
       * Participant names are redacted before the row exists, not after.
       *
       * They go through redactDeclaredValue rather than redact: the detectors
       * cannot find a person's name in free text, so detection would return the
       * name untouched and store it in the clear. The operator typed it into a
       * field labelled "name", so there is nothing to detect — the whole value is
       * sealed and replaced with a placeholder.
       *
       * One shared context, so the same person entered twice keeps one
       * placeholder. The context is deliberately NOT shared with the transcript's:
       * that runs in a later request over different text, and a placeholder
       * numbered here would collide with one numbered there.
       */
      const participantInputs = parseParticipants(fields.get('participants'));
      const nameContext = createRedactionContext();
      const redactedParticipants = participantInputs.map((participant, index) => ({
        redaction: redactDeclaredValue(
          participant.name,
          'PERSON_NAME',
          deps.vaultKey,
          nameContext,
        ),
        role: participant.role ?? null,
        ordinal: index,
      }));

      const meeting = await prisma.$transaction(async (tx) => {
        const created = await tx.meeting.create({
          data: {
            title: metadata.data.title,
            description: metadata.data.description ?? null,
            occurredAt: new Date(metadata.data.occurredAt),
            status: 'CAPTURED',
            consentConfirmed: true,
            transferAcknowledged: true,
            createdById: actor.id,
          },
        });

        /**
         * Each participant's row, vault entry and redaction row commit together
         * with the meeting. A name stored beside a missing vault entry would be
         * a placeholder nothing could resolve; a vault entry with no redaction
         * row would be an identifier nobody could account for.
         */
        for (const participant of redactedParticipants) {
          const row = await tx.meetingParticipant.create({
            data: {
              meetingId: created.id,
              nameRedacted: participant.redaction.text,
              role: participant.role,
              ordinal: participant.ordinal,
            },
          });

          for (const record of participant.redaction.records) {
            const vault = await tx.piiVault.create({ data: sealedToRow(record.sealed) });
            await tx.redaction.create({
              data: {
                participantId: row.id,
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
        }

        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: actor.id,
          actorRole: actor.role,
          action: 'meeting.uploaded',
          entityType: 'Meeting',
          entityId: created.id,
          payload: {
            consentConfirmed: true,
            // Recorded separately so the log shows which of the two acts was
            // agreed to, rather than one flag standing in for both.
            transferAcknowledged: true,
            transferProcessor: 'google-gemini',
            occurredAt: created.occurredAt.toISOString(),
            audioBytes: audioBytes.byteLength,
            audioMimeType,
            /**
             * A count, never the names — and the description is omitted
             * entirely, for the same reason the title is: both are free text an
             * operator typed, both can name a person, and the audit log has no
             * redaction offsets able to describe them. They stay in the columns
             * entityId points at.
             */
            participantCount: redactedParticipants.length,
          },
        });

        return created;
      });

      /**
       * Processing is started but deliberately not awaited.
       *
       * Transcribing a real recording takes minutes, and Railway's edge proxy
       * closes any request at 300 seconds. An upload that blocked on the
       * pipeline returned 502 to the caller even while the pipeline was still
       * working. The client is given the meeting id immediately and polls
       * GET /meetings/:id, whose status field already models
       * CAPTURED → PROCESSING → READY | FAILED.
       *
       * The trade-off: a container restart mid-processing strands a meeting in
       * PROCESSING. A durable queue is the real answer; this is honest about
       * being a single process.
       */
      /**
       * Client-measured playback length, for correcting the provider's
       * self-reported segment timestamps (see rescaleSegmentTimestamps).
       * Best-effort: a missing or malformed value just means no correction
       * runs, never a rejected upload — this field is an enhancement, not a
       * requirement like consent or the audio bytes above.
       */
      const rawDurationMs = fields.get('durationMs');
      const parsedDurationMs = rawDurationMs === undefined ? NaN : Number(rawDurationMs);
      const durationMs =
        Number.isFinite(parsedDurationMs) && parsedDurationMs > 0 ? parsedDurationMs : undefined;

      const audio = { bytes: audioBytes, mimeType: audioMimeType, durationMs };

      deps.jobs.run(processMeeting(deps, meeting.id, audio, actor), (error: unknown) => {
        /**
         * The stored failureReason is PII-free by design, which makes a failure
         * hard to diagnose from the database alone. The full cause is logged
         * instead: server logs are operator-only, and an operator can already
         * read the transcript this text came from.
         */
        const stage = error instanceof PipelineError ? error.stage : 'unknown';
        request.log.error(
          { err: error, meetingId: meeting.id, stage },
          'meeting processing failed',
        );
      });

      return reply.code(202).send({
        meetingId: meeting.id,
        status: 'CAPTURED',
        pollUrl: `/meetings/${meeting.id}`,
      });
    },
  );

  /**
   * Connect a Google Meet session to FinTalk AI for automatic post-meeting transcript ingestion.
   */
  const ConnectMeetSchema = z.object({
    meetLink: z.string().min(1),
    title: z.string().min(1).max(200),
    occurredAt: z.string().datetime(),
    description: z.string().max(2_000).optional(),
    consentConfirmed: z.boolean(),
    transferAcknowledged: z.boolean(),
    participants: z
      .array(
        z.object({
          name: z.string().min(1),
          role: z.string().optional(),
        }),
      )
      .optional(),
  });

  app.post(
    '/meetings/connect-meet',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const parsed = ConnectMeetSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'Malformed request payload.',
        );
      }

      const {
        meetLink,
        title,
        occurredAt,
        description,
        consentConfirmed,
        transferAcknowledged,
        participants: rawParticipants,
      } = parsed.data;

      if (!consentConfirmed) {
        return sendProblem(
          reply,
          400,
          'Consent required',
          'Consent from all participants is required before a meeting can be recorded.',
        );
      }

      if (!transferAcknowledged) {
        return sendProblem(
          reply,
          400,
          'Cross-border transfer acknowledgement required',
          'Cross-border transfer acknowledgement is required for Google Meet processing.',
        );
      }

      let meetingCode: string;
      try {
        meetingCode = extractMeetingCode(meetLink);
      } catch (err) {
        return sendProblem(
          reply,
          400,
          'Invalid Google Meet link',
          err instanceof Error ? err.message : 'Invalid Google Meet URL',
        );
      }

      // Check if user has linked Google account
      const token = await prisma.googleToken.findUnique({
        where: { userId: request.authUser!.id },
      });

      if (!token) {
        return sendProblem(
          reply,
          400,
          'Google Account Not Linked',
          'Please link your Google account in Settings before connecting Google Meet meetings.',
        );
      }

      const participantInputs = (rawParticipants ?? []).filter((p) => p.name.trim().length > 0);
      const nameContext = createRedactionContext();
      const redactedParticipants = participantInputs.map((participant, index) => ({
        redaction: redactDeclaredValue(
          participant.name,
          'PERSON_NAME',
          deps.vaultKey,
          nameContext,
        ),
        role: participant.role ?? null,
        ordinal: index,
      }));

      const meeting = await prisma.$transaction(async (tx) => {
        const created = await tx.meeting.create({
          data: {
            title,
            description: description ?? null,
            occurredAt: new Date(occurredAt),
            status: 'CAPTURED',
            consentConfirmed: true,
            transferAcknowledged: true,
            captureSource: 'GOOGLE_MEET',
            meetLink,
            googleConferenceId: meetingCode,
            createdById: request.authUser!.id,
          },
        });

        for (const participant of redactedParticipants) {
          const row = await tx.meetingParticipant.create({
            data: {
              meetingId: created.id,
              nameRedacted: participant.redaction.text,
              role: participant.role,
              ordinal: participant.ordinal,
            },
          });

          for (const record of participant.redaction.records) {
            const vault = await tx.piiVault.create({ data: sealedToRow(record.sealed) });
            await tx.redaction.create({
              data: {
                participantId: row.id,
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
        }

        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: request.authUser!.id,
          actorRole: request.authUser!.role ?? 'MAKER',
          action: 'meeting.connected.google-meet',
          entityType: 'Meeting',
          entityId: created.id,
          payload: {
            meetLink,
            meetingCode,
            participantCount: redactedParticipants.length,
          },
        });

        return created;
      });

      return reply.code(202).send({
        meetingId: meeting.id,
        status: meeting.status,
        pollUrl: `/meetings/${meeting.id}`,
      });
    },
  );

  /**
   * Manually triggers syncing and processing a Google Meet transcript for a meeting.
   */
  app.post(
    '/meetings/:id/sync-meet',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const meeting = await prisma.meeting.findUnique({
        where: { id },
      });

      if (!meeting) {
        return sendProblem(reply, 404, 'Meeting not found', `No meeting with id ${id}.`);
      }

      if (meeting.captureSource !== 'GOOGLE_MEET' || !meeting.googleConferenceId) {
        return sendProblem(
          reply,
          400,
          'Not a Google Meet meeting',
          'This meeting was not captured via Google Meet.',
        );
      }

      let authClient;
      try {
        const env = deps.env ?? getEnv();
        authClient = await getUserGoogleClient(env, prisma, meeting.createdById);
      } catch (err) {
        return sendProblem(
          reply,
          400,
          'Google Authorization Failed',
          err instanceof Error ? err.message : 'Could not authorize with Google',
        );
      }

      let entries;
      try {
        entries = await fetchMeetTranscript(authClient, meeting.googleConferenceId);
      } catch (err) {
        return sendProblem(
          reply,
          502,
          'Failed to fetch transcript from Google',
          err instanceof Error ? err.message : 'Google Meet API error',
        );
      }

      if (!entries || entries.length === 0) {
        return sendProblem(
          reply,
          404,
          'No transcript available yet',
          'Google Meet is still generating the transcript or the call has not ended. Please check that Transcripts was enabled and try again shortly.',
        );
      }

      const segments = convertToSegments(
        entries,
        meeting.occurredAt.getTime(),
      );

      const transcriptionResult = {
        segments,
        languages: ['en', 'ms'],
        modelId: 'google-meet-transcript',
        promptVersion: 'google-v2',
      };

      const actor = { id: request.authUser!.id, role: request.authUser!.role ?? 'MAKER' };

      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { status: 'PROCESSING', failureReason: null },
      });

      deps.jobs.run(
        processTranscriptDirectly(deps, meeting.id, transcriptionResult, actor),
        (error: unknown) => {
          const stage = error instanceof PipelineError ? error.stage : 'unknown';
          request.log.error(
            { err: error, meetingId: meeting.id, stage },
            'Google Meet background processing failed',
          );
        },
      );

      return reply.code(202).send({
        meetingId: meeting.id,
        status: 'PROCESSING',
        segmentCount: segments.length,
        pollUrl: `/meetings/${meeting.id}`,
      });
    },
  );

  app.get(
    '/meetings',
    { preHandler: [requireAuth, requireCapability('meeting:read')] },
    async (_request, reply) => {
      const meetings = await prisma.meeting.findMany({
        // Archived rows are hidden from this list only — GET /meetings/:id and
        // every referencing row (TermSheet, Approval, Settlement, ShariahFlag,
        // Transcript) keep resolving them normally.
        where: { archivedAt: null },
        orderBy: { occurredAt: 'desc' },
        select: {
          id: true,
          title: true,
          occurredAt: true,
          status: true,
          consentConfirmed: true,
          transferAcknowledged: true,
          createdById: true,
          _count: { select: { shariahFlags: true, termSheets: true } },
        },
      });

      return reply.send({
        meetings: meetings.map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          occurredAt: meeting.occurredAt.toISOString(),
          status: meeting.status,
          consentConfirmed: meeting.consentConfirmed,
          transferAcknowledged: meeting.transferAcknowledged,
          createdById: meeting.createdById,
          shariahFlagCount: meeting._count.shariahFlags,
          termSheetCount: meeting._count.termSheets,
        })),
      });
    },
  );

  /**
   * Archive, never delete — the same reasoning as user deactivation. A
   * Meeting is referenced by TermSheet, Approval, Settlement, ShariahFlag and
   * Transcript, and every one of them must keep resolving meetingId after
   * this route runs. Only this list's own query excludes an archived row.
   *
   * Scoped to the meeting's own creator: archiving is personal cleanup, not
   * shared moderation. Widening it to ADMIN later is a capability decision
   * (meeting:archive), not a tweak to this check.
   */
  app.patch<{ Params: { id: string } }>(
    '/meetings/:id/archive',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const meeting = await prisma.meeting.findUnique({ where: { id: request.params.id } });
      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }
      if (meeting.createdById !== actor.id) {
        return sendProblem(
          reply,
          403,
          'Forbidden',
          'Only the meeting you captured can be archived by you.',
        );
      }
      if (meeting.archivedAt !== null) {
        return sendProblem(reply, 409, 'Already archived', 'This meeting is already archived.');
      }

      await prisma.$transaction(async (tx) => {
        await tx.meeting.update({ where: { id: meeting.id }, data: { archivedAt: new Date() } });

        // Empty payload: the meeting's title is operator-typed free text that
        // meeting.uploaded already excludes from audit payloads, for the
        // same reason.
        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: actor.id,
          actorRole: actor.role,
          action: 'meeting.archived',
          entityType: 'Meeting',
          entityId: meeting.id,
          payload: {},
        });
      });

      return reply.status(200).send({ ok: true });
    },
  );

  /**
   * Hard delete, unlike archive above. The row and everything Prisma
   * cascades from it (Transcript, TranscriptSegment, MeetingTopic,
   * ShariahFlag, TermSheet → Approval/Settlement, Whiteboard, HumanEdit) are
   * gone — including from the knowledge graph and Ask FinTalk AI, which both
   * query these tables live with no separate cache to invalidate. AuditEntry
   * survives: entityId there is a plain string, not a foreign key, so the
   * audit chain keeps a record the meeting existed and was deleted even once
   * the row is gone.
   *
   * Same scope as archive: only the meeting's own creator.
   */
  app.delete<{ Params: { id: string } }>(
    '/meetings/:id',
    { preHandler: [requireAuth, requireCapability('meeting:create')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const meeting = await prisma.meeting.findUnique({ where: { id: request.params.id } });
      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }
      if (meeting.createdById !== actor.id) {
        return sendProblem(
          reply,
          403,
          'Forbidden',
          'Only the meeting you captured can be deleted by you.',
        );
      }

      await prisma.$transaction(async (tx) => {
        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: actor.id,
          actorRole: actor.role,
          action: 'meeting.deleted',
          entityType: 'Meeting',
          entityId: meeting.id,
          payload: {},
        });

        await tx.meeting.delete({ where: { id: meeting.id } });
      });

      return reply.status(200).send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/meetings/:id',
    { preHandler: [requireAuth, requireCapability('transcript:read')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
        include: {
          transcript: {
            include: {
              segments: { orderBy: { startMs: 'asc' } },
              // The vault relation is deliberately not included. Reading a
              // stored identifier is a separate, separately-audited action.
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
          },
          shariahFlags: { orderBy: { createdAt: 'asc' } },
          participants: { orderBy: { ordinal: 'asc' } },
          decisions: { orderBy: { ordinal: 'asc' } },
          actionItems: { orderBy: { ordinal: 'asc' } },
        },
      });

      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }

      /**
       * Self-heals flags raised before the dedup/segment-link/highlight fix
       * (see shariah/reconcile.ts) the first time this meeting is opened
       * after that fix shipped, so a meeting captured before today does not
       * need a re-upload to show a working "jump to transcript" link.
       * Skipped once any flag has been reviewed, or once reconciliation has
       * already run — needsReconciliation is false in both cases, the first
       * on purpose (never discard a reviewer's verdict) and the second
       * because the fresh rows it just wrote already carry highlights.
       */
      let shariahFlags = meeting.shariahFlags;
      if (meeting.transcript !== null && needsReconciliation(shariahFlags)) {
        shariahFlags = await reconcileStaleFlags(prisma, meeting.id, meeting.transcript, actor);
      }

      /**
       * Human corrections, fetched alongside rather than joined.
       *
       * HumanEdit is a generic (entityType, entityId) table with no relation to
       * TranscriptSegment, so Prisma cannot include it. One query keyed on the
       * segment ids beats one per segment.
       */
      const segmentIds = meeting.transcript?.segments.map((s) => s.id) ?? [];
      const edits = segmentIds.length === 0
        ? []
        : await prisma.humanEdit.findMany({
            where: { entityType: 'TranscriptSegment', entityId: { in: segmentIds } },
            orderBy: { editedAt: 'asc' },
          });

      const editsBySegment = new Map<string, typeof edits>();
      for (const edit of edits) {
        const existing = editsBySegment.get(edit.entityId);
        if (existing === undefined) editsBySegment.set(edit.entityId, [edit]);
        else existing.push(edit);
      }

      return reply.send({
        id: meeting.id,
        title: meeting.title,
        description: meeting.description,
        /**
         * Participants carry placeholders, never names. The vault relation is
         * deliberately not joined here for the same reason the transcript's is
         * not: reading a stored identifier is a separate, separately-audited
         * action, and this endpoint is the one every reader hits.
         */
        participants: meeting.participants.map((participant) => ({
          id: participant.id,
          nameRedacted: participant.nameRedacted,
          role: participant.role,
        })),
        occurredAt: meeting.occurredAt.toISOString(),
        createdById: meeting.createdById,
        status: meeting.status,
        failureReason: meeting.failureReason,
        consentConfirmed: meeting.consentConfirmed,
        transferAcknowledged: meeting.transferAcknowledged,
        transcript:
          meeting.transcript === null
            ? null
            : {
                id: meeting.transcript.id,
                rawRedacted: meeting.transcript.rawRedacted,
                summaryEn: meeting.transcript.summaryEn,
                languages: meeting.transcript.languages,
                modelId: meeting.transcript.modelId,
                promptVersion: meeting.transcript.promptVersion,
                processingMs: meeting.transcript.processingMs,
                // Null/empty when no provider produced one or a PII check
                // skipped it — never a reason to fail the capture, so the
                // client must render an absent draft, not an error.
                projectKickoff: meeting.transcript.projectKickoffRedacted,
                followUps: meeting.transcript.followUpsRedacted,
                segments: meeting.transcript.segments.map((segment) => ({
                  id: segment.id,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  speakerLabel: segment.speakerLabel,
                  textRedacted: segment.textRedacted,
                  // Null means not scored, and the client renders that
                  // differently from a low score. See the schema comment.
                  confidence: segment.confidence,
                  confirmedById: segment.confirmedById,
                  confirmedAt: segment.confirmedAt?.toISOString() ?? null,
                  /**
                   * Every correction, not just the latest. A reviewer who
                   * corrected a segment twice made two judgements, and showing
                   * only the last would hide that the first was reconsidered.
                   */
                  corrections: (editsBySegment.get(segment.id) ?? []).map((edit) => ({
                    id: edit.id,
                    editorId: edit.editorId,
                    humanValue: edit.humanValue,
                    editedAt: edit.editedAt.toISOString(),
                  })),
                })),
                redactions: meeting.transcript.redactions,
              },
        shariahFlags: shariahFlags.map((flag) => ({
          id: flag.id,
          issueType: flag.issueType,
          excerpt: flag.excerpt,
          detectedBy: flag.detectedBy,
          confidence: flag.confidence,
          reference: flag.reference,
          status: flag.status,
          // Null when the offset could not be resolved to a segment (see
          // ShariahFlag.segmentId) — the client renders that finding without
          // a "jump to transcript" link rather than a broken one.
          segmentId: flag.segmentId,
          highlights: flag.highlights,
        })),
        /**
         * Static across every meeting — the size of the rule set the engine
         * ran, for the findings panel's "screened against N rules" header.
         * Read from the same array the engine iterates, so it can never
         * drift from what was actually run.
         */
        shariahRuleCount: SHARIAH_RULES.length,
        /** The final decision each debated point reached, arbiter output. */
        decisions: meeting.decisions.map((decision) => ({
          id: decision.id,
          topic: decision.topic,
          decision: decision.decision,
          rationale: decision.rationale,
        })),
        /** Who/what/when. `owner` is a role or speaker label, never a name. */
        actionItems: meeting.actionItems.map((item) => ({
          id: item.id,
          owner: item.owner,
          task: item.task,
          dueDate: item.dueDate,
        })),
      });
    },
  );

  const AskMeetingBody = z.object({
    question: z.string().min(1).max(2_000),
    history: z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2_000),
      }),
    ).max(10).optional(),
  });

  app.post(
    '/meetings/:id/ask',
    { preHandler: [requireAuth, requireCapability('meeting:read'), requireCapability('transcript:read')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const params = request.params as { id?: string };
      const meetingId = params.id;
      if (meetingId === undefined || meetingId.trim() === '') {
        return sendProblem(reply, 400, 'Invalid request', 'Meeting id is required.');
      }

      const body = AskMeetingBody.safeParse(request.body);
      if (!body.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'A non-empty question string (up to 2,000 chars) is required.',
        );
      }

      try {
        const result = await ask(
          { prisma: deps.prisma, provider: deps.provider },
          {
            question: body.data.question,
            actor: { id: actor.id, role: actor.role },
            history: body.data.history,
            meetingId,
          },
        );
        return reply.send(result);
      } catch (error) {
        if (error instanceof ComplianceError) {
          return sendProblem(reply, error.status, error.code, error.message);
        }
        request.log.error({ err: error }, 'per-meeting assistant query failed');
        return sendProblem(
          reply,
          503,
          'Assistant unavailable',
          'The assistant could not answer just now. Nothing was stored.',
        );
      }
    },
  );
}
