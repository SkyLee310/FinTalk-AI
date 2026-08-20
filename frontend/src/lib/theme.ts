/** What actually gets painted — the value `data-theme` carries. */
export type Theme = 'light' | 'dark';

/**
 * What the user chose. `'system'` defers to the OS and is the default.
 *
 * Kept separate from `Theme` because the two answer different questions:
 * this is the preference to persist, that is the result to paint.
 * Conflating them is what made following the OS unreachable — see
 * `resolveTheme`.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

/**
 * Single source of truth for the storage key. `app/layout.tsx`'s pre-paint
 * script reads this same string as a literal (it runs before any module
 * import is possible) — if the two ever disagree, the result is a flash of
 * the wrong theme on every load.
 */
export const THEME_STORAGE_KEY = 'fintalk-theme';

/**
 * Pure resolution: an explicit choice always wins, and only `'system'`
 * falls through to `systemPrefersDark`.
 *
 * This used to take `Theme | null`, where `null` meant "nothing stored".
 * That made following the OS a state you could leave but never return to —
 * one toggle wrote a concrete value and the app stopped tracking the system
 * for good. Settings offers `'system'` as a choice, so it has to be
 * representable rather than inferred from an absence.
 *
 * No DOM access, so this is the part covered by a unit test;
 * `readStoredPreference`/`applyTheme`/`setTheme` below are the DOM-touching
 * shell around it.
 */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference !== 'system') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Reads the stored preference, defaulting to `'system'`.
 *
 * Absent, invalid and storage-blocked all return `'system'` — a first-time
 * visitor and someone who explicitly chose to follow the OS should behave
 * identically, and collapsing them here means no caller has to decide what
 * a missing value means.
 */
export function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    // Private browsing / storage disabled: follow the OS.
    return 'system';
  }
}

/**
 * The OS preference, right now.
 *
 * The DOM-reading counterpart to `resolveTheme`'s pure `systemPrefersDark`
 * argument. Returns `false` during SSR, where there is no OS to ask and
 * `app/layout.tsx`'s pre-paint script settles the question before paint
 * anyway.
 */
export function currentSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Stamps `data-theme` and `.dark` class on the root element so both globals.css and Tailwind dark: variants apply. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/**
 * How long the colour cross-fade runs. Must match the transition duration in
 * globals.css's `.theme-transition` rule — the class has to outlive the
 * animation it enables, or the fade is cut off partway.
 */
const TRANSITION_MS = 260;

/** Class that opts the document into the cross-fade. Defined in globals.css. */
const TRANSITION_CLASS = 'theme-transition';

/**
 * Held so a second toggle mid-fade restarts the timer rather than letting the
 * first one strip the class out from under it — which would leave the rest of
 * the second fade running with no transition at all.
 */
let transitionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Applies the theme and persists the choice. Storage failure does not block
 * applying it.
 *
 * Unlike `applyTheme`, this one fades: it is the deliberate act of switching,
 * and an instant repaint of every colour on the page reads as a glitch rather
 * than a change. `applyTheme` stays abrupt on purpose — it is also what the
 * pre-paint script path uses, where there is no previous state to fade from
 * and a transition would only delay first paint.
 */
export function setTheme(preference: ThemePreference): void {
  const root = typeof document === 'undefined' ? null : document.documentElement;

  if (root !== null) {
    root.classList.add(TRANSITION_CLASS);
    if (transitionTimer !== null) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      root.classList.remove(TRANSITION_CLASS);
      transitionTimer = null;
    }, TRANSITION_MS);
  }

  // Resolved for painting, stored unresolved: writing the resolved value
  // would silently convert a 'system' choice into a fixed one, which is the
  // trap this type split exists to close.
  applyTheme(resolveTheme(preference, currentSystemPrefersDark()));
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Choice still applies for this page load via applyTheme above; it
    // simply will not survive a reload.
  }
}
