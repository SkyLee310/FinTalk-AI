'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from './card';
import { Badge } from './badge';
import { ChevronRight, Mic, ShieldCheck, FileSpreadsheet, CheckCircle2, Sparkles } from 'lucide-react';
import type { Session } from '@/lib/api';

interface StepInfo {
  number: number;
  label: string;
  desc: string;
  icon: typeof Mic;
  role: string;
  detail: string;
  cta: string;
  href: string;
}

const WORKFLOW_STEPS: StepInfo[] = [
  {
    number: 1,
    label: 'Capture',
    desc: 'Record or upload audio',
    icon: Mic,
    role: 'Maker',
    detail: 'Record live audio or upload files with whiteboard notes.',
    cta: 'Start Capture',
    href: '/record',
  },
  {
    number: 2,
    label: 'Screen',
    desc: 'PDPA & Shariah check',
    icon: ShieldCheck,
    role: 'Shariah Reviewer',
    detail: 'AI redacts personal data and flags Shariah non-compliance.',
    cta: 'View Meetings',
    href: '/meetings',
  },
  {
    number: 3,
    label: 'Draft',
    desc: 'AI extracts terms',
    icon: FileSpreadsheet,
    role: 'Maker',
    detail: 'AI suggests loan amounts, rates, and Islamic contracts.',
    cta: 'Draft Terms',
    href: '/meetings',
  },
  {
    number: 4,
    label: 'Decide',
    desc: 'Approve & settle',
    icon: CheckCircle2,
    role: 'Checker',
    detail: 'Independent checker approves facility and simulates settlement.',
    cta: 'Open Decide',
    href: '/approvals',
  },
];

export function WorkflowGuide({ user }: { user: Session }) {
  const [selectedStep, setSelectedStep] = useState<number>(() => {
    if (user.role === 'CHECKER') return 4;
    if (user.role === 'SHARIAH') return 2;
    return 1;
  });

  const [expanded, setExpanded] = useState(true);
  const currentStep: StepInfo = WORKFLOW_STEPS[selectedStep - 1] ?? (WORKFLOW_STEPS[0] as StepInfo);

  return (
    <Card className="overflow-hidden border-brand/20 bg-gradient-to-br from-surface via-surface to-brand-soft/20 shadow-xs">
      <div className="p-4 sm:p-4.5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-lg bg-brand/10 text-brand">
              <Sparkles className="size-3.5" />
            </span>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-text tracking-tight">
                FinTalk Lifecycle
              </h2>
              <Badge tone="brand">4 Steps</Badge>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-text transition"
          >
            <span>{expanded ? 'Hide' : 'Show'}</span>
            <span
              className="text-[10px] transition-transform duration-200"
              style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
            >
              ▼
            </span>
          </button>
        </div>

        {expanded && (
          <div className="mt-3.5 space-y-3">
            {/* 4-Step Stepper Bar */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WORKFLOW_STEPS.map((step) => {
                const isSelected = selectedStep === step.number;
                const Icon = step.icon;

                return (
                  <button
                    key={step.number}
                    type="button"
                    onClick={() => setSelectedStep(step.number)}
                    className={`group flex flex-col items-start rounded-xl border p-2.5 text-left transition-all duration-150 active:scale-[0.98] ${
                      isSelected
                        ? 'border-brand bg-brand/10 shadow-xs ring-1 ring-brand/30'
                        : 'border-line bg-surface/80 hover:border-line-strong hover:bg-raised'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-1">
                      <span
                        className={`inline-flex items-center justify-center size-5 rounded-full font-mono text-[0.65rem] font-bold ${
                          isSelected
                            ? 'bg-brand text-white'
                            : 'bg-raised text-muted group-hover:text-text border border-line'
                        }`}
                      >
                        {step.number}
                      </span>
                      <Icon
                        className={`size-3.5 ${
                          isSelected ? 'text-brand' : 'text-muted group-hover:text-text'
                        }`}
                      />
                    </div>
                    <span className="mt-1.5 text-xs font-semibold text-text group-hover:text-brand">
                      {step.label}
                    </span>
                    <span className="text-[0.7rem] text-muted truncate w-full">
                      {step.desc}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Active Step Highlight */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-line bg-raised/50 px-3.5 py-2.5">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[0.7rem] font-bold text-brand">
                    Step {currentStep.number} ({currentStep.role}):
                  </span>
                  <p className="text-xs text-text font-medium truncate">
                    {currentStep.detail}
                  </p>
                </div>
              </div>

              <Link href={currentStep.href} className="shrink-0">
                <span className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 shadow-xs">
                  <span>{currentStep.cta}</span>
                  <ChevronRight className="size-3" />
                </span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
