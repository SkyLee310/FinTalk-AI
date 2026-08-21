import { describe, expect, it } from 'vitest';
import { detectStartCaptureIntent } from '../../../src/knowledge/intent.js';

describe('detectStartCaptureIntent', () => {
  it('matches each recognized opening verb', () => {
    expect(detectStartCaptureIntent('start a meeting')).toEqual({ action: 'start_capture', title: '' });
    expect(detectStartCaptureIntent('record a new meeting')).toEqual({ action: 'start_capture', title: '' });
    expect(detectStartCaptureIntent('capture a meeting')).toEqual({ action: 'start_capture', title: '' });
    expect(detectStartCaptureIntent('create a meeting')).toEqual({ action: 'start_capture', title: '' });
    expect(detectStartCaptureIntent('setup a meeting')).toEqual({ action: 'start_capture', title: '' });
    expect(detectStartCaptureIntent('set up a meeting')).toEqual({ action: 'start_capture', title: '' });
  });

  it('extracts a title from the Cowork panel\'s own example phrasing', () => {
    expect(detectStartCaptureIntent('Setup a meeting called SME discussion'))
      .toEqual({ action: 'start_capture', title: 'SME discussion' });
  });

  it('accepts "please" and "a/an/another/new" variants on "create"', () => {
    expect(detectStartCaptureIntent('please create a meeting')).not.toBeNull();
    expect(detectStartCaptureIntent('create an new recording')).not.toBeNull();
    expect(detectStartCaptureIntent('create another meeting')).not.toBeNull();
    expect(detectStartCaptureIntent('create a new capture')).not.toBeNull();
  });

  it('pulls a quoted title over a trailing clause', () => {
    const result = detectStartCaptureIntent('create a meeting called "Credit committee review" for today');
    expect(result).toEqual({ action: 'start_capture', title: 'Credit committee review' });
  });

  it('pulls a trailing "called/titled/for/about" clause when unquoted', () => {
    expect(detectStartCaptureIntent('create a meeting called Term Sheet Walkthrough'))
      .toEqual({ action: 'start_capture', title: 'Term Sheet Walkthrough' });
  });

  it('does not match "create" when it is not the opening word', () => {
    // A real question that happens to contain "create" must not be hijacked.
    expect(detectStartCaptureIntent('How do I create a term sheet from a meeting?')).toBeNull();
  });

  it('returns null for an ordinary finance question', () => {
    expect(detectStartCaptureIntent('What is the markup on a Murabahah facility?')).toBeNull();
  });
});
