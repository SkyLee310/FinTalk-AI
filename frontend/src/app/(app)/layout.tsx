'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { AskFinTalkAI, AskFinTalkAITrigger, type ChatMessage } from '@/components/ask-fintalk-ai';
import { ProfileMenu } from '@/components/profile-menu';
import { ErrorNote, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, can, type Session } from '@/lib/api';
import { isActive, visibleNav } from '@/lib/nav';

/**
 * The signed-in shell.
 *
 * The navigation itself lives in lib/nav.ts, because the post-login landing page is
 * derived from the same list — sending someone to a page their nav does not contain
 * strands them there. AppSidebar owns rendering that nav and the real-routing +
 * transition-direction bookkeeping the old top-nav header used to; this file still
 * owns session loading, the pending-user count, and the Ask FinTalk AI modal's
 * state, since a page navigation must not reset any of those.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    data: session,
    error,
    errorStatus,
    loading,
    reload,
  } = useAsync<Session>(() => api.me(), 'session');

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

  // Only a genuine 401 means the session is actually gone. Anything else —
  // a network blip, a 500 — is worth retrying rather than bouncing someone
  // straight back to sign-in as though they had been logged out.
  const sessionExpired = errorStatus === 401;

  useEffect(() => {
    if (!loading && sessionExpired) router.replace('/login');
  }, [loading, sessionExpired, router]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }

  if (sessionExpired) {
    return (
      <main id="main" className="mx-auto max-w-md px-5 py-16">
        <ErrorNote>Your session has ended. Redirecting you to sign in.</ErrorNote>
      </main>
    );
  }

  if (session === null) {
    return (
      <main id="main" className="mx-auto max-w-md px-5 py-16">
        <ErrorNote onRetry={() => reload()}>
          {error ?? 'Could not load your session.'}
        </ErrorNote>
      </main>
    );
  }

  const visible = visibleNav(session);
  const active = visible.find((item) => isActive(pathname, item));

  return (
    <div className="flex min-h-screen">
      <AppSidebar items={visible} pathname={pathname} pendingUserCount={pendingUserCount} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          The id is load-bearing, not decoration: globals.css gives it its own
          view-transition-name so the header holds still while the content slides.
          It cannot select on `header`, because PageHeader is one too.
        */}
        <header
          id="app-header"
          className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-canvas/85 px-5 backdrop-blur-md"
        >
          <span className="truncate text-sm font-semibold tracking-tight">
            {active?.label ?? 'FinTalk AI'}
          </span>

          <div className="flex shrink-0 items-center gap-3">
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
        </header>

        <main id="main" className="bg-grid flex-1 px-5 py-8">
          {children}
        </main>
      </div>

      <AskFinTalkAI
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        setMessages={setChatMessages}
      />
    </div>
  );
}
