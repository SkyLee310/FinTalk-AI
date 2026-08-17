'use client';

import { Badge } from '@/components/badge';
import { Card, CardHeader } from '@/components/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export default function AuditPage() {
  const audit = useAsync(() => api.audit(), 'audit');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Audit trail"
        lead="Append-only, and hash-chained so an alteration anywhere invalidates every entry after it. The chain is verified on each read rather than trusted."
      />

      {audit.loading && <Spinner label="Verifying the chain" />}
      {audit.error !== null && <ErrorNote>{audit.error}</ErrorNote>}

      {audit.data && (
        <>
          {/*
            Integrity is shown, not assumed. If the chain is broken the viewer must
            see which entry failed rather than a page that looks normal.
          */}
          <Card>
            <CardHeader
              title="Chain integrity"
              description={`${String(audit.data.integrity.length)} entries verified`}
              action={
                <Badge tone={audit.data.integrity.ok ? 'ok' : 'danger'} dot>
                  {audit.data.integrity.ok ? 'Verified' : 'Broken'}
                </Badge>
              }
            />
            {!audit.data.integrity.ok && (
              <div className="px-5 py-4">
                <ErrorNote>
                  The chain fails at entry {audit.data.integrity.brokenAtId} (
                  {audit.data.integrity.reason}). Every entry after it is untrustworthy.
                  Treat this as a security incident.
                </ErrorNote>
              </div>
            )}
          </Card>

          {audit.data.entries.length === 0 ? (
            <EmptyState title="No entries yet" body="Actions appear here as they happen." />
          ) : (
            <Card>
              <CardHeader title="Recent activity" description="Newest first, up to 200." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-faint">
                    <tr>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        When
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Actor
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Action
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Entity
                      </th>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Hash
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {audit.data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted">
                          {formatDateTime(entry.at)}
                        </td>
                        <td className="px-5 py-2.5 text-xs">
                          {entry.actorRole === null ? (
                            <span className="text-faint">system</span>
                          ) : (
                            <Badge tone="neutral">{entry.actorRole}</Badge>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="font-mono text-xs">{entry.action}</span>
                        </td>
                        <td className="px-5 py-2.5 text-xs text-muted">
                          {entry.entityType}
                          <span className="text-faint"> · {entry.entityId.slice(0, 8)}</span>
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="font-mono text-xs text-faint">
                            {entry.hash.slice(0, 12)}…
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
