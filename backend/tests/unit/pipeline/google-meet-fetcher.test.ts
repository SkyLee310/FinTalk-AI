import { describe, expect, it } from 'vitest';
import {
  convertToSegments,
  extractMeetingCode,
  type GoogleTranscriptEntry,
} from '../../../src/pipeline/google-meet-fetcher.js';

describe('google-meet-fetcher', () => {
  describe('extractMeetingCode', () => {
    it('extracts meeting code from standard meet.google.com URLs', () => {
      expect(extractMeetingCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
      expect(extractMeetingCode('http://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
      expect(extractMeetingCode('meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
    });

    it('extracts meeting code from raw code string with uppercase letters', () => {
      expect(extractMeetingCode('ABC-DEFG-HIJ')).toBe('abc-defg-hij');
    });

    it('throws GoogleMeetFetcherError on invalid URL or code', () => {
      expect(() => extractMeetingCode('https://invalid.com/123')).toThrow(/Invalid Google Meet/);
      expect(() => extractMeetingCode('')).toThrow(/Invalid Google Meet/);
    });
  });

  describe('convertToSegments', () => {
    it('converts Google transcript entries into FinTalk SegmentDrafts', () => {
      const mockEntries: GoogleTranscriptEntry[] = [
        {
          participant: 'users/1001',
          text: 'Welcome everyone to the credit committee meeting.',
          startTime: '2026-08-19T10:00:00.000Z',
          endTime: '2026-08-19T10:00:05.000Z',
        },
        {
          participant: 'users/1002',
          text: 'We are reviewing the SME facility application.',
          startTime: '2026-08-19T10:00:06.000Z',
          endTime: '2026-08-19T10:00:10.000Z',
        },
        {
          participant: 'users/1001',
          text: 'Please confirm Shariah compliance requirements.',
          startTime: '2026-08-19T10:00:11.000Z',
          endTime: '2026-08-19T10:00:15.000Z',
        },
      ];

      const segments = convertToSegments(
        mockEntries,
        new Date('2026-08-19T10:00:00.000Z').getTime(),
      );

      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({
        startMs: 0,
        endMs: 5000,
        speakerLabel: 'Speaker 1',
        text: 'Welcome everyone to the credit committee meeting.',
        confidence: 0.95,
      });

      expect(segments[1]).toEqual({
        startMs: 6000,
        endMs: 10000,
        speakerLabel: 'Speaker 2',
        text: 'We are reviewing the SME facility application.',
        confidence: 0.95,
      });

      // Same participant as segment 0 -> same speaker label
      expect(segments[2].speakerLabel).toBe('Speaker 1');
      expect(segments[2].startMs).toBe(11000);
      expect(segments[2].endMs).toBe(15000);
    });

    it('returns empty array when entries are empty', () => {
      expect(convertToSegments([])).toEqual([]);
    });

    it('filters out entries with empty or whitespace-only text', () => {
      const mockEntries: GoogleTranscriptEntry[] = [
        {
          participant: 'users/1001',
          text: '   ',
          startTime: '2026-08-19T10:00:00.000Z',
          endTime: '2026-08-19T10:00:05.000Z',
        },
      ];

      expect(convertToSegments(mockEntries)).toEqual([]);
    });
  });
});
