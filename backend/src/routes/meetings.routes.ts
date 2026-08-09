import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appendAuditWithin } from '../audit/chain.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { sendProblem } from '../http/problem.js';
import {
  PipelineError,
  type PipelineDeps,
  processMeeting,
} from '../pipeline/process-meeting.js';

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
});

export interface MeetingRouteDeps extends PipelineDeps {
  readonly prisma: PrismaClient;
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
      const meeting = await prisma.$transaction(async (tx) => {
        const created = await tx.meeting.create({
          data: {
            title: metadata.data.title,
            occurredAt: new Date(metadata.data.occurredAt),
            status: 'CAPTURED',
            consentConfirmed: true,
            createdById: actor.id,
          },
        });

        await appendAuditWithin(tx, {
          at: new Date(),
          actorId: actor.id,
          actorRole: actor.role,
          action: 'meeting.uploaded',
          entityType: 'Meeting',
          entityId: created.id,
          payload: {
            consentConfirmed: true,
            occurredAt: created.occurredAt.toISOString(),
            audioBytes: audioBytes.byteLength,
            audioMimeType,
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
      const audio = { bytes: audioBytes, mimeType: audioMimeType };

      void processMeeting(deps, meeting.id, audio, actor).catch((error: unknown) => {
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

  app.get(
    '/meetings',
    { preHandler: [requireAuth, requireCapability('meeting:read')] },
    async (_request, reply) => {
      const meetings = await prisma.meeting.findMany({
        orderBy: { occurredAt: 'desc' },
        select: {
          id: true,
          title: true,
          occurredAt: true,
          status: true,
          consentConfirmed: true,
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
          shariahFlagCount: meeting._count.shariahFlags,
          termSheetCount: meeting._count.termSheets,
        })),
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/meetings/:id',
    { preHandler: [requireAuth, requireCapability('transcript:read')] },
    async (request, reply) => {
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
        },
      });

      if (meeting === null) {
        return sendProblem(reply, 404, 'Not found', 'No meeting exists with that id.');
      }

      return reply.send({
        id: meeting.id,
        title: meeting.title,
        occurredAt: meeting.occurredAt.toISOString(),
        status: meeting.status,
        failureReason: meeting.failureReason,
        consentConfirmed: meeting.consentConfirmed,
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
                segments: meeting.transcript.segments.map((segment) => ({
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  speakerLabel: segment.speakerLabel,
                  textRedacted: segment.textRedacted,
                })),
                redactions: meeting.transcript.redactions,
              },
        shariahFlags: meeting.shariahFlags.map((flag) => ({
          id: flag.id,
          issueType: flag.issueType,
          excerpt: flag.excerpt,
          detectedBy: flag.detectedBy,
          confidence: flag.confidence,
          reference: flag.reference,
          status: flag.status,
        })),
      });
    },
  );
}
