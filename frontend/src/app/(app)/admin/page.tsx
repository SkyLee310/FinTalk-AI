'use client';

import Link from 'next/link';
import { Card } from '@/components/card';
import { ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Capability, type Session } from '@/lib/api';

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
      'Invite people, change what a role permits them to do, and revoke access. '
      + 'Accounts are deactivated rather than deleted, because approvals and audit '
      + 'entries name them.',
    needs: 'user:manage',
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
          <Link key={area.href} href={area.href} className="rounded-xl">
            <Card className="h-full p-5 transition hover:border-line-strong">
              <h2 className="text-base font-semibold tracking-tight">{area.title}</h2>
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
    </div>
  );
}
