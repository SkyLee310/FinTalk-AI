'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Input } from './ui';

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

const WIDTH = 560;
const HEIGHT = 360;
const ITERATIONS = 280;

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
  const radius = Math.min(WIDTH, HEIGHT) / 3.2;
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

    // Repulsion: every pair pushes apart
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (a === undefined || b === undefined) continue;

        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1) {
          dx = (i - j) * 0.5;
          dy = 0.5;
          distance = 1;
        }
        const force = 6_000 / (distance * distance);
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
      const force = (distance - 110) * 0.025 * edge.strength;
      from.vx += (dx / distance) * force;
      from.vy += (dy / distance) * force;
      to.vx -= (dx / distance) * force;
      to.vy -= (dy / distance) * force;
    }

    for (const point of placed) {
      // Pull to the centre
      point.vx += (WIDTH / 2 - point.x) * 0.008;
      point.vy += (HEIGHT / 2 - point.y) * 0.008;

      point.x = Math.max(35, Math.min(WIDTH - 35, point.x + point.vx * damping * 0.1));
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
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(
    graph.edges.length > 0 ? (graph.edges[0] ?? null) : null,
  );
  const [filter, setFilter] = useState('');

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const placed = useMemo(() => layout(graph.nodes, graph.edges), [graph]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.meetingId, p])), [placed]);

  // Clears or updates selection if the corpus changes
  useEffect(() => {
    if (graph.edges.length > 0) {
      setSelectedEdge(graph.edges[0] ?? null);
    } else {
      setSelectedEdge(null);
    }
    setSelected(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-raised px-4 py-6 text-center text-caption text-muted">
        No processed meetings yet. Capture one, and connections appear here as the
        corpus grows.
      </p>
    );
  }

  const handleZoomIn = () => setZoom((z) => Math.min(3.0, Number((z + 0.25).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setZoom((z) => Math.min(3.0, Math.max(0.5, Number((z + delta).toFixed(2)))));
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only start drag if left mouse button
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const selectedNode = selected === null ? null : byId.get(selected)?.node ?? null;

  const query = filter.trim().toLowerCase();
  const nodeMatches = (node: GraphNode): boolean =>
    query === '' ||
    node.title.toLowerCase().includes(query) ||
    node.topics.some((topic) => topic.toLowerCase().includes(query));
  const edgeMatches = (edge: GraphEdge): boolean => {
    const from = byId.get(edge.from)?.node;
    const to = byId.get(edge.to)?.node;
    return (from !== undefined && nodeMatches(from)) || (to !== undefined && nodeMatches(to));
  };
  const visibleEdges = query === '' ? graph.edges : graph.edges.filter(edgeMatches);

  const activeEdge = selectedEdge ?? (visibleEdges.length > 0 ? (visibleEdges[0] ?? null) : null);

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  return (
    <div className="space-y-3.5">
      {/* Filter, notice, and stats toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[240px] max-w-md">
          <Input
            type="text"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter meetings or topics…"
            aria-label="Filter meetings or topics"
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {graph.similarityUnavailable && (
            <span className="rounded-full bg-warn/10 border border-warn/30 px-2.5 py-0.5 text-[0.7rem] font-medium text-warn">
              Topic matching only
            </span>
          )}
          <div className="flex items-center gap-1.5 font-medium text-text">
            <span>{graph.nodes.length} meetings</span>
            <span className="text-faint">·</span>
            <span>{graph.edges.length} connections</span>
          </div>
        </div>
      </div>

      {/* Compact Side-by-side 2-column view to eliminate scrolling */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* Left Column: 1/4 to 1/3 Compact Graph Canvas with Zoom Controls */}
        <div className="lg:col-span-5 flex flex-col rounded-xl border border-line bg-surface overflow-hidden shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted bg-raised/50">
            <span>Visual Graph</span>
            <div className="flex items-center gap-1">
              <span className="text-faint text-[0.65rem] normal-case mr-2">Scroll/drag to pan</span>
              {/* Zoom Buttons */}
              <button
                type="button"
                onClick={handleZoomOut}
                title="Zoom Out"
                aria-label="Zoom Out"
                className="size-5 flex items-center justify-center rounded border border-line bg-surface hover:bg-raised text-text font-bold text-xs leading-none transition"
              >
                −
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                title="Reset Zoom"
                aria-label="Reset Zoom"
                className="px-1.5 h-5 flex items-center justify-center rounded border border-line bg-surface hover:bg-raised text-muted text-[0.65rem] font-medium transition"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                title="Zoom In"
                aria-label="Zoom In"
                className="size-5 flex items-center justify-center rounded border border-line bg-surface hover:bg-raised text-text font-bold text-xs leading-none transition"
              >
                +
              </button>
            </div>
          </div>

          <div className="relative p-2 flex items-center justify-center bg-surface/50 select-none overflow-hidden">
            <svg
              viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
              className={`h-auto w-full max-h-[300px] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              role="img"
              aria-label={`Knowledge graph with ${String(graph.nodes.length)} meetings`}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <g transform={`translate(${pan.x + cx}, ${pan.y + cy}) scale(${zoom}) translate(${-cx}, ${-cy})`}>
                {graph.edges.map((edge) => {
                  const from = byId.get(edge.from);
                  const to = byId.get(edge.to);
                  if (from === undefined || to === undefined) return null;
                  const active = activeEdge?.from === edge.from && activeEdge?.to === edge.to;
                  const touchesSelection = selected === edge.from || selected === edge.to;
                  const dimmed = !edgeMatches(edge);

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
                          : 'cursor-pointer text-line-strong hover:text-brand'
                      }
                      strokeWidth={active ? 3.5 : 1.5 + edge.strength * 2}
                      strokeOpacity={dimmed ? 0.1 : active || touchesSelection ? 0.95 : 0.4}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEdge(edge);
                        setSelected(null);
                      }}
                    />
                  );
                })}

                {placed.map((point) => {
                  const { node } = point;
                  const size = 8 + Math.min(4, node.termSheetCount) * 2;
                  const blocked = node.openFindingCount > 0;
                  const isSelected = selected === node.meetingId;
                  const isConnected =
                    activeEdge?.from === node.meetingId || activeEdge?.to === node.meetingId;

                  return (
                    <g key={node.meetingId} opacity={nodeMatches(node) ? 1 : 0.25}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={size}
                        className={blocked ? 'fill-warn' : isConnected ? 'fill-brand-strong' : 'fill-brand'}
                        stroke="currentColor"
                        strokeWidth={isSelected || isConnected ? 2.5 : 0}
                        strokeOpacity={0.8}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(node.meetingId);
                        }}
                      />
                      <text
                        x={point.x}
                        y={point.y - size - 5}
                        textAnchor="middle"
                        className="pointer-events-none fill-text font-medium text-[10px]"
                      >
                        {node.title.length > 20 ? `${node.title.slice(0, 19)}…` : node.title}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </div>

        {/* Right Column: Connection Insight & Complete Connection List */}
        <div className="lg:col-span-7 space-y-4">
          {/* Why these are connected Detail Card */}
          {selectedNode ? (
            <div className="rounded-xl border border-brand/40 bg-brand-soft/30 p-4 transition">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-brand">
                    Selected Meeting
                  </span>
                  <h3 className="mt-0.5 text-sm font-bold text-text">{selectedNode.title}</h3>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-canvas hover:opacity-90 transition shrink-0"
                  onClick={() => onOpenMeeting(selectedNode.meetingId)}
                >
                  Open Meeting →
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{formatDate(selectedNode.occurredAt)}</span>
                <span>·</span>
                <span>{selectedNode.termSheetCount} term sheet{selectedNode.termSheetCount === 1 ? '' : 's'}</span>
                {selectedNode.openFindingCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="font-medium text-warn">{selectedNode.openFindingCount} open finding</span>
                  </>
                )}
              </div>

              {selectedNode.topics.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {selectedNode.topics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded-md border border-line-strong bg-surface px-2 py-0.5 text-[0.7rem] font-medium text-muted"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : activeEdge ? (
            <div className="rounded-xl border border-brand/40 bg-brand-soft/30 p-4 transition">
              <span className="text-[0.65rem] font-bold uppercase tracking-wider text-brand">
                Why these are connected
              </span>
              <p className="mt-1 text-xs font-semibold leading-snug text-text">
                {activeEdge.reason}
              </p>

              {activeEdge.sharedTopics.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.68rem] text-muted">Shared:</span>
                  {activeEdge.sharedTopics.map((topic) => (
                    <span
                      key={topic}
                      className="rounded border border-brand/30 bg-surface px-1.5 py-0.5 text-[0.68rem] font-medium text-brand"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-brand/20">
                {[activeEdge.from, activeEdge.to].map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="truncate max-w-[220px] rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-text hover:bg-raised hover:border-brand transition"
                    onClick={() => onOpenMeeting(id)}
                  >
                    Open {byId.get(id)?.node.title ?? 'meeting'} →
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* All Connections List (Always open and visible on screen) */}
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                Connections List ({visibleEdges.length})
              </h3>
            </div>

            {visibleEdges.length === 0 ? (
              <p className="text-xs text-muted py-2">
                {query === ''
                  ? 'No connections detected between recorded meetings yet.'
                  : `No connections match "${filter.trim()}".`}
              </p>
            ) : (
              <div className="custom-scrollbar max-h-[220px] space-y-2 overflow-y-auto pr-1">
                {visibleEdges.map((edge) => {
                  const fromNode = byId.get(edge.from)?.node;
                  const toNode = byId.get(edge.to)?.node;
                  const isSelected = activeEdge?.from === edge.from && activeEdge?.to === edge.to;

                  return (
                    <div
                      key={`${edge.from}-${edge.to}`}
                      onClick={() => {
                        setSelectedEdge(edge);
                        setSelected(null);
                      }}
                      className={`cursor-pointer rounded-lg border p-2.5 text-xs transition ${
                        isSelected
                          ? 'border-brand bg-brand-soft/40 shadow-xs'
                          : 'border-line bg-raised/40 hover:border-line-strong hover:bg-raised'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-text">
                          <span>{fromNode?.title ?? edge.from}</span>
                          <span className="text-brand mx-1.5">↔</span>
                          <span>{toNode?.title ?? edge.to}</span>
                        </div>
                        {edge.strength > 0.5 && (
                          <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[0.65rem] font-bold text-brand">
                            Strong Link
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-muted text-[0.73rem] leading-relaxed">
                        {edge.reason}
                      </p>

                      {edge.sharedTopics.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {edge.sharedTopics.map((topic) => (
                            <span
                              key={topic}
                              className="rounded bg-surface px-1.5 py-0.5 text-[0.65rem] text-faint"
                            >
                              #{topic}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
