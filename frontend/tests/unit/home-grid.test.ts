import { describe, expect, it } from 'vitest';
import { gridColumnClass } from '../../src/lib/grid';

/**
 * `gridColumnClass` is the pure core of the /home stat row's layout: the
 * fixed three-up grid the section-card chooser uses below it looks fine
 * with five cards and leaves dead space with one or two, which is what this
 * exists to avoid. The role-to-tile-count logic that calls it is verified
 * live in the browser instead, per this project's test stack (no jsdom).
 */

describe('gridColumnClass', () => {
  it('returns a single column for one tile', () => {
    expect(gridColumnClass(1)).toBe('grid-cols-1');
  });

  it('returns a two-up grid for two tiles', () => {
    expect(gridColumnClass(2)).toBe('grid-cols-1 sm:grid-cols-2');
  });

  it('returns a three-up grid for three tiles', () => {
    expect(gridColumnClass(3)).toBe('grid-cols-1 sm:grid-cols-2 lg:grid-cols-3');
  });

  it('caps at the three-up grid beyond three tiles', () => {
    expect(gridColumnClass(5)).toBe('grid-cols-1 sm:grid-cols-2 lg:grid-cols-3');
  });
});
