import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime } from '../../src/lib/format';

describe('formatDate', () => {
  it('renders day-month-year with a short month name', () => {
    expect(formatDate(new Date(2026, 7, 17))).toBe('17 Aug 2026');
  });

  it('accepts an ISO string', () => {
    expect(formatDate('2026-01-05T00:00:00')).toBe('5 Jan 2026');
  });
});

describe('formatDateTime', () => {
  it('renders "D Mon YYYY, H:MM AM/PM" — Malaysia order, never US M/D/Y', () => {
    expect(formatDateTime(new Date(2026, 7, 17, 20, 27))).toBe('17 Aug 2026, 8:27 PM');
  });

  it('pads single-digit minutes', () => {
    expect(formatDateTime(new Date(2026, 7, 17, 8, 5))).toBe('17 Aug 2026, 8:05 AM');
  });

  it('renders midnight as 12 AM and noon as 12 PM', () => {
    expect(formatDateTime(new Date(2026, 7, 17, 0, 0))).toBe('17 Aug 2026, 12:00 AM');
    expect(formatDateTime(new Date(2026, 7, 17, 12, 0))).toBe('17 Aug 2026, 12:00 PM');
  });
});

describe('formatTime', () => {
  it('renders "H:MM:SS AM/PM" with no date', () => {
    expect(formatTime(new Date(2026, 7, 17, 20, 27, 41))).toBe('8:27:41 PM');
  });

  it('pads single-digit minutes and seconds', () => {
    expect(formatTime(new Date(2026, 7, 17, 8, 5, 9))).toBe('8:05:09 AM');
  });

  it('renders midnight as 12 AM and noon as 12 PM', () => {
    expect(formatTime(new Date(2026, 7, 17, 0, 0, 0))).toBe('12:00:00 AM');
    expect(formatTime(new Date(2026, 7, 17, 12, 0, 0))).toBe('12:00:00 PM');
  });
});
