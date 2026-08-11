'use client';

import { useEffect } from 'react';
import { applyTheme, currentSystemPrefersDark, readStoredPreference } from '@/lib/theme';

/**
 * Keeps a `'system'` preference actually following the system.
 *
 * The pre-paint script in app/layout.tsx resolves the OS preference once, at
 * load. Without this, someone who chose to follow the OS would keep whichever
 * theme they happened to load with until they reloaded — so the app would sit
 * in light mode all evening after the OS had gone dark, which is the one thing
 * choosing "System" is meant to prevent.
 *
 * Renders nothing. It exists for the subscription, and it lives at the root so
 * the public pages and the signed-in shell both get it from a single mount.
 */
export function ThemeWatcher() {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');

    function sync(): void {
      // Re-read the preference on every change rather than closing over it:
      // the user can pick a fixed theme in /settings while this listener is
      // still attached, and a stale capture would then fight their choice.
      if (readStoredPreference() !== 'system') return;
      applyTheme(currentSystemPrefersDark() ? 'dark' : 'light');
    }

    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return null;
}
