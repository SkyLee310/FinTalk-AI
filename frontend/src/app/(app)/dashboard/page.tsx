'use client';

import Link from 'next/link';
import { Badge, type Tone } from '@/components/badge';
import { Card } from '@/components/card';
import {
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Section,
  Spinner,
  Stat,
} from '@/components/ui';
import { WorkflowGuide } from '@/components/workflow-guide';
import { useAsync } from '@/hooks/use-async';
import {
  api,
  type ApprovalStatus,
  can,
  type FeedbackCategory,
  type MeetingStatus,
  type Session,
} from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

const ROLE_TONE: Record<string, Tone> = {
  MAKER: 'brand',
  CHECKER: 'warn',
  SHARIAH: 'ok',
  ADMIN: 'danger',
  OVERSIGHT: 'neutral',
  VIEWER: 'neutral',
  SUPERVISOR: 'neutral',
};

const DECISION_TONE: Record<ApprovalStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_CHECKER: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

const DECISION_LABEL: Record<ApprovalStatus, string> = {
  DRAFT: 'DRAFT',
  PENDING_CHECKER: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
};

const MEETING_STATUS_TONE: Record<MeetingStatus, Tone> = {
  CAPTURED: 'neutral',
  PROCESSING: 'warn',
  READY: 'ok',
  FAILED: 'danger',
};

const FEEDBACK_TONE: Record<FeedbackCategory, Tone> = {
  BUG: 'danger',
  IDEA: 'brand',
  OTHER: 'neutral',
};

export default function DashboardPage() {
  const session = useAsync<Session>(() => api.me(), 'session');

  if (session.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label="Loading your dashboard" />
      </div>
    );
  }

  if (session.error !== null || session.data === null) {
    return <ErrorNote>{session.error ?? 'Unable to load your session.'}</ErrorNote>;
  }

  const user = session.data;
  const isMaker = can(user, 'termsheet:draft');
  const isChecker = can(user, 'termsheet:approve');
  const isShariah = can(user, 'shariah:review');
  const isAdmin = can(user, 'user:manage');
  const isOversight = user.role === 'OVERSIGHT';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace Dashboard"
        title={`Welcome back, ${user.displayName}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ROLE_TONE[user.role] ?? 'neutral'} dot>
              {user.role}
            </Badge>
            <span className="text-caption text-faint">
              {formatDate(new Date())}
            </span>
          </div>
        }
      />

      {/* Interactive 4-Step Lifecycle Guide for First-time and Regular Users */}
      <WorkflowGuide user={user} />

      {/* Role-specific Sections */}
      {isChecker && <CheckerSection />}
      {isShariah && <ShariahSection />}
      {isAdmin && <AdminSection />}
      {isMaker && <MakerSection session={user} />}
      {isOversight && <OversightSection />}
    </div>
  );
}

/** -----------------------------------------------------------------------
 * CHECKER SECTION
 * ----------------------------------------------------------------------- */
function CheckerSection() {
  const approvalsState = useAsync(() => api.approvals(), 'checker-dashboard-approvals');

  if (approvalsState.loading) return <Spinner label="Loading pending approvals" />;
  if (approvalsState.error !== null) return <ErrorNote>{approvalsState.error}</ErrorNote>;

  const approvals = approvalsState.data?.approvals ?? [];
  const pendingApprovals = approvals.filter((a) => a.decision === 'PENDING_CHECKER');
  const awaitingSettlement = approvals.filter(
    (a) => a.decision === 'APPROVED' && a.settlement === null,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Pending Approvals"
          value={pendingApprovals.length}
          tone={pendingApprovals.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Awaiting Settlement"
          value={awaitingSettlement.length}
          tone={awaitingSettlement.length > 0 ? 'brand' : 'neutral'}
        />
        <Stat
          label="Total Handled"
          value={approvals.length}
          tone="neutral"
        />
      </div>

      <Section
        title="Pending Term Sheet Approvals"
        action={
          <Link href="/approvals" className="text-caption font-medium text-brand hover:underline">
            View all approvals →
          </Link>
        }
      >
        {pendingApprovals.length === 0 ? (
          <EmptyState
            title="No approvals pending"
            body="All submitted term sheets have been reviewed. New submissions from Makers will appear here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {pendingApprovals.slice(0, 4).map((row) => (
              <Link key={row.id} href="/approvals" className="block transition hover:-translate-y-px">
                <Card className="p-4 transition hover:border-line-strong">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-caption font-semibold uppercase tracking-wider text-muted">
                        {row.termSheet.facilityKind}
                      </span>
                      <h3 className="mt-1 text-sm font-bold text-text">{row.termSheet.applicantName}</h3>
                    </div>
                    <Badge tone={DECISION_TONE[row.decision]}>{row.decision}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-2 text-caption">
                    <span className="font-mono font-semibold text-text">
                      {row.termSheet.currency} {row.termSheet.principalFormatted}
                    </span>
                    <span className="text-faint">By {row.makerName}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** -----------------------------------------------------------------------
 * SHARIAH SECTION
 * ----------------------------------------------------------------------- */
function ShariahSection() {
  const meetingsState = useAsync(() => api.meetings(), 'shariah-dashboard-meetings');

  if (meetingsState.loading) return <Spinner label="Loading compliance findings" />;
  if (meetingsState.error !== null) return <ErrorNote>{meetingsState.error}</ErrorNote>;

  const meetings = meetingsState.data?.meetings ?? [];
  const flaggedMeetings = meetings.filter((m) => m.shariahFlagCount > 0 && m.status === 'READY');
  const totalFindings = meetings.reduce((sum, m) => sum + m.shariahFlagCount, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Flagged Meetings"
          value={flaggedMeetings.length}
          tone={flaggedMeetings.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Total Findings"
          value={totalFindings}
          tone={totalFindings > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Audited Meetings"
          value={meetings.length}
          tone="neutral"
        />
      </div>

      <Section
        title="Meetings Requiring Shariah Review"
        action={
          <Link href="/meetings" className="text-caption font-medium text-brand hover:underline">
            View all meetings →
          </Link>
        }
      >
        {flaggedMeetings.length === 0 ? (
          <EmptyState
            title="All clear"
            body="No meetings currently have unresolved Shariah flags. New findings flagged by AI will appear here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {flaggedMeetings.slice(0, 4).map((meeting) => (
              <Link
                key={meeting.id}
                href={`/meetings/${meeting.id}`}
                className="block transition hover:-translate-y-px"
              >
                <Card className="p-4 transition hover:border-line-strong">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-text">{meeting.title}</h3>
                    <Badge tone="warn" dot>
                      {meeting.shariahFlagCount} finding{meeting.shariahFlagCount === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-caption text-faint border-t border-line pt-2">
                    <span>{formatDateTime(meeting.occurredAt)}</span>
                    <span className="font-medium text-brand">Resolve finding →</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** -----------------------------------------------------------------------
 * ADMIN SECTION
 * ----------------------------------------------------------------------- */
function AdminSection() {
  const usersState = useAsync(() => api.users(), 'admin-dashboard-users');
  const feedbackState = useAsync(() => api.feedback(), 'admin-dashboard-feedback');

  const usersLoading = usersState.loading;
  const feedbackLoading = feedbackState.loading;

  if (usersLoading || feedbackLoading) return <Spinner label="Loading admin metrics" />;

  const users = usersState.data?.users ?? [];
  const pendingUsers = users.filter((u) => u.accountStatus === 'PENDING');
  const feedbackList = feedbackState.data?.feedback ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Pending Registrations"
          value={pendingUsers.length}
          tone={pendingUsers.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Active Users"
          value={users.filter((u) => u.accountStatus === 'ACTIVE').length}
          tone="neutral"
        />
        <Stat
          label="Feedback Received"
          value={feedbackList.length}
          tone={feedbackList.length > 0 ? 'brand' : 'neutral'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pending Users Column */}
        <Section
          title="Pending Approvals"
          action={
            <Link href="/admin/users" className="text-caption font-medium text-brand hover:underline">
              Manage users →
            </Link>
          }
        >
          {pendingUsers.length === 0 ? (
            <EmptyState
              title="No pending requests"
              body="All user accounts have been reviewed and assigned roles."
            />
          ) : (
            <ul className="space-y-2.5">
              {pendingUsers.slice(0, 4).map((u) => (
                <li key={u.id}>
                  <Link href="/admin/users">
                    <Card className="p-3.5 transition hover:border-line-strong">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-text">{u.displayName}</p>
                          <p className="text-caption text-faint">{u.email}</p>
                        </div>
                        <Badge tone="warn">Needs Role</Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Feedback Column */}
        <Section
          title="Recent Feedback"
          action={
            <Link href="/admin" className="text-caption font-medium text-brand hover:underline">
              View all feedback →
            </Link>
          }
        >
          {feedbackList.length === 0 ? (
            <EmptyState
              title="No feedback yet"
              body="User suggestions and bug reports will be listed here."
            />
          ) : (
            <ul className="space-y-2.5">
              {feedbackList.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <Link href="/admin">
                    <Card className="p-3.5 transition hover:border-line-strong">
                      <div className="flex items-start justify-between gap-2">
                        <Badge tone={FEEDBACK_TONE[item.category]}>{item.category}</Badge>
                        <span className="text-caption text-faint">{formatDate(item.createdAt)}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-caption text-muted">{item.message}</p>
                      <p className="mt-1 text-xs font-medium text-text">— {item.author.displayName}</p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** -----------------------------------------------------------------------
 * MAKER SECTION
 * ----------------------------------------------------------------------- */
function MakerSection({ session }: { session: Session }) {
  const approvalsState = useAsync(() => api.approvals(), 'maker-dashboard-approvals');
  const meetingsState = useAsync(() => api.meetings(), 'maker-dashboard-meetings');

  if (approvalsState.loading || meetingsState.loading) {
    return <Spinner label="Loading your deals and meetings" />;
  }

  const approvals = approvalsState.data?.approvals ?? [];
  const myApprovals = approvals.filter((a) => a.makerId === session.id);
  const myInFlight = myApprovals.filter((a) => a.decision === 'PENDING_CHECKER');
  const myApproved = myApprovals.filter((a) => a.decision === 'APPROVED');
  const myRejected = myApprovals.filter((a) => a.decision === 'REJECTED');

  const meetings = meetingsState.data?.meetings ?? [];
  const myMeetings = meetings.filter((m) => m.createdById === session.id);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Pending Approval"
          value={myInFlight.length}
          tone={myInFlight.length > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Approved Facilities"
          value={myApproved.length}
          tone="ok"
        />
        <Stat
          label="Action Required"
          value={myRejected.length}
          tone={myRejected.length > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label="Captured Meetings"
          value={myMeetings.length}
          tone="brand"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* In-flight and recent approvals */}
        <Section
          title="My Term Sheet Submissions"
          action={
            <Link href="/approvals" className="text-caption font-medium text-brand hover:underline">
              Go to Approvals →
            </Link>
          }
        >
          {myApprovals.length === 0 ? (
            <EmptyState
              title="No term sheets drafted yet"
              body="Draft term sheets from your recorded meetings to submit them for approval."
            />
          ) : (
            <ul className="space-y-2.5">
              {myApprovals.slice(0, 4).map((approval) => (
                <li key={approval.id}>
                  <Link href="/approvals">
                    <Card className="p-3.5 transition hover:border-line-strong">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-text">{approval.termSheet.applicantName}</p>
                          <p className="font-mono text-caption text-muted">
                            {approval.termSheet.currency} {approval.termSheet.principalFormatted}
                          </p>
                        </div>
                        <Badge tone={DECISION_TONE[approval.decision]}>
                          {DECISION_LABEL[approval.decision]}
                        </Badge>
                      </div>
                      {approval.note && (
                        <p className="mt-2 text-xs italic text-faint">Note: &ldquo;{approval.note}&rdquo;</p>
                      )}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* My recent meetings */}
        <Section
          title="Recent Meetings"
          action={
            <Link href="/meetings" className="text-caption font-medium text-brand hover:underline">
              View all meetings →
            </Link>
          }
        >
          {myMeetings.length === 0 ? (
            <EmptyState
              title="No meetings recorded yet"
              body="Use the Capture section to record or upload your first client meeting."
            />
          ) : (
            <ul className="space-y-2.5">
              {myMeetings.slice(0, 4).map((meeting) => (
                <li key={meeting.id}>
                  <Link href={`/meetings/${meeting.id}`}>
                    <Card className="p-3.5 transition hover:border-line-strong">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-text">{meeting.title}</p>
                        <Badge tone={MEETING_STATUS_TONE[meeting.status]}>{meeting.status}</Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-caption text-faint">
                        <span>{formatDateTime(meeting.occurredAt)}</span>
                        <span>{meeting.termSheetCount} term sheet{meeting.termSheetCount === 1 ? '' : 's'}</span>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** -----------------------------------------------------------------------
 * OVERSIGHT SECTION
 * ----------------------------------------------------------------------- */
function OversightSection() {
  const meetingsState = useAsync(() => api.meetings(), 'oversight-dashboard-meetings');

  if (meetingsState.loading) return <Spinner label="Loading workspace overview" />;

  const meetings = meetingsState.data?.meetings ?? [];
  const totalFindings = meetings.reduce((sum, m) => sum + m.shariahFlagCount, 0);
  const totalTermSheets = meetings.reduce((sum, m) => sum + m.termSheetCount, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total Meetings" value={meetings.length} tone="brand" />
        <Stat label="Shariah Findings" value={totalFindings} tone="warn" />
        <Stat label="Term Sheets" value={totalTermSheets} tone="neutral" />
      </div>

      <Section
        title="Recent Meeting Records"
        action={
          <Link href="/meetings" className="text-caption font-medium text-brand hover:underline">
            Open Meeting Archive →
          </Link>
        }
      >
        <ul className="space-y-2.5">
          {meetings.slice(0, 5).map((m) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`}>
                <Card className="p-3.5 transition hover:border-line-strong">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-text">{m.title}</span>
                    <Badge tone={MEETING_STATUS_TONE[m.status]}>{m.status}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-caption text-faint">
                    <span>{formatDateTime(m.occurredAt)}</span>
                    <span>{m.shariahFlagCount} Shariah finding{m.shariahFlagCount === 1 ? '' : 's'}</span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
