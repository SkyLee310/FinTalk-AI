'use client';

import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAsync } from '@/hooks/use-async';
import { api, type NotificationRow } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Spinner } from './ui';

const POLL_MS = 5000;

/**
 * Self-scoped alerts — see backend/prisma/schema.prisma's Notification model
 * for the three events that create one. Polls GET /notifications every 5s,
 * the same silent-reload pattern meetings/[id]/page.tsx uses for its own
 * status poll, so the badge updates without the caller doing anything.
 *
 * Trigger/panel open-close state machine mirrors ProfileMenu exactly (same
 * pop-in/pop-out animation, Escape + outside-click dismissal, focus return)
 * so the header's two popovers behave identically.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data, reload } = useAsync(() => api.notifications(), 'notifications');

  useEffect(() => {
    const poll = setInterval(() => {
      reload({ silent: true });
    }, POLL_MS);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload is useCallback-stable; re-running this effect on every render would restart the interval on every tick.
  }, []);

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

  async function handleSelect(notification: NotificationRow): Promise<void> {
    close();
    if (!notification.read) {
      try {
        await api.markNotificationRead(notification.id);
        reload({ silent: true });
      } catch {
        // Not surfaced: a failed read-mark leaves the badge one item high
        // until the next poll's list still shows it as unread — a better
        // failure mode than blocking navigation on it.
      }
    }
    if (notification.relatedMeetingId !== null) {
      router.push(`/meetings/${notification.relatedMeetingId}`);
    }
  }

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          unreadCount > 0 ? `Notifications, ${String(unreadCount)} unread` : 'Notifications'
        }
        onClick={() => {
          if (open) {
            setClosing(false);
            setOpen(false);
            return;
          }
          setClosing(false);
          setOpen(true);
        }}
        className="relative grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-surface text-muted transition hover:bg-raised hover:text-text active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Bell aria-hidden="true" className="size-4" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid min-w-[1.1rem] place-items-center rounded-full border border-warn/40 bg-warn-soft px-1 py-0.5 font-mono text-[0.6rem] font-semibold leading-none text-warn"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Notifications"
          style={{ transformOrigin: 'top right' }}
          className={`absolute right-0 top-[calc(100%+0.5rem)] z-30 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg ${
            closing
              ? 'animate-[pop-out_140ms_ease-in_both]'
              : 'animate-[pop-in_140ms_var(--ease-out)_both]'
          }`}
          onAnimationEnd={() => {
            if (!closing) return;
            setClosing(false);
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-medium">Notifications</p>
          </div>

          <div className="max-h-96 overflow-y-auto p-1.5">
            {data === null && (
              <div className="flex justify-center py-6">
                <Spinner label="Loading notifications" />
              </div>
            )}
            {data !== null && notifications.length === 0 && (
              <p className="px-2.5 py-6 text-center text-caption text-faint">
                You&apos;re all caught up.
              </p>
            )}
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                role="menuitem"
                onClick={() => void handleSelect(notification)}
                className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                    notification.read
                      ? 'bg-transparent'
                      : 'bg-brand text-brand shadow-[0_0_6px_currentColor]'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block ${notification.read ? 'text-muted' : 'font-medium text-text'}`}
                  >
                    {notification.message}
                  </span>
                  <span className="mt-0.5 block text-caption text-faint">
                    {formatDateTime(notification.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
