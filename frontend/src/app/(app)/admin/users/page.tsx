'use client';

import { type FormEvent, useState } from 'react';
import { Badge } from '@/components/badge';
import { Card, CardHeader } from '@/components/card';
import {
  Button,
  Disclosure,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Spinner,
  SuccessNote,
} from '@/components/ui';
import { describeError, useAsync } from '@/hooks/use-async';
import { api, can, type ManagedUser, type Role, type Session } from '@/lib/api';

/**
 * User administration.
 *
 * What each role means is shown beside it rather than documented elsewhere. An
 * administrator choosing between SHARIAH and CHECKER is making a compliance
 * decision, and a bare six-item dropdown assumes they already know the matrix.
 */

const ROLES: readonly Role[] = [
  'VIEWER',
  'MAKER',
  'CHECKER',
  'SHARIAH',
  'SUPERVISOR',
  'ADMIN',
];

const ROLE_MEANING: Record<Role, string> = {
  VIEWER: 'Read meetings and transcripts. Changes nothing.',
  MAKER: 'Record meetings, and draft and submit term sheets for approval.',
  CHECKER:
    'Approve or reject a submitted term sheet, then record its settlement. Never their own work.',
  SHARIAH:
    'Resolve Shariah findings — the only role that can, including instead of an administrator.',
  SUPERVISOR: 'Read the audit trail. Makes no decisions.',
  ADMIN:
    'Manage users and read the audit trail. Cannot clear a finding, approve a facility, or settle one.',
};

function InviteForm({ onDone }: { onDone: (user: ManagedUser) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createUser(email.trim(), displayName.trim(), role);
      setEmail('');
      setDisplayName('');
      setRole('VIEWER');
      onDone(created);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Invite someone"
        description="You choose their role. They choose their own password."
      />
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="space-y-4 px-5 py-4"
      >
        {error !== null && <ErrorNote>{error}</ErrorNote>}

        <Field label="Email" htmlFor="new-email">
          <Input
            id="new-email"
            type="email"
            required
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@bank.example"
          />
        </Field>

        <Field label="Display name" htmlFor="new-name">
          <Input
            id="new-name"
            required
            value={displayName}
            disabled={busy}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>

        <Field label="Role" htmlFor="new-role" hint={ROLE_MEANING[role]}>
          <Select
            id="new-role"
            value={role}
            disabled={busy}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          Stated on the form, not buried in a help page. An administrator who
          expects to be handed a password needs to know here that they will not be,
          and that the account cannot be used until its owner acts.
        */}
        <p className="rounded-lg border border-line bg-raised px-4 py-3 text-caption leading-relaxed text-muted">
          No password is set here, and none is shown to you. The account is created
          with a random credential nobody reads, so it cannot be signed into until its
          owner sets their own.{' '}
          <span className="font-medium text-text">
            There is no self-service reset yet
          </span>{' '}
          — until there is, an invited user needs their password set directly in the
          database. That is a real gap, not a step you are missing.
        </p>

        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </Card>
  );
}

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: ManagedUser;
  isSelf: boolean;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = user.deactivatedAt === null;

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged(message);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {user.displayName}
              {isSelf && <span className="ml-2 text-caption text-faint">(you)</span>}
            </p>
            <p className="mt-0.5 truncate text-caption text-faint">{user.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={active ? 'brand' : 'neutral'}>{user.role}</Badge>
            {!active && (
              <Badge tone="danger" dot>
                Deactivated
              </Badge>
            )}
          </div>
        </div>

        <p className="mt-2 text-caption leading-relaxed text-muted">
          {ROLE_MEANING[user.role]}
        </p>

        {error !== null && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          {/*
            Both controls are disabled for your own account, and the server refuses
            them independently. Changing your own role or deactivating yourself is
            how a system ends up with no administrator — a mistake, not a decision.
          */}
          <Field label="Change role" htmlFor={`role-${user.id}`}>
            <Select
              id={`role-${user.id}`}
              value={user.role}
              disabled={busy || isSelf}
              onChange={(event) => {
                const next = event.target.value as Role;
                void run(
                  () => api.setUserRole(user.id, next),
                  `${user.displayName} is now ${next}.`,
                );
              }}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>

          <Button
            variant={active ? 'danger' : 'secondary'}
            disabled={busy || isSelf}
            onClick={() => {
              void run(
                () => api.setUserActive(user.id, !active),
                active
                  ? `${user.displayName} can no longer sign in.`
                  : `${user.displayName} can sign in again.`,
              );
            }}
          >
            {busy ? 'Saving…' : active ? 'Deactivate' : 'Reactivate'}
          </Button>

          {isSelf && (
            <p className="w-full text-caption text-faint">
              You cannot change your own role or deactivate yourself. Ask another
              administrator.
            </p>
          )}
        </div>

        <div className="mt-4">
          <Disclosure summary={`What ${user.role} may do`}>
            <ul className="space-y-1">
              {user.capabilities.map((capability) => (
                <li key={capability} className="font-mono text-caption text-muted">
                  {capability}
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      </Card>
    </li>
  );
}

export default function AdminUsersPage() {
  const session = useAsync<Session>(() => api.me(), 'session');
  const users = useAsync(() => api.users(), 'users');
  const [done, setDone] = useState<string | null>(null);

  if (session.loading) return <Spinner label="Checking your session" />;

  if (!can(session.data, 'user:manage')) {
    return (
      <ErrorNote>
        Only an administrator can manage users. Your role does not include
        user:manage.
      </ErrorNote>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administration"
        title="Users and roles"
        lead={
          'A role decides what someone can do, and several of them are compliance '
          + 'boundaries rather than conveniences. Every change here is written to the '
          + 'audit trail.'
        }
      />

      {done !== null && <SuccessNote>{done}</SuccessNote>}

      <InviteForm
        onDone={(user) => {
          setDone(`${user.displayName} was created as ${user.role}.`);
          users.reload();
        }}
      />

      <Section
        title="Accounts"
        description="Deactivated accounts are kept, not deleted — their approvals and audit entries name them."
      >
        {users.loading && <Spinner label="Loading users" />}
        {users.error !== null && <ErrorNote>{users.error}</ErrorNote>}

        <ul className="space-y-4">
          {users.data?.users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === session.data?.id}
              onChanged={(message) => {
                setDone(message);
                users.reload();
              }}
            />
          ))}
        </ul>
      </Section>
    </div>
  );
}
