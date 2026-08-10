export type Theme = 'light' | 'dark';

/**
 * Single source of truth for the storage key. `app/layout.tsx`'s pre-paint
 * script reads this same string as a literal (it runs before any module
 * import is possible) — if the two ever disagree, the result is a flash of
 * the wrong theme on every load.
 */
export const THEME_STORAGE_KEY = 'fintalk-theme';

/**
 * Pure resolution: a stored choice always wins over the system preference,
 * and only its absence falls through to `systemPrefersDark`. No DOM access,
 * so this is the part covered by a unit test; `readStoredTheme`/
 * `applyTheme`/`setTheme` below are the DOM-touching shell around it.
 */
export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  if (stored !== null) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

/** Reads the stored choice, or `null` if absent, invalid, or storage is blocked. */
export function readStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Private browsing / storage disabled: treat as "nothing stored".
    return null;
  }
}

/** Stamps `data-theme` on the root element so `globals.css`'s selectors apply. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/** Applies the theme and persists the choice. Storage failure does not block applying it. */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Choice still applies for this page load via applyTheme above; it
    // simply will not survive a reload.
  }
}
