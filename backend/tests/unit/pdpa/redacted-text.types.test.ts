import { describe, expect, it } from 'vitest';
import type { RedactedText } from '../../../src/pdpa/redacted-text.js';
import { redact } from '../../../src/pdpa/redactor.js';

/**
 * The load-bearing assertion in this file is the `@ts-expect-error` below, and
 * it is checked by `npm run typecheck` (via tsconfig.test.json), not by vitest.
 * If a plain string ever became assignable to RedactedText, that directive
 * would be unused and tsc would fail the build. Vitest only confirms the
 * runtime half.
 */

/** Stands in for the persistence layer, which accepts nothing else. */
function persist(text: RedactedText): string {
  return text;
}

describe('RedactedText write barrier', () => {
  it('does not accept a plain string', () => {
    // @ts-expect-error a plain string must never satisfy RedactedText
    const smuggled: string = persist('880101-14-5678');

    // Documents the consequence of defeating the barrier: unredacted data
    // reaches the write path. The compiler is what prevents this.
    expect(smuggled).toBe('880101-14-5678');
  });

  it('accepts the redactor output, and that output is already redacted', () => {
    const { text } = redact('IC 880101-14-5678 on file', Buffer.alloc(32, 1));
    const stored = persist(text);
    expect(stored).toBe('IC [NRIC_1] on file');
    expect(stored).not.toMatch(/\d{6}-\d{2}-\d{4}/);
  });
});
