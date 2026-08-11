import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/lib/theme';

/**
 * `resolveTheme` is the pure core of theme resolution: an explicit choice
 * always wins, and only `'system'` falls through to the OS value.
 *
 * `'system'` is a real, selectable preference rather than the absence of
 * one. It used to be `null` — "nothing stored yet" — which made following
 * the OS a state you could leave but never return to: the first toggle
 * pinned the theme for good. Settings offers it as a choice, so the type
 * has to be able to hold it.
 *
 * The DOM-touching half (reading/writing localStorage, stamping
 * data-theme, subscribing to the OS media query) is verified in the
 * browser, not here — this project has no jsdom in its test stack.
 */

describe('resolveTheme', () => {
  it('prefers an explicit dark choice over a light system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('prefers an explicit light choice over a dark system', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('follows a dark system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('follows a light system when the preference is system', () => {
    expect(resolveTheme('system', false)).toBe('light');
  });
});
