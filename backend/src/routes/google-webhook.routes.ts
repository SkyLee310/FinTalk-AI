import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { getUserGoogleClient } from '../auth/google-oauth.js';
import {
  convertToSegments,
  fetchMeetTranscript,
} from '../pipeline/google-meet-fetcher.js';
import {
  PipelineError,
  type PipelineDeps,
  processTranscriptDirectly,
} from '../pipeline/process-meeting.js';

export function registerGoogleWebhookRoutes(
  app: FastifyInstance,
  deps: PipelineDeps & { env: Env },
) {
  const { prisma, env } = deps;

  /**
   * Google Workspace Events API Webhook Receiver.
   * Receives notifications when a Google Meet conference ends or a transcript is ready.
   */
  app.post('/webhooks/google-meet', async (request, reply) => {
    // Optional secret token verification
    if (env.GOOGLE_WEBHOOK_SECRET) {
      const authHeader = request.headers['x-goog-webhook-secret'] || request.headers['authorization'];
      if (authHeader !== env.GOOGLE_WEBHOOK_SECRET && authHeader !== `Bearer ${env.GOOGLE_WEBHOOK_SECRET}`) {
        return reply.code(401).send({ error: 'Unauthorized webhook request' });
      }
    }

    const WebhookPayloadSchema = z.object({
      type: z.string().optional(),
      targetResource: z.string().optional(),
      resourceName: z.string().optional(),
      conferenceRecord: z.string().optional(),
      event: z.record(z.unknown()).optional(),
    });

    const parsed = WebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(200).send({ received: true, ignored: 'invalid_format' });
    }

    const resource =
      parsed.data.conferenceRecord
      || parsed.data.resourceName
      || parsed.data.targetResource
      || '';

    if (!resource) {
      return reply.code(200).send({ received: true, ignored: 'no_resource' });
    }

    // Extract conference record ID (e.g. 'conferenceRecords/abc-defg-hij' -> 'abc-defg-hij')
    const match = resource.match(/conferenceRecords\/([^/]+)/);
    const conferenceId = match ? match[1] : resource;

    // Look for pending Google Meet meetings matching this conferenceId
    const matchingMeetings = await prisma.meeting.findMany({
      where: {
        captureSource: 'GOOGLE_MEET',
        googleConferenceId: { in: [conferenceId, resource, `conferenceRecords/${conferenceId}`] },
        status: { in: ['CAPTURED', 'PROCESSING'] },
      },
    });

    if (matchingMeetings.length === 0) {
      request.log.info({ conferenceId, resource }, 'No pending meeting matched Google Meet webhook');
      return reply.code(200).send({ received: true, matched: 0 });
    }

    for (const meeting of matchingMeetings) {
      try {
        const authClient = await getUserGoogleClient(env, prisma, meeting.createdById);
        const conferenceRecordName = resource.startsWith('conferenceRecords/')
          ? resource.split('/transcripts')[0]
          : `conferenceRecords/${conferenceId}`;

        const entries = await fetchMeetTranscript(authClient, conferenceRecordName);
        if (entries.length === 0) {
          request.log.info({ meetingId: meeting.id }, 'Google Meet transcript empty or not ready yet');
          continue;
        }

        const segments = convertToSegments(entries, meeting.occurredAt.getTime());
        const transcriptionResult = {
          segments,
          languages: ['en', 'ms'],
          modelId: 'google-meet-transcript',
          promptVersion: 'google-v2',
        };

        const actor = { id: meeting.createdById, role: 'MAKER' as const };

        deps.jobs.run(
          processTranscriptDirectly(deps, meeting.id, transcriptionResult, actor),
          (error: unknown) => {
            const stage = error instanceof PipelineError ? error.stage : 'unknown';
            request.log.error(
              { err: error, meetingId: meeting.id, stage },
              'Google Meet webhook background processing failed',
            );
          },
        );
      } catch (err) {
        request.log.error(
          { err, meetingId: meeting.id },
          'Failed to process Google Meet webhook for meeting',
        );
      }
    }

    return reply.code(200).send({ received: true, matched: matchingMeetings.length });
  });
}
