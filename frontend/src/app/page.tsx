import Link from 'next/link';
import { Badge } from '@/components/badge';
import { Card, CardHeader, DataRow } from '@/components/card';
import { ApiError, apiFetch } from '@/lib/api-client';

type Health = { status: string; provider: string };

/**
 * The backend is checked on every request rather than at build time, so a
 * Vercel deploy never bakes in a stale verdict about Railway's health.
 */
export const dynamic = 'force-dynamic';

const PILLARS = [
  {
    title: 'Capture without loss',
    body:
      'Mixed-language discussion and the whiteboard behind it become one linked '
      + 'record, instead of a transcript that drops every third sentence.',
  },
  {
    title: 'Compliance by construction',
    body:
      'Personal data is redacted before persistence, and an Islamic facility '
      + 'cannot carry an interest rate — the database rejects it outright.',
  },
  {
    title: 'Decision to execution',
    body:
      'An approved decision becomes a structured term sheet under maker–checker '
      + 'segregation, with every AI output kept beside the human edit.',
  },
] as const;

function describeFailure(error: unknown): string {
  if (error instanceof ApiError) return `HTTP ${error.status} — ${error.detail}`;
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

export default async function HomePage() {
  let health: Health | null = null;
  let failure: string | null = null;

  try {
    health = await apiFetch<Health>('/health');
  } catch (error: unknown) {
    failure = describeFailure(error);
  }

  const reachable = health !== null;

  return (
    <main id="main" className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <section className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">
          Foundation deploy
        </p>
        <h1 className="mt-3 text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          Every credit decision, captured and auditable.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          FinTalk AI records what was actually discussed in a credit meeting — across
          languages, including the whiteboard — then holds the result to Malaysian
          data-protection and Shariah requirements before anyone can act on it.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-canvas transition hover:opacity-90"
          >
            Sign in
          </Link>
          <Link
            href="/meetings"
            className="inline-flex items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium transition hover:bg-raised"
          >
            Go to meetings
          </Link>
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="System status"
            description="Live check from this page to the API."
            action={
              <Badge tone={reachable ? 'ok' : 'danger'} dot>
                {reachable ? 'Operational' : 'Unreachable'}
              </Badge>
            }
          />
          <dl className="divide-y divide-line px-5 py-2" aria-live="polite">
            <DataRow label="API">
              <span className={reachable ? 'text-ok' : 'text-danger'}>
                {reachable ? 'Reachable' : 'Not reachable'}
              </span>
            </DataRow>
            <DataRow label="Reported status">
              <span className="font-mono text-xs">{health?.status ?? '—'}</span>
            </DataRow>
            <DataRow label="Transcription provider">
              {health ? (
                <Badge tone={health.provider === 'gemini' ? 'brand' : 'neutral'}>
                  {health.provider}
                </Badge>
              ) : (
                <span className="text-faint">—</span>
              )}
            </DataRow>
          </dl>

          {failure && (
            <div className="mx-5 mb-5 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3">
              <p className="text-xs font-semibold text-danger">Connection failed</p>
              <p className="mt-1 break-words font-mono text-xs leading-relaxed text-muted">
                {failure}
              </p>
              <p className="mt-2 text-xs text-muted">
                Start the backend with <code className="font-mono">npm run dev</code> in{' '}
                <code className="font-mono">backend/</code>, and set{' '}
                <code className="font-mono">NEXT_PUBLIC_API_BASE_URL</code> in{' '}
                <code className="font-mono">.env.local</code>.
              </p>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="What is built" />
          <ul className="space-y-3 px-5 py-4 text-sm text-muted">
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ok" />
              <span>Capture, redaction, Shariah screening and maker–checker approval.</span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ok" />
              <span>Compliance invariants enforced in the database, not in application code.</span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ok" />
              <span>Hash-chained audit log, verified on every read of the trail.</span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-faint" />
              <span className="text-faint">
                Whiteboard capture and on-device audio pre-screening are not built yet.
              </span>
            </li>
          </ul>
        </Card>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
          How it works
        </h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <Card key={pillar.title} className="p-5">
              <h3 className="text-sm font-semibold tracking-tight">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{pillar.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
