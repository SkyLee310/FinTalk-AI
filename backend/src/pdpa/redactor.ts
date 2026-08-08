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

/**
 * First-pass redaction of untrusted raw text.
 *
 * Rejects input that already carries a placeholder: redacting twice emits a
 * second [NRIC_1] beside the first, so every token in the redaction log would
 * have two candidate spans, and that log is audit evidence. For the legitimate
 * second pass over model output, use redactDerived.
 */
export function redact(
  source: string,
  vaultKey: Buffer,
  context: RedactionContext = createRedactionContext(),
): RedactionResult {
  assertVaultKey(vaultKey);

  // The message deliberately does not quote the input.
  if (PLACEHOLDER_TOKEN.test(source)) {
    throw new Error(
      'redact() received text that already contains a redaction placeholder. '
      + 'Redact once, at the trust boundary, or use redactDerived for model '
      + 'output built from already-redacted text.',
    );
  }

  return redactCore(source, vaultKey, context);
}

/**
 * Verification pass over text derived from already-redacted text, such as an
 * LLM summary.
 *
 * Existing placeholders are the input's correct state here, not evidence of a
 * double redaction, so the collision guard does not apply. Any identifier this
 * pass finds was introduced by the model, and callers are expected to treat
 * that as a failure rather than a repair — see processMeeting.
 */
export function redactDerived(
  source: string,
  vaultKey: Buffer,
  context: RedactionContext = createRedactionContext(),
): RedactionResult {
  assertVaultKey(vaultKey);
  return redactCore(source, vaultKey, context);
}

function redactCore(
  source: string,
  vaultKey: Buffer,
  context: RedactionContext,
): RedactionResult {
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
