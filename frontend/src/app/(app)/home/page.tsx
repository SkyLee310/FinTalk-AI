'use client';

import Link from 'next/link';
import { Card } from '@/components/card';
import { PageHeader, Spinner, Stat } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import {
  api,
  can,
  type ApprovalRow,
  type AuditRow,
  type ManagedUser,
  type MeetingSummary,
  type Session,
} from '@/lib/api';
import { gridColumnClass } from '@/lib/grid';
import { visibleNav } from '@/lib/nav';

/**
 * A chooser, not a guess.
 *
 * Every session lands here after signing in — the nav bar's own list, shown once
 * as full cards before it shrinks to a row of labels. A role with more than one
 * visible section used to discover the rest only by noticing the nav bar; here
 * all of them are in view from the first screen.
 *
 * No role currently holds zero of the capabilities `visibleNav` checks, but the
 * fallback card exists anyway: every role holds `meeting:read`, and a chooser
 * with nothing on it would be worse than a chooser pointing at the one thing
 * everyone can open.
 */
const FALLBACK: ReadonlyArray<{ href: string; label: string; hint: string }> = [
  { href: '/meetings', label: 'Meetings', hint: 'Browse what has been captured so far.' },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the role-specific stat row needs, fetched from whichever single
 * existing list endpoint that role's own capabilities already allow — never
 * a new stats endpoint, and never an endpoint another role's tiles would
 * 403 on. `kind: 'none'` covers both "no session yet" and "no case below
 * claims this role," so rendering never has to guess why data is absent.
 */
type HomeStatsData =
  | { kind: 'meetings'; meetings: MeetingSummary[] }
  | { kind: 'approvals'; approvals: ApprovalRow[] }
  | { kind: 'users'; users: ManagedUser[] }
  | { kind: 'audit'; entries: AuditRow[] }
  | { kind: 'none' };

async function loadHomeStats(session: Session | null): Promise<HomeStatsData> {
  if (session === null) return { kind: 'none' };
  switch (session.role) {
    case 'MAKER':
    case 'SHARIAH':
    case 'VIEWER':
      return { kind: 'meetings', meetings: (await api.meetings()).meetings };
    case 'CHECKER':
      return { kind: 'approvals', approvals: (await api.approvals()).approvals };
    case 'SUPERVISOR':
      return { kind: 'audit', entries: (await api.audit()).entries };
    case 'ADMIN':
      return { kind: 'users', users: (await api.users()).users };
    default:
      return { kind: 'none' };
  }
}

interface Tile {
  key: string;
  label: string;
  value: number;
}

/**
 * One role's numbers, read out of whatever loadHomeStats fetched for it.
 * MAKER, SHARIAH and VIEWER all fetch the same 'meetings' list but read
 * three different things out of it, which is why this switches on the
 * session's role rather than on data.kind.
 */
function statsFor(session: Session, data: HomeStatsData): Tile[] {
  switch (session.role) {
    case 'MAKER': {
      if (data.kind !== 'meetings') return [];
      const since = Date.now() - WEEK_MS;
      const capturedThisWeek = data.meetings.filter(
        (meeting) =>
          meeting.createdById === session.id && new Date(meeting.occurredAt).getTime() >= since,
      ).length;
      return [
        { key: 'captures-this-week', label: 'Your captures this week', value: capturedThisWeek },
      ];
    }

    case 'CHECKER': {
      if (data.kind !== 'approvals') return [];
      const pendingApprovals = data.approvals.filter(
        (approval) => approval.decision === 'PENDING_CHECKER',
      ).length;
      const pendingSettlements = data.approvals.filter(
        (approval) => approval.decision === 'APPROVED' && approval.settlement === null,
      ).length;
      return [
        { key: 'pending-approvals', label: 'Awaiting your decision', value: pendingApprovals },
        {
          key: 'pending-settlements',
          label: 'Approved, not yet settled',
          value: pendingSettlements,
        },
      ];
    }

    case 'SHARIAH': {
      if (data.kind !== 'meetings') return [];
      // Not "open findings": a meeting's shariahFlagCount is a lifetime
      // total that never drops when a flag is cleared, so summing it would
      // silently count resolved findings as still open. This counts
      // meetings that have ever needed a look, which stays true regardless
      // of how any individual flag inside them was later resolved.
      const flagged = data.meetings.filter((meeting) => meeting.shariahFlagCount > 0).length;
      return [{ key: 'flagged-meetings', label: 'Meetings with Shariah flags', value: flagged }];
    }

    case 'SUPERVISOR': {
      if (data.kind !== 'audit') return [];
      const since = Date.now() - DAY_MS;
      const recent = data.entries.filter((entry) => new Date(entry.at).getTime() >= since).length;
      return [
        { key: 'recent-activity', label: 'Audit entries in the last 24 hours', value: recent },
      ];
    }

    case 'ADMIN': {
      if (data.kind !== 'users') return [];
      const pending = data.users.filter((user) => user.accountStatus === 'PENDING').length;
      const active = data.users.filter(
        (user) => user.accountStatus === 'ACTIVE' && user.deactivatedAt === null,
      ).length;
      return [
        { key: 'pending-registrations', label: 'Pending registrations', value: pending },
        { key: 'active-users', label: 'Active users', value: active },
      ];
    }

    case 'VIEWER': {
      if (data.kind !== 'meetings') return [];
      return [
        {
          key: 'meetings-visible',
          label: 'Meetings visible to you',
          value: data.meetings.length,
        },
      ];
    }

    default:
      return [];
  }
}

/** Styled to match Stat's own tile exactly, so it sits in the same row as a figure without pretending to be one. */
function CaptureCallout() {
  return (
    <Link href="/record" className="block h-full">
      <div className="flex h-full flex-col justify-between rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-line-strong">
        <div>
          <p className="text-sm font-semibold tracking-tight">Start a new capture</p>
          <p className="mt-0.5 text-caption text-muted">Record or upload a meeting.</p>
        </div>
        <span className="mt-2 text-caption font-medium text-brand">Go to Capture →</span>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const session = useAsync<Session>(() => api.me(), 'session');

  // Hooks cannot be called conditionally, so this always runs — but its key
  // is the placeholder 'pending' until session.data resolves, and
  // loadHomeStats(null) returns { kind: 'none' } without a fetch. The key
  // then flips to the real role exactly once, per useAsync's own
  // [key, nonce] effect dependency, firing the real fetch at that point.
  const stats = useAsync<HomeStatsData>(
    () => loadHomeStats(session.data),
    session.data?.role ?? 'pending',
  );

  if (session.loading) return <Spinner label="Checking your session" />;

  const sections = visibleNav(session.data);
  const cards = sections.length > 0 ? sections : FALLBACK;
  const name = session.data?.displayName;

  const showCapture = can(session.data, 'meeting:create');
  const tiles =
    session.data === null ? [] : statsFor(session.data, stats.data ?? { kind: 'none' });
  const tileCount = tiles.length + (showCapture ? 1 : 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title={name === undefined ? 'Welcome back' : `Welcome back, ${name}`}
        lead="Pick a section below. Each one only shows what your role can act on."
      />

      {tileCount > 0 && (
        <div className={`grid gap-3 ${gridColumnClass(tileCount)}`}>
          {showCapture && <CaptureCallout />}
          {tiles.map((tile) => (
            <Stat key={tile.key} label={tile.label} value={tile.value} />
          ))}
        </div>
      )}
      {stats.error !== null && (
        <p className="text-caption text-faint">Could not load your stats: {stats.error}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((item) => (
          <Link key={item.href} href={item.href} className="block">
            <Card className="h-full p-5 transition hover:-translate-y-px hover:border-line-strong">
              <h2 className="text-base font-semibold tracking-tight">{item.label}</h2>
              <p className="mt-1.5 text-sm text-muted">{item.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
