import { apiFetch } from './api-client';

/**
 * Typed surface over the backend.
 *
 * Money arrives as a string and stays a string. Turning `principalMinor` into a
 * JavaScript number here would silently drop cents above 2^53, and a facility
 * amount is not a place to lose precision for convenience.
 */

// Mirrors the backend Prisma Role enum, which keeps all six values for audit-chain
// integrity. VIEWER and SUPERVISOR are retired — nothing new is assigned either
// (see the admin invite form) — but an audit row may still name one as a historical
// actor, so the display type keeps them.
/**
 * VIEWER and SUPERVISOR are superseded by OVERSIGHT, not assignable to a new
 * or changed account (see backend/src/routes/users.routes.ts's ROLES const)
 * — kept here only because an audit row can still name one as its actor.
 */
export type Role =
  | 'VIEWER'
  | 'MAKER'
  | 'CHECKER'
  | 'SHARIAH'
  | 'SUPERVISOR'
  | 'ADMIN'
  | 'OVERSIGHT';

/** PENDING has no role and no session; ACTIVE can sign in. Set by POST /auth/register and PATCH /users/:id/approve. */
export type AccountStatus = 'PENDING' | 'ACTIVE';

export type Capability =
  | 'meeting:create'
  | 'meeting:read'
  | 'transcript:read'
  | 'shariah:review'
  | 'termsheet:draft'
  | 'termsheet:submit'
  | 'termsheet:approve'
  | 'payment:settle'
  | 'audit:read'
  | 'user:read'
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
  transferAcknowledged: boolean;
  shariahFlagCount: number;
  termSheetCount: number;
  /** Sent by GET /meetings since the archive route shipped — who may archive this row. */
  createdById: string;
}

/**
 * Mirrors LOW_CONFIDENCE_THRESHOLD in backend/src/ai/provider.ts.
 *
 * Duplicated rather than fetched, because the client needs it to render before
 * any request completes. Two values that drifted apart would mark a segment for
 * review on the server and not in the UI, so the backend constant carries a
 * pointer back to this one.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface SegmentCorrection {
  id: string;
  editorId: string;
  /** What the reviewer says was actually said. Never replaces the AI's text. */
  humanValue: string;
  editedAt: string;
}

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  speakerLabel: string;
  textRedacted: string;
  /**
   * The model's self-reported certainty, 0–1, or null for "not scored".
   *
   * Null is not zero and not one. A segment transcribed before scoring existed
   * has no opinion attached, and rendering it as either extreme would invent
   * one. Not a calibrated probability — never label it "accuracy".
   */
  confidence: number | null;
  confirmedById: string | null;
  confirmedAt: string | null;
  corrections: SegmentCorrection[];
}

export interface ParticipantRow {
  id: string;
  /** A placeholder such as [PERSON_NAME_1]. Never the name itself. */
  nameRedacted: string;
  role: string | null;
}

/** True when a human should be asked to check this segment. */
export function needsReview(segment: TranscriptSegment): boolean {
  return (
    segment.confirmedAt === null
    && segment.confidence !== null
    && segment.confidence < LOW_CONFIDENCE_THRESHOLD
  );
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

export type WhiteboardKind = 'WHITEBOARD' | 'SLIDE' | 'DOCUMENT';

/** Shared with the capture flow, so an attachment is tagged the same word throughout. */
export const WHITEBOARD_KIND_LABEL: Record<WhiteboardKind, string> = {
  WHITEBOARD: 'Whiteboard',
  SLIDE: 'Slide',
  DOCUMENT: 'Document',
};

export interface WhiteboardRow {
  id: string;
  kind: WhiteboardKind;
  /** The canonical redacted text. Redaction offsets index into this. */
  rawRedacted: string;
  /** Null for a DOCUMENT capture — a Word file has no diagram to draw. */
  mermaid: string | null;
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
  /** Which transcript segment to scroll to for "jump to transcript", or null. */
  segmentId: string | null;
  /** The phrase(s) matched within `excerpt`, for highlighting. */
  highlights: string[];
}

/** The final decision a debated point reached, or "left unresolved" — arbiter output. */
export interface DecisionRow {
  id: string;
  topic: string;
  decision: string;
  rationale: string;
}

/** Who/what/when. `owner` is a role or speaker label — redaction means it is never a name. */
export interface ActionItemRow {
  id: string;
  owner: string;
  task: string;
  dueDate: string | null;
}

export interface MeetingDetail {
  id: string;
  title: string;
  description: string | null;
  participants: ParticipantRow[];
  occurredAt: string;
  status: MeetingStatus;
  failureReason: string | null;
  consentConfirmed: boolean;
  transferAcknowledged: boolean;
  transcript: {
    id: string;
    rawRedacted: string;
    summaryEn: string;
    languages: string[];
    modelId: string;
    promptVersion: string;
    /** Milliseconds the capture pipeline took, or null if it predates timing. */
    processingMs: number | null;
    /** Null when no provider produced one, or a PII check skipped it — never an error. */
    projectKickoff: string | null;
    followUps: string[];
    segments: TranscriptSegment[];
    redactions: RedactionRow[];
  } | null;
  shariahFlags: ShariahFlagRow[];
  /** Size of the rule set the engine screened against, for the findings header. */
  shariahRuleCount: number;
  /** The final decision each debated point reached, arbiter output. Empty is normal, not a failure. */
  decisions: DecisionRow[];
  /** Who/what/when. Empty is normal, not a failure. */
  actionItems: ActionItemRow[];
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

export type SettlementRail = 'DUITNOW' | 'RENTAS';

/**
 * A simulated settlement. No money moved and no bank was contacted.
 *
 * `simulated` arrives from the server rather than being assumed here, so the UI
 * cannot go on claiming a row is a mock if that ever stopped being true.
 */
export interface SettlementRow {
  id: string;
  rail: SettlementRail;
  /** Always prefixed MOCK-. A database CHECK enforces it. */
  mockReference: string;
  /** Minor units, as a string. Never parsed into a number. */
  amountMinor: string;
  amountFormatted: string;
  currency: string;
  settledAt: string;
  simulated: boolean;
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
  /** Null until the approving checker records a settlement. */
  settlement: SettlementRow | null;
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

export interface GraphNode {
  meetingId: string;
  title: string;
  occurredAt: string;
  status: string;
  termSheetCount: number;
  openFindingCount: number;
  /** Topic labels. Never a person — see the backend graph module for why. */
  topics: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  /** 0–1. Drives line weight only; not a probability of anything. */
  strength: number;
  /** Why this edge exists, checkable against the two meetings. */
  reason: string;
  sharedTopics: string[];
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when no embedding model is configured, so edges rest on topics alone. */
  similarityUnavailable: boolean;
}

export interface AskCitation {
  meetingId: string;
  title: string;
  occurredAt: string;
  score: number;
}

/** Mirrors backend/src/knowledge/assistant.ts's AskHistoryTurn — the wire shape for one prior turn. */
export interface AskHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskAnswer {
  answer: string;
  citations: AskCitation[];
  /** True when the corpus does not answer the question. Never a guess instead. */
  unanswerable: boolean;
  modelId: string;
  promptVersion: string;
  /**
   * How the cited meetings were found. `keyword` means the deployment could
   * not search by meaning and fell back to matching words, which the panel
   * says out loud rather than letting the two look alike.
   */
  retrieval: 'semantic' | 'keyword';
}

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  /** Null until an admin approves a PENDING registration (PATCH /users/:id/approve). */
  role: Role | null;
  accountStatus: AccountStatus;
  /** Collected at registration. Null for an admin-created account that predates it. */
  username: string | null;
  staffId: string | null;
  createdAt: string;
  /** Null means active. A deactivated account cannot sign in. */
  deactivatedAt: string | null;
  /** Meaningful only when role is 'OVERSIGHT'; false and ignored otherwise. */
  canViewMeetings: boolean;
  /** Meaningful only when role is 'OVERSIGHT'; false and ignored otherwise. */
  canViewAuditTrail: boolean;
  /** What this role permits, so the UI need not restate the matrix. Empty for a PENDING row, which holds none. */
  capabilities: Capability[];
}

export type FeedbackCategory = 'BUG' | 'IDEA' | 'OTHER';

/** What POST /feedback echoes back — never the message, which the submitter already has. */
export interface FeedbackReceipt {
  id: string;
  category: FeedbackCategory;
  createdAt: string;
}

/** One submission, as GET /feedback returns it to an administrator. */
export interface FeedbackRow {
  id: string;
  category: FeedbackCategory;
  message: string;
  createdAt: string;
  author: {
    displayName: string;
    email: string;
    /** Never null in practice: a PENDING account has no role and never receives a session. */
    role: Role;
  };
}

export interface AuditIntegrity {
  ok: boolean;
  length: number;
  brokenAtId?: string;
  reason?: string;
}

export interface RegisterBody {
  displayName: string;
  email: string;
  password: string;
  username: string;
  staffId: string;
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

/**
 * A model's read of a meeting's redacted transcript and whiteboards, for a
 * maker to review before drafting — never a term sheet itself. Every field
 * but modelId/promptVersion is optional: the meeting may never have settled
 * a given fact, and an absent key means exactly that, not zero or "".
 */
export interface TermSheetSuggestion {
  applicantName?: string;
  /** Whole ringgit, as a string — see the module note. */
  principalMyr?: string;
  tenureMonths?: number;
  facilityKind?: FacilityKind;
  rateBps?: number;
  islamicContract?: string;
  modelId: string;
  promptVersion: string;
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

  /**
   * Self-service registration. Always comes back PENDING — there is no
   * session to grant yet, since a PENDING account has no role. An
   * administrator assigns one via the pending-approval queue.
   */
  register: (body: RegisterBody) =>
    apiFetch<{ accountStatus: AccountStatus }>('/auth/register', json(body)),

  meetings: () => apiFetch<{ meetings: MeetingSummary[] }>('/meetings'),

  meeting: (id: string) => apiFetch<MeetingDetail>(`/meetings/${id}`),

  /**
   * Archive, never delete — hides it from meetings() while every row that
   * references it (term sheet, approval, settlement, Shariah flag,
   * transcript) keeps resolving it normally. The server also enforces
   * creator-only; this is not the only gate.
   */
  archiveMeeting: async (id: string): Promise<void> => {
    await apiFetch<{ ok: boolean }>(`/meetings/${id}/archive`, { method: 'PATCH' });
  },

  /** Hard delete — the row and everything under it is gone, not archived. */
  deleteMeeting: async (id: string): Promise<void> => {
    await apiFetch<{ ok: boolean }>(`/meetings/${id}`, { method: 'DELETE' });
  },

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

  /**
   * Extracts a photographed whiteboard into the meeting record.
   *
   * Unlike the audio upload this waits for the result: vision extraction on one
   * still image takes seconds, not the minutes transcription takes, so there is
   * nothing to poll for.
   */
  uploadWhiteboard: (meetingId: string, form: FormData) =>
    apiFetch<{ whiteboardId: string; redactionCount: number }>(
      `/meetings/${meetingId}/whiteboards`,
      { method: 'POST', body: form },
    ),

  whiteboards: (meetingId: string) =>
    apiFetch<{ whiteboards: WhiteboardRow[] }>(`/meetings/${meetingId}/whiteboards`),

  /**
   * Records that a human read a low-confidence segment and found it correct.
   * Distinct from a correction: this asserts the model was right.
   */
  confirmSegment: (segmentId: string) =>
    apiFetch<TranscriptSegment>(`/transcript-segments/${segmentId}/confirm`, {
      method: 'POST',
    }),

  /**
   * Records a correction beside the model's text. The AI's version is never
   * overwritten — the redaction log's offsets index into it.
   */
  correctSegment: (segmentId: string, correctedText: string) =>
    apiFetch<TranscriptSegment>(
      `/transcript-segments/${segmentId}/correct`,
      json({ correctedText }),
    ),

  reviewFlag: (flagId: string, status: ShariahStatus, note: string) =>
    apiFetch<ShariahFlagRow>(`/shariah-flags/${flagId}/review`, json({ status, note })),

  /**
   * A model's read of the meeting's redacted transcript and whiteboards, for
   * a maker to review before drafting. Never stored, never submitted on its
   * own — see applySuggestion in lib/term-sheet-suggestion.ts for how a
   * maker's already-typed fields are merged with it.
   */
  suggestTermSheet: (meetingId: string) =>
    apiFetch<TermSheetSuggestion>(`/meetings/${meetingId}/term-sheets/suggestion`, {
      method: 'POST',
    }),

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

  /**
   * Records a **simulated** settlement against an approved facility.
   *
   * No amount is sent: the server copies it from the approved term sheet, so a
   * request cannot settle a different figure from the one the checker approved.
   */
  settle: (termSheetId: string, rail: SettlementRail) =>
    apiFetch<SettlementRow>(`/term-sheets/${termSheetId}/settle`, json({ rail })),

  knowledgeGraph: () => apiFetch<KnowledgeGraph>('/knowledge/graph'),

  /**
   * Asks a question of the stored meetings.
   *
   * Answers come only from redacted transcripts the corpus actually contains. The
   * vault is never opened, so no question can retrieve an identifier — and a
   * question containing one is refused rather than searched, because a placeholder
   * could never match it anyway.
   */
  /**
   * `history` is capped at 10 turns server-side (AskBody.history.max(10));
   * callers slice before sending so a full conversation never 400s on a
   * bound the client could have respected. Omitted entirely (not sent as
   * an empty array) when there is no prior turn, so a first question is
   * byte-identical to the pre-history request shape.
   */
  ask: (question: string, history?: readonly AskHistoryTurn[]) =>
    apiFetch<AskAnswer>('/knowledge/ask', json({ question, history })),

  users: () => apiFetch<{ users: ManagedUser[] }>('/users'),

  /**
   * Invites a user. No password is sent or returned — the server mints a random
   * one nobody reads, so the account is unusable until its owner sets their own.
   */
  /**
   * `oversight` is only meaningful when role is 'OVERSIGHT' — the two flags
   * an admin ticks to grant that account meeting/transcript visibility,
   * audit-trail visibility, or both. Omitted (both false) for every other role.
   */
  createUser: (
    email: string,
    displayName: string,
    role: Role,
    oversight?: { canViewMeetings: boolean; canViewAuditTrail: boolean },
  ) =>
    apiFetch<ManagedUser>(
      '/users',
      json({
        email,
        displayName,
        role,
        canViewMeetings: oversight?.canViewMeetings ?? false,
        canViewAuditTrail: oversight?.canViewAuditTrail ?? false,
      }),
    ),

  /**
   * Also how an existing OVERSIGHT account's two flags are edited without
   * changing its role — pass the same role back with new flags.
   */
  setUserRole: (
    id: string,
    role: Role,
    oversight?: { canViewMeetings: boolean; canViewAuditTrail: boolean },
  ) =>
    apiFetch<ManagedUser>(`/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({
        role,
        canViewMeetings: oversight?.canViewMeetings ?? false,
        canViewAuditTrail: oversight?.canViewAuditTrail ?? false,
      }),
    }),

  /** Deactivates or restores access. Never deletes — audit entries name the user. */
  setUserActive: (id: string, active: boolean) =>
    apiFetch<ManagedUser>(`/users/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  /** Grants a role to a PENDING registration and flips it to ACTIVE — it can sign in immediately after. */
  approveUser: (
    id: string,
    role: Role,
    oversight?: { canViewMeetings: boolean; canViewAuditTrail: boolean },
  ) =>
    apiFetch<ManagedUser>(`/users/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify({
        role,
        canViewMeetings: oversight?.canViewMeetings ?? false,
        canViewAuditTrail: oversight?.canViewAuditTrail ?? false,
      }),
    }),

  /**
   * Deletes the PENDING row outright — the one real delete in this app, safe
   * only because nothing may yet reference an unapproved registration. The
   * audit trail keeps the submitted details; the row itself does not survive.
   */
  rejectUser: async (id: string): Promise<void> => {
    await apiFetch<{ ok: boolean }>(`/users/${id}/reject`, { method: 'PATCH' });
  },

  audit: () => apiFetch<{ integrity: AuditIntegrity; entries: AuditRow[] }>('/audit'),

  /** Open to any signed-in role — gating this on a capability would silence the accounts most worth hearing from. */
  submitFeedback: (category: FeedbackCategory, message: string) =>
    apiFetch<FeedbackReceipt>('/feedback', json({ category, message })),

  /** Gated server-side on user:manage. Newest first. */
  feedback: () => apiFetch<{ feedback: FeedbackRow[] }>('/feedback'),
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
