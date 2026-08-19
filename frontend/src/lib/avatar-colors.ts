/**
 * The fixed avatar-accent palette — the only values `avatarColor` may hold.
 *
 * Deliberately a closed set rather than a free-text color: the backend
 * enforces this same list server-side (AVATAR_COLORS in
 * backend/src/routes/auth.routes.ts), so a request that bypasses this UI
 * still cannot set anything outside it.
 */
export const AVATAR_COLORS = ['violet', 'rose', 'teal', 'indigo', 'sky', 'orange'] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

export function isAvatarColor(value: string): value is AvatarColor {
  return (AVATAR_COLORS as readonly string[]).includes(value);
}

/**
 * Tailwind classes for the initials circle, keyed by preset.
 *
 * A lookup table of complete literal strings, deliberately not a template
 * literal like `bg-avatar-${color}-soft` — Tailwind's scanner only picks up
 * class names it can see written out in full in the source, so a
 * dynamically assembled name would compile to nothing.
 */
const CLASSES: Record<AvatarColor, string> = {
  violet: 'bg-avatar-violet-soft text-avatar-violet',
  rose: 'bg-avatar-rose-soft text-avatar-rose',
  teal: 'bg-avatar-teal-soft text-avatar-teal',
  indigo: 'bg-avatar-indigo-soft text-avatar-indigo',
  sky: 'bg-avatar-sky-soft text-avatar-sky',
  orange: 'bg-avatar-orange-soft text-avatar-orange',
};

/** Falls back to the app's default brand tint when unset or unrecognised. */
export function avatarClasses(color: string | null | undefined): string {
  if (color !== null && color !== undefined && isAvatarColor(color)) {
    return CLASSES[color];
  }
  return 'bg-brand-soft text-brand';
}

/** Solid fill for a picker swatch — the color itself, not the soft-tinted pairing above. */
const SWATCH_CLASSES: Record<AvatarColor, string> = {
  violet: 'bg-avatar-violet',
  rose: 'bg-avatar-rose',
  teal: 'bg-avatar-teal',
  indigo: 'bg-avatar-indigo',
  sky: 'bg-avatar-sky',
  orange: 'bg-avatar-orange',
};

export function avatarSwatchClass(color: AvatarColor): string {
  return SWATCH_CLASSES[color];
}
