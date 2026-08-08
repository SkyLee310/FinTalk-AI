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
 * Shared placeholder numbering across several redact() calls.
 *
 * A transcript is redacted segment by segment. Without a shared context each
 * call restarts at [NRIC_1], so the first identifier in segment one and a
 * different identifier in segment three would both be labelled [NRIC_1] — the
 * transcript would read as though one person appeared twice. Pass one context
 * through every segment of a document.
 */
export interface RedactionContext {
  readonly placeholderByValue: Map<string, string>;
  readonly countByType: Map<PiiType, number>;
}

export function createRedactionContext(): RedactionContext {
  return { placeholderByValue: new Map(), countByType: new Map() };
}

/**
 * Concatenates already-redacted pieces.
 *
 * Joining cannot reintroduce an identifier, so the result is redacted by
 * construction. This lives here rather than at the call site because the
 * architecture test allows exactly one module to mint RedactedText, and
 * `parts.join()` on branded strings returns a plain one.
 */
export function joinRedacted(
  parts: readonly RedactedText[],
  separator: string,
): RedactedText {
  return parts.join(separator) as unknown as RedactedText;
}

/**
 * Replaces every detected identifier with a stable placeholder and seals the
 * original into a vault record.
 *
 * Repeated mentions of one value share a placeholder, so a reader can still
 * follow that two sentences refer to the same person, while each occurrence
 * gets its own vault row under its own iv.
 */
const PLACEHOLDER_TOKEN =
  /\[(?:NRIC|BANK_ACCOUNT|PHONE|EMAIL|PERSON_NAME|ADDRESS|CARD)_\d+\]/;

export function redact(
  source: string,
  vaultKey: Buffer,
  context: RedactionContext = createRedactionContext(),
): RedactionResult {
  // Validated before the text is touched. A key fault discovered halfway
  // through would leave a partially redacted string and a decision about
  // whether to return it — and there is no acceptable answer to that.
  assertVaultKey(vaultKey);

  // Redacting twice would emit a second [NRIC_1] beside the first, so every
  // token in the redaction log would have two candidate spans. That log is
  // audit evidence. The message deliberately does not quote the input.
  if (PLACEHOLDER_TOKEN.test(source)) {
    throw new Error(
      'redact() received text that already contains a redaction placeholder. '
      + 'Redact once, at the trust boundary.',
    );
  }

  const { placeholderByValue, countByType } = context;
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
