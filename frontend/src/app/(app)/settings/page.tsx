'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Badge } from '@/components/badge';
import { Card, DataRow } from '@/components/card';
import { initials } from '@/components/profile-menu';
import {
  Button,
  ErrorNote,
  Field,
  PageHeader,
  Section,
  Select,
  Spinner,
  SuccessNote,
  Textarea,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { api, type FeedbackCategory, type Session } from '@/lib/api';
import { AVATAR_COLORS, type AvatarColor, avatarClasses, avatarSwatchClass } from '@/lib/avatar-colors';
import { notifySessionChanged } from '@/lib/session-refresh';
import { readStoredPreference, setTheme, type ThemePreference } from '@/lib/theme';

/**
 * Personal settings — not a sixth section.
 *
 * Deliberately absent from lib/nav.ts. Those entries are stages of the work
 * and each is capability-gated; this page is preferences, applies to
 * everyone, and is reached from the profile menu, not the sidebar.
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
      />

      <Section
        title="Appearance"
      >
        <Appearance />
      </Section>

      <Section
        title="Avatar"
      >
        {session.loading && <Spinner label="Loading your account" />}
        {session.error !== null && <ErrorNote>Could not load your account.</ErrorNote>}
        {session.data !== null && (
          <AvatarPicker session={session.data} onChanged={() => session.reload({ silent: true })} />
        )}
      </Section>

      <Section
        title="Account"
      >
        {session.loading && <Spinner label="Loading your account" />}
        {session.error !== null && <ErrorNote>Could not load your account.</ErrorNote>}
        {session.data !== null && <Account session={session.data} />}
      </Section>

      <Section
        title="Google Workspace & Meet"
        description="Connect your Google account to automatically import transcripts from Google Meet calls."
      >
        <GoogleIntegration />
      </Section>

      <Section
        title="Feedback"
      >
        <Feedback />
      </Section>
    </div>
  );
}

const CATEGORIES: readonly { readonly value: FeedbackCategory; readonly label: string }[] = [
  { value: 'BUG', label: 'Bug' },
  { value: 'IDEA', label: 'Idea' },
  { value: 'OTHER', label: 'Other' },
];

function Feedback() {
  const [category, setCategory] = useState<FeedbackCategory>('IDEA');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitFeedback(category, message.trim());
      setMessage('');
      setCategory('IDEA');
      setDone(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form
        onSubmit={(event) => {
          // A resubmission after success clears the earlier notice — it would
          // otherwise sit above the form claiming success while a second
          // attempt is still in flight.
          setDone(false);
          void submit(event);
        }}
        className="space-y-4"
      >
        {error !== null && <ErrorNote>{error}</ErrorNote>}
        {done && <SuccessNote>Sent. Thank you.</SuccessNote>}

        <Field label="Category" htmlFor="feedback-category">
          <Select
            id="feedback-category"
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
          >
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Message"
          htmlFor="feedback-message"
          hint="Describe the account or the meeting rather than naming an NRIC, phone number, or card — a message containing one is refused."
        >
          <Textarea
            id="feedback-message"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            value={message}
            disabled={busy}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What happened, or what would help?"
          />
        </Field>

        <Button type="submit" disabled={busy || message.trim().length < 10}>
          {busy ? 'Sending…' : 'Send feedback'}
        </Button>
      </form>
    </Card>
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

function AvatarPicker({
  session,
  onChanged,
}: {
  session: Session;
  onChanged: () => void;
}) {
  const [color, setColor] = useState(session.avatarColor);
  const [busy, setBusy] = useState<AvatarColor | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: AvatarColor): Promise<void> {
    if (busy !== null || next === color) return;
    setBusy(next);
    setError(null);
    try {
      await api.updateAvatarColor(next);
      setColor(next);
      // Updates this page's own copy and the shell's (sidebar, profile
      // menu) — two separate useAsync('session') instances that share no
      // state, per lib/session-refresh.ts.
      onChanged();
      notifySessionChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5">
      {error !== null && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-5">
        <span
          aria-hidden="true"
          className={`grid size-12 shrink-0 place-items-center rounded-full text-body font-semibold ${avatarClasses(color)}`}
        >
          {initials(session.displayName)}
        </span>
        <div className="flex flex-wrap gap-2.5">
          {AVATAR_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Use ${option}`}
              aria-pressed={color === option}
              disabled={busy !== null}
              onClick={() => void choose(option)}
              className={`size-8 rounded-full transition disabled:opacity-60 ${avatarSwatchClass(option)} ${
                color === option
                  ? 'ring-2 ring-text ring-offset-2 ring-offset-surface'
                  : 'hover:opacity-80'
              }`}
            />
          ))}
        </div>
      </div>
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

function GoogleIntegration() {
  const status = useAsync(() => api.googleAuthStatus(), 'googleAuthStatus');
  const [connecting, setConnecting] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('google') === 'linked') {
        setSuccessNote('Google account linked successfully!');
        window.history.replaceState({}, '', window.location.pathname);
      } else if (params.get('google_error')) {
        setActionError(`Failed to link Google account: ${params.get('google_error')}`);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setActionError(null);
    try {
      const { url } = await api.googleAuthUrl();
      window.location.href = url;
    } catch (err) {
      const msg = describeError(err);
      if (msg.toLowerCase().includes('not configured')) {
        setActionError(
          'Google OAuth is not configured on this server. Please ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set in backend/.env (or Railway environment variables).',
        );
      } else {
        setActionError(msg);
      }
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Are you sure you want to disconnect your Google account?')) {
      return;
    }
    setUnlinking(true);
    setActionError(null);
    try {
      await api.unlinkGoogle();
      setSuccessNote('Google account disconnected.');
      status.reload();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setUnlinking(false);
    }
  }

  if (status.loading) {
    return <Spinner label="Loading Google integration status..." />;
  }

  const isLinked = status.data?.linked ?? false;

  return (
    <Card className="p-5 space-y-4">
      {successNote && <SuccessNote>{successNote}</SuccessNote>}
      {actionError && <ErrorNote>{actionError}</ErrorNote>}
      {status.error && <ErrorNote>{describeError(status.error)}</ErrorNote>}

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Google Meet & Workspace</span>
            {isLinked ? (
              <Badge tone="ok">Connected</Badge>
            ) : (
              <Badge tone="neutral">Not Connected</Badge>
            )}
          </div>
          <p className="text-caption text-muted">
            {isLinked
              ? `Connected to your Google Workspace account. Transcripts from connected Google Meet sessions will be automatically imported.`
              : `Link your Google Workspace account to enable direct Google Meet transcript imports without uploading manual files.`}
          </p>
          {isLinked && status.data?.linkedAt && (
            <p className="text-caption text-faint">
              Connected since: {new Date(status.data.linkedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        <div>
          {isLinked ? (
            <Button
              variant="danger"
              onClick={handleDisconnect}
              disabled={unlinking}
            >
              {unlinking ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? 'Redirecting...' : 'Connect Google'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

