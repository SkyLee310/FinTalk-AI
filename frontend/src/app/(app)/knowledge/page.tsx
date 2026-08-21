'use client';

import { useRouter } from 'next/navigation';
import { KnowledgeGraphView } from '@/components/knowledge-graph';
import { ErrorNote, PageHeader, Spinner } from '@/components/ui';
import { useAsync } from '@/hooks/use-async';
import { api } from '@/lib/api';

/**
 * How meetings connect — the one thing a chat answer cannot show well.
 *
 * Asking a question now lives in the header-anchored Ask FinTalk AI panel
 * (components/ask-fintalk-ai.tsx), reachable from anywhere in the signed-in
 * app rather than a form that only ever existed on this one page. What
 * remains here is the shape of the whole corpus at once, at full page
 * width instead of sharing the page with a form above it.
 */
export default function KnowledgePage() {
  const router = useRouter();
  const graph = useAsync(() => api.knowledgeGraph(), 'knowledge-graph');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Knowledge Graph"
        title="How meetings connect"
      />

      {graph.loading && <Spinner label="Building the graph" />}
      {graph.error !== null && <ErrorNote>{graph.error}</ErrorNote>}
      {graph.data !== null && (
        <KnowledgeGraphView
          graph={graph.data}
          onOpenMeeting={(meetingId) => {
            router.push(`/meetings/${meetingId}`);
          }}
        />
      )}
    </div>
  );
}
