'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { Badge } from '@/components/badge';
import { Logo } from '@/components/logo';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Capability, type Session } from '@/lib/api';

const NAV: { href: string; label: string; needs: Capability }[] = [
  { href: '/meetings', label: 'Meetings', needs: 'meeting:read' },
  { href: '/approvals', label: 'Approvals', needs: 'meeting:read' },
  { href: '/audit', label: 'Audit', needs: 'audit:read' },
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

  const visible = NAV.filter((item) => can(session, item.needs));

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
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-sm transition ${
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
