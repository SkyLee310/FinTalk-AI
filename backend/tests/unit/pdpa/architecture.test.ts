import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The RedactedText barrier is only worth anything if exactly one module can
 * produce the type. TypeScript stops an accidental plain string; it cannot
 * stop a deliberate cast. This test is what stops the cast.
 */

const SRC = join(process.cwd(), 'src');
const MINTER = join('pdpa', 'redactor.ts');
const MINT_PATTERN = /as\s+(?:unknown\s+as\s+)?RedactedText/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Comments are not code. redacted-text.ts documents the very cast this test
 * forbids, and without stripping, that prose would read as a violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function mintsRedactedText(file: string): boolean {
  return MINT_PATTERN.test(stripComments(readFileSync(file, 'utf8')));
}

describe('RedactedText write barrier', () => {
  it('is minted only in pdpa/redactor.ts', () => {
    const offenders = tsFiles(SRC)
      .filter((file) => relative(SRC, file) !== MINTER)
      .filter(mintsRedactedText)
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });

  // Without this, the rule above would also pass if nothing minted the type
  // at all — a green test that proves nothing.
  it('really is minted in redactor.ts, so the rule above is not vacuous', () => {
    expect(mintsRedactedText(join(SRC, MINTER))).toBe(true);
  });

  it('finds source files to scan, so the walk itself is not silently empty', () => {
    expect(tsFiles(SRC).length).toBeGreaterThan(3);
  });
});
