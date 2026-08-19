'use client';

import {
  CheckCheck,
  ChevronsLeft,
  ChevronsRight,
  Landmark,
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
      <div className="flex h-16 items-center gap-2.5 border-b border-line px-4">
        <Link
          href={items[0]?.href ?? '/record'}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Logo className="size-8 shrink-0" />
          <span className={`min-w-0 ${labelVisibility}`}>
            <span className="block truncate text-sm font-semibold tracking-tight">
              FinTalk AI
            </span>
            <span className="block truncate font-mono text-[0.65rem] uppercase tracking-wide text-muted">
              Secure
            </span>
          </span>
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-3 p-2 md:p-3">
        {/* Apple-style Prominent Capture Button */}
        {captureItem && (
          <div className={collapsed ? 'flex justify-center' : ''}>
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
              className={`group relative flex items-center gap-2.5 rounded-full transition-all duration-200 active:scale-[0.96] shadow-sm hover:shadow ${
                collapsed
                  ? 'size-10 justify-center p-0'
                  : 'w-full px-3.5 py-2.5 justify-start'
              } ${
                isCaptureActive
                  ? 'bg-emerald-200 dark:bg-emerald-900/90 text-emerald-950 dark:text-emerald-100 border-2 border-emerald-500/80 dark:border-emerald-400 ring-2 ring-emerald-400/20'
                  : 'bg-[#d1fae5] dark:bg-[#064e3b]/80 text-[#065f46] dark:text-[#a7f3d0] border border-[#a7f3d0] dark:border-[#047857] hover:bg-[#bbf7d0] dark:hover:bg-[#064e3b]'
              }`}
            >
              <div className="grid size-5 place-items-center shrink-0">
                <Video aria-hidden="true" className="size-4 shrink-0 text-[#065f46] dark:text-[#a7f3d0]" />
              </div>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold tracking-tight">
                    Capture
                  </span>
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
                  <span className="block truncate text-[0.7rem] text-faint">{item.hint}</span>
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
