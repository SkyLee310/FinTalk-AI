'use client';

import Link from 'next/link';
import { Card } from '@/components/card';
import { PageHeader, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, type Session } from '@/lib/api';
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

export default function HomePage() {
  const session = useAsync<Session>(() => api.me(), 'session');

  if (session.loading) return <Spinner label="Checking your session" />;

  const sections = visibleNav(session.data);
  const cards = sections.length > 0 ? sections : FALLBACK;
  const name = session.data?.displayName;

  return (
    <div className="space-y-8">
      <PageHeader
        title={name === undefined ? 'Welcome back' : `Welcome back, ${name}`}
        lead="Pick a section below. Each one only shows what your role can act on."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((item) => (
          <Link key={item.href} href={item.href} className="block">
            <Card className="h-full p-5 transition hover:border-line-strong">
              <h2 className="text-base font-semibold tracking-tight">{item.label}</h2>
              <p className="mt-1.5 text-sm text-muted">{item.hint}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
