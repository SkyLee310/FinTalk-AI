'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { GlassPanel } from '@/components/glass-panel';
import { Logo } from '@/components/logo';
import { Button, ErrorNote, Field, Input, Spinner, SuccessNote } from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { navigateWithTransition } from '@/lib/view-transition';

type Mode = 'signin' | 'signup';

/**
 * `useSearchParams` opts a statically-prerendered client page into
 * client-side rendering up to the nearest Suspense boundary, and `next build`
 * fails outright without one. So the page is that boundary, and the work
 * lives in LoginPageContent below.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main
          id="main"
          className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center px-5"
        >
          <Spinner label="Loading" />
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
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
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.get('mode') === 'signup' ? 'signup' : 'signin',
  );
  const [registered, setRegistered] = useState(false);

  if (registered) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-5 py-12"
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="text-brand">
            <Logo />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">FinTalk AI</h1>
        </div>

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
      className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-5 py-12"
    >
      <div className="mb-6 flex items-center gap-3">
        <span className="text-brand">
          <Logo />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">FinTalk AI</h1>
      </div>

      <GlassPanel className="p-6 sm:p-8">
        <div
          role="tablist"
          aria-label="Sign in or sign up"
          className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-line-strong bg-raised p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => setMode('signin')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
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
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
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
          <p className="mt-1.5 text-sm text-muted">
            {mode === 'signin'
              ? 'Enter your credentials to continue.'
              : 'Tell us who you are — an administrator will review and assign access.'}
          </p>
        </div>

        {mode === 'signin' ? <SignInForm /> : <SignUpForm onSuccess={() => setRegistered(true)} />}
      </GlassPanel>

      {/*
        The seeded accounts, shown because this build runs against synthetic
        data. A deployment holding real records must not ship this block.
        Sign-in only: someone signing up has no seeded account to use.
      */}
      {mode === 'signin' && (
        <div className="mt-5 rounded-lg border border-line bg-raised px-4 py-3 text-xs text-muted">
          <p className="font-medium text-text">Demo accounts — synthetic data only</p>
          <p className="mt-1">
            <code className="font-mono">maker@fintalk.test</code>,{' '}
            <code className="font-mono">checker@fintalk.test</code>,{' '}
            <code className="font-mono">shariah@fintalk.test</code>,{' '}
            <code className="font-mono">oversight@fintalk.test</code> and{' '}
            <code className="font-mono">admin@fintalk.test</code>.
          </p>
          <p className="mt-1">
            Password <code className="font-mono">Demo!2345</code>. Run{' '}
            <code className="font-mono">npm run db:seed</code> in{' '}
            <code className="font-mono">backend/</code> first.
          </p>
        </div>
      )}
    </main>
  );
}

/** Today's exact sign-in fields and flow, unchanged except the redirect now transitions. */
function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Login's own response carries the session, so this skips a second
      // /auth/me round trip. Land on /home — the chooser — rather than
      // guessing which of this role's sections it wants first.
      await api.login(email, password);
      navigateWithTransition(() => router.push('/home'));
    } catch (cause) {
      setError(describeError(cause));
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

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
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
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
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

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Submitting…' : 'Request access'}
      </Button>
    </form>
  );
}
