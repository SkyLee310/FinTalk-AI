'use client';

import Link from 'next/link';
import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { EmptyState, ErrorNote, PageHeader, Section, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Capability, type FeedbackRow, type Session } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * The Administration section index.
 *
 * ADMIN is a governance role, and this page says so in its first paragraph —
 * because the question a tester actually asked was "what is admin for". It
 * controls who has access and can read the whole record; it cannot capture a
 * meeting, clear a Shariah finding, approve a facility or settle one. That is the
 * design rather than a gap: the account that can grant itself a role must not also
 * be able to use it to move money.
 */

const AREAS: readonly {
  href: string;
  title: string;
  body: string;
  needs: Capability;
}[] = [
  {
    href: '/admin/users',
    title: 'Users and roles',
    body:
      'View users, roles, and capabilities. Administrators can also invite '
      + 'people, change roles, and deactivate/reactivate accounts.',
    needs: 'user:read',
  },
  {
    href: '/audit',
    title: 'Audit trail',
    body:
      'Every recorded action, hash-chained. The chain is verified on each read, so a '
      + 'tampered or missing entry shows up rather than staying quiet.',
    needs: 'audit:read',
  },
];

export default function AdminPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const mayManageUsers = can(session.data, 'user:manage');
  /**
   * Gated on the loader, not just the key. Only ADMIN reaches this page today and
   * it holds user:manage, but the guard stays defensive: any future role that could
   * open this page without user:manage would 403 on an ungated GET /users. A second,
   * independent fetch of /users lives in (app)/layout.tsx for the nav badge — two is
   * the honest trade at this scale.
   */
  const pendingUsers = useAsync(
    () => (mayManageUsers ? api.users() : Promise.resolve({ users: [] })),
    mayManageUsers ? 'admin-pending-users' : 'admin-pending-users-none',
  );
  const pendingCount = pendingUsers.data?.users.filter(
    (user) => user.accountStatus === 'PENDING',
  ).length ?? 0;

  /** Same gating reasoning as pendingUsers above: GET /feedback 403s without user:manage. */
  const feedback = useAsync(
    () => (mayManageUsers ? api.feedback() : Promise.resolve({ feedback: [] })),
    mayManageUsers ? 'admin-feedback' : 'admin-feedback-none',
  );

  if (session.loading) return <Spinner label="Checking your session" />;
  if (session.error !== null) return <ErrorNote>{session.error}</ErrorNote>;

  const areas = AREAS.filter((area) => can(session.data, area.needs));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Govern access, and read the record"
        lead={
          'This section controls who may use FinTalk and what they may do, and gives a '
          + 'complete view of what has been done. It deliberately cannot make a credit '
          + 'decision: an administrator can grant a role but never use one to approve a '
          + 'facility or move money.'
        }
      />

      {areas.length === 0 && (
        <ErrorNote>
          Your role has no administrative permissions. Ask an administrator if you
          need them.
        </ErrorNote>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {areas.map((area) => (
          <Link key={area.href} href={area.href} className="rounded-lg">
            <Card className="h-full p-5 transition hover:-translate-y-px hover:border-line-strong">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">{area.title}</h2>
                {area.href === '/admin/users' && pendingCount > 0 && (
                  <Badge tone="warn" dot>
                    {pendingCount} pending
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-caption leading-relaxed text-muted">{area.body}</p>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold tracking-tight">
          What an administrator cannot do
        </h2>
        <ul className="mt-3 space-y-2 text-caption leading-relaxed text-muted">
          <li className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger"
            />
            <span>
              <span className="font-medium text-text">Clear a Shariah finding.</span>{' '}
              Only the SHARIAH role can, and a database constraint requires reviewer
              attribution on any resolved finding.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger"
            />
            <span>
              <span className="font-medium text-text">Approve a facility.</span> Only a
              CHECKER can, and never one they drafted themselves.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger"
            />
            <span>
              <span className="font-medium text-text">Record a settlement.</span> Only
              the checker who approved that facility can, and every settlement in this
              system is simulated.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger"
            />
            <span>
              <span className="font-medium text-text">
                Set someone else&apos;s password.
              </span>{' '}
              An invited account is unusable until its owner sets their own, so nothing
              done under a person&apos;s name is deniable.
            </span>
          </li>
        </ul>
      </Card>

      {mayManageUsers && (
        <Section
          title="Feedback"
          description="Submitted from Settings. Not anonymous — each entry names its author."
        >
          {feedback.loading && <Spinner label="Loading feedback" />}
          {feedback.error !== null && <ErrorNote>{feedback.error}</ErrorNote>}
          {feedback.data !== null && <FeedbackList rows={feedback.data.feedback} />}
        </Section>
      )}
    </div>
  );
}

const CATEGORY_TONE = {
  BUG: 'danger',
  IDEA: 'brand',
  OTHER: 'neutral',
} as const;

function FeedbackList({ rows }: { rows: FeedbackRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No feedback yet"
        body="Submissions from Settings → Feedback appear here, newest first."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id}>
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="flex items-baseline gap-2">
                <Badge tone={CATEGORY_TONE[row.category]}>{row.category}</Badge>
                <span className="text-sm font-medium">{row.author.displayName}</span>
                <span className="text-caption text-faint">{row.author.role}</span>
              </div>
              <time dateTime={row.createdAt} className="text-caption text-faint">
                {formatDateTime(row.createdAt)}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {row.message}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
