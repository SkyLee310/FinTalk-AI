import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SelectHTMLAttributes,
  SyntheticEvent,
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

/**
 * One idea per page, stated once, at the top.
 *
 * `action` holds the page's single primary action. Passing two is possible and
 * should not be done: the point is that someone arriving on a screen can tell what
 * it is for and what to do next without reading all of it, and two equally
 * weighted buttons destroy exactly that.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="max-w-2xl">
        {eyebrow !== undefined && (
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-brand">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1.5 text-section font-semibold sm:text-[2rem] sm:leading-[1.12] sm:tracking-[-0.018em]">
          {title}
        </h1>
        {lead !== undefined && <p className="mt-2.5 text-body text-muted">{lead}</p>}
      </div>
      {action !== undefined && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  );
}

/**
 * A titled band of content.
 *
 * The heading is a real h2 rather than a styled div, so the page keeps an outline
 * a screen reader can navigate. `description` is for the sentence a first-time
 * reader needs — not for caveats, which belong beside the thing they qualify.
 */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description !== undefined && (
            <p className="mt-1 max-w-2xl text-caption text-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A single figure with its label. Value first, because that is what gets scanned. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-caption text-muted">{label}</p>
      {hint !== undefined && <p className="mt-1 text-caption text-faint">{hint}</p>}
    </div>
  );
}

/**
 * Progressive disclosure for provenance.
 *
 * Model ids, prompt versions, redaction offsets and chain hashes are all things an
 * auditor needs and a decision-maker does not. Collapsed, they stop competing with
 * the decision; removed, the record would stop being auditable. A native
 * <details> so it works before hydration and gets keyboard operation for free
 * instead of reimplementing it.
 */
export function Disclosure({
  summary,
  children,
  open,
  onToggle,
}: {
  summary: string;
  children: ReactNode;
  /** Omit for the existing uncontrolled behavior — the native <details> manages its own state. */
  open?: boolean;
  /** Receives the requested new state. Task 13's accordion only acts on the open case. */
  onToggle?: (open: boolean) => void;
}) {
  const controlled = open !== undefined;

  return (
    <details
      open={open}
      /**
       * Native toggle events are for uncontrolled use only. In controlled
       * mode the click handler below is the single entry point, and keeping
       * this wired as well would report the same interaction twice.
       */
      onToggle={
        controlled || onToggle === undefined
          ? undefined
          : (event: SyntheticEvent<HTMLDetailsElement>) => onToggle(event.currentTarget.open)
      }
      className="group rounded-lg border border-line bg-raised"
    >
      <summary
        /**
         * `open` alone does not actually control a <details>.
         *
         * Clicking a <summary> flips the parent's `open` attribute as a
         * browser default action. React never observes that, so the DOM and
         * the prop diverge — and because React skips writing an attribute
         * whose prop has not changed, a later render will not put it back.
         * A step the controller believed shut could therefore be opened by
         * clicking it, and every guard downstream then refused to act on a
         * panel the user could plainly see.
         *
         * Cancelling the default makes React the only thing that opens or
         * closes a controlled Disclosure. Enter and Space both fire click on
         * a summary, so this covers the keyboard too.
         *
         * Uncontrolled callers get `undefined` here, which also keeps this
         * component renderable from a server component (app/page.tsx) — an
         * event handler on a DOM node there is not serializable.
         */
        onClick={
          controlled
            ? (event: ReactMouseEvent<HTMLElement>) => {
              event.preventDefault();
              onToggle?.(!open);
            }
            : undefined
        }
        className={`cursor-pointer list-none rounded-lg px-4 py-2.5 text-caption font-medium text-muted hover:text-text ${FOCUS}`}
      >
        <span className="inline-block transition group-open:rotate-90" aria-hidden="true">
          ▸
        </span>{' '}
        {summary}
      </summary>
      <div className="border-t border-line px-4 py-3">{children}</div>
    </details>
  );
}

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
  // `active:scale-[0.98]` rides on the existing bare `transition` utility
  // rather than adding `transition-transform` alongside it: Tailwind's
  // default `transition` already includes `transform`/`scale` in its
  // property list, and a second transition-property utility on the same
  // element would race it for which properties actually animate — risking
  // the hover color/opacity transitions above going instant. One
  // transition utility, one clear winner. globals.css's
  // prefers-reduced-motion block still zeroes it, unchanged.
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium tracking-tight transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS} ${VARIANTS[variant]} ${className}`}
    />
  );
}

const CONTROL =
  'w-full rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-sm text-text placeholder:text-faint disabled:opacity-60';

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
