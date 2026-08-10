import type { PrismaClient } from '@prisma/client';

/**
 * Cross-meeting relationships, built from topics and facility metadata only.
 *
 * **No edge is ever drawn from a redaction placeholder, and that is correctness
 * rather than caution.** Redaction contexts are per-meeting, so `[NRIC_1]` in one
 * meeting and `[NRIC_1]` in another are *different people*. A graph linking them
 * would not merely be over-sharing — it would assert a relationship that does not
 * exist, which is worse. Nothing personal participates in an edge, and the
 * placeholder guard below is asserted by a test.
 *
 * Every edge carries a human-readable reason. An edge a user cannot interrogate is
 * a claim they have to take on faith, and this product's whole argument is that it
 * does not ask for faith.
 */

/** Anything shaped like a redaction placeholder must never become a node. */
const PLACEHOLDER = /\[[A-Z_]+_\d+\]/;

/**
 * How close two summaries must be to count as related on similarity alone.
 *
 * Set by intent rather than by data, and deliberately high: a graph that links
 * everything to everything communicates nothing, and two credit meetings at a
 * Malaysian bank share so much vocabulary that a low threshold turns the corpus
 * into one blob. Topic overlap is the more legible signal and does most of the
 * work.
 */
export const SIMILARITY_THRESHOLD = 0.82;

/** Topic overlap needed for an edge, when similarity is unavailable or below par. */
export const MIN_SHARED_TOPICS = 2;

export interface GraphNode {
  readonly meetingId: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly status: string;
  readonly termSheetCount: number;
  readonly openFindingCount: number;
  readonly topics: readonly string[];
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /** 0–1. Drives line weight only; not a probability of anything. */
  readonly strength: number;
  /** Why this edge exists, in words a reviewer can check against the meetings. */
  readonly reason: string;
  readonly sharedTopics: readonly string[];
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** True when no embedding was available, so edges rest on topic overlap alone. */
  readonly similarityUnavailable: boolean;
}

/**
 * Cosine similarity of two equal-length vectors.
 *
 * Returns 0 for mismatched or empty input rather than throwing: a transcript
 * embedded by an older model has a different dimensionality, and that is a reason
 * to skip the pair, not to fail the whole graph.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Formats an edge's justification. Never names a person, because it cannot. */
function describeEdge(shared: readonly string[], similarity: number): string {
  if (shared.length > 0) {
    const list = shared.slice(0, 3).join(', ');
    const rest = shared.length > 3 ? ` and ${String(shared.length - 3)} more` : '';
    return `Both discuss ${list}${rest}.`;
  }
  return `Their summaries are ${String(Math.round(similarity * 100))}% similar in wording.`;
}

/**
 * Builds the whole graph in one pass.
 *
 * **This is O(n²) over meetings and holds every embedding in memory.** Fine for
 * the tens-to-low-hundreds a demo or a pilot has; wrong for a real deployment,
 * which needs pgvector or a vector store with an indexed nearest-neighbour query.
 * Stated here rather than left to be discovered, because the failure mode is a
 * slow page rather than an error, and slow pages get blamed on the network.
 */
export async function buildGraph(prisma: PrismaClient): Promise<Graph> {
  const meetings = await prisma.meeting.findMany({
    where: { status: 'READY' },
    orderBy: { occurredAt: 'desc' },
    select: {
      id: true,
      title: true,
      occurredAt: true,
      status: true,
      topics: { select: { label: true, weight: true }, orderBy: { weight: 'desc' } },
      transcript: { select: { summaryEmbedding: true } },
      _count: { select: { termSheets: true } },
      shariahFlags: {
        where: { status: { in: ['FLAGGED', 'UNDER_REVIEW'] } },
        select: { id: true },
      },
    },
  });

  const nodes: GraphNode[] = meetings.map((meeting) => ({
    meetingId: meeting.id,
    title: meeting.title,
    occurredAt: meeting.occurredAt.toISOString(),
    status: meeting.status,
    termSheetCount: meeting._count.termSheets,
    openFindingCount: meeting.shariahFlags.length,
    /**
     * Filtered, not trusted. Extraction already refuses placeholder labels; this
     * is the second gate, because a topic list is the one field on this payload
     * that came from a language model reading a transcript.
     */
    topics: meeting.topics
      .map((topic) => topic.label)
      .filter((label) => !PLACEHOLDER.test(label)),
  }));

  const embeddings = new Map<string, readonly number[]>(
    meetings.map((meeting) => [meeting.id, meeting.transcript?.summaryEmbedding ?? []]),
  );
  const similarityUnavailable = [...embeddings.values()].every((v) => v.length === 0);

  const edges: GraphEdge[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i];
      const right = nodes[j];
      if (left === undefined || right === undefined) continue;

      const rightTopics = new Set(right.topics);
      const shared = left.topics.filter((label) => rightTopics.has(label));

      const similarity = cosineSimilarity(
        embeddings.get(left.meetingId) ?? [],
        embeddings.get(right.meetingId) ?? [],
      );

      const byTopic = shared.length >= MIN_SHARED_TOPICS;
      const bySimilarity = similarity >= SIMILARITY_THRESHOLD;
      if (!byTopic && !bySimilarity) continue;

      /**
       * Topic overlap dominates the strength even when similarity is higher.
       * Shared vocabulary between two credit meetings is cheap; two meetings
       * naming the same contract and the same finding is a real connection, and
       * the line weight should reflect which kind of evidence it rests on.
       */
      const strength = byTopic ? Math.min(1, 0.5 + shared.length * 0.15) : similarity;

      edges.push({
        from: left.meetingId,
        to: right.meetingId,
        strength,
        reason: describeEdge(shared, similarity),
        sharedTopics: shared,
      });
    }
  }

  return { nodes, edges, similarityUnavailable };
}

/**
 * Ranks meetings by how close their summary is to a query embedding.
 *
 * Used by the assistant to choose what to read. A meeting with no embedding scores
 * zero and is excluded rather than included at an invented score — an unembedded
 * transcript is not a poor match, it is an unknown one.
 */
export function rankBySimilarity(
  query: readonly number[],
  candidates: readonly { readonly meetingId: string; readonly embedding: readonly number[] }[],
  limit: number,
): readonly { readonly meetingId: string; readonly score: number }[] {
  return candidates
    .map((candidate) => ({
      meetingId: candidate.meetingId,
      score: cosineSimilarity(query, candidate.embedding),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Rejects a label that looks like a redaction placeholder, or is unusable. */
export function isStorableTopicLabel(label: string): boolean {
  const trimmed = label.trim();
  return (
    trimmed.length > 0
    && trimmed.length <= 60
    && !PLACEHOLDER.test(trimmed)
    // A bare bracketed token is placeholder-shaped even when the type is unknown
    // to the pattern above — a model inventing [CUSTOMER_1] must not become a node.
    && !/^\[.*\]$/.test(trimmed)
  );
}
