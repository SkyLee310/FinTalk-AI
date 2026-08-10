/**
 * Tailwind column classes for a row of role-specific stat tiles on /home.
 *
 * The section-card grid below keeps its own fixed `sm:grid-cols-2
 * lg:grid-cols-3` — that grid always holds several cards. This one is for
 * a row that might hold just one or two tiles depending on role, where a
 * fixed three-up class would leave visible dead space beside them. This
 * picks the narrowest grid that still fits every tile at each breakpoint.
 */
export function gridColumnClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
}
