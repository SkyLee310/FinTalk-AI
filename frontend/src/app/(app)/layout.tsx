'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Badge } from '@/components/badge';
import { Logo } from '@/components/logo';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Capability, type Session } from '@/lib/api';

/**
 * Navigation named after the work, not after the tables.
 *
 * The old nav read Meetings / Approvals / Audit — three nouns that told a tester
 * nothing about what to do or in what order, which is what "unclear direction"
 * meant. These five are the stages of the actual process: capture it, review it,
 * decide on it, look across all of it, administer who may do any of that.
 *
 * Each entry declares the capability it needs, and `can()` filters the list — so
 * a CHECKER never sees Capture and a MAKER never sees Administration. A nav item
 * that leads to a 403 is worse than an absent one: it invites a click and then
 * refuses it.
 *
 * `needs` is the capability that makes the *section* useful, not merely readable.
 * Decide asks for `termsheet:draft` OR `termsheet:approve`, which is why it takes
 * a list.
 */
interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  /** Visible when the session holds any one of these. */
  readonly needs: readonly Capability[];
  /**
   * Extra path prefixes this section owns, for pages whose URL predates the
   * grouping. /audit keeps its address — a section rename is no reason to break
   * a bookmark or an audit link someone pasted into a ticket — but it belongs
   * under Administration, so highlighting has to know that.
   */
  readonly owns?: readonly string[];
}

/** True when the current path belongs to this section. */
function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = [item.href, ...(item.owns ?? [])];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

const NAV: readonly NavItem[] = [
  {
    href: '/record',
    label: 'Capture',
    hint: 'Record or upload a meeting',
    needs: ['meeting:create'],
  },
  {
    href: '/meetings',
    label: 'Review',
    hint: 'Transcripts, redactions and Shariah findings',
    needs: ['transcript:read'],
  },
  {
    href: '/approvals',
    label: 'Decide',
    hint: 'Term sheets, approvals and settlement',
    needs: ['termsheet:draft', 'termsheet:approve'],
  },
  {
    href: '/knowledge',
    label: 'Knowledge',
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
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, error, loading } = useAsync<Session>(() => api.me(), 'session');

  // An expired or absent session sends the user to sign in rather than leaving
  // them on a shell full of empty panels.
  useEffect(() => {
    if (!loading && error !== null) router.replace('/login');
  }, [loading, error, router]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (session === null) {
    return (
      <main id="main" className="mx-auto max-w-md px-5 py-16">
        <ErrorNote>Your session has ended. Redirecting you to sign in.</ErrorNote>
      </main>
    );
  }

  const visible = NAV.filter((item) =>
    item.needs.some((capability) => can(session, capability)),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <Link href="/meetings" className="flex items-center gap-2.5 rounded">
            <Logo className="size-7" />
            <span className="text-sm font-semibold tracking-tight">FinTalk AI</span>
          </Link>

          <nav aria-label="Main" className="flex items-center gap-1">
            {visible.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  // The hint is a title rather than visible text: five labels with
                  // subtitles is a menu, not a nav bar. Each section's own page
                  // states its purpose in words that do not need hovering.
                  title={item.hint}
                  className={`rounded-md px-2.5 py-1.5 text-caption transition sm:text-sm ${
                    active
                      ? 'bg-brand-soft font-medium text-brand'
                      : 'text-muted hover:bg-raised hover:text-text'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs font-medium leading-tight">{session.displayName}</p>
              <p className="text-xs leading-tight text-faint">{session.email}</p>
            </div>
            <Badge tone="brand">{session.role}</Badge>
            <Button
              variant="secondary"
              onClick={() => {
                void api.logout().finally(() => {
                  router.replace('/login');
                });
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">
        {children}
      </main>
    </div>
  );
}
