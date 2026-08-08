import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/**
 * Form and feedback primitives, sharing the token set from globals.css.
 *
 * Every control is a real element with a real label association, and disabled
 * states live on the element rather than only in styling, so a keyboard or
 * screen-reader user gets the same information a sighted one does.
 */

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

const VARIANTS = {
  primary: 'bg-brand text-canvas hover:opacity-90',
  secondary: 'border border-line-strong bg-surface text-text hover:bg-raised',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:opacity-90',
} as const;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium tracking-tight transition disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} ${VARIANTS[variant]} ${className}`}
    />
  );
}

const CONTROL =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-faint disabled:opacity-60';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${FOCUS} ${className}`} />;
}

export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} ${FOCUS} ${className}`} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} ${FOCUS} ${className}`} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className="size-3.5 animate-spin rounded-full border-2 border-line-strong border-t-brand"
      />
      {label}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

/** role="alert" so a failure is announced, not merely coloured. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      {children}
    </div>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-ok/40 bg-ok-soft px-4 py-3 text-sm text-ok"
    >
      {children}
    </div>
  );
}
