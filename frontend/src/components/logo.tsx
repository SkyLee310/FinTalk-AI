/**
 * Wordless mark: a speech bubble carrying a check. Inherits `currentColor`
 * so it takes the surrounding text colour in either theme.
 */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="32" height="32" rx="9" fill="currentColor" opacity="0.12" />
      <path
        d="M9.25 12.75A3.5 3.5 0 0 1 12.75 9.25h6.5a3.5 3.5 0 0 1 3.5 3.5v3.75a3.5 3.5 0 0 1-3.5 3.5h-4.1l-3.9 2.85V20.5a1.75 1.75 0 0 1-1.75-1.75v-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m13.1 15.05 2.25 2.25 3.6-4.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
