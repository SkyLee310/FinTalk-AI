import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Frosted glass surface: backdrop-blur over the --glass-* tokens from
 * globals.css, with a 1px inset top highlight for depth.
 *
 * Additive, not a replacement for Card (./card.tsx). Card stays opaque and
 * stays correct for transcript segments, audit rows, and tables, where
 * blur costs legibility a reader of dense data cannot afford. GlassPanel
 * is for a page's hero-level surfaces — the landing hero, the sign-in
 * card, the Ask FinTalk AI panel — where depth reads as intentional and
 * there is no dense grid underneath to blur.
 */
export function GlassPanel({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-glass-border bg-glass-bg shadow-[inset_0_1px_0_0_var(--glass-highlight),0_12px_36px_-6px_rgba(0,0,0,0.07)] dark:shadow-[inset_0_1px_0_0_var(--glass-highlight),0_16px_48px_-8px_rgba(0,0,0,0.55)] backdrop-blur-2xl ${className}`}
    >
      {children}
    </div>
  );
}
