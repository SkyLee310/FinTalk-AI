import { describe, expect, it } from 'vitest';
import { guessAttachmentKind, isKindFixed } from '../../src/lib/attachment-kind';

describe('isKindFixed', () => {
  it('is fixed for a .docx by mime type', () => {
    expect(
      isKindFixed({
        name: 'terms.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe(true);
  });

  it('is fixed for a .docx by extension alone, when the browser reports no mime type', () => {
    expect(isKindFixed({ name: 'terms.DOCX', type: '' })).toBe(true);
  });

  it('is not fixed for an image or a PDF', () => {
    expect(isKindFixed({ name: 'board.png', type: 'image/png' })).toBe(false);
    expect(isKindFixed({ name: 'scan.pdf', type: 'application/pdf' })).toBe(false);
  });
});

describe('guessAttachmentKind', () => {
  it('guesses DOCUMENT for a .docx, regardless of filename', () => {
    expect(
      guessAttachmentKind({
        name: 'board_1.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe('DOCUMENT');
  });

  it('guesses DOCUMENT for a PDF', () => {
    expect(guessAttachmentKind({ name: 'scan.pdf', type: 'application/pdf' })).toBe('DOCUMENT');
  });

  it('guesses SLIDE for an image whose name suggests a slide', () => {
    expect(guessAttachmentKind({ name: 'Q3-deck.png', type: 'image/png' })).toBe('SLIDE');
    expect(guessAttachmentKind({ name: 'slide_04.jpg', type: 'image/jpeg' })).toBe('SLIDE');
  });

  it('falls back to WHITEBOARD for any other image', () => {
    expect(guessAttachmentKind({ name: 'board_1.jpg', type: 'image/jpeg' })).toBe('WHITEBOARD');
    expect(guessAttachmentKind({ name: 'IMG_2043.HEIC', type: 'image/heic' })).toBe('WHITEBOARD');
  });
});
