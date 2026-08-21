'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { Home } from 'lucide-react';
import { FallingLogoBackground } from '@/components/falling-logo-background';
import { GlassPanel } from '@/components/glass-panel';
import { toast } from '@/components/toast';
import { Button, ErrorNote, Field, Input, Spinner, SuccessNote } from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { visibleNav } from '@/lib/nav';
import { navigateWithTransition } from '@/lib/view-transition';

type Mode = 'signin' | 'signup';

const DEMO_PASSWORD = 'Demo!2345';
const DEMO_ACCOUNTS = [
  {
    role: 'Maker',
    email: 'maker@fintalk.ai',
    title: 'Relationship Mgr',
    desc: 'Records meetings & drafts credit term sheets.',
    badge: 'Draft',
  },
  {
    role: 'Checker',
    email: 'checker@fintalk.ai',
    title: 'Credit Officer',
    desc: 'Approves term sheets & simulates disbursement.',
    badge: 'Approve',
  },
  {
    role: 'Shariah',
    email: 'shariah@fintalk.ai',
    title: 'Compliance Officer',
    desc: 'Screens & resolves Shariah compliance flags.',
    badge: 'Review',
  },
  {
    role: 'Oversight',
    email: 'oversight@fintalk.ai',
    title: 'Auditor',
    desc: 'Read-only access across meetings & audit trail.',
    badge: 'Audit',
  },
  {
    role: 'Admin',
    email: 'admin@fintalk.ai',
    title: 'Administrator',
    desc: 'Manages user roles & system settings.',
    badge: 'Admin',
  },
] as const;

/**
 * The one sign-in path both the real form and the one-click demo buttons
 * use — a demo button is not a shortcut around login, it is the same call
 * with the credentials pre-filled. Lands each role on the first section its
 * own nav contains (visibleNav) rather than a fixed page, so a role without
 * Capture never opens on a capability error; /settings is the fallback for
 * the one session with no visible section at all (an OVERSIGHT account with
 * neither view flag set).
 */
async function performSignIn(
  router: ReturnType<typeof useRouter>,
  email: string,
  password: string,
): Promise<string | null> {
  try {
    const session = await api.login(email, password);
    const destination = visibleNav(session)[0];
    toast(destination ? `Signed in — opening ${destination.label}` : 'Signed in', 'ok');
    navigateWithTransition(() => router.push(destination?.href ?? '/settings'));
    return null;
  } catch (cause) {
    return describeError(cause);
  }
}

/**
 * `useSearchParams` opts a statically-prerendered client page into
 * client-side rendering up to the nearest Suspense boundary, and `next build`
 * fails outright without one. So the page is that boundary, and the work
 * lives in LoginPageContent below.
 */
export default function LoginPage() {
  return (
    <>
      <FallingLogoBackground />
      {/* Top-left rounded home button */}
      <Link
        href="/"
        aria-label="Back to main page"
        title="Back to main page"
        className="fixed top-5 left-5 z-40 flex size-11 items-center justify-center rounded-2xl border border-glass-border bg-glass-bg shadow-md shadow-black/5 dark:shadow-black/30 backdrop-blur-2xl text-text transition-all duration-150 hover:scale-105 hover:bg-surface hover:text-brand active:scale-95"
      >
        <Home className="size-5" />
      </Link>

      <Suspense
        fallback={
          <main
            id="main"
            className="relative z-10 mx-auto flex min-h-[80vh] max-w-md items-center justify-center px-5"
          >
            <Spinner label="Loading" />
          </main>
        }
      >
        <LoginPageContent />
      </Suspense>
    </>
  );
}

/**
 * One page, two doors. A segmented control rather than two routes because
 * both forms are asking the same question — "let me in" versus "let me
 * ask to be let in" — and switching between them should feel like flipping
 * a toggle, not navigating away.
 *
 * Which door opens comes from `?mode=`, so that the landing page's Sign up
 * button can actually mean Sign up. It seeds the initial state only, rather
 * than staying bound to the URL: the segmented control is the authority once
 * the page is up, and rewriting the query string on every toggle would put a
 * history entry behind switching a tab.
 */
function LoginPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.get('mode') === 'signup' ? 'signup' : 'signin',
  );
  const [registered, setRegistered] = useState(false);

  // Lifted out of SignInForm so a demo-account click can drive the same
  // visible fields and the same submit path as typing them in by hand — the
  // point is to watch the credentials appear and then submit, not to sign
  // in through some parallel, invisible route.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(signInEmail: string, signInPassword: string): Promise<void> {
    setBusy(true);
    setError(null);
    const failure = await performSignIn(router, signInEmail, signInPassword);
    if (failure !== null) setError(failure);
    setBusy(false);
  }

  if (registered) {
    return (
      <main
        id="main"
        className="relative z-10 mx-auto flex min-h-[85vh] max-w-md flex-col justify-center px-5 py-12"
      >
        <GlassPanel className="p-6 sm:p-8">
          <SuccessNote>
            Your request has been submitted. An administrator will review it and assign
            your access.
          </SuccessNote>
          {/*
            Deliberately no session here: a PENDING account has no role, and
            there is nothing yet for a session to grant. The only place this
            person moves next is back to a sign-in attempt, which will refuse
            them by name (Task 2's 403) until an admin approves them.
          */}
          <Button
            type="button"
            variant="secondary"
            className="mt-4 w-full"
            onClick={() => {
              setRegistered(false);
              setMode('signin');
            }}
          >
            Back to sign in
          </Button>
        </GlassPanel>
      </main>
    );
  }

  return (
    <main
      id="main"
      className="relative z-10 mx-auto flex min-h-[85vh] max-w-md flex-col justify-center px-5 py-12"
    >
      <GlassPanel className="p-6 sm:p-8">
        <div
          role="tablist"
          aria-label="Sign in or sign up"
          className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-line-strong bg-surface/70 dark:bg-raised/70 p-1 backdrop-blur-md"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => setMode('signin')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              mode === 'signin'
                ? 'bg-surface text-text shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted hover:text-text'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            onClick={() => setMode('signup')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              mode === 'signup'
                ? 'bg-surface text-text shadow-[0_1px_2px_rgb(0_0_0/0.06)]'
                : 'text-muted hover:text-text'
            }`}
          >
            Sign up
          </button>
        </div>

        <div className="mb-6">
          <h2 className="text-[1.75rem] font-bold leading-tight tracking-[-0.02em] sm:text-[2rem]">
            {mode === 'signin' ? 'Sign in' : 'Request access'}
          </h2>
        </div>

        {mode === 'signin' ? (
          <SignInForm
            email={email}
            password={password}
            onEmailChange={setEmail}
            onPasswordChange={setPassword}
            error={error}
            busy={busy}
            onSubmit={() => void signIn(email, password)}
          />
        ) : (
          <SignUpForm onSuccess={() => setRegistered(true)} />
        )}
      </GlassPanel>

      {/*
        The seeded accounts, shown because this build runs against synthetic
        data. A deployment holding real records must not ship this block.
        Sign-in only: someone signing up has no seeded account to use.
      */}
      {mode === 'signin' && (
        <DemoAccounts
          busy={busy}
          onSelect={(account) => {
            setEmail(account.email);
            setPassword(DEMO_PASSWORD);
            void signIn(account.email, DEMO_PASSWORD);
          }}
        />
      )}
    </main>
  );
}

/**
 * Controlled by LoginPageContent, not self-contained: a demo-account click
 * has to land in these same fields and go through this same submit, so
 * there is exactly one sign-in path with two ways to fill it in.
 */
function SignInForm({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  error,
  busy,
  onSubmit,
}: {
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
      noValidate
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="min-h-[160px] space-y-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </Field>
      </div>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

/**
 * One click, straight into that role's account — for pitching, where typing
 * out credentials between roles breaks the flow. `onSelect` fills the real
 * form fields and submits through the same `signIn` the manual form uses
 * (LoginPageContent), so a viewer watching the screen sees the email and
 * password actually appear before it signs in, not a login that happens
 * out of nowhere.
 */
function DemoAccounts({
  busy,
  onSelect,
}: {
  busy: boolean;
  onSelect: (account: (typeof DEMO_ACCOUNTS)[number]) => void;
}) {
  return (
    <GlassPanel className="mt-5 p-4 text-xs text-muted">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-text">Demo Roles</p>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[0.65rem] font-medium text-brand border border-brand/20">
          One-Click Login
        </span>
      </div>

      {/* Role Pill Buttons */}
      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="group" aria-label="Demo accounts">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            disabled={busy}
            onClick={() => onSelect(account)}
            className="group flex flex-col items-start rounded-xl border border-line-strong bg-surface/70 p-2 text-left transition-all duration-150 hover:border-brand/40 hover:bg-raised active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex w-full items-center justify-between gap-1">
              <span className="font-mono text-xs font-bold text-text group-hover:text-brand">
                {account.role}
              </span>
              <span className="text-[0.6rem] font-medium text-brand">
                {account.badge}
              </span>
            </div>
            <span className="text-[0.68rem] text-muted truncate w-full">
              {account.title}
            </span>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SignUpFields {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  username: string;
  staffId: string;
}

const EMPTY_FIELDS: SignUpFields = {
  displayName: '',
  email: '',
  password: '',
  confirmPassword: '',
  username: '',
  staffId: '',
};

/**
 * Mirrors the server's own validation (POST /auth/register's RegisterBody):
 * email shape, password >= 8, username >= 3. Client-side checks exist so a
 * person sees what is wrong before a round trip, not instead of the
 * server's — the server re-validates everything here regardless.
 */
function validate(fields: SignUpFields): Partial<Record<keyof SignUpFields, string>> {
  const errors: Partial<Record<keyof SignUpFields, string>> = {};

  if (fields.displayName.trim() === '') {
    errors.displayName = 'Enter your full name.';
  }
  if (!EMAIL_SHAPE.test(fields.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (fields.password.length < 8) {
    errors.password = 'Use at least 8 characters.';
  }
  // Confirm-password is never sent — it exists purely for this check.
  if (fields.confirmPassword !== fields.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  if (fields.username.trim().length < 3) {
    errors.username = 'Use at least 3 characters.';
  }
  if (fields.staffId.trim() === '') {
    errors.staffId = 'Enter your staff ID.';
  }

  return errors;
}

/**
 * The backend's ApiError carries only `detail` text (no structured field
 * name — see http/problem.ts), so a duplicate is attributed to a field by
 * matching the word each of the two 409 messages actually uses
 * ("email"/"username"). Any other 409 or error falls through to the
 * page-level ErrorNote instead of guessing at a field.
 */
function duplicateField(cause: unknown): { field: 'email' | 'username'; message: string } | null {
  if (!(cause instanceof ApiError) || cause.status !== 409) return null;
  const lower = cause.detail.toLowerCase();
  if (lower.includes('email')) return { field: 'email', message: cause.detail };
  if (lower.includes('username')) return { field: 'username', message: cause.detail };
  return null;
}

function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const [fields, setFields] = useState<SignUpFields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof SignUpFields, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof SignUpFields>(key: K, value: string): void {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const errors = validate(fields);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      await api.register({
        displayName: fields.displayName.trim(),
        email: fields.email.trim(),
        password: fields.password,
        username: fields.username.trim(),
        staffId: fields.staffId.trim(),
      });
      onSuccess();
    } catch (cause) {
      const duplicate = duplicateField(cause);
      if (duplicate) {
        setFieldErrors((prev) => ({ ...prev, [duplicate.field]: duplicate.message }));
      } else {
        setError(describeError(cause));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-4"
      noValidate
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="custom-scrollbar h-[160px] space-y-4 overflow-y-auto pr-2 -mr-1">
        <Field label="Full name" htmlFor="displayName" hint={fieldErrors.displayName}>
          <Input
            id="displayName"
            name="displayName"
            autoComplete="name"
            required
            value={fields.displayName}
            onChange={(event) => set('displayName', event.target.value)}
          />
        </Field>

        <Field label="Email" htmlFor="signup-email" hint={fieldErrors.email}>
          <Input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={fields.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="signup-password" hint={fieldErrors.password}>
          <Input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={fields.password}
            onChange={(event) => set('password', event.target.value)}
          />
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          hint={fieldErrors.confirmPassword}
        >
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={fields.confirmPassword}
            onChange={(event) => set('confirmPassword', event.target.value)}
          />
        </Field>

        <Field label="Username" htmlFor="username" hint={fieldErrors.username}>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            required
            value={fields.username}
            onChange={(event) => set('username', event.target.value)}
          />
        </Field>

        <Field label="Staff ID" htmlFor="staffId" hint={fieldErrors.staffId}>
          <Input
            id="staffId"
            name="staffId"
            autoComplete="off"
            required
            value={fields.staffId}
            onChange={(event) => set('staffId', event.target.value)}
          />
        </Field>
      </div>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Submitting…' : 'Request access'}
      </Button>
    </form>
  );
}
