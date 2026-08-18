import { describe, expect, it } from 'vitest';
import { needsReconciliation } from '../../../src/shariah/reconcile.js';

describe('needsReconciliation', () => {
  it('is false for a meeting with no flags', () => {
    expect(needsReconciliation([])).toBe(false);
  });

  it('is false when every flag already has highlights', () => {
    expect(
      needsReconciliation([
        { status: 'FLAGGED', highlights: ['interest rate'] },
        { status: 'FLAGGED', highlights: ['Murabahah'] },
      ]),
    ).toBe(false);
  });

  it('is true when a FLAGGED row predates the highlights column', () => {
    expect(
      needsReconciliation([
        { status: 'FLAGGED', highlights: [] },
        { status: 'FLAGGED', highlights: ['Murabahah'] },
      ]),
    ).toBe(true);
  });

  it('is false once any flag has moved past FLAGGED, even if another is stale', () => {
    // A reviewer already acted on this meeting — replacing the rows would
    // discard their verdict, so reconciliation must not run.
    expect(
      needsReconciliation([
        { status: 'CONFIRMED_VIOLATION', highlights: [] },
        { status: 'FLAGGED', highlights: [] },
      ]),
    ).toBe(false);
  });

  it('is false when every flag is UNDER_REVIEW', () => {
    expect(
      needsReconciliation([{ status: 'UNDER_REVIEW', highlights: [] }]),
    ).toBe(false);
  });
});
