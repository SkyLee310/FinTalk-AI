import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { submitCapture } from '../../src/lib/submit-capture';

vi.mock('../../src/lib/api', () => ({
  api: {
    uploadMeeting: vi.fn(),
    uploadWhiteboard: vi.fn(),
  },
}));

const uploadMeeting = vi.mocked(api.uploadMeeting);
const uploadWhiteboard = vi.mocked(api.uploadWhiteboard);

function audioBlob(): Blob {
  return new Blob(['fake-audio-bytes'], { type: 'audio/webm' });
}

function imageFile(name: string): File {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

beforeEach(() => {
  uploadMeeting.mockReset();
  uploadWhiteboard.mockReset();
});

describe('submitCapture', () => {
  it('sends the required fields and omits optional ones when absent', async () => {
    uploadMeeting.mockResolvedValue({ meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' });

    await submitCapture({
      title: 'Credit committee review',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      audio: audioBlob(),
    });

    expect(uploadMeeting).toHaveBeenCalledTimes(1);
    const form = uploadMeeting.mock.calls[0]?.[0] as FormData;
    expect(form.get('title')).toBe('Credit committee review');
    expect(form.get('occurredAt')).toBe('2026-08-20T10:00:00.000Z');
    expect(form.get('consentConfirmed')).toBe('true');
    expect(form.get('transferAcknowledged')).toBe('true');
    expect(form.get('description')).toBeNull();
    expect(form.get('participants')).toBeNull();
    expect(form.get('durationMs')).toBeNull();
    expect(form.get('audio')).toBeInstanceOf(Blob);
  });

  it('includes description, participants and durationMs when given', async () => {
    uploadMeeting.mockResolvedValue({ meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' });

    await submitCapture({
      title: 'T',
      description: 'Notes',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      participants: [{ name: 'Alice', role: 'Credit Manager' }],
      audio: audioBlob(),
      durationMs: 61234.6,
    });

    const form = uploadMeeting.mock.calls[0]?.[0] as FormData;
    expect(form.get('description')).toBe('Notes');
    expect(form.get('participants')).toBe(JSON.stringify([{ name: 'Alice', role: 'Credit Manager' }]));
    expect(form.get('durationMs')).toBe('61235');
  });

  it('calls onAccepted once the meeting is created, before any whiteboard upload', async () => {
    const order: string[] = [];
    uploadMeeting.mockImplementation(async () => {
      order.push('uploadMeeting');
      return { meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' };
    });
    uploadWhiteboard.mockImplementation(async () => {
      order.push('uploadWhiteboard');
      return { whiteboardId: 'w1', redactionCount: 0 };
    });

    await submitCapture({
      title: 'T',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      audio: audioBlob(),
      boardFiles: [{ file: imageFile('board.png'), kind: 'WHITEBOARD' }],
      onAccepted: () => order.push('onAccepted'),
    });

    expect(order).toEqual(['uploadMeeting', 'onAccepted', 'uploadWhiteboard']);
  });

  it('extracts every board file best-effort, aggregating counts and failures', async () => {
    uploadMeeting.mockResolvedValue({ meetingId: 'm1', status: 'CAPTURED', pollUrl: '/x' });
    uploadWhiteboard
      .mockResolvedValueOnce({ whiteboardId: 'w1', redactionCount: 2 })
      .mockRejectedValueOnce(new Error('too large'))
      .mockResolvedValueOnce({ whiteboardId: 'w3', redactionCount: 1 });

    const result = await submitCapture({
      title: 'T',
      occurredAt: '2026-08-20T10:00:00.000Z',
      consentConfirmed: true,
      transferAcknowledged: true,
      audio: audioBlob(),
      boardFiles: [
        { file: imageFile('a.png'), kind: 'WHITEBOARD' },
        { file: imageFile('b.png'), kind: 'SLIDE' },
        { file: imageFile('c.png'), kind: 'DOCUMENT' },
      ],
    });

    expect(result).toEqual({
      meetingId: 'm1',
      boardExtractedCount: 2,
      boardMaskedCount: 3,
      boardFailures: ['b.png (too large)'],
    });
  });

  it('rejects without ever calling uploadWhiteboard when uploadMeeting itself fails', async () => {
    uploadMeeting.mockRejectedValue(new Error('network down'));

    await expect(
      submitCapture({
        title: 'T',
        occurredAt: '2026-08-20T10:00:00.000Z',
        consentConfirmed: true,
        transferAcknowledged: true,
        audio: audioBlob(),
        boardFiles: [{ file: imageFile('a.png'), kind: 'WHITEBOARD' }],
      }),
    ).rejects.toThrow('network down');
    expect(uploadWhiteboard).not.toHaveBeenCalled();
  });
});
