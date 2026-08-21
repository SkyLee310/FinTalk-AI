'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/card';
import { Badge, type Tone } from '@/components/badge';
import { PageHeader } from '@/components/ui';
import {
  Scale,
  Coins,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Building2,
  Sparkles,
  Search,
  BookOpen,
  ArrowRight,
  Percent,
  Clock,
  HelpCircle,
  Dices,
  Ban,
  FileCode2,
} from 'lucide-react';
import { SHARIAH_GUIDANCE, SHARIAH_ISSUE_ORDER } from '@/lib/shariah-guidance';

interface PrincipleItem {
  icon: typeof Coins;
  title: string;
  tagline: string;
  summary: string;
}

const PRINCIPLES: readonly PrincipleItem[] = [
  {
    icon: Coins,
    title: 'Money is a Measure, Not a Commodity',
    tagline: 'Return from real trade, not loan time',
    summary:
      'Money prices value; it cannot earn more of itself through time. Returns must come from genuine trade, leases, or shared enterprise.',
  },
  {
    icon: Scale,
    title: 'Shared Risk for Just Returns',
    tagline: 'No guaranteed return without risk',
    summary:
      'Financiers earn by taking a legitimate share of commercial risk. Guaranteed lender returns with one-sided borrower risk is prohibited (Riba).',
  },
  {
    icon: Building2,
    title: 'Asset-Backed Financing',
    tagline: 'Anchored to real economic assets',
    summary:
      'Every contract is anchored to tangible assets — goods sold (Murabahah), property leased (Ijarah), or partnerships (Musharakah).',
  },
  {
    icon: CheckCircle2,
    title: 'Certainty & Transparency',
    tagline: 'No ambiguity or gambling elements',
    summary:
      'Price, delivery, and terms must be clearly established upfront. Avoidable uncertainty (Gharar) and pure chance (Maysir) are excluded.',
  },
];

interface ComparisonRow {
  aspect: string;
  conventional: string;
  islamic: string;
}

const COMPARISON: readonly ComparisonRow[] = [
  {
    aspect: 'Pricing Mechanism',
    conventional: 'Interest rate charged for lending money.',
    islamic: 'Agreed profit margin on asset sale or lease rate.',
  },
  {
    aspect: 'Underlying Anchor',
    conventional: 'Money loan without required tangible asset.',
    islamic: 'Must be backed by real tangible goods or services.',
  },
  {
    aspect: 'Late Payment Handling',
    conventional: 'Penalty interest compounded and kept as profit.',
    islamic: "Actual loss compensation (Ta'widh); excess to charity.",
  },
  {
    aspect: 'Risk Distribution',
    conventional: 'Borrower absorbs commercial losses alone.',
    islamic: 'Financier and client share commercial risk.',
  },
];

interface IssueMeta {
  category: 'rates' | 'terms' | 'ethics';
  icon: typeof Percent;
  tone: Tone;
  badQuote: string;
  goodFix: string;
}

const ISSUE_METAS: Record<string, IssueMeta> = {
  RIBA: {
    category: 'rates',
    icon: Percent,
    tone: 'danger',
    badQuote: '"We will charge an 8% interest rate per annum on the financing."',
    goodFix: 'Price as an 8% Murabahah profit markup on the asset sale price.',
  },
  LATE_PAYMENT_PENALTY: {
    category: 'rates',
    icon: Clock,
    tone: 'warn',
    badQuote: '"Late payment penalty of 1.5% per month booked to bank revenue."',
    goodFix: "Charge Ta'widh compensation limited to actual bank cost; excess to charity.",
  },
  GHARAR: {
    category: 'terms',
    icon: HelpCircle,
    tone: 'warn',
    badQuote: '"We will agree on the asset purchase price at a later date."',
    goodFix: 'Fix purchase price, specifications, and delivery date before contract execution.',
  },
  MAYSIR: {
    category: 'terms',
    icon: Dices,
    tone: 'danger',
    badQuote: '"Payout is structured as a speculative wager on market index swings."',
    goodFix: 'Anchor returns to actual commercial asset performance and real business profits.',
  },
  HARAM_SECTOR: {
    category: 'ethics',
    icon: Ban,
    tone: 'danger',
    badQuote: '"Financing working capital for alcohol distillery expansion."',
    goodFix: 'Verify borrower sector against BNM Shariah SAC exclusion list prior to approval.',
  },
  CONTRACT_MISMATCH: {
    category: 'terms',
    icon: FileCode2,
    tone: 'warn',
    badQuote: '"Labelled as Murabahah facility but drafted with interest compounding clauses."',
    goodFix: 'Ensure contract legal mechanics match named Islamic contract structure.',
  },
};

type FilterCategory = 'all' | 'rates' | 'terms' | 'ethics';

export default function IslamicBankingPage() {
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredIssues = useMemo(() => {
    return SHARIAH_ISSUE_ORDER.filter((issueType) => {
      const guidance = SHARIAH_GUIDANCE[issueType];
      const meta = ISSUE_METAS[issueType];
      if (!guidance || !meta) return false;

      // Filter by category
      if (filter !== 'all' && meta.category !== filter) return false;

      // Filter by search query
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesTitle = guidance.title.toLowerCase().includes(query);
        const matchesWhat = guidance.whatItIs.toLowerCase().includes(query);
        const matchesWhy = guidance.whyItViolates.toLowerCase().includes(query);
        const matchesQuote = meta.badQuote.toLowerCase().includes(query);
        return matchesTitle || matchesWhat || matchesWhy || matchesQuote;
      }

      return true;
    });
  }, [filter, searchQuery]);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page Header */}
      <PageHeader
        eyebrow="Compliance & Education"
        title="Islamic Banking Reference"
        action={
          <Link
            href="/meetings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-raised transition"
          >
            <BookOpen className="size-3.5 text-brand" />
            <span>View Reviewed Meetings →</span>
          </Link>
        }
      />

      {/* 1. Quick Comparison Table: Conventional vs Islamic */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-brand/10 text-brand">
            <Scale className="size-3.5" />
          </span>
          <h2 className="text-sm font-bold text-text uppercase tracking-wider">
            Quick Comparison: Conventional vs. Islamic
          </h2>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
          <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
            {/* Header row for mobile / desktop */}
            <div className="bg-raised/60 p-3 font-mono text-[0.7rem] font-bold uppercase tracking-wider text-muted hidden sm:block">
              Core Dimension
            </div>
            <div className="bg-danger/5 p-3 font-mono text-[0.7rem] font-bold uppercase tracking-wider text-danger hidden sm:block">
              Conventional Finance
            </div>
            <div className="bg-brand/5 p-3 font-mono text-[0.7rem] font-bold uppercase tracking-wider text-brand hidden sm:block">
              Islamic Banking (FinTalk AI)
            </div>
          </div>

          <div className="divide-y divide-line">
            {COMPARISON.map((row, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-3 sm:divide-x divide-line transition hover:bg-raised/20"
              >
                <div className="p-3 text-xs font-semibold text-text bg-raised/30 sm:bg-transparent">
                  {row.aspect}
                </div>
                <div className="p-3 text-xs text-muted flex items-start gap-1.5">
                  <span className="text-danger font-bold text-[0.7rem] mt-0.5">✕</span>
                  <span>{row.conventional}</span>
                </div>
                <div className="p-3 text-xs text-text flex items-start gap-1.5 font-medium bg-brand/5 sm:bg-transparent">
                  <span className="text-ok font-bold text-[0.7rem] mt-0.5">✓</span>
                  <span>{row.islamic}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2. Four Core Pillars */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-brand/10 text-brand">
            <Sparkles className="size-3.5" />
          </span>
          <h2 className="text-sm font-bold text-text uppercase tracking-wider">
            The 4 Foundational Principles
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {PRINCIPLES.map((principle) => {
            const Icon = principle.icon;
            return (
              <Card key={principle.title} className="p-4 space-y-2 border-line hover:border-brand/30 transition">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-text">
                      {principle.title}
                    </h3>
                    <p className="text-[0.68rem] font-medium text-brand">
                      {principle.tagline}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  {principle.summary}
                </p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 3. The 6 Automated Shariah Screening Rules */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-warn/10 text-warn">
              <ShieldAlert className="size-3.5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-text uppercase tracking-wider">
                Automated Screening Engine (6 Rules)
              </h2>
              <p className="text-xs text-muted">
                What the AI flags during credit discussions and how to remediate
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
            <input
              type="text"
              placeholder="Search rules or terms…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-xs text-text placeholder:text-muted focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {[
            { id: 'all', label: 'All Rules (6)' },
            { id: 'rates', label: 'Pricing & Fees (2)' },
            { id: 'terms', label: 'Contract Clarity (3)' },
            { id: 'ethics', label: 'Excluded Sectors (1)' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as FilterCategory)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === tab.id
                  ? 'bg-brand text-white shadow-xs'
                  : 'bg-surface border border-line-strong text-muted hover:text-text hover:bg-raised'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Issue Cards */}
        <div className="space-y-4">
          {filteredIssues.map((issueType) => {
            const guidance = SHARIAH_GUIDANCE[issueType];
            const meta = ISSUE_METAS[issueType];
            if (!guidance || !meta) return null;
            const Icon = meta.icon;

            return (
              <Card key={issueType} className="overflow-hidden border-line hover:border-brand/40 transition">
                <div className="p-4 sm:p-5 space-y-3.5">
                  {/* Title & Badge */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                          meta.tone === 'danger'
                            ? 'bg-danger/10 text-danger'
                            : 'bg-warn/10 text-warn'
                        }`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm sm:text-base font-bold text-text">
                            {guidance.title}
                          </h3>
                          <Badge tone={meta.tone}>{guidance.shortLabel}</Badge>
                        </div>
                        <span className="font-mono text-[0.68rem] text-muted">
                          {guidance.reference}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Plain English Explanation */}
                  <div className="rounded-lg border border-line bg-raised/30 p-3 text-xs leading-relaxed space-y-1">
                    <p className="font-semibold text-text">What it means:</p>
                    <p className="text-muted">{guidance.whatItIs}</p>
                    <p className="text-muted mt-1">{guidance.whyItViolates}</p>
                  </div>

                  {/* Red Flag vs Compliant Fix Comparison */}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-danger font-bold text-[0.7rem] uppercase tracking-wider">
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span>Meeting Red Flag (What AI Flags)</span>
                      </div>
                      <p className="text-xs text-text italic">
                        {meta.badQuote}
                      </p>
                    </div>

                    <div className="rounded-lg border border-ok/20 bg-ok/5 p-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-ok font-bold text-[0.7rem] uppercase tracking-wider">
                        <CheckCircle2 className="size-3.5 shrink-0" />
                        <span>Compliant Solution (Remediation)</span>
                      </div>
                      <p className="text-xs text-text">
                        {meta.goodFix}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}

          {filteredIssues.length === 0 && (
            <div className="rounded-xl border border-line bg-surface p-8 text-center space-y-2">
              <p className="text-sm font-semibold text-text">No rules match your search</p>
              <p className="text-xs text-muted">Try a different search keyword or switch category filters.</p>
            </div>
          )}
        </div>
      </section>

      {/* Footer Note */}
      <div className="rounded-xl border border-line bg-raised/40 p-4 text-xs text-muted leading-relaxed">
        <p>
          <span className="font-semibold text-text">Regulatory Note: </span>
          Educational summary aligned with Bank Negara Malaysia (BNM) Shariah Advisory Council (SAC) standards and AAOIFI governance standards. All machine findings require verification by a certified Shariah officer.
        </p>
      </div>
    </div>
  );
}
