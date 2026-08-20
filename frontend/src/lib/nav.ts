import { can, type Capability, type Session } from './api';

/**
 * Navigation named after the work, not after the tables.
 *
 * The old nav read Meetings / Approvals / Audit — three nouns that told a tester
 * nothing about what to do or in what order, which is what "unclear direction"
 * meant. These five are the stages of the actual process: capture it, review it,
 * decide on it, look across all of it, administer who may do any of that.
 *
 * This lives in lib rather than in the layout because both AppSidebar and the
 * shell's landing-page choice read the same list. Sending someone to a page
 * their own nav does not contain strands them: an ADMIN landed on /meetings,
 * could read the list, and then had no link back after navigating away. One
 * list, every consumer, no drift.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  /** Visible when the session holds any one of these. */
  readonly needs: readonly Capability[];
  /**
   * Extra path prefixes this section owns, for pages whose URL predates the
   * grouping. /audit keeps its address — a section rename is no reason to break a
   * bookmark or an audit link someone pasted into a ticket — but it belongs under
   * Administration, so highlighting has to know that.
   */
  readonly owns?: readonly string[];
}

export const NAV: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    hint: 'Your pending actions at a glance',
    needs: ['meeting:read'],
  },
  {
    href: '/meetings',
    label: 'Review Meetings',
    hint: 'Transcripts, redactions and Shariah findings',
    needs: ['transcript:read'],
  },
  {
    href: '/record',
    label: 'Capture',
    hint: 'Record or upload a meeting',
    needs: ['meeting:create'],
  },
  {
    href: '/approvals',
    label: 'Decide',
    hint: 'Term sheets, approvals and settlement',
    needs: ['termsheet:draft', 'termsheet:approve'],
  },
  {
    href: '/knowledge',
    label: 'Knowledge Graph',
    hint: 'Ask across every meeting, and see how they connect',
    needs: ['transcript:read'],
  },
  {
    href: '/admin',
    label: 'Administration',
    hint: 'Users, audit trail and system health',
    needs: ['user:manage', 'audit:read'],
    owns: ['/audit'],
  },
  /**
   * Reference, not a stage of the process — positioned last for that reason.
   * `meeting:read` is the one capability every active role holds, so Islamic
   * Banking shows for everyone in the sidebar automatically.
   */
  {
    href: '/islamic-banking',
    label: 'Islamic Banking',
    hint: 'Shariah principles, and what can flag a facility',
    needs: ['meeting:read'],
  },
];

/** True when the current path belongs to this section. */
export function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = [item.href, ...(item.owns ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The sections this session may use. A nav item that 403s is worse than none. */
export function visibleNav(session: Session | null): readonly NavItem[] {
  return NAV.filter((item) => item.needs.some((capability) => can(session, capability)));
}
