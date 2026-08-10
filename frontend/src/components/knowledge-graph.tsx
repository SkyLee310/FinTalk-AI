'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@/lib/api';

/**
 * A force-directed graph of connected meetings, in plain SVG.
 *
 * **No layout library.** The simulation below is about forty lines — repulsion,
 * spring attraction along edges, and a pull toward the centre — and a graph
 * dependency would be tens of kilobytes for a view most users open rarely. The same
 * restraint put mermaid behind a dynamic import.
 *
 * The layout runs once over a fixed iteration count rather than animating forever. A
 * perpetually drifting graph is hard to read, hard to click, and keeps a phone's CPU
 * busy for decoration.
 *
 * Nodes are meetings and edges are shared topics. **No node is ever a person** —
 * redaction placeholders are per-meeting, so a person cannot be identified across
 * two meetings, and the graph does not pretend otherwise.
 */

interface Placed {
  readonly node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const WIDTH = 900;
const HEIGHT = 520;
const ITERATIONS = 320;

/**
 * Deterministic starting positions.
 *
 * Seeded from the meeting id rather than Math.random, so the same corpus lays out the
 * same way on every load. A graph that rearranges itself on refresh makes a reader
 * doubt what they saw the first time.
 */
function seededAngle(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 100_000;
  }
  return (hash / 100_000) * Math.PI * 2;
}

function layout(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Placed[] {
  const radius = Math.min(WIDTH, HEIGHT) / 3;
  const placed: Placed[] = nodes.map((node, index) => {
    const angle = seededAngle(node.meetingId) + index * 0.01;
    return {
      node,
      x: WIDTH / 2 + Math.cos(angle) * radius,
      y: HEIGHT / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const index = new Map(placed.map((p, i) => [p.node.meetingId, i]));

  for (let step = 0; step < ITERATIONS; step += 1) {
    // Cooling, so early iterations explore and later ones settle.
    const damping = 0.85 * (1 - step / ITERATIONS) + 0.1;

    // Repulsion: every pair pushes apart, which is what stops the graph collapsing
    // into one unreadable knot.
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (a === undefined || b === undefined) continue;

        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1) {
          // Coincident nodes have no direction to separate along. Nudge, rather than
          // divide by zero and poison the rest of the run with NaN.
          dx = (i - j) * 0.5;
          dy = 0.5;
          distance = 1;
        }
        const force = 9_000 / (distance * distance);
        a.vx += (dx / distance) * force;
        a.vy += (dy / distance) * force;
        b.vx -= (dx / distance) * force;
        b.vy -= (dy / distance) * force;
      }
    }

    // Attraction along edges, stronger for a stronger relationship.
    for (const edge of edges) {
      const from = placed[index.get(edge.from) ?? -1];
      const to = placed[index.get(edge.to) ?? -1];
      if (from === undefined || to === undefined) continue;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 140) * 0.02 * edge.strength;
      from.vx += (dx / distance) * force;
      from.vy += (dy / distance) * force;
      to.vx -= (dx / distance) * force;
      to.vy -= (dy / distance) * force;
    }

    for (const point of placed) {
      // A gentle pull to the centre, so an unconnected meeting does not drift off
      // the canvas and become invisible.
      point.vx += (WIDTH / 2 - point.x) * 0.006;
      point.vy += (HEIGHT / 2 - point.y) * 0.006;

      point.x = Math.max(40, Math.min(WIDTH - 40, point.x + point.vx * damping * 0.1));
      point.y = Math.max(30, Math.min(HEIGHT - 30, point.y + point.vy * damping * 0.1));
      point.vx *= 0.6;
      point.vy *= 0.6;
    }
  }

  return placed;
}

export function KnowledgeGraphView({
  graph,
  onOpenMeeting,
}: {
  graph: KnowledgeGraph;
  onOpenMeeting: (meetingId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const placed = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.meetingId, p])), [placed]);

  // Clears a stale selection if the corpus changes underneath it.
  useEffect(() => {
    setSelected(null);
    setSelectedEdge(null);
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-raised px-4 py-6 text-center text-caption text-muted">
        No processed meetings yet. Capture one, and connections appear here as the
        corpus grows.
      </p>
    );
  }

  const selectedNode = selected === null ? null : byId.get(selected)?.node ?? null;

  return (
    <div className="space-y-3">
      {graph.similarityUnavailable && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft/60 px-4 py-2.5 text-caption text-muted">
          Connections here come from shared topics only. No embedding model is
          configured, so similarity of wording is not being compared — some genuine
          relationships will be missing rather than wrong.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          className="h-auto w-full min-w-[640px]"
          role="img"
          aria-label={
            `Knowledge graph: ${String(graph.nodes.length)} meetings, `
            + `${String(graph.edges.length)} connections. `
            + 'The list below carries the same information.'
          }
        >
          {graph.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (from === undefined || to === undefined) return null;
            const active = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to;
            const touchesSelection = selected === edge.from || selected === edge.to;

            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="currentColor"
                className={
                  active || touchesSelection
                    ? 'cursor-pointer text-brand'
                    : 'cursor-pointer text-line-strong'
                }
                strokeWidth={1 + edge.strength * 3}
                strokeOpacity={active || touchesSelection ? 0.9 : 0.45}
                onClick={() => {
                  setSelectedEdge(edge);
                  setSelected(null);
                }}
              />
            );
          })}

          {placed.map((point) => {
            const { node } = point;
            // Size carries how much came out of the meeting; colour carries whether
            // anything is still outstanding on it.
            const size = 7 + Math.min(4, node.termSheetCount) * 2.5;
            const blocked = node.openFindingCount > 0;
            const isSelected = selected === node.meetingId;

            return (
              <g key={node.meetingId}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={size}
                  className={blocked ? 'fill-warn' : 'fill-brand'}
                  stroke="currentColor"
                  strokeWidth={isSelected ? 3 : 0}
                  strokeOpacity={0.35}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelected(node.meetingId);
                    setSelectedEdge(null);
                  }}
                />
                <text
                  x={point.x}
                  y={point.y - size - 6}
                  textAnchor="middle"
                  className="pointer-events-none fill-muted text-[10px]"
                >
                  {node.title.length > 26 ? `${node.title.slice(0, 25)}…` : node.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/*
        The SVG is a picture of data, so the data must be readable without it. A
        graph that exists only as pixels is unusable with a screen reader and awkward
        on a phone.
      */}
      <p className="sr-only" aria-live="polite">
        {selectedNode !== null
          ? `Selected ${selectedNode.title}`
          : selectedEdge !== null
            ? `Selected connection: ${selectedEdge.reason}`
            : ''}
      </p>

      {selectedEdge !== null && (
        <div className="rounded-lg border border-brand/40 bg-brand-soft/40 px-4 py-3">
          <p className="text-caption font-medium">Why these are connected</p>
          <p className="mt-1 text-body text-muted">{selectedEdge.reason}</p>
          {selectedEdge.sharedTopics.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {selectedEdge.sharedTopics.map((topic) => (
                <li
                  key={topic}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-caption text-muted"
                >
                  {topic}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {[selectedEdge.from, selectedEdge.to].map((id) => (
              <button
                key={id}
                type="button"
                className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-caption font-medium hover:bg-raised"
                onClick={() => {
                  onOpenMeeting(id);
                }}
              >
                Open {byId.get(id)?.node.title ?? 'meeting'}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedNode !== null && (
        <div className="rounded-lg border border-brand/40 bg-brand-soft/40 px-4 py-3">
          <p className="text-caption font-medium">{selectedNode.title}</p>
          <p className="mt-1 text-caption text-muted">
            {new Date(selectedNode.occurredAt).toLocaleDateString()} ·{' '}
            {selectedNode.termSheetCount} term sheet
            {selectedNode.termSheetCount === 1 ? '' : 's'}
            {selectedNode.openFindingCount > 0 && (
              <span className="text-warn">
                {' '}
                · {selectedNode.openFindingCount} finding still open
              </span>
            )}
          </p>
          {selectedNode.topics.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {selectedNode.topics.map((topic) => (
                <li
                  key={topic}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-caption text-muted"
                >
                  {topic}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-caption font-medium text-canvas hover:opacity-90"
            onClick={() => {
              onOpenMeeting(selectedNode.meetingId);
            }}
          >
            Open this meeting
          </button>
        </div>
      )}

      <details className="rounded-lg border border-line bg-raised">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-caption font-medium text-muted hover:text-text">
          ▸ Connections as a list ({graph.edges.length})
        </summary>
        <div className="border-t border-line px-4 py-3">
          {graph.edges.length === 0 ? (
            <p className="text-caption text-muted">
              No two meetings share enough topics to be connected yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {graph.edges.map((edge) => (
                <li key={`${edge.from}-${edge.to}`} className="text-caption">
                  <span className="font-medium">
                    {byId.get(edge.from)?.node.title ?? edge.from}
                  </span>
                  <span className="text-faint"> ↔ </span>
                  <span className="font-medium">
                    {byId.get(edge.to)?.node.title ?? edge.to}
                  </span>
                  <span className="text-muted"> — {edge.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
