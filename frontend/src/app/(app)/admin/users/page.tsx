'use client';

import { type FormEvent, useState } from 'react';
import { Badge } from '@/components/badge';
import { Card, CardHeader } from '@/components/card';
import {
  Button,
  Disclosure,
  EmptyState,
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

// Assignable roles only. The Role type (lib/api) still lists VIEWER and
// SUPERVISOR so audit rows can display those historical actors, but neither
// is offered here: both are superseded by OVERSIGHT below.
const ROLES: readonly Role[] = ['MAKER', 'CHECKER', 'SHARIAH', 'ADMIN', 'OVERSIGHT'];

const ROLE_MEANING: Record<Role, string> = {
  VIEWER: 'Superseded by Oversight. Grants nothing on its own — see Oversight below.',
  MAKER: 'Record meetings, and draft and submit term sheets for approval.',
  CHECKER:
    'Approve or reject a submitted term sheet, then record its settlement. Never their own work.',
  SHARIAH:
    'Resolve Shariah findings — the only role that can, including instead of an administrator.',
  SUPERVISOR: 'Superseded by Oversight. Grants nothing on its own — see Oversight below.',
  ADMIN:
    'Manage users only. Cannot view meetings, transcripts, or the audit trail — that '
    + 'visibility belongs to Oversight, kept separate so an administrator can never both '
    + 'grant permissions and inspect the trail meant to catch their own misuse of them.',
  OVERSIGHT:
    'Read-only, and never both permission-managing and audit-watching at once. What it '
    + 'sees is set per account, below — meetings and transcripts, the audit trail, or both.',
};

/**
 * The two OVERSIGHT grants, shown wherever a role is being chosen or an
 * existing Oversight account is being edited. Not shown for any other role —
 * the two columns are meaningless there (see capabilitiesOf in
 * backend/src/auth/rbac.ts).
 */
function OversightFlagsFields({
  canViewMeetings,
  canViewAuditTrail,
  disabled,
  onChangeMeetings,
  onChangeAuditTrail,
}: {
  canViewMeetings: boolean;
  canViewAuditTrail: boolean;
  disabled: boolean;
  onChangeMeetings: (value: boolean) => void;
  onChangeAuditTrail: (value: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-raised px-4 py-3">
      <p className="text-caption font-medium text-text">What this Oversight account can see</p>
      <label className="flex items-center gap-2 text-caption text-muted">
        <input
          type="checkbox"
          checked={canViewMeetings}
          disabled={disabled}
          onChange={(event) => onChangeMeetings(event.target.checked)}
        />
        Meetings and transcripts
      </label>
      <label className="flex items-center gap-2 text-caption text-muted">
        <input
          type="checkbox"
          checked={canViewAuditTrail}
          disabled={disabled}
          onChange={(event) => onChangeAuditTrail(event.target.checked)}
        />
        The audit trail
      </label>
    </div>
  );
}

function InviteForm({ onDone }: { onDone: (user: ManagedUser) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('MAKER');
  const [canViewMeetings, setCanViewMeetings] = useState(false);
  const [canViewAuditTrail, setCanViewAuditTrail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createUser(email.trim(), displayName.trim(), role, {
        canViewMeetings,
        canViewAuditTrail,
      });
      setEmail('');
      setDisplayName('');
      setRole('MAKER');
      setCanViewMeetings(false);
      setCanViewAuditTrail(false);
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

        {role === 'OVERSIGHT' && (
          <OversightFlagsFields
            canViewMeetings={canViewMeetings}
            canViewAuditTrail={canViewAuditTrail}
            disabled={busy}
            onChangeMeetings={setCanViewMeetings}
            onChangeAuditTrail={setCanViewAuditTrail}
          />
        )}

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

/**
 * A self-registered account with no role and no access yet. Approve grants
 * one of the same roles InviteForm can grant — this path is not restricted
 * to a smaller set — and immediately lets the account sign in. Reject is a
 * real delete: nothing may yet reference an unapproved registration, which
 * is exactly what makes deleting it safe here and nowhere else in this app.
 */
function PendingUserRow({
  user,
  readOnly,
  onChanged,
}: {
  user: ManagedUser;
  readOnly: boolean;
  onChanged: (message: string) => void;
}) {
  const [role, setRole] = useState<Role | ''>('');
  const [canViewMeetings, setCanViewMeetings] = useState(false);
  const [canViewAuditTrail, setCanViewAuditTrail] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(): Promise<void> {
    if (role === '') return;
    setBusy('approve');
    setError(null);
    try {
      await api.approveUser(user.id, role, { canViewMeetings, canViewAuditTrail });
      onChanged(`${user.displayName} was approved as ${role}.`);
    } catch (cause) {
      setError(describeError(cause));
      setBusy(null);
    }
  }

  async function reject(): Promise<void> {
    setBusy('reject');
    setError(null);
    try {
      await api.rejectUser(user.id);
      onChanged(`${user.displayName}'s registration was rejected.`);
    } catch (cause) {
      setError(describeError(cause));
      setBusy(null);
    }
  }

  return (
    <li>
      <Card className="p-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.displayName}</p>
          <p className="mt-0.5 truncate text-caption text-faint">{user.email}</p>
        </div>

        <dl className="mt-3 grid gap-1.5 text-caption text-muted sm:grid-cols-2">
          <div className="flex gap-1.5">
            <dt className="font-medium text-text">Username</dt>
            <dd>{user.username}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="font-medium text-text">Staff ID</dt>
            <dd>{user.staffId}</dd>
          </div>
        </dl>

        {error !== null && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        {!readOnly && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="Grant role"
                htmlFor={`grant-role-${user.id}`}
                hint={role === '' ? 'Choose a role to enable Approve.' : ROLE_MEANING[role]}
              >
                <Select
                  id={`grant-role-${user.id}`}
                  value={role}
                  disabled={busy !== null}
                  onChange={(event) => setRole(event.target.value as Role | '')}
                >
                  <option value="">Choose a role…</option>
                  {ROLES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>

              <Button
                disabled={busy !== null || role === ''}
                onClick={() => {
                  void approve();
                }}
              >
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </Button>
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() => {
                  void reject();
                }}
              >
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </Button>
            </div>

            {role === 'OVERSIGHT' && (
              <OversightFlagsFields
                canViewMeetings={canViewMeetings}
                canViewAuditTrail={canViewAuditTrail}
                disabled={busy !== null}
                onChangeMeetings={setCanViewMeetings}
                onChangeAuditTrail={setCanViewAuditTrail}
              />
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function UserRow({
  user,
  isSelf,
  readOnly,
  onChanged,
}: {
  user: ManagedUser;
  isSelf: boolean;
  readOnly: boolean;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = user.deactivatedAt === null;
  // ManagedUser.role is Role | null because a PENDING registration has none
  // yet (Task 11 of the UX redesign). This row only ever renders an ACTIVE
  // account — Task 16 adds the PENDING queue as its own separate list — so
  // the non-null assertion just states what is already true here.
  const role = user.role!;

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
            <Badge tone={active ? 'brand' : 'neutral'}>{role}</Badge>
            {!active && (
              <Badge tone="danger" dot>
                Deactivated
              </Badge>
            )}
          </div>
        </div>

        <p className="mt-2 text-caption leading-relaxed text-muted">
          {ROLE_MEANING[role]}
        </p>

        {error !== null && (
          <div className="mt-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}

        <div className="mt-4 border-t border-line pt-4">
          {readOnly ? (
            role === 'OVERSIGHT' && (
              <div className="space-y-1 text-caption text-muted bg-raised px-4 py-3 rounded-lg border border-line">
                <p className="font-medium text-text">Assigned permissions:</p>
                <p className="flex items-center gap-2">
                  <span className={`inline-block size-2 rounded-full ${user.canViewMeetings ? 'bg-brand' : 'bg-line'}`} />
                  Meetings and transcripts: {user.canViewMeetings ? 'Enabled' : 'Disabled'}
                </p>
                <p className="flex items-center gap-2">
                  <span className={`inline-block size-2 rounded-full ${user.canViewAuditTrail ? 'bg-brand' : 'bg-line'}`} />
                  Audit trail: {user.canViewAuditTrail ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Change role" htmlFor={`role-${user.id}`}>
                  <Select
                    id={`role-${user.id}`}
                    value={role}
                    disabled={busy || isSelf}
                    onChange={(event) => {
                      const next = event.target.value as Role;
                      void run(
                        () =>
                          api.setUserRole(
                            user.id,
                            next,
                            // When keeping or moving to OVERSIGHT, preserve the
                            // existing flags rather than zeroing them out.
                            next === 'OVERSIGHT'
                              ? {
                                  canViewMeetings: user.canViewMeetings,
                                  canViewAuditTrail: user.canViewAuditTrail,
                                }
                              : undefined,
                          ),
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

              {role === 'OVERSIGHT' && (
                <OversightFlagsFields
                  canViewMeetings={user.canViewMeetings}
                  canViewAuditTrail={user.canViewAuditTrail}
                  disabled={busy || isSelf}
                  onChangeMeetings={(value) => {
                    void run(
                      () =>
                        api.setUserRole(user.id, 'OVERSIGHT', {
                          canViewMeetings: value,
                          canViewAuditTrail: user.canViewAuditTrail,
                        }),
                      `${user.displayName}'s meeting visibility is now ${value ? 'on' : 'off'}.`,
                    );
                  }}
                  onChangeAuditTrail={(value) => {
                    void run(
                      () =>
                        api.setUserRole(user.id, 'OVERSIGHT', {
                          canViewMeetings: user.canViewMeetings,
                          canViewAuditTrail: value,
                        }),
                      `${user.displayName}'s audit trail visibility is now ${value ? 'on' : 'off'}.`,
                    );
                  }}
                />
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <Disclosure summary={`What ${role} may do`}>
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

  if (!can(session.data, 'user:read')) {
    return (
      <ErrorNote>
        Only an administrator or oversight account can view users. Your role does not include
        user:read.
      </ErrorNote>
    );
  }

  const pendingUsers = users.data?.users.filter((user) => user.accountStatus === 'PENDING') ?? [];
  const activeUsers = users.data?.users.filter((user) => user.accountStatus === 'ACTIVE') ?? [];

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
      {users.loading && <Spinner label="Loading users" />}
      {users.error !== null && <ErrorNote>{users.error}</ErrorNote>}

      {can(session.data, 'user:manage') && (
        <InviteForm
          onDone={(user) => {
            setDone(`${user.displayName} was created as ${user.role}.`);
            users.reload();
          }}
        />
      )}

      <Section
        title="Pending approval"
        description="A self-registered account waits here with no role and no access until you approve it."
      >
        {!users.loading && pendingUsers.length === 0 && (
          <EmptyState
            title="No pending registrations"
            body="Anyone who signs up from the public site appears here for you to approve or reject."
          />
        )}

        {pendingUsers.length > 0 && (
          <ul className="space-y-4">
            {pendingUsers.map((user) => (
              <PendingUserRow
                key={user.id}
                user={user}
                readOnly={!can(session.data, 'user:manage')}
                onChanged={(message) => {
                  setDone(message);
                  users.reload();
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Accounts"
        description="Deactivated accounts are kept, not deleted — their approvals and audit entries name them."
      >
        <ul className="space-y-4">
          {activeUsers.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === session.data?.id}
              readOnly={!can(session.data, 'user:manage')}
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
