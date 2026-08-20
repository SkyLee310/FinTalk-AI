'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@/lib/api';
import { avatarClasses } from '@/lib/avatar-colors';
import { Badge } from './badge';
import { Button } from './ui';

/**
 * Who you are signed in as, and the two things you can do about it.
 *
 * The header used to carry five unrelated controls in one corner: a theme
 * toggle, the Ask trigger, a name, an email, a role badge and a Sign out
 * button. Identity is not a tool, so it collapses to one control here and the
 * details move inside. The Ask trigger stays in the header — that one *is* a
 * tool.
 *
 * Deliberately not a `<details>`: this has to close on Escape and on an
 * outside click, and hand focus back to the trigger afterwards. A native
 * disclosure gives none of those, and bolting them on around it is more code
 * than owning the state.
 */
export function ProfileMenu({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Closing plays the exit animation before unmounting, so the panel leaves
   * along the path it arrived on instead of blinking out. `closing` is separate
   * from `open` because the panel must stay mounted while that plays.
   *
   * Stable, and deliberately unguarded: every caller already knows the panel is
   * open, and opening resets `closing` anyway. Making it depend on `open` would
   * give the effect below a new identity on every toggle, tearing down and
   * rebuilding its listeners for nothing.
   */
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const close = useCallback(() => {
    setClosing(true);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') close();
    }

    function onPointerDown(event: PointerEvent): void {
      const container = containerRef.current;
      if (container !== null && !container.contains(event.target as Node)) {
        close();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setClosing(false);
            setOpen(false);
            return;
          }
          setClosing(false);
          setOpen(true);
        }}
        className="group inline-flex h-9 items-center gap-2 rounded-full border border-line-strong/80 bg-surface/90 py-1 pl-1.5 pr-3 text-xs font-medium text-text shadow-xs backdrop-blur-md transition-all duration-150 hover:border-brand/40 hover:bg-raised active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span
          aria-hidden="true"
          className={`grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold ${avatarClasses(session.avatarColor)}`}
        >
          {initials(session.displayName)}
        </span>
        <span className="hidden max-w-[10rem] truncate font-medium sm:inline">
          {session.displayName}
        </span>
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`text-muted transition-transform duration-150 group-hover:text-text ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          // Anchored to the trigger it hangs from rather than its own centre:
          // a popover that grows out of the control makes the relationship
          // between the two obvious without an arrow to point it out.
          style={{ transformOrigin: 'top right' }}
          className={`absolute right-0 top-[calc(100%+0.5rem)] z-30 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-lg ${
            closing
              ? 'animate-[pop-out_140ms_ease-in_both]'
              : 'animate-[pop-in_140ms_var(--ease-out)_both]'
          }`}
          onAnimationEnd={() => {
            if (!closing) return;
            setClosing(false);
            setOpen(false);
            // Focus returns where it came from, so a keyboard user is not
            // dropped back at the top of the document.
            triggerRef.current?.focus();
          }}
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium">{session.displayName}</p>
            <p className="mt-0.5 truncate text-caption text-faint">{session.email}</p>
            <div className="mt-2">
              <Badge tone="brand">{session.role}</Badge>
            </div>
          </div>

          <div className="p-1.5">
            <Link
              href="/settings"
              role="menuitem"
              onClick={close}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted transition hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </Link>
          </div>

          <div className="border-t border-line p-1.5">
            <Button
              variant="secondary"
              role="menuitem"
              onClick={onSignOut}
              className="w-full justify-start"
            >
              Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Up to two letters, from the first and last word of the name.
 *
 * Falls back to a single character rather than rendering an empty circle, and
 * to nothing at all only for a blank name — which the backend does not allow.
 */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase();
}
