declare const redactedBrand: unique symbol;

/**
 * Text that has passed the redaction barrier.
 *
 * The brand symbol is not exported, so no other module can build a value of
 * this type structurally — a plain `string` will not satisfy it. Persistence
 * accepts only `RedactedText`, which makes "personal data is redacted before
 * anything is stored" a condition the compiler checks rather than a rule
 * reviewers have to remember.
 *
 * A deliberate `as unknown as RedactedText` can still defeat this. That is
 * what tests/unit/pdpa/architecture.test.ts is for: it fails if any module
 * other than pdpa/redactor.ts performs the cast.
 */
export type RedactedText = string & { readonly [redactedBrand]: 'redacted' };
