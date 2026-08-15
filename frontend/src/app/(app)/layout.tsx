'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AskFinTalkAI, AskFinTalkAITrigger, type ChatMessage } from '@/components/ask-fintalk-ai';
import { Badge } from '@/components/badge';
import { Logo } from '@/components/logo';
import { ProfileMenu } from '@/components/profile-menu';
import { ErrorNote, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Session } from '@/lib/api';
import { isActive, visibleNav } from '@/lib/nav';
import { navigateWithTransition } from '@/lib/view-transition';

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
   * the same reason. Gated on the loader, not just the key: any role that could
   * see this nav item without holding user:manage would 403 on an ungated
   * GET /users, so the fetch is skipped unless user:manage is present.
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
  /**
   * Where in the sequence we currently are, so a click can tell forward from
   * back. -1 when no section owns this path (/settings, for one) — treated as
   * forward, because arriving somewhere outside the sequence is not a return.
   */
  const currentIndex = visible.findIndex((item) => isActive(pathname, item));

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        The id is load-bearing, not decoration: globals.css gives it its own
        view-transition-name so the header holds still while the content slides.
        It cannot select on `header`, because PageHeader is one too.
      */}
      <header
        id="app-header"
        className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <Link href="/home" className="flex items-center gap-2.5 rounded">
            <Logo className="size-7" />
            <span className="text-sm font-semibold tracking-tight">FinTalk AI</span>
          </Link>

          <nav aria-label="Main" className="flex items-center gap-1">
            {visible.map((item, index) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  /**
                   * Still a real link — only plain left-clicks are taken over.
                   *
                   * Cmd/Ctrl/Shift/Alt-click and middle-click fall through
                   * untouched, so opening a section in a new tab keeps working
                   * and Next.js keeps prefetching on hover. Replacing these
                   * with buttons to get the transition would have cost both.
                   *
                   * The direction goes on the document because CSS is what
                   * reads it: the five sections are a sequence, so moving
                   * deeper slides one way and coming back mirrors it.
                   */
                  onClick={(event) => {
                    if (
                      event.metaKey
                      || event.ctrlKey
                      || event.shiftKey
                      || event.altKey
                      || event.button !== 0
                    ) {
                      return;
                    }
                    event.preventDefault();
                    document.documentElement.dataset.nav =
                      currentIndex === -1 || index > currentIndex ? 'forward' : 'back';
                    navigateWithTransition(() => router.push(item.href));
                  }}
                  // The hint is a title rather than visible text: five labels with
                  // subtitles is a menu, not a nav bar. Each section's own page
                  // states its purpose in words that do not need hovering.
                  title={item.hint}
                  className={`rounded-md px-3.5 py-1.5 text-caption transition sm:text-sm ${
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
            {/*
              Gated on transcript:read, deliberately: the assistant reads the
              redacted transcript corpus, and ADMIN holds every other broad
              capability but not this one (backend/src/auth/rbac.ts). Showing
              the trigger regardless of that gate would open a side door into
              transcript content for a role the capability matrix keeps out.

              It sits outside the profile menu because it is a tool, not an
              account control — the same reason the theme toggle moved out of
              here entirely and into /settings.
            */}
            {can(session, 'transcript:read') && (
              <AskFinTalkAITrigger onClick={() => setChatOpen(true)} />
            )}
            <ProfileMenu
              session={session}
              onSignOut={() => {
                // The redirect is in `finally` on purpose: a failed logout
                // request still has to end the session on this client rather
                // than leave the user looking at a shell they cannot use.
                void api.logout().finally(() => {
                  router.replace('/login');
                });
              }}
            />
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
