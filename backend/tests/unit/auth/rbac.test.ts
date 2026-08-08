import { describe, expect, it } from 'vitest';
import { type Capability, can, capabilitiesOf } from '../../../src/auth/rbac.js';

describe('capability matrix', () => {
  it('gives a viewer read access and nothing else', () => {
    expect(can('VIEWER', 'meeting:read')).toBe(true);
    expect(can('VIEWER', 'meeting:create')).toBe(false);
    expect(can('VIEWER', 'termsheet:draft')).toBe(false);
  });

  it('lets a maker draft and submit but never approve', () => {
    expect(can('MAKER', 'termsheet:draft')).toBe(true);
    expect(can('MAKER', 'termsheet:submit')).toBe(true);
    expect(can('MAKER', 'termsheet:approve')).toBe(false);
  });

  it('lets a checker approve but never draft', () => {
    expect(can('CHECKER', 'termsheet:approve')).toBe(true);
    expect(can('CHECKER', 'termsheet:draft')).toBe(false);
  });
});

/**
 * These are safety properties, not conveniences. A Shariah finding may only be
 * resolved by a qualified Shariah reviewer, and the four-eyes rule is worthless
 * if one role can both submit and approve. Neither may be reachable by
 * escalating to an administrator.
 */
describe('compliance capabilities are not administrative', () => {
  const ALL_ROLES = ['VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN'] as const;

  it('grants shariah:review to the SHARIAH role alone', () => {
    expect(ALL_ROLES.filter((role) => can(role, 'shariah:review'))).toEqual(['SHARIAH']);
  });

  it('grants termsheet:approve to the CHECKER role alone', () => {
    expect(ALL_ROLES.filter((role) => can(role, 'termsheet:approve'))).toEqual(['CHECKER']);
  });

  it('does not let an administrator resolve a Shariah flag or move a facility', () => {
    expect(can('ADMIN', 'shariah:review')).toBe(false);
    expect(can('ADMIN', 'termsheet:approve')).toBe(false);
    expect(can('ADMIN', 'termsheet:submit')).toBe(false);
  });

  it('does not let any single role both submit and approve', () => {
    for (const role of ALL_ROLES) {
      const both = can(role, 'termsheet:submit') && can(role, 'termsheet:approve');
      expect(both, `${role} holds both sides of the four-eyes rule`).toBe(false);
    }
  });
});

describe('capabilitiesOf', () => {
  it('returns a frozen list so a caller cannot widen its own permissions', () => {
    const caps = capabilitiesOf('VIEWER');
    expect(() => (caps as Capability[]).push('user:manage')).toThrow();
  });

  it('rejects an unknown role rather than defaulting to permissive', () => {
    // @ts-expect-error exercising the runtime guard for a value the type forbids
    expect(can('SUPERUSER', 'user:manage')).toBe(false);
  });
});
