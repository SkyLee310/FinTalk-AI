import type { Role } from '@prisma/client';

/**
 * Capabilities, granted per role — except OVERSIGHT, which grants nothing of
 * its own. OVERSIGHT's capabilities come from two independent per-account
 * flags on User (canViewMeetings, canViewAuditTrail) instead of a fixed list,
 * because it replaces two former roles (VIEWER, SUPERVISOR) that differed
 * only in whether the audit trail was included.
 *
 * ADMIN deliberately holds neither `transcript:read` nor `audit:read`. The
 * capability to manage permissions (`user:manage`) and the capability to
 * watch for abuse of permissions (`audit:read`) are kept apart on purpose: a
 * role holding both could grant itself access, then read the one record that
 * would show it happened. That visibility belongs to OVERSIGHT, whose holder
 * cannot also change who holds what.
 *
 * Two more grants are safety properties rather than convenience: `shariah:review`
 * belongs to SHARIAH alone, and `termsheet:approve` to CHECKER alone. Tests
 * assert both, and assert that no single role holds both sides of the
 * four-eyes rule.
 */

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

/**
 * What capabilitiesOf/can need for OVERSIGHT, beyond the role itself. Every
 * other role ignores these two fields. OVERSIGHT reads them off the User
 * row's canViewMeetings/canViewAuditTrail columns, carried into the access
 * token at sign-in the same way role already is (see auth/tokens.ts).
 */
export interface CapabilityContext {
  readonly role: Role;
  readonly canViewMeetings?: boolean;
  readonly canViewAuditTrail?: boolean;
}

const NONE: readonly Capability[] = Object.freeze<Capability[]>([]);

const CAPABILITIES: Readonly<Record<Exclude<Role, 'OVERSIGHT'>, readonly Capability[]>> =
  Object.freeze({
    /**
     * VIEWER and SUPERVISOR are superseded, not folded into another role's
     * list. The enum keeps their values because AuditEntry.actorRole is
     * append-only and hash-chained — historical rows still name them and must
     * stay valid — but nothing new is assigned either, and both grant
     * nothing here. can() denies by default, so a stale token carrying one
     * gets no access rather than its old access. VIEWER's bundle
     * (meeting:read + transcript:read) became OVERSIGHT's canViewMeetings;
     * SUPERVISOR's extra audit:read became canViewAuditTrail.
     */
    VIEWER: NONE,

    MAKER: Object.freeze<Capability[]>([
      'meeting:create',
      'meeting:read',
      'transcript:read',
      'termsheet:draft',
      'termsheet:submit',
    ]),

    /**
     * `payment:settle` sits with CHECKER by the product owner's decision.
     *
     * It does not weaken four-eyes: CHECKER still holds neither `termsheet:draft`
     * nor `termsheet:submit`, so the person who wrote the facility is still never
     * the person who approves or settles it. The service narrows it further —
     * only the checker who actually approved that facility may settle it, so a
     * second checker cannot release money against a decision they never read.
     */
    CHECKER: Object.freeze<Capability[]>([
      'meeting:read',
      'transcript:read',
      'termsheet:approve',
      'payment:settle',
    ]),

    SHARIAH: Object.freeze<Capability[]>([
      'meeting:read',
      'transcript:read',
      'shariah:review',
    ]),

    SUPERVISOR: NONE,

    /**
     * Governs access only — see the file header for why transcript:read and
     * audit:read are both withheld. An administrator can grant an OVERSIGHT
     * account audit visibility, but cannot read the audit trail itself, and
     * cannot read a transcript either.
     */
    ADMIN: Object.freeze<Capability[]>(['meeting:read', 'user:manage', 'user:read']),
  });

const OVERSIGHT_MEETINGS: readonly Capability[] = Object.freeze<Capability[]>([
  'meeting:read',
  'transcript:read',
]);
const OVERSIGHT_AUDIT: readonly Capability[] = Object.freeze<Capability[]>([
  'audit:read',
  'user:read',
]);

/** Frozen, so a caller cannot widen its own permissions by mutating the list. */
export function capabilitiesOf(context: CapabilityContext): readonly Capability[] {
  if (context.role === 'OVERSIGHT') {
    if (context.canViewMeetings === true && context.canViewAuditTrail === true) {
      return Object.freeze([...OVERSIGHT_MEETINGS, ...OVERSIGHT_AUDIT]);
    }
    if (context.canViewMeetings === true) return OVERSIGHT_MEETINGS;
    if (context.canViewAuditTrail === true) return OVERSIGHT_AUDIT;
    return NONE;
  }
  return CAPABILITIES[context.role] ?? NONE;
}

/**
 * Denies by default. An unrecognised role — one arriving from a stale token
 * after the enum changed — gets nothing rather than everything.
 */
export function can(context: CapabilityContext, capability: Capability): boolean {
  return capabilitiesOf(context).includes(capability);
}
