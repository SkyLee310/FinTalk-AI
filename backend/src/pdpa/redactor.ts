import type { PiiType } from '@prisma/client';
import { detectPii } from './detectors.js';
import type { RedactedText } from './redacted-text.js';
import { assertVaultKey, seal, type SealedValue } from './vault.js';

/**
 * The single point at which text becomes RedactedText.
 *
 * Nothing else in the codebase may mint that type — see
 * tests/unit/pdpa/architecture.test.ts, which fails the build if it happens.
 */

export interface RedactionRecord {
  readonly piiType: PiiType;
  readonly placeholder: string;
  /** Offsets into the redacted text, pointing at the placeholder itself. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly detectedBy: string;
  readonly confidence: number;
  readonly sealed: SealedValue;
}

export interface RedactionResult {
  readonly text: RedactedText;
  readonly records: readonly RedactionRecord[];
}

/**
 * Replaces every detected identifier with a stable placeholder and seals the
 * original into a vault record.
 *
 * Repeated mentions of one value share a placeholder, so a reader can still
 * follow that two sentences refer to the same person, while each occurrence
 * gets its own vault row under its own iv.
 */
export function redact(source: string, vaultKey: Buffer): RedactionResult {
  // Validated before the text is touched. A key fault discovered halfway
  // through would leave a partially redacted string and a decision about
  // whether to return it — and there is no acceptable answer to that.
  assertVaultKey(vaultKey);

  const placeholderByValue = new Map<string, string>();
  const countByType = new Map<PiiType, number>();
  const records: RedactionRecord[] = [];

  let out = '';
  let cursor = 0;

  for (const detection of detectPii(source)) {
    const piiType: PiiType = detection.kind;

    let placeholder = placeholderByValue.get(detection.value);
    if (placeholder === undefined) {
      const ordinal = (countByType.get(piiType) ?? 0) + 1;
      countByType.set(piiType, ordinal);
      placeholder = `[${piiType}_${String(ordinal)}]`;
      placeholderByValue.set(detection.value, placeholder);
    }

    out += source.slice(cursor, detection.start);
    const startOffset = out.length;
    out += placeholder;
    cursor = detection.end;

    records.push({
      piiType,
      placeholder,
      startOffset,
      endOffset: startOffset + placeholder.length,
      detectedBy: detection.detectedBy,
      confidence: detection.confidence,
      sealed: seal(detection.value, vaultKey),
    });
  }

  out += source.slice(cursor);

  return { text: out as unknown as RedactedText, records };
}
