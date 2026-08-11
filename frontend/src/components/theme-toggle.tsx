'use client';

import { useEffect, useState } from 'react';
import {
  currentSystemPrefersDark,
  readStoredPreference,
  resolveTheme,
  setTheme as persistTheme,
  type Theme,
} from '@/lib/theme';
import { Button } from './ui';

/**
 * Icon button for the public pages, where there is no Settings page to hold
 * the preference. No icon dependency — both glyphs are inline SVG.
 *
 * Deliberately binary: it writes an explicit 'light' or 'dark', which leaves
 * the 'system' preference behind. That is the honest behaviour for a
 * two-state control, and the three-way choice lives in /settings — the place
 * a signed-in user can get back to following the OS.
 */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    // layout.tsx's pre-paint script already stamped data-theme before this
    // component mounted; read it back rather than re-resolving, so there is
    // exactly one place that decides system-vs-stored precedence.
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light' || current === 'dark') {
      setThemeState(current);
      return;
    }
    // No attribute found (only possible if the pre-paint script did not
    // run) — fall back to the same resolution it uses.
    setThemeState(resolveTheme(readStoredPreference(), currentSystemPrefersDark()));
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    persistTheme(next);
    setThemeState(next);
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
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
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
