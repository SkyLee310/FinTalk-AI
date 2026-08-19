'use client';

import {
  AudioLines,
  CheckCheck,
  Landmark,
  type LucideIcon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
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
 *
 * lib/nav.ts is plain data consumed outside this component too (the layout
 * reads it for the active section's title, and it is unit-tested); keeping
 * React components out of it means that data stays serializable and
 * testable without a DOM.
 */
const ICON: Record<string, LucideIcon> = {
  '/record': AudioLines,
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

  // Read after mount, not as useState's initializer: server and the first
  // client render must agree (both false) or hydration mismatches. A stored
  // `true` then applies a moment later, same trade the theme toggle makes
  // everywhere except the pre-paint script reserved for theme's own flash.
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

  // Width (.sidebar-rail, globals.css) and this opacity both ride CSS
  // transitions rather than snapping. Opacity resolves faster than the
  // width so labels finish fading before the rail finishes resizing,
  // instead of visibly smearing across the resize.
  const labelVisibility = `transition-opacity duration-150 ${collapsed ? 'opacity-0' : 'opacity-0 md:opacity-100'}`;

  return (
    <aside
      className={`sidebar-rail sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-line bg-raised ${collapsed ? '' : 'md:w-64'}`}
    >
      <div className="border-b border-line">
        <div className="flex h-16 items-center gap-2.5 px-4">
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

        {/* Below md the automatic breakpoint already forces icon-only, so the manual toggle has nothing to do there. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="mx-3 mb-3 hidden w-[calc(100%-1.5rem)] items-center justify-center rounded-md py-1.5 text-faint transition hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand md:flex"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-4" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 p-2 md:p-3">
        <p
          className={`truncate px-2 pb-1 font-mono text-[0.62rem] tracking-widest text-faint uppercase ${labelVisibility}`}
        >
          Workspace
        </p>
        {items.map((item, index) => {
          const active = isActive(pathname, item);
          const Icon = ICON[item.href];
          const badgeCount = item.href === '/admin' ? pendingUserCount : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.hint}
              // Same real-navigation + direction bookkeeping the previous
              // top-nav header used — only the button chrome moved.
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
