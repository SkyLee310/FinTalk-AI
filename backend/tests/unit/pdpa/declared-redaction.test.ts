import { describe, expect, it } from 'vitest';
import {
  createRedactionContext,
  redact,
  redactDeclaredValue,
} from '../../../src/pdpa/redactor.js';
import { open } from '../../../src/pdpa/vault.js';

const KEY = Buffer.alloc(32, 9);

/**
 * Invented names. They exist to prove a labelled field is sealed whether or not
 * any pattern recognises it.
 */
const NAME = 'Nurul Aisyah binti Rahman';
const OTHER_NAME = 'Tan Wei Ming';

describe('redactDeclaredValue', () => {
  /**
   * The reason this function exists at all.
   *
   * If the detectors ever start finding names, the participant path stays
   * correct — but this assertion is what documents the premise, and it fails
   * loudly rather than silently if that premise changes.
   */
  it('demonstrates that detection alone leaves a name in the clear', () => {
    const detected = redact(NAME, KEY);
    expect(detected.records).toHaveLength(0);
    expect(detected.text).toBe(NAME);
  });

  it('replaces the entire value with a placeholder', () => {
    const { text, records } = redactDeclaredValue(NAME, 'PERSON_NAME', KEY);

    expect(text).toBe('[PERSON_NAME_1]');
    expect(text).not.toContain('Nurul');
    expect(records).toHaveLength(1);
  });

  it('seals the original so it is recoverable from the vault and nowhere else', () => {
    const { records } = redactDeclaredValue(NAME, 'PERSON_NAME', KEY);
    const record = records[0];
    if (record === undefined) throw new Error('expected one record');

    expect(open(record.sealed, KEY)).toBe(NAME);
  });

  it('marks the row as declared rather than detected', () => {
    const { records } = redactDeclaredValue(NAME, 'PERSON_NAME', KEY);
    const record = records[0];
    if (record === undefined) throw new Error('expected one record');

    // An auditor must be able to tell an assertion from an inference.
    // 'declared' means a human labelled the field; a detector name means a
    // pattern matched.
    expect(record.detectedBy).toBe('declared');
    expect(record.confidence).toBe(1);
  });

  it('points its offsets at the whole placeholder', () => {
    const { text, records } = redactDeclaredValue(NAME, 'PERSON_NAME', KEY);
    const record = records[0];
    if (record === undefined) throw new Error('expected one record');

    expect(record.startOffset).toBe(0);
    expect(record.endOffset).toBe(text.length);
    expect(text.slice(record.startOffset, record.endOffset)).toBe(record.placeholder);
  });

  it('gives one person one placeholder across a shared context', () => {
    const context = createRedactionContext();
    const first = redactDeclaredValue(NAME, 'PERSON_NAME', KEY, context);
    const second = redactDeclaredValue(OTHER_NAME, 'PERSON_NAME', KEY, context);
    const repeat = redactDeclaredValue(NAME, 'PERSON_NAME', KEY, context);

    expect(first.text).toBe('[PERSON_NAME_1]');
    expect(second.text).toBe('[PERSON_NAME_2]');
    // The same participant entered twice must not read as two people.
    expect(repeat.text).toBe('[PERSON_NAME_1]');
  });

  it('treats surrounding whitespace as the same person', () => {
    const context = createRedactionContext();
    const bare = redactDeclaredValue(NAME, 'PERSON_NAME', KEY, context);
    const padded = redactDeclaredValue(`  ${NAME}  `, 'PERSON_NAME', KEY, context);

    expect(padded.text).toBe(bare.text);
  });

  it('refuses a blank value without quoting it', () => {
    expect(() => redactDeclaredValue('   ', 'PERSON_NAME', KEY)).toThrow(/blank/i);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => redactDeclaredValue(NAME, 'PERSON_NAME', Buffer.alloc(16))).toThrow();
  });

  it('numbers each type independently', () => {
    const context = createRedactionContext();
    const name = redactDeclaredValue(NAME, 'PERSON_NAME', KEY, context);
    const address = redactDeclaredValue('12 Jalan Contoh', 'ADDRESS', KEY, context);

    expect(name.text).toBe('[PERSON_NAME_1]');
    expect(address.text).toBe('[ADDRESS_1]');
  });
});
