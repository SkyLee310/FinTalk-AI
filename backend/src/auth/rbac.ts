import type { Role } from '@prisma/client';

/**
 * Capabilities, granted per role.
 *
 * Two grants in this table are safety properties rather than convenience:
 * `shariah:review` belongs to SHARIAH alone, and `termsheet:approve` to CHECKER
 * alone. Neither is administrative, so ADMIN does not hold them — an
 * administrator can manage users and read the audit log, but cannot clear a
 * Shariah finding or move a facility forward. Tests assert both, and assert
 * that no single role holds both sides of the four-eyes rule.
 */

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

const CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = Object.freeze({
  VIEWER: Object.freeze<Capability[]>(['meeting:read', 'transcript:read']),

  MAKER: Object.freeze<Capability[]>([
    'meeting:create',
    'meeting:read',
    'transcript:read',
    'termsheet:draft',
    'termsheet:submit',
  ]),

  CHECKER: Object.freeze<Capability[]>([
    'meeting:read',
    'transcript:read',
    'termsheet:approve',
  ]),

  SHARIAH: Object.freeze<Capability[]>([
    'meeting:read',
    'transcript:read',
    'shariah:review',
  ]),

  SUPERVISOR: Object.freeze<Capability[]>([
    'meeting:read',
    'transcript:read',
    'audit:read',
  ]),

  ADMIN: Object.freeze<Capability[]>(['meeting:read', 'audit:read', 'user:manage']),
});

const NONE: readonly Capability[] = Object.freeze<Capability[]>([]);

/** Frozen, so a caller cannot widen its own permissions by mutating the list. */
export function capabilitiesOf(role: Role): readonly Capability[] {
  return CAPABILITIES[role] ?? NONE;
}

/**
 * Denies by default. An unrecognised role — one arriving from a stale token
 * after the enum changed — gets nothing rather than everything.
 */
export function can(role: Role, capability: Capability): boolean {
  return capabilitiesOf(role).includes(capability);
}
