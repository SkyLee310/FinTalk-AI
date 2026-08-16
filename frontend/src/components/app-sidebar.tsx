'use client';

import {
  AudioLines,
  CheckCheck,
  Landmark,
  type LucideIcon,
  Network,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { type NavItem, isActive } from '@/lib/nav';
import { navigateWithTransition } from '@/lib/view-transition';

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

  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-line bg-raised md:w-64">
      <div className="flex h-16 items-center gap-2.5 border-b border-line px-4">
        <Link
          href={items[0]?.href ?? '/record'}
          className="flex items-center gap-2.5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Logo className="size-8 shrink-0" />
          <span className="hidden min-w-0 md:block">
            <span className="block truncate text-sm font-semibold tracking-tight">
              FinTalk AI
            </span>
            <span className="block truncate font-mono text-[0.65rem] uppercase tracking-wide text-muted">
              Secure
            </span>
          </span>
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-1 p-2 md:p-3">
        <p className="hidden px-2 pb-1 font-mono text-[0.62rem] tracking-widest text-faint uppercase md:block">
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
              <span className="hidden min-w-0 flex-1 md:block">
                <span className="block truncate text-sm font-medium">{item.label}</span>
                <span className="block truncate text-[0.7rem] text-faint">{item.hint}</span>
              </span>
              {badgeCount > 0 && (
                <span className="hidden shrink-0 rounded-full bg-warn-soft px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold text-warn md:inline">
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <div className="mx-auto size-2 rounded-full bg-ok shadow-[0_0_8px_var(--ok)] md:hidden" />
      </div>
    </aside>
  );
}
