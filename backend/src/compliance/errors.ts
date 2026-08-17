/**
 * Errors from compliance operations, each carrying the HTTP status the route
 * should answer with.
 *
 * Messages here are shown to a person and must never carry personal data. Every
 * one of these is a refusal to act, not a partial success — nothing in this
 * module family half-completes an operation.
 */

export type ComplianceErrorCode =
  | 'forbidden-role'
  | 'not-found'
  | 'note-required'
  | 'note-contains-personal-data'
  | 'already-resolved'
  | 'unresolved-shariah-flags'
  | 'self-approval'
  | 'invalid-state'
  | 'invalid-facility'
  // Transcript segment review (Phase 2).
  | 'already-confirmed'
  | 'correction-empty'
  | 'correction-identical'
  | 'correction-contains-personal-data'
  | 'viewer-read-only'
  // Mock settlement (Phase 3).
  | 'already-settled'
  | 'rail-limit-exceeded'
  // Knowledge assistant (Phase 5).
  | 'question-too-short'
  | 'question-contains-personal-data'
  | 'assistant-unavailable'
  | 'answer-contains-personal-data'
  // Term sheet suggestion (Phase 6).
  | 'suggestion-unavailable';

export class ComplianceError extends Error {
  readonly code: ComplianceErrorCode;
  readonly status: number;

  constructor(code: ComplianceErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ComplianceError';
    this.code = code;
    this.status = status;
  }
}
