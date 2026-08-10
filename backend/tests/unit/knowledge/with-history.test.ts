import { describe, expect, it } from 'vitest';
import { withHistory } from '../../../src/knowledge/assistant.js';

/**
 * `withHistory` is the entire surface of multi-turn Ask: a pure string
 * transform, so a follow-up question can be resolved against what was asked
 * and answered before it without changing any provider signature.
 */

describe('withHistory', () => {
  it('returns the question unchanged when history is absent', () => {
    expect(withHistory('What is the profit rate?')).toBe('What is the profit rate?');
  });

  it('returns the question unchanged when history is empty', () => {
    expect(withHistory('What is the profit rate?', [])).toBe('What is the profit rate?');
  });

  it('folds one prior turn in with the new question', () => {
    const composite = withHistory('What about the second one?', [
      { role: 'user', content: 'What facilities were discussed this week?' },
      { role: 'assistant', content: 'Two facilities: a working capital line and a term loan.' },
    ]);

    expect(composite).toContain('What facilities were discussed this week?');
    expect(composite).toContain('Two facilities: a working capital line and a term loan.');
    expect(composite).toContain('What about the second one?');
  });

  it('preserves turn order across multiple prior turns', () => {
    const composite = withHistory('And after that?', [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
      { role: 'assistant', content: 'second answer' },
    ]);

    expect(composite.indexOf('first question')).toBeLessThan(composite.indexOf('first answer'));
    expect(composite.indexOf('first answer')).toBeLessThan(composite.indexOf('second question'));
    expect(composite.indexOf('second question')).toBeLessThan(composite.indexOf('second answer'));
    expect(composite.indexOf('second answer')).toBeLessThan(composite.indexOf('And after that?'));
  });

  it('labels roles distinguishably', () => {
    const composite = withHistory('follow-up', [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
    ]);

    expect(composite).toMatch(/user/i);
    expect(composite).toMatch(/assistant/i);
  });
});
