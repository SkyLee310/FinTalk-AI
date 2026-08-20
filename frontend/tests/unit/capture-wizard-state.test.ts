import { describe, expect, it } from 'vitest';
import { NO_ACKNOWLEDGEMENT } from '../../src/components/transfer-notice';
import {
  addBoardFile,
  advanceFromConsent,
  backToConfirm,
  type CaptureWizardState,
  chooseAudioFile,
  chooseImportAudio,
  finishWhiteboard,
  startSubmitting,
  startWizard,
  submitTitle,
} from '../../src/lib/capture-wizard-state';

function audioFile(): File {
  return new File(['fake'], 'recording.mp3', { type: 'audio/mpeg' });
}

function boardFile(): File {
  return new File(['fake'], 'board.png', { type: 'image/png' });
}

describe('startWizard', () => {
  it('goes straight to consent when a title is already known', () => {
    expect(startWizard('Credit committee review')).toEqual({
      step: 'consent',
      title: 'Credit committee review',
      ack: NO_ACKNOWLEDGEMENT,
    });
  });

  it('asks for a title when none was extracted', () => {
    expect(startWizard('')).toEqual({ step: 'title' });
  });

  it('trims whitespace-only titles down to asking', () => {
    expect(startWizard('   ')).toEqual({ step: 'title' });
  });
});

describe('submitTitle', () => {
  it('moves from title to consent with the trimmed text as the title', () => {
    expect(submitTitle('  Credit committee review  ')).toEqual({
      step: 'consent',
      title: 'Credit committee review',
      ack: NO_ACKNOWLEDGEMENT,
    });
  });
});

describe('the rest of the happy path', () => {
  it('walks consent -> mode -> audio -> whiteboard -> confirm -> submitting -> back to confirm', () => {
    const consent: CaptureWizardState = {
      step: 'consent',
      title: 'T',
      ack: { consentConfirmed: true, transferAcknowledged: true, liveCaptionsConsent: false },
    };

    const mode = advanceFromConsent(consent);
    expect(mode).toEqual({ step: 'mode', title: 'T', ack: consent.ack });
    if (mode.step !== 'mode') throw new Error('expected mode step');

    const audio = chooseImportAudio(mode);
    expect(audio).toEqual({ step: 'audio', title: 'T', ack: consent.ack });
    if (audio.step !== 'audio') throw new Error('expected audio step');

    const file = audioFile();
    const whiteboard = chooseAudioFile(audio, file);
    expect(whiteboard).toEqual({ step: 'whiteboard', title: 'T', ack: consent.ack, audio: file, boardFiles: [] });
    if (whiteboard.step !== 'whiteboard') throw new Error('expected whiteboard step');

    const board = boardFile();
    const withBoard = addBoardFile(whiteboard, { file: board, kind: 'WHITEBOARD' });
    if (withBoard.step !== 'whiteboard') throw new Error('expected whiteboard step');
    expect(withBoard.boardFiles).toEqual([{ file: board, kind: 'WHITEBOARD' }]);

    const confirm = finishWhiteboard(withBoard);
    expect(confirm).toEqual({
      step: 'confirm',
      title: 'T',
      ack: consent.ack,
      audio: file,
      boardFiles: [{ file: board, kind: 'WHITEBOARD' }],
    });
    if (confirm.step !== 'confirm') throw new Error('expected confirm step');

    const submitting = startSubmitting(confirm);
    expect(submitting).toEqual({ ...confirm, step: 'submitting' });
    if (submitting.step !== 'submitting') throw new Error('expected submitting step');

    expect(backToConfirm(submitting)).toEqual(confirm);
  });

  it('finishWhiteboard preserves an empty boardFiles list when nothing was added', () => {
    const whiteboard: CaptureWizardState = {
      step: 'whiteboard',
      title: 'T',
      ack: NO_ACKNOWLEDGEMENT,
      audio: audioFile(),
      boardFiles: [],
    };
    if (whiteboard.step !== 'whiteboard') throw new Error('expected whiteboard step');
    expect(finishWhiteboard(whiteboard)).toEqual({ ...whiteboard, step: 'confirm' });
  });
});
