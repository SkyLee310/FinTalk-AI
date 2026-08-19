/**
 * Date and time formatting for a Malaysian audience: D/M/Y order, a short
 * month name, and a 12-hour clock — never the US-style M/D/Y that
 * `toLocaleString()` falls back to without an explicit locale.
 *
 * Built from Date getters rather than `toLocaleString(locale, options)` so
 * the exact punctuation ("17 Aug 2026, 8:27 PM") is guaranteed rather than
 * left to whatever ICU data the runtime happens to ship.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function toDate(input: string | Date): Date {
  return typeof input === 'string' ? new Date(input) : input;
}

/** "17 Aug 2026" */
export function formatDate(input: string | Date): string {
  const date = toDate(input);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "17 Aug 2026, 8:27 PM" */
export function formatDateTime(input: string | Date): string {
  const date = toDate(input);
  const hours24 = date.getHours();
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(date)}, ${hours12}:${minutes} ${period}`;
}

/** "8:27:41 PM" — a same-day timestamp where only the time matters. */
export function formatTime(input: string | Date): string {
  const date = toDate(input);
  const hours24 = date.getHours();
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours12}:${minutes}:${seconds} ${period}`;
}
