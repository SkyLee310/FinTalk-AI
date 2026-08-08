'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Card } from '@/components/card';
import { Logo } from '@/components/logo';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { describeError } from '@/hooks/use-async';
import { api } from '@/lib/api';

export default function LoginPage() {
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
      await api.login(email, password);
      router.push('/meetings');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
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
        <div>
          <h1 className="text-lg font-semibold tracking-tight">FinTalk AI</h1>
          <p className="text-xs text-faint">Sign in to continue</p>
        </div>
      </div>

      <Card className="p-6">
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
      </Card>

      {/*
        The seeded accounts, shown because this build runs against synthetic data.
        A deployment holding real records must not ship this block.
      */}
      <div className="mt-5 rounded-lg border border-line bg-raised px-4 py-3 text-xs text-muted">
        <p className="font-medium text-text">Demo accounts — synthetic data only</p>
        <p className="mt-1">
          <code className="font-mono">maker@fintalk.test</code>,{' '}
          <code className="font-mono">checker@fintalk.test</code>,{' '}
          <code className="font-mono">shariah@fintalk.test</code>, plus{' '}
          <code className="font-mono">viewer</code>,{' '}
          <code className="font-mono">supervisor</code> and{' '}
          <code className="font-mono">admin</code> at the same domain.
        </p>
        <p className="mt-1">
          Password <code className="font-mono">Demo!2345</code>. Run{' '}
          <code className="font-mono">npm run db:seed</code> in{' '}
          <code className="font-mono">backend/</code> first.
        </p>
      </div>
    </main>
  );
}
