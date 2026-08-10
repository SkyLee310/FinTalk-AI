import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/lib/theme';

/**
 * `resolveTheme` is the pure core of theme resolution: a stored choice
 * always wins, and only its absence falls through to the system value.
 * The DOM-touching half (reading/writing localStorage, stamping
 * data-theme) is verified in the browser, not here — this project has no
 * jsdom in its test stack.
 */

describe('resolveTheme', () => {
  it('prefers a stored dark choice over a light system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('prefers a stored light choice over a dark system', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('falls through to a dark system when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
  });

  it('falls through to a light system when nothing is stored', () => {
    expect(resolveTheme(null, false)).toBe('light');
  });
});
