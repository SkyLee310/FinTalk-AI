import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { appendAudit, verifyChain } from '../audit/chain.js';
import { requireAuth, requireCapability } from '../auth/middleware.js';
import { ComplianceError } from '../compliance/errors.js';
import { reviewShariahFlag } from '../compliance/shariah-review.js';
import {
  decideApproval,
  draftTermSheet,
  submitForApproval,
} from '../compliance/termsheet.js';
import { buildPain001, buildPaymentCsv, minorToDecimal } from '../export/pain001.js';
import { sendProblem } from '../http/problem.js';

/**
 * Compliance surface: Shariah review, term sheets, maker–checker approval, and
 * the payment payload download.
 *
 * Every money value crosses this boundary as a string, never a JSON number.
 * Beyond 2^53 a JSON number silently drops cents, and JSON.stringify cannot
 * serialise a BigInt at all, so both directions use strings.
 */

const ReviewBody = z.object({
  status: z.enum(['UNDER_REVIEW', 'CLEARED', 'CONFIRMED_VIOLATION']),
  note: z.string().max(4_000),
});

const DraftBody = z.object({
  applicantName: z.string().min(1).max(200),
  currency: z.string().length(3).optional(),
  // A string, deliberately. See the module note.
  principalMinor: z.string().regex(/^\d+$/, 'must be a whole number of minor units'),
  tenureMonths: z.number().int().positive(),
  facilityKind: z.enum(['CONVENTIONAL', 'ISLAMIC']),
  interestRateBps: z.number().int().nullable().optional(),
  profitRateBps: z.number().int().nullable().optional(),
  islamicContract: z
    .enum(['MURABAHAH', 'TAWARRUQ', 'IJARAH', 'MUSHARAKAH', 'MUDHARABAH', 'ISTISNA', 'SALAM'])
    .nullable()
    .optional(),
});

const DecideBody = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(4_000),
});

function handleComplianceError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ComplianceError) {
    return sendProblem(reply, error.status, error.code, error.message);
  }
  throw error;
}

/** Term sheets leave this service with money as a string. */
function serialiseTermSheet(sheet: {
  id: string;
  meetingId: string;
  applicantName: string;
  currency: string;
  principalMinor: bigint;
  tenureMonths: number;
  facilityKind: string;
  interestRateBps: number | null;
  profitRateBps: number | null;
  islamicContract: string | null;
  status: string;
}) {
  return {
    id: sheet.id,
    meetingId: sheet.meetingId,
    applicantName: sheet.applicantName,
    currency: sheet.currency,
    principalMinor: sheet.principalMinor.toString(),
    principalFormatted: minorToDecimal(sheet.principalMinor),
    tenureMonths: sheet.tenureMonths,
    facilityKind: sheet.facilityKind,
    interestRateBps: sheet.interestRateBps,
    profitRateBps: sheet.profitRateBps,
    islamicContract: sheet.islamicContract,
    status: sheet.status,
  };
}

export function registerComplianceRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): void {
  app.post<{ Params: { id: string } }>(
    '/shariah-flags/:id/review',
    { preHandler: [requireAuth, requireCapability('shariah:review')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const body = ReviewBody.safeParse(request.body);
      if (!body.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'A status of UNDER_REVIEW, CLEARED or CONFIRMED_VIOLATION and a note are required.',
        );
      }

      try {
        const flag = await reviewShariahFlag(prisma, {
          flagId: request.params.id,
          reviewer: { id: actor.id, role: actor.role },
          status: body.data.status,
          note: body.data.note,
        });
        return reply.send({
          id: flag.id,
          status: flag.status,
          reviewedById: flag.reviewedById,
          reviewedAt: flag.reviewedAt?.toISOString() ?? null,
          reviewNote: flag.reviewNote,
        });
      } catch (error) {
        return handleComplianceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/meetings/:id/term-sheets',
    { preHandler: [requireAuth, requireCapability('termsheet:draft')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const body = DraftBody.safeParse(request.body);
      if (!body.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      }

      try {
        const sheet = await draftTermSheet(prisma, actor, {
          meetingId: request.params.id,
          applicantName: body.data.applicantName,
          currency: body.data.currency ?? 'MYR',
          principalMinor: BigInt(body.data.principalMinor),
          tenureMonths: body.data.tenureMonths,
          facilityKind: body.data.facilityKind,
          interestRateBps: body.data.interestRateBps ?? null,
          profitRateBps: body.data.profitRateBps ?? null,
          islamicContract: body.data.islamicContract ?? null,
        });
        return reply.code(201).send(serialiseTermSheet(sheet));
      } catch (error) {
        return handleComplianceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/term-sheets/:id/submit',
    { preHandler: [requireAuth, requireCapability('termsheet:submit')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      try {
        const approval = await submitForApproval(prisma, actor, request.params.id);
        return reply.code(201).send({
          approvalId: approval.id,
          termSheetId: approval.termSheetId,
          makerId: approval.makerId,
          decision: approval.decision,
          submittedAt: approval.submittedAt.toISOString(),
        });
      } catch (error) {
        return handleComplianceError(reply, error);
      }
    },
  );

  app.get(
    '/approvals',
    { preHandler: [requireAuth, requireCapability('meeting:read')] },
    async (_request, reply) => {
      const approvals = await prisma.approval.findMany({
        orderBy: { submittedAt: 'desc' },
        include: { termSheet: true, maker: { select: { displayName: true } } },
      });

      return reply.send({
        approvals: approvals.map((approval) => ({
          id: approval.id,
          decision: approval.decision,
          submittedAt: approval.submittedAt.toISOString(),
          decidedAt: approval.decidedAt?.toISOString() ?? null,
          makerId: approval.makerId,
          makerName: approval.maker.displayName,
          checkerId: approval.checkerId,
          note: approval.note,
          termSheet: serialiseTermSheet(approval.termSheet),
        })),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/approvals/:id/decide',
    { preHandler: [requireAuth, requireCapability('termsheet:approve')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const body = DecideBody.safeParse(request.body);
      if (!body.success) {
        return sendProblem(
          reply,
          400,
          'Invalid request',
          'A decision of APPROVED or REJECTED and a note are required.',
        );
      }

      try {
        const approval = await decideApproval(
          prisma,
          actor,
          request.params.id,
          body.data.decision,
          body.data.note,
        );
        return reply.send({
          id: approval.id,
          decision: approval.decision,
          checkerId: approval.checkerId,
          decidedAt: approval.decidedAt?.toISOString() ?? null,
          note: approval.note,
        });
      } catch (error) {
        return handleComplianceError(reply, error);
      }
    },
  );

  /**
   * The payment payload, for human download only.
   *
   * Refused unless the term sheet is APPROVED, and the download itself is
   * audited: who took a payment payload out of the system is exactly what an
   * auditor asks about later.
   */
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/term-sheets/:id/payment-payload',
    { preHandler: [requireAuth, requireCapability('termsheet:submit')] },
    async (request, reply) => {
      const actor = request.authUser;
      if (actor === undefined) {
        return sendProblem(reply, 401, 'Unauthenticated', 'A valid session is required.');
      }

      const sheet = await prisma.termSheet.findUnique({
        where: { id: request.params.id },
        include: { meeting: { select: { title: true } } },
      });
      if (sheet === null) {
        return sendProblem(reply, 404, 'Not found', 'No term sheet exists with that id.');
      }
      if (sheet.status !== 'APPROVED') {
        return sendProblem(
          reply,
          409,
          'Not approved',
          `This term sheet is ${sheet.status}. A payment payload is only produced `
          + 'for an approved facility.',
        );
      }

      const now = new Date();
      const payload = {
        messageId: `FT-${sheet.id}`,
        createdAt: now,
        // Two days out is a placeholder the maker adjusts in their own channel;
        // this system schedules nothing.
        requestedExecutionDate: new Date(now.getTime() + 2 * 86_400_000),
        initiatingParty: 'FinTalk AI',
        debtorName: 'Originating institution',
        creditorName: sheet.applicantName,
        currency: sheet.currency,
        amountMinor: sheet.principalMinor,
        endToEndId: sheet.id,
        remittanceInfo: sheet.meeting.title,
      };

      const format = request.query.format === 'csv' ? 'csv' : 'xml';

      await appendAudit(prisma, {
        at: now,
        actorId: actor.id,
        actorRole: actor.role,
        action: 'termsheet.payload.downloaded',
        entityType: 'TermSheet',
        entityId: sheet.id,
        payload: { format },
      });

      if (format === 'csv') {
        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${sheet.id}.csv"`)
          .send(buildPaymentCsv(payload));
      }

      return reply
        .type('application/xml; charset=utf-8')
        .header('content-disposition', `attachment; filename="${sheet.id}.xml"`)
        .send(buildPain001(payload));
    },
  );

  app.get(
    '/audit',
    { preHandler: [requireAuth, requireCapability('audit:read')] },
    async (_request, reply) => {
      const [entries, verdict] = await Promise.all([
        prisma.auditEntry.findMany({ orderBy: { id: 'desc' }, take: 200 }),
        verifyChain(prisma),
      ]);

      return reply.send({
        // Surfaced rather than assumed. A viewer must be able to see that the
        // chain was checked, and where it broke if it did.
        integrity: verdict.ok
          ? { ok: true, length: verdict.length }
          : {
              ok: false,
              length: verdict.length,
              brokenAtId: verdict.brokenAtId.toString(),
              reason: verdict.reason,
            },
        entries: entries.map((entry) => ({
          id: entry.id.toString(),
          at: entry.at.toISOString(),
          actorId: entry.actorId,
          actorRole: entry.actorRole,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          payload: entry.payload,
          hash: entry.hash,
          prevHash: entry.prevHash,
        })),
      });
    },
  );
}
