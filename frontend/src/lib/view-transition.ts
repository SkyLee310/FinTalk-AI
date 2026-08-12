/**
 * Runs `fn` inside `document.startViewTransition` when the browser
 * supports it and the visitor has not asked for reduced motion; otherwise
 * calls `fn` directly.
 *
 * Both fallback paths — unsupported browser (Firefox, at time of writing)
 * and an explicit `prefers-reduced-motion: reduce` — land in exactly the
 * same place: instant, today's behavior. That is what makes this safe to
 * wrap around every navigation without a feature-detection story at each
 * call site, and what satisfies the requirement that reduced motion be
 * able to zero this transition completely rather than merely shorten it.
 */
export function navigateWithTransition(fn: () => void): void {
  const prefersReducedMotion =
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (
    !prefersReducedMotion
    && typeof document !== 'undefined'
    && 'startViewTransition' in document
  ) {
    const transition = (
      document as unknown as {
        startViewTransition: (callback: () => void) => { ready: Promise<void> };
      }
    ).startViewTransition(fn);

    // `fn` runs and the navigation completes no matter what this promise does.
    // But startViewTransition returns before Next.js has actually mutated the
    // route's DOM, and when the browser skips the animation for that — an
    // interrupted transition, or a document it deems to be in an invalid state
    // mid-navigation — `ready` rejects with InvalidStateError. Nothing awaits
    // it, so it surfaces as an uncaught rejection on every nav. It is cosmetic,
    // not a failure, so swallow it rather than let it redden the console.
    transition.ready.catch(() => {});
    return;
  }

  fn();
}
