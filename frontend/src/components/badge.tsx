import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-line-strong bg-raised text-muted',
  brand: 'border-brand/40 bg-brand-soft text-brand',
  ok: 'border-ok/40 bg-ok-soft text-ok',
  warn: 'border-warn/40 bg-warn-soft text-warn',
  danger: 'border-danger/40 bg-danger-soft text-danger',
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-faint',
  brand: 'bg-brand',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/**
 * Status pill. `dot` adds a leading indicator; the tone is never the only
 * carrier of meaning — callers always pass readable text as children.
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.7rem] font-medium uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full shadow-[0_0_6px_currentColor] ${DOT_CLASS[tone]}`}
        />
      )}
      {children}
    </span>
  );
}
