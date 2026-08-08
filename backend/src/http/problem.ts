import type { FastifyReply } from 'fastify';

/**
 * RFC 9457 problem responses.
 *
 * The frontend's ApiError reads `detail`, so every error path in this service
 * produces the same envelope. `detail` is written for a person and must never
 * carry personal data, a token, or a stack trace.
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
}

export function problem(status: number, title: string, detail: string): Problem {
  return { type: 'about:blank', title, status, detail };
}

export function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
): FastifyReply {
  return reply
    .code(status)
    .type(PROBLEM_CONTENT_TYPE)
    .send(problem(status, title, detail));
}
