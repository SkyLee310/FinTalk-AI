'use client';

import Link from 'next/link';
import { Card, CardHeader } from '@/components/card';
import { PageHeader } from '@/components/ui';
import { SHARIAH_GUIDANCE, SHARIAH_ISSUE_ORDER } from '@/lib/shariah-guidance';

/**
 * A plain-language reference to Shariah banking, reachable by every role.
 *
 * Two jobs: explain the principles the product is built around, and, for each
 * issue the Shariah engine can raise, say what it is and why it flags — drawn
 * from the same guidance module the "why was this flagged" detail on a meeting
 * uses, so the lesson and the finding never drift apart. Education, not a
 * ruling; every reference needs confirmation by counsel before it governs a
 * real facility.
 */

const PRINCIPLES: readonly { title: string; body: string }[] = [
  {
    title: 'Money is a measure, not a commodity',
    body: 'Money prices value; it is not a thing that earns more of itself. A return has to come from real economic activity — a sale, a lease, a shared venture — rather than from the passage of time on a loan.',
  },
  {
    title: 'Share the risk to earn the return',
    body: 'The financier earns by taking a genuine share of the risk in an asset or enterprise. A structure that guarantees one party a return while placing all the risk on the other is what the prohibition of riba is about.',
  },
  {
    title: 'Back financing with a real asset',
    body: 'Islamic contracts are anchored to something real — goods bought and resold (Murabahah), an asset leased (Ijarah), a partnership in a business (Musharakah). The contract names the asset and the roles, and the mechanics have to match the name.',
  },
  {
    title: 'Certainty over ambiguity',
    body: 'The essential terms — price, subject, timing — must be known when the contract is struck. Avoidable uncertainty (gharar) and gain by pure chance (maysir) are excluded: both let one party profit at the expense of the other through something other than agreement.',
  },
];

export default function IslamicBankingPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Islamic banking"
        lead="What Shariah-compliant finance is, and what can flag a facility for review."
      />

      <section className="space-y-4">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          FinTalk AI is built for Islamic banking. A facility is Shariah-compliant when the
          return is earned by sharing the risk of a real asset or venture, not by charging
          interest on money lent. These principles shape what the app records, and the
          checks below are the ones its Shariah engine looks for.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((principle) => (
            <Card key={principle.title} className="px-5 py-4">
              <p className="text-sm font-semibold">{principle.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{principle.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
            What can flag a facility
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            When a meeting is transcribed, a deterministic rule set reads it for these six
            issues and raises a finding for a qualified reviewer. A finding is a machine
            reading of the transcript, never a ruling — the reviewer decides, and counsel
            confirms every reference.
          </p>
        </div>

        <div className="space-y-4">
          {SHARIAH_ISSUE_ORDER.map((issueType) => {
            const guidance = SHARIAH_GUIDANCE[issueType];
            if (guidance === undefined) return null;
            return (
              <Card key={issueType}>
                <CardHeader title={guidance.title} description={guidance.reference} />
                <div className="space-y-3 px-5 py-4 text-sm leading-relaxed">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                      What it is
                    </p>
                    <p className="mt-1 text-muted">{guidance.whatItIs}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                      Why it flags
                    </p>
                    <p className="mt-1 text-muted">{guidance.whyItViolates}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                      In a meeting, this looks like
                    </p>
                    <p className="mt-1 italic text-muted">{guidance.example}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-faint">
        Educational summary only, not Shariah or legal advice. Every reference above
        requires confirmation by qualified counsel before it governs a real facility. See a
        finding in context on any{' '}
        <Link href="/meetings" className="underline underline-offset-2">
          reviewed meeting
        </Link>
        .
      </p>
    </div>
  );
}
