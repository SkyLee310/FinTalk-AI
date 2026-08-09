import { apiFetch } from './api-client';

/**
 * Typed surface over the backend.
 *
 * Money arrives as a string and stays a string. Turning `principalMinor` into a
 * JavaScript number here would silently drop cents above 2^53, and a facility
 * amount is not a place to lose precision for convenience.
 */

export type Role = 'VIEWER' | 'MAKER' | 'CHECKER' | 'SHARIAH' | 'SUPERVISOR' | 'ADMIN';

export type Capability =
  | 'meeting:create'
  | 'meeting:read'
  | 'transcript:read'
  | 'shariah:review'
  | 'termsheet:draft'
  | 'termsheet:submit'
  | 'termsheet:approve'
  | 'audit:read'
  | 'user:manage';

export interface Session {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  capabilities: Capability[];
}

export type MeetingStatus = 'CAPTURED' | 'PROCESSING' | 'READY' | 'FAILED';
export type ShariahStatus = 'FLAGGED' | 'UNDER_REVIEW' | 'CLEARED' | 'CONFIRMED_VIOLATION';
export type FacilityKind = 'CONVENTIONAL' | 'ISLAMIC';
export type ApprovalStatus =
  | 'DRAFT'
  | 'PENDING_CHECKER'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface MeetingSummary {
  id: string;
  title: string;
  occurredAt: string;
  status: MeetingStatus;
  consentConfirmed: boolean;
  shariahFlagCount: number;
  termSheetCount: number;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  speakerLabel: string;
  textRedacted: string;
}

export interface RedactionRow {
  id: string;
  piiType: string;
  placeholder: string;
  startOffset: number;
  endOffset: number;
  detectedBy: string;
  confidence: number;
}

export interface WhiteboardRow {
  id: string;
  /** The canonical redacted text. Redaction offsets index into this. */
  rawRedacted: string;
  mermaid: string;
  structuredJson: unknown;
  modelId: string;
  promptVersion: string;
  createdAt: string;
  redactions: RedactionRow[];
}

export interface ShariahFlagRow {
  id: string;
  issueType: string;
  excerpt: string;
  detectedBy: string;
  confidence: number;
  reference: string;
  status: ShariahStatus;
}

export interface MeetingDetail {
  id: string;
  title: string;
  occurredAt: string;
  status: MeetingStatus;
  failureReason: string | null;
  consentConfirmed: boolean;
  transcript: {
    id: string;
    rawRedacted: string;
    summaryEn: string;
    languages: string[];
    modelId: string;
    promptVersion: string;
    segments: TranscriptSegment[];
    redactions: RedactionRow[];
  } | null;
  shariahFlags: ShariahFlagRow[];
}

export interface TermSheetRow {
  id: string;
  meetingId: string;
  applicantName: string;
  currency: string;
  /** Minor units, as a string. Never parsed into a number. */
  principalMinor: string;
  principalFormatted: string;
  tenureMonths: number;
  facilityKind: FacilityKind;
  interestRateBps: number | null;
  profitRateBps: number | null;
  islamicContract: string | null;
  status: ApprovalStatus;
}

export interface ApprovalRow {
  id: string;
  decision: ApprovalStatus;
  submittedAt: string;
  decidedAt: string | null;
  makerId: string;
  makerName: string;
  checkerId: string | null;
  note: string | null;
  termSheet: TermSheetRow;
}

export interface AuditRow {
  id: string;
  at: string;
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  hash: string;
  prevHash: string;
}

export interface AuditIntegrity {
  ok: boolean;
  length: number;
  brokenAtId?: string;
  reason?: string;
}

export interface DraftTermSheetBody {
  applicantName: string;
  currency?: string;
  principalMinor: string;
  tenureMonths: number;
  facilityKind: FacilityKind;
  interestRateBps?: number | null;
  profitRateBps?: number | null;
  islamicContract?: string | null;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export const api = {
  login: (email: string, password: string) =>
    apiFetch<Session>('/auth/login', json({ email, password })),

  me: () => apiFetch<Session>('/auth/me'),

  logout: () => apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  meetings: () => apiFetch<{ meetings: MeetingSummary[] }>('/meetings'),

  meeting: (id: string) => apiFetch<MeetingDetail>(`/meetings/${id}`),

  /**
   * Returns as soon as the recording is accepted, not when it is processed.
   * Transcription takes minutes and the platform closes a request at 300
   * seconds, so the caller polls `meeting(meetingId)` until status leaves
   * CAPTURED/PROCESSING.
   */
  uploadMeeting: (form: FormData) =>
    apiFetch<{ meetingId: string; status: MeetingStatus; pollUrl: string }>('/meetings', {
      method: 'POST',
      body: form,
    }),

  whiteboards: (meetingId: string) =>
    apiFetch<{ whiteboards: WhiteboardRow[] }>(`/meetings/${meetingId}/whiteboards`),

  reviewFlag: (flagId: string, status: ShariahStatus, note: string) =>
    apiFetch<ShariahFlagRow>(`/shariah-flags/${flagId}/review`, json({ status, note })),

  draftTermSheet: (meetingId: string, body: DraftTermSheetBody) =>
    apiFetch<TermSheetRow>(`/meetings/${meetingId}/term-sheets`, json(body)),

  submitTermSheet: (termSheetId: string) =>
    apiFetch<{ approvalId: string; decision: string }>(
      `/term-sheets/${termSheetId}/submit`,
      { method: 'POST' },
    ),

  approvals: () => apiFetch<{ approvals: ApprovalRow[] }>('/approvals'),

  decide: (approvalId: string, decision: 'APPROVED' | 'REJECTED', note: string) =>
    apiFetch<{ id: string; decision: string }>(
      `/approvals/${approvalId}/decide`,
      json({ decision, note }),
    ),

  audit: () => apiFetch<{ integrity: AuditIntegrity; entries: AuditRow[] }>('/audit'),
};

export function can(session: Session | null, capability: Capability): boolean {
  return session?.capabilities.includes(capability) ?? false;
}

/** Formats a millisecond offset as m:ss for the transcript gutter. */
export function timecode(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, '0')}`;
}
