import { describe, expect, it } from 'vitest';
import { type Capability, can, capabilitiesOf } from '../../../src/auth/rbac.js';

describe('capability matrix', () => {
  it('lets a maker draft and submit but never approve', () => {
    expect(can({ role: 'MAKER' }, 'termsheet:draft')).toBe(true);
    expect(can({ role: 'MAKER' }, 'termsheet:submit')).toBe(true);
    expect(can({ role: 'MAKER' }, 'termsheet:approve')).toBe(false);
  });

  it('lets a checker approve but never draft', () => {
    expect(can({ role: 'CHECKER' }, 'termsheet:approve')).toBe(true);
    expect(can({ role: 'CHECKER' }, 'termsheet:draft')).toBe(false);
  });

  it('grants VIEWER and SUPERVISOR nothing — both are superseded by OVERSIGHT', () => {
    for (const role of ['VIEWER', 'SUPERVISOR'] as const) {
      expect(capabilitiesOf({ role })).toEqual([]);
    }
  });
});

/**
 * OVERSIGHT is not a fixed list — its grants come from two per-account flags
 * rather than the role alone. These are the properties that make the split
 * meaningful: neither flag implies the other, and neither is on by default.
 */
describe('OVERSIGHT capabilities', () => {
  it('grants nothing when both flags are false', () => {
    expect(
      capabilitiesOf({ role: 'OVERSIGHT', canViewMeetings: false, canViewAuditTrail: false }),
    ).toEqual([]);
  });

  it('grants only meeting:read and transcript:read when canViewMeetings is set alone', () => {
    const caps = capabilitiesOf({ role: 'OVERSIGHT', canViewMeetings: true, canViewAuditTrail: false });
    expect(caps).toContain('meeting:read');
    expect(caps).toContain('transcript:read');
    expect(caps).not.toContain('audit:read');
  });

  it('grants only audit:read and user:read when canViewAuditTrail is set alone', () => {
    const caps = capabilitiesOf({ role: 'OVERSIGHT', canViewMeetings: false, canViewAuditTrail: true });
    expect(caps).toEqual(['audit:read', 'user:read']);
  });

  it('grants all four when both flags are set', () => {
    const caps = capabilitiesOf({ role: 'OVERSIGHT', canViewMeetings: true, canViewAuditTrail: true });
    expect(caps).toContain('meeting:read');
    expect(caps).toContain('transcript:read');
    expect(caps).toContain('audit:read');
    expect(caps).toContain('user:read');
  });

  it('never grants user:manage, under any flag combination', () => {
    for (const canViewMeetings of [false, true]) {
      for (const canViewAuditTrail of [false, true]) {
        expect(can({ role: 'OVERSIGHT', canViewMeetings, canViewAuditTrail }, 'user:manage')).toBe(false);
      }
    }
  });

  it('ignores the two flags for every role but OVERSIGHT', () => {
    // A stray canViewAuditTrail: true must not leak audit:read onto MAKER.
    expect(can({ role: 'MAKER', canViewAuditTrail: true }, 'audit:read')).toBe(false);
  });
});

/**
 * These are safety properties, not conveniences. A Shariah finding may only be
 * resolved by a qualified Shariah reviewer, and the four-eyes rule is worthless
 * if one role can both submit and approve. Neither may be reachable by
 * escalating to an administrator.
 */
describe('compliance capabilities are not administrative', () => {
  const ALL_ROLES = ['VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN', 'OVERSIGHT'] as const;

  it('grants shariah:review to the SHARIAH role alone', () => {
    expect(ALL_ROLES.filter((role) => can({ role }, 'shariah:review'))).toEqual(['SHARIAH']);
  });

  it('grants termsheet:approve to the CHECKER role alone', () => {
    expect(ALL_ROLES.filter((role) => can({ role }, 'termsheet:approve'))).toEqual(['CHECKER']);
  });

  it('does not let an administrator resolve a Shariah flag, move a facility, read a transcript, or read the audit trail', () => {
    expect(can({ role: 'ADMIN' }, 'shariah:review')).toBe(false);
    expect(can({ role: 'ADMIN' }, 'termsheet:approve')).toBe(false);
    expect(can({ role: 'ADMIN' }, 'termsheet:submit')).toBe(false);
    // The separation-of-duties property this redesign turns on: an
    // administrator who manages permissions must not also be able to read
    // the trail meant to catch abuse of them.
    expect(can({ role: 'ADMIN' }, 'audit:read')).toBe(false);
    expect(can({ role: 'ADMIN' }, 'transcript:read')).toBe(false);
  });

  it('does not let any single role both submit and approve', () => {
    for (const role of ALL_ROLES) {
      const both = can({ role }, 'termsheet:submit') && can({ role }, 'termsheet:approve');
      expect(both, `${role} holds both sides of the four-eyes rule`).toBe(false);
    }
  });

  it('does not let any static role hold both user:manage and audit:read', () => {
    for (const role of ['VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN'] as const) {
      const both = can({ role }, 'user:manage') && can({ role }, 'audit:read');
      expect(both, `${role} holds both sides of the separation-of-duties rule`).toBe(false);
    }
  });
});

describe('capabilitiesOf', () => {
  it('returns a frozen list so a caller cannot widen its own permissions', () => {
    const caps = capabilitiesOf({ role: 'MAKER' });
    expect(() => (caps as Capability[]).push('user:manage')).toThrow();
  });

  it('rejects an unknown role rather than defaulting to permissive', () => {
    // @ts-expect-error exercising the runtime guard for a value the type forbids
    expect(can({ role: 'SUPERUSER' }, 'user:manage')).toBe(false);
  });
});
