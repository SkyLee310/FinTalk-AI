'use client';

import { useEffect, useState } from 'react';

/**
 * A minimal, dependency-free toast.
 *
 * `toast()` is a plain module function rather than a hook, so it can be
 * called from anywhere a result needs to be announced — a submit handler,
 * a `.then()` — without that call site needing to be, or be inside, a
 * component that wired up a provider. `<Toaster/>` (mounted once, in the
 * root layout) is the only thing that subscribes to the queue.
 */

type Tone = 'ok' | 'danger' | 'neutral';

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly tone: Tone;
}

const DURATION_MS = 4000;

let items: readonly ToastItem[] = [];
let nextId = 0;
const listeners = new Set<(items: readonly ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

/** Queue a toast. Auto-dismisses after a few seconds — nothing to clear. */
export function toast(message: string, tone: Tone = 'neutral'): void {
  const id = nextId;
  nextId += 1;
  items = [...items, { id, message, tone }];
  emit();
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, DURATION_MS);
}

const TONE_STYLE: Record<Tone, string> = {
  ok: 'border-ok/40 bg-ok-soft text-ok',
  danger: 'border-danger/40 bg-danger-soft text-danger',
  neutral: 'border-line-strong bg-surface text-text',
};

/**
 * Renders whatever `toast()` has queued. Mount exactly once, in the root
 * layout — it sits above the route tree so a toast fired just before a
 * navigation (e.g. sign-in redirecting into the app) survives the redirect
 * instead of unmounting with the page that queued it.
 */
export function Toaster() {
  const [visible, setVisible] = useState<readonly ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setVisible);
    return () => {
      listeners.delete(setVisible);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
    >
      {visible.map((item) => (
        <div
          key={item.id}
          role="status"
          className={`animate-materialize pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-md ${TONE_STYLE[item.tone]}`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
