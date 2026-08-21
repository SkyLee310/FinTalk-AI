import Link from 'next/link';
import { Badge } from '@/components/badge';
import { Card, DataRow } from '@/components/card';
import { FallingLogoBackground } from '@/components/falling-logo-background';
import { GlassPanel } from '@/components/glass-panel';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { ApiError, apiFetch } from '@/lib/api-client';

type Health = { status: string; provider: string };

/**
 * The backend is checked on every request rather than at build time, so a
 * Vercel deploy never bakes in a stale verdict about Railway's health.
 */
export const dynamic = 'force-dynamic';

/** Right-column hero card — the three-step overview, not the four nav stages. */
const OVERVIEW_STATS = [
  {
    title: 'Record',
    body: 'Capture audio, documents, and whiteboard notes while preserving mixed-language context.',
  },
  {
    title: 'Protect',
    body: 'Mask personal data before it is stored, with full traceability for every redaction.',
  },
  {
    title: 'Review',
    body: 'Flag Shariah findings and route approvals through defined maker/checker roles.',
  },
] as const;

/** The four "what is built" feature cards beside the section's lede copy. */
const BUILT_FEATURES = [
  {
    title: 'Secure capture',
    body: 'Record sessions in the browser, upload files, and document whiteboards while keeping sensitive data safe.',
  },
  {
    title: 'Automated redaction',
    body: 'Personal data is masked before each save, and every mask is logged for audit review.',
  },
  {
    title: 'Shariah-aware review',
    body: 'Automated screening highlights findings, but only qualified reviewers can confirm advisory flags.',
  },
  {
    title: 'Separation of duties',
    body: 'Distinct maker and checker roles prevent self-approval and ensure accountability.',
  },
] as const;

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
    stage: 'Approval & Settlement',
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

/** Each claim beside the mechanism that enforces it, tagged the way the mockup labels them. */
const GUARANTEES = [
  {
    tag: 'Unmasked',
    claim: 'Personal data cannot be stored unmasked',
    how:
      'A branded type is minted in exactly one file, and the persistence layer '
      + 'accepts nothing else — so an unmasked write does not compile. A test scans '
      + 'the source and fails the build if any other module casts to it.',
  },
  {
    tag: 'Islamic',
    claim: 'An Islamic facility cannot carry an interest rate',
    how:
      'A Postgres CHECK constraint makes the combination unstorable, so the product '
      + 'cannot emit the violation it claims to detect.',
  },
  {
    tag: 'Shariah',
    claim: 'The AI never issues a Shariah ruling',
    how:
      'A finding leaves FLAGGED only through a user holding the SHARIAH role — '
      + 'enforced in the capability matrix, in the service, and by a constraint '
      + 'requiring reviewer attribution. An administrator cannot do it either.',
  },
  {
    tag: 'Mock',
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
      <FallingLogoBackground />
      {/* Floating navigation bar: clean unboxed logo/name on left, unboxed action buttons on right */}
      <header className="relative z-10 mx-auto max-w-6xl px-5 pt-5 sm:pt-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3.5 sm:gap-4 rounded-xl transition hover:opacity-90">
            <Logo className="size-14 sm:size-16" />
            <div className="flex flex-col">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text leading-tight">FinTalk AI</span>
              <span className="text-[0.62rem] sm:text-[0.7rem] font-bold uppercase tracking-[0.22em] text-muted">
                YOUR MEETING INTELLIGENCE
              </span>
            </div>
          </Link>

          {/* Action buttons without enclosing box */}
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full border border-line-strong bg-surface/80 backdrop-blur-md px-4 py-1.5 text-sm font-medium text-text shadow-xs transition hover:bg-raised"
            >
              Sign in
            </Link>
            <Link
              href="/login?mode=signup"
              className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white shadow-xs transition active:scale-[0.98] hover:opacity-90"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-4 sm:pb-24">
        {/* Hero: the pitch on the left, a process-overview card on the right. */}
        <section className="grid gap-5 py-8 sm:py-14 lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
          <GlassPanel className="flex flex-col justify-center p-6 sm:p-10">
            <p className="text-caption font-semibold uppercase tracking-[0.18em] text-brand">
              Shariah-aware meeting capture
            </p>
            <h1 className="mt-4 text-[2.25rem] font-extrabold leading-[1.03] tracking-[-0.03em] sm:text-[3.25rem]">
              Every credit decision, captured and auditable.
            </h1>
            <p className="mt-5 max-w-xl text-body text-muted">
              Malaysian credit meetings — captured, redacted, and screened for
              Shariah compliance, audited end to end.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full border border-line-strong bg-surface px-6 py-3 text-sm font-medium text-text transition active:scale-[0.98] hover:bg-raised"
              >
                Sign in
              </Link>
              <Link
                href="/login?mode=signup"
                className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-medium text-white transition active:scale-[0.98] hover:opacity-90"
              >
                Sign up
              </Link>
            </div>
          </GlassPanel>

          <GlassPanel className="flex flex-col justify-center p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">Process overview</span>
              <Badge tone="brand">Audit ready</Badge>
            </div>
            <div className="mt-6 space-y-4">
              {OVERVIEW_STATS.map((stat) => (
                <div key={stat.title} className="rounded-xl border border-line/60 bg-surface/70 dark:bg-raised/70 p-4 backdrop-blur-md transition hover:border-line-strong">
                  <p className="text-sm font-semibold">{stat.title}</p>
                  <p className="mt-1.5 text-caption text-muted">{stat.body}</p>
                </div>
              ))}
            </div>
          </GlassPanel>
        </section>

        {/* What is built: lede copy beside a 2x2 feature grid. */}
        <section
          id="built"
          className="mt-section-tight grid gap-8 sm:mt-section lg:grid-cols-[0.95fr_0.9fr] lg:items-center"
        >
          <GlassPanel className="flex flex-col justify-center p-6 sm:p-8">
            <p className="text-caption font-semibold uppercase tracking-[0.18em] text-brand">
              What is built
            </p>
            <h2 className="mt-3 text-section font-semibold leading-tight">
              Capture, redaction, Shariah screening, and maker–checker approval.
            </h2>
            <div className="mt-4 space-y-3 text-body text-muted">
              <p>Compliance invariants enforced in the database, not in application code.</p>
              <p>Hash-chained audit log, verified on every read of the trail.</p>
              <p className="text-warn">
                Audio is transcribed by Google Gemini, so it leaves Malaysia before
                redaction. Every recording requires an explicit acknowledgement first.
              </p>
            </div>
          </GlassPanel>

          <div className="grid gap-4 sm:grid-cols-2">
            {BUILT_FEATURES.map((feature) => (
              <Card key={feature.title} className="p-5">
                <h3 className="text-base font-semibold tracking-tight">{feature.title}</h3>
                <p className="mt-2 text-caption text-muted">{feature.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/*
          The four stages, named as work rather than as features, and in the order
          they happen.
        */}
        <section id="process" className="mt-section-tight sm:mt-section">
          <GlassPanel className="mx-auto max-w-2xl p-6 text-center sm:p-8">
            <p className="text-caption font-semibold uppercase tracking-[0.18em] text-brand">
              How a meeting becomes a decision
            </p>
            <p className="mt-3 text-body text-muted">
              Guided workflows keep your teams aligned while every stage is recorded,
              reviewed, and enforced by policy.
            </p>
          </GlassPanel>

          <ol className="mt-8 grid gap-5 sm:grid-cols-2">
            {PILLARS.map((pillar, index) => (
              <li key={pillar.title}>
                <Card className="h-full p-6">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
                    {pillar.stage}
                  </p>
                  <h3 className="mt-3 text-base font-semibold tracking-tight">
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
          The guarantees, stated with how each is enforced.
        */}
        <section id="guarantees" className="mt-section-tight sm:mt-section">
          <GlassPanel className="mx-auto max-w-2xl p-6 text-center sm:p-8">
            <p className="text-caption font-semibold uppercase tracking-[0.18em] text-brand">
              Four guarantees, and their teeth
            </p>
            <p className="mt-3 text-body text-muted">
              These are not conventions anyone has to remember. Each one fails loudly if
              broken — in the type system, in a database constraint, or in a test that
              stops the build.
            </p>
          </GlassPanel>

          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {GUARANTEES.map((item) => (
              <Card key={item.claim} className="p-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">
                  {item.tag}
                </p>
                <h3 className="mt-3 text-base font-semibold tracking-tight">{item.claim}</h3>
                <p className="mt-2.5 text-body text-muted">{item.how}</p>
              </Card>
            ))}
          </div>
        </section>

        {/*
          System status, paired with the disclaimer.
        */}
        <section className="mt-section-tight grid gap-5 sm:mt-section lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
          <GlassPanel className="flex flex-col justify-center p-6 sm:p-8">
            <p className="text-caption font-semibold uppercase tracking-[0.18em] text-brand">
              Operational system status
            </p>
            <h2 className="mt-3 text-section font-semibold">
              Auditability and separation are built in.
            </h2>
            <p className="mt-3 max-w-lg text-body text-muted">
              Raw audio and source images are never stored, personal data is redacted
              before persistence, and every system action is logged for transparent
              review.
            </p>
          </GlassPanel>

          <Card className="p-6">
            <div className="flex items-center gap-2">
              <Badge tone={reachable ? 'ok' : 'danger'} dot>
                {reachable ? 'Operational' : 'Unreachable'}
              </Badge>
              <p className="text-sm font-semibold">Important</p>
            </div>
            <p className="mt-3 text-caption text-muted">
              This product is not a compliance certification. Shariah findings are
              advisory and should be confirmed by qualified reviewers before
              production use.
            </p>
            <dl className="mt-5 divide-y divide-line rounded-lg border border-line bg-raised px-4">
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
          </Card>
        </section>
      </main>
    </>
  );
}
