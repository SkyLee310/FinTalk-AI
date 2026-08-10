import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockReference, SETTLEMENT_RAILS } from '../../../src/payments/mock-settlement.js';

const SOURCE = join(process.cwd(), 'src', 'payments', 'mock-settlement.ts');

/**
 * "Mock" is asserted here, not merely promised in a comment.
 *
 * Spec §2.3 says no code path submits a payment, and a test on the export module
 * asserts that no exported name there looks like a transmitter. This file is the
 * second half of that guarantee: the module that *does* simulate settlement is
 * checked for any means of reaching a network, by reading its own source.
 *
 * A source scan rather than a runtime spy, for the same reason
 * tests/unit/pdpa/architecture.test.ts scans for RedactedText casts — it catches
 * the call that was added but never exercised by a test, which is exactly the one
 * a reviewer would miss.
 */
describe('mock settlement makes no network call', () => {
  const source = readFileSync(SOURCE, 'utf8');

  /**
   * Comments are stripped first. This module's own documentation contains the
   * words "no fetch, no HTTP client", and matching that prose would fail the test
   * for describing the very property it asserts.
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const FORBIDDEN: readonly { readonly label: string; readonly pattern: RegExp }[] = [
    { label: 'fetch', pattern: /\bfetch\s*\(/ },
    { label: 'XMLHttpRequest', pattern: /XMLHttpRequest/ },
    { label: 'node:http or node:https', pattern: /['"]node:https?['"]/ },
    { label: 'a bare http import', pattern: /from\s+['"]https?['"]/ },
    { label: 'node:net', pattern: /['"]node:net['"]/ },
    { label: 'node:dgram', pattern: /['"]node:dgram['"]/ },
    { label: 'WebSocket', pattern: /WebSocket/ },
    { label: 'axios', pattern: /axios/ },
    { label: 'got', pattern: /from\s+['"]got['"]/ },
    { label: 'undici', pattern: /undici/ },
    { label: 'child_process', pattern: /child_process/ },
    { label: 'a URL literal', pattern: /https?:\/\// },
  ];

  for (const { label, pattern } of FORBIDDEN) {
    it(`does not use ${label}`, () => {
      expect(pattern.test(code)).toBe(false);
    });
  }

  /**
   * The import list is pinned whole, so a new dependency has to be justified here
   * rather than slipping in beside the existing ones.
   */
  it('imports only crypto, Prisma types, the audit chain and the error type', () => {
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();
    expect(imports).toEqual([
      '../audit/chain.js',
      '../compliance/errors.js',
      '@prisma/client',
      'node:crypto',
    ]);
  });
});

describe('mockReference', () => {
  it('announces itself as a mock', () => {
    for (const rail of SETTLEMENT_RAILS) {
      expect(mockReference(rail)).toMatch(/^MOCK-(DUITNOW|FPX)-[0-9A-Z]+$/);
    }
  });

  /**
   * The prefix is the point. A reference that could pass for a genuine DuitNow
   * one in a screenshot or an email would defeat every other safeguard here, so it
   * is asserted separately from the overall shape and repeatedly, since the suffix
   * is random.
   */
  it('always starts with MOCK-, matching the database CHECK', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(mockReference('DUITNOW').startsWith('MOCK-')).toBe(true);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mockReference('FPX')));
    expect(seen.size).toBe(200);
  });

  it('names the rail it simulates', () => {
    expect(mockReference('DUITNOW')).toContain('DUITNOW');
    expect(mockReference('FPX')).toContain('FPX');
  });
});
