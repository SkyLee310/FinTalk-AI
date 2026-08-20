'use client';

import {
  CheckCheck,
  ChevronsLeft,
  ChevronsRight,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Network,
  Settings2,
  ShieldCheck,
  Video,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { type NavItem, isActive } from '@/lib/nav';
import { navigateWithTransition } from '@/lib/view-transition';

/** Manual override of the automatic narrow-viewport collapse, remembered across visits. */
const COLLAPSE_KEY = 'fintalk-sidebar-collapsed';

/**
 * Icons keyed by href rather than folded into NavItem itself.
 */
const ICON: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/record': Video,
  '/meetings': ShieldCheck,
  '/approvals': CheckCheck,
  '/knowledge': Network,
  '/admin': Settings2,
  '/islamic-banking': Landmark,
};

export function AppSidebar({
  items,
  pathname,
  pendingUserCount,
}: {
  items: readonly NavItem[];
  pathname: string;
  pendingUserCount: number;
}) {
  const router = useRouter();
  const currentIndex = items.findIndex((item) => isActive(pathname, item));

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === 'true') setCollapsed(true);
    } catch {
      // Storage blocked (private mode) — default expanded stands.
    }
  }, []);

  function toggleCollapsed(): void {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        // Storage blocked — the toggle still works for the rest of this visit.
      }
      return next;
    });
  }

  const labelVisibility = `transition-opacity duration-150 ${collapsed ? 'opacity-0' : 'opacity-0 md:opacity-100'}`;

  const captureItem = items.find((i) => i.href === '/record');
  const navItems = items.filter((i) => i.href !== '/record');
  const isCaptureActive = captureItem ? isActive(pathname, captureItem) : false;

  return (
    <aside
      className={`sidebar-rail sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-line bg-raised transition-all duration-200 ${collapsed ? '' : 'md:w-64'}`}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center border-b border-line px-3.5">
        <Link
          href={items[0]?.href ?? '/meetings'}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand transition hover:opacity-90"
        >
          <Logo className="size-10 sm:size-11 shrink-0" />
          <span className={`min-w-0 ${labelVisibility}`}>
            <span className="block truncate text-base sm:text-[1.05rem] font-bold tracking-tight text-text">
              FinTalk AI
            </span>
          </span>
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-3 p-2 md:p-3">
        {/* Apple-style Prominent Central-Aligned Light-Blue Capture Button with Floating Hover Effect */}
        {captureItem && (
          <div className="px-0.5">
            <Link
              href="/record"
              aria-current={isCaptureActive ? 'page' : undefined}
              title="Capture meeting or upload"
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                ) {
                  return;
                }
                event.preventDefault();
                document.documentElement.dataset.nav = 'forward';
                navigateWithTransition(() => router.push('/record'));
              }}
              className={`group relative flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 ease-out active:scale-[0.97] active:translate-y-0 ${
                collapsed
                  ? 'size-10 mx-auto p-0 hover:-translate-y-0.5 hover:shadow-md hover:shadow-brand/20'
                  : 'w-full px-4 py-2.5 hover:-translate-y-0.5 hover:shadow-md hover:shadow-brand/20'
              } ${
                isCaptureActive
                  ? 'bg-brand text-canvas border border-brand shadow-md shadow-brand/25 ring-2 ring-brand/30'
                  : 'bg-brand-soft/90 dark:bg-brand/20 text-brand-strong dark:text-sky-300 border border-brand/30 dark:border-brand/40 hover:bg-brand-soft hover:border-brand/50 dark:hover:bg-brand/30'
              }`}
            >
              <Video
                aria-hidden="true"
                className={`size-4 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                  isCaptureActive ? 'text-canvas' : 'text-brand dark:text-sky-300'
                }`}
              />
              {!collapsed && (
                <span className="text-sm font-bold tracking-tight text-center">
                  Capture
                </span>
              )}
            </Link>
          </div>
        )}

        {/* Workspace section with <<< collapse button on the right */}
        <div className="space-y-1">
          <div
            className={`flex items-center pt-1 pb-1 ${
              collapsed ? 'justify-center' : 'justify-between px-2'
            }`}
          >
            {!collapsed && (
              <p className="truncate font-mono text-[0.62rem] font-bold tracking-widest text-faint uppercase">
                Workspace
              </p>
            )}
            {/* Collapse toggle right beside WORKSPACE word (or centered when collapsed) */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:inline-flex size-6 items-center justify-center rounded-md text-faint hover:bg-surface hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-brand"
            >
              {collapsed ? (
                <ChevronsRight aria-hidden="true" className="size-4" />
              ) : (
                <ChevronsLeft aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>

          {navItems.map((item, index) => {
            const active = isActive(pathname, item);
            const Icon = ICON[item.href];
            const badgeCount = item.href === '/admin' ? pendingUserCount : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.hint}
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    event.button !== 0
                  ) {
                    return;
                  }
                  event.preventDefault();
                  document.documentElement.dataset.nav =
                    currentIndex === -1 || index > currentIndex ? 'forward' : 'back';
                  navigateWithTransition(() => router.push(item.href));
                }}
                className={`group relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted hover:bg-surface hover:text-text'
                }`}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />
                )}
                {Icon !== undefined && (
                  <Icon
                    aria-hidden="true"
                    className={`size-[1.125rem] shrink-0 ${active ? 'text-brand' : 'text-faint group-hover:text-text'}`}
                  />
                )}
                <span className={`min-w-0 flex-1 ${labelVisibility}`}>
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                </span>
                {badgeCount > 0 && (
                  <span
                    className={`shrink-0 rounded-full bg-warn-soft px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold text-warn ${collapsed ? 'hidden' : 'hidden md:inline'}`}
                  >
                    {badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-line p-3">
        <div
          className={`mx-auto mb-2 size-2 rounded-full bg-ok shadow-[0_0_8px_var(--ok)] ${collapsed ? '' : 'md:hidden'}`}
        />
        <Link
          href="/settings"
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
          title="Settings"
          className={`group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
            pathname.startsWith('/settings')
              ? 'bg-brand-soft text-brand'
              : 'text-muted hover:bg-surface hover:text-text'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`size-[1.125rem] shrink-0 ${pathname.startsWith('/settings') ? 'text-brand' : 'text-faint group-hover:text-text'}`}
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className={`min-w-0 flex-1 ${labelVisibility}`}>
            <span className="block truncate text-sm font-medium">Settings</span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
