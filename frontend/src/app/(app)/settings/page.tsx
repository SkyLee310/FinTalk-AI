'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/badge';
import { Card, DataRow } from '@/components/card';
import { ErrorNote, PageHeader, Section, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api, type Session } from '@/lib/api';
import { readStoredPreference, setTheme, type ThemePreference } from '@/lib/theme';

/**
 * Personal settings — not a sixth section.
 *
 * Deliberately absent from lib/nav.ts. Those five entries are stages of the
 * work and each is capability-gated; this page is preferences, applies to
 * everyone, and is reached from the profile menu. Adding it to the nav would
 * also have dropped a Settings card among the five work stages on /home.
 */

const APPEARANCE: readonly {
  readonly value: ThemePreference;
  readonly label: string;
  readonly hint: string;
}[] = [
  { value: 'light', label: 'Light', hint: 'Always light, whatever the device is set to.' },
  { value: 'dark', label: 'Dark', hint: 'Always dark, whatever the device is set to.' },
  { value: 'system', label: 'System', hint: 'Follows your device, and changes with it.' },
];

export default function SettingsPage() {
  const session = useAsync<Session>(() => api.me(), 'session');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        lead="Your preferences, and what this account is allowed to do."
      />

      <Section
        title="Appearance"
        description="Applies to this browser only — it is not stored on your account."
      >
        <Appearance />
      </Section>

      <Section
        title="Account"
        description="An administrator sets these. They cannot be edited here."
      >
        {session.loading && <Spinner label="Loading your account" />}
        {session.error !== null && <ErrorNote>Could not load your account.</ErrorNote>}
        {session.data !== null && <Account session={session.data} />}
      </Section>
    </div>
  );
}

/**
 * Three radios rather than a switch.
 *
 * A two-state toggle cannot express three choices, and it cannot show which
 * one is active without the reader inferring it from an icon. Following the
 * device is a real choice here — it used to be merely the state you were in
 * before you first touched the toggle, and unreachable afterwards.
 */
function Appearance() {
  // 'system' until the effect runs: localStorage does not exist during the
  // server render, and guessing would risk a hydration mismatch on the one
  // control whose whole job is to report the stored value accurately.
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    setPreference(readStoredPreference());
  }, []);

  function choose(next: ThemePreference): void {
    setTheme(next);
    setPreference(next);
  }

  return (
    <Card className="p-1.5">
      <fieldset>
        <legend className="sr-only">Theme</legend>
        {APPEARANCE.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg px-3.5 py-3 transition hover:bg-raised"
          >
            <input
              type="radio"
              name="appearance"
              value={option.value}
              checked={preference === option.value}
              onChange={() => choose(option.value)}
              className="mt-0.5 size-4 accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            />
            <span>
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-caption text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Card>
  );
}

function Account({ session }: { session: Session }) {
  return (
    <Card className="px-5 py-3">
      <dl>
        <DataRow label="Name">{session.displayName}</DataRow>
        <DataRow label="Email">{session.email}</DataRow>
        <DataRow label="Role">
          <Badge tone="brand">{session.role}</Badge>
        </DataRow>
      </dl>

      <div className="border-t border-line pt-3">
        <p className="text-sm text-muted">What this role may do</p>
        {/*
          The capability list verbatim from the session, rather than a prose
          summary. A tester asking "why can I not approve this?" gets a real
          answer, and it cannot drift from rbac.ts the way a hand-written
          description would.
        */}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {session.capabilities.map((capability) => (
            <li
              key={capability}
              className="rounded-full border border-line-strong bg-surface px-2 py-0.5 font-mono text-caption text-muted"
            >
              {capability}
            </li>
          ))}
        </ul>
        {session.capabilities.length === 0 && (
          <p className="mt-2 text-caption text-faint">
            No capabilities yet — an administrator has not assigned this account a role.
          </p>
        )}
      </div>
    </Card>
  );
}
