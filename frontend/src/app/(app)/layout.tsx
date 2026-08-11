'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AskFinTalkAI, AskFinTalkAITrigger, type ChatMessage } from '@/components/ask-fintalk-ai';
import { Badge } from '@/components/badge';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button, ErrorNote, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Session } from '@/lib/api';
import { isActive, visibleNav } from '@/lib/nav';

/**
 * The signed-in shell.
 *
 * The navigation itself lives in lib/nav.ts, because the post-login landing page is
 * derived from the same list — sending someone to a page their nav does not contain
 * strands them there.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, error, loading } = useAsync<Session>(() => api.me(), 'session');

  // Lives here, not inside AskFinTalkAI, so a page navigation does not
  // clear the conversation. Both still reset for free: this whole layout
  // unmounts on sign-out (redirect to /login, outside this route group)
  // and on a hard reload (fresh component instance, fresh useState).
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const mayManageUsers = can(session, 'user:manage');
  /**
   * A second, independent fetch of /users — admin/page.tsx has its own for
   * the same reason. Gated on the loader, not just the key: a SUPERVISOR
   * sees this nav item via audit:read but not user:manage, and an ungated
   * GET /users would 403 for them.
   */
  const pendingUsers = useAsync(
    () => (mayManageUsers ? api.users() : Promise.resolve({ users: [] })),
    mayManageUsers ? 'nav-pending-users' : 'nav-pending-users-none',
  );
  const pendingUserCount = pendingUsers.data?.users.filter(
    (user) => user.accountStatus === 'PENDING',
  ).length ?? 0;

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

  const visible = visibleNav(session);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <Link href="/home" className="flex items-center gap-2.5 rounded">
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
                  <span className="inline-flex items-center gap-1.5">
                    {item.label}
                    {item.href === '/admin' && pendingUserCount > 0 && (
                      <Badge tone="warn" dot>
                        {pendingUserCount}
                      </Badge>
                    )}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            {/*
              Gated on transcript:read, deliberately: the assistant reads the
              redacted transcript corpus, and ADMIN holds every other broad
              capability but not this one (backend/src/auth/rbac.ts). Showing
              the trigger regardless of that gate would open a side door into
              transcript content for a role the capability matrix keeps out.
            */}
            {can(session, 'transcript:read') && (
              <AskFinTalkAITrigger onClick={() => setChatOpen(true)} />
            )}
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

      <AskFinTalkAI
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        setMessages={setChatMessages}
      />
    </div>
  );
}
