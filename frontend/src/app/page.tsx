import Link from 'next/link';
import { Badge } from '@/components/badge';
import { Card, CardHeader, DataRow } from '@/components/card';
import { GlassPanel } from '@/components/glass-panel';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Disclosure } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api-client';

type Health = { status: string; provider: string };

/**
 * The backend is checked on every request rather than at build time, so a
 * Vercel deploy never bakes in a stale verdict about Railway's health.
 */
export const dynamic = 'force-dynamic';

/** The four stages, in the order they happen, named as the app names them. */
const PILLARS = [
  {
    stage: 'Capture',
    title: 'Record it without losing half of it',
    body:
      'Record in the browser or upload a file, and photograph the whiteboard. '
      + 'Mixed English, Malay and Chinese become one linked record instead of a '
      + 'transcript that drops every third sentence. Anything the model was unsure '
      + 'of is marked for a person to confirm.',
  },
  {
    stage: 'Review',
    title: 'Read what was said, not what was remembered',
    body:
      'Personal data is masked before storage, and every mask is logged with an '
      + 'offset an auditor can reconcile. Six Shariah rules raise findings for a '
      + 'qualified reviewer, who answers yes or no — the system never rules.',
  },
  {
    stage: 'Decide',
    title: 'Two people, or it does not happen',
    body:
      'A maker drafts and submits a term sheet; a different person approves it, and '
      + 'cannot approve their own work. A facility cannot even be submitted while a '
      + 'Shariah finding is unresolved.',
  },
  {
    stage: 'Administration',
    title: 'Govern access, and read the whole record',
    body:
      'An administrator decides who may do what, and can read every action taken. '
      + 'They cannot clear a finding, approve a facility or move money — the account '
      + 'that grants roles must not be able to use them.',
  },
] as const;

/** Each claim beside the mechanism that enforces it. */
const GUARANTEES = [
  {
    claim: 'Personal data cannot be stored unmasked',
    how:
      'A branded type is minted in exactly one file, and the persistence layer '
      + 'accepts nothing else — so an unmasked write does not compile. A test scans '
      + 'the source and fails the build if any other module casts to it.',
  },
  {
    claim: 'An Islamic facility cannot carry an interest rate',
    how:
      'A Postgres CHECK constraint makes the combination unstorable, so the product '
      + 'cannot emit the violation it claims to detect.',
  },
  {
    claim: 'The AI never issues a Shariah ruling',
    how:
      'A finding leaves FLAGGED only through a user holding the SHARIAH role — '
      + 'enforced in the capability matrix, in the service, and by a constraint '
      + 'requiring reviewer attribution. An administrator cannot do it either.',
  },
  {
    claim: 'No payment is ever submitted',
    how:
      'Settlement is simulated, its reference is prefixed MOCK-, and a CHECK '
      + 'constraint makes a row claiming otherwise unstorable. Two separate tests '
      + 'read the source and assert that nothing here can reach a network.',
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
    <>
      {/* No nav here: there is nothing to navigate to before signing in. */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5 rounded">
          <Logo className="size-7" />
          <span className="text-sm font-semibold tracking-tight">FinTalk AI</span>
        </Link>
        <ThemeToggle />
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 pb-12 sm:pb-16">
        {/*
          One idea, one primary action pair. The previous hero offered "Sign in"
          and "Go to meetings" side by side at equal weight, which asked a
          first-time visitor to choose between two doors without telling them the
          second one needs a key. Sign in and Sign up are the only two doors that
          exist before an account has a role — both lead to the same page, whose
          segmented control (Task 9) decides which form opens.
        */}
        <section className="rounded-3xl bg-[radial-gradient(circle_at_15%_10%,var(--brand-soft),var(--canvas)_65%)] px-4 py-8 sm:px-8 sm:py-14">
          <GlassPanel className="mx-auto max-w-3xl p-6 sm:p-10">
            <p className="text-caption font-semibold uppercase tracking-[0.12em] text-brand">
              Shariah-aware meeting capture
            </p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-display">
              Every credit decision, captured and auditable.
            </h1>
            <p className="mt-4 max-w-2xl text-body text-muted">
              Malaysian credit meetings — captured, redacted, and screened for
              Shariah compliance, audited end to end.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-medium text-canvas transition active:scale-[0.98] hover:opacity-90"
              >
                Sign in
              </Link>
              {/*
                The mode is carried in the query string rather than assumed.
                Both buttons used to land on the same bare /login, whose
                segmented control always opened Sign in — so this one sent
                people to the wrong form and left them to find the toggle.
              */}
              <Link
                href="/login?mode=signup"
                className="inline-flex items-center justify-center rounded-full border border-line-strong bg-surface px-6 py-3 text-sm font-medium text-text transition active:scale-[0.98] hover:bg-raised"
              >
                Sign up
              </Link>
            </div>
          </GlassPanel>
        </section>

        <section className="mt-10">
          <Card>
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
              {/*
                Kept deliberately on the landing page rather than buried in a
                policy link. Transcription sends audio to Google before anything is
                redacted, and a limitation a visitor has to go looking for is one
                the product is hiding.
              */}
              <li className="flex gap-2.5">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                <span className="text-muted">
                  Audio is transcribed by Google Gemini, so it leaves Malaysia before
                  redaction. Every recording requires an explicit acknowledgement first.
                </span>
              </li>
            </ul>
          </Card>
        </section>

        {/*
          The four stages, named as work rather than as features, and in the order
          they happen. This mirrors the app's navigation exactly — Capture, Review,
          Decide, Administration — so someone who reads this page arrives inside
          already knowing where things are.
        */}
        <section className="mt-section-tight sm:mt-section">
          <h2 className="text-section font-semibold">How a meeting becomes a decision</h2>
          <ol className="mt-6 grid gap-5 sm:grid-cols-2">
            {PILLARS.map((pillar, index) => (
              <li key={pillar.title}>
                <Card className="h-full p-6">
                  <p className="text-caption font-semibold uppercase tracking-[0.12em] text-brand">
                    {pillar.stage}
                  </p>
                  <h3 className="mt-2 text-base font-semibold tracking-tight">
                    {pillar.title}
                  </h3>
                  <p className="mt-2.5 text-body text-muted">{pillar.body}</p>
                  <span className="sr-only">Step {index + 1}</span>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        {/*
          The guarantees, stated with how each is enforced. "We take compliance
          seriously" is worth nothing; "the database rejects it" is checkable, and a
          reader who does not believe it can go and look.
        */}
        <section className="mt-section-tight sm:mt-section">
          <h2 className="text-section font-semibold">Four guarantees, and their teeth</h2>
          <p className="mt-3 max-w-2xl text-body text-muted">
            These are not conventions anyone has to remember. Each one fails loudly if
            broken — in the type system, in a database constraint, or in a test that
            stops the build.
          </p>
          <dl className="mt-6 divide-y divide-line border-y border-line">
            {GUARANTEES.map((item) => (
              <div key={item.claim} className="grid gap-1.5 py-5 sm:grid-cols-5 sm:gap-6">
                <dt className="text-sm font-medium sm:col-span-2">{item.claim}</dt>
                <dd className="text-body text-muted sm:col-span-3">{item.how}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/*
          System status, demoted from a mid-page 3-of-5 column to a slim bar: a
          first-time visitor deciding whether to trust this product with credit
          meetings does not need API health above the fold — an engineer
          debugging a broken deploy does, which is exactly what the Disclosure
          below is for.
        */}
        <section className="mt-section-tight sm:mt-section">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-5 py-3">
            <Badge tone={reachable ? 'ok' : 'danger'} dot>
              {reachable ? 'Operational' : 'Unreachable'}
            </Badge>
            <p className="text-sm text-muted">System status</p>
            <div className="ml-auto">
              <Disclosure summary="Details">
                <dl className="divide-y divide-line" aria-live="polite">
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
                  <div className="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3">
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
              </Disclosure>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
