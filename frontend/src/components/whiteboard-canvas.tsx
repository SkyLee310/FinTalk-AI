'use client';

import { Eraser, Redo2, X } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { Button } from './ui';

/** Logical drawing resolution — the canvas element's own pixel grid, independent of its on-screen CSS size. */
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;

/** Longest undo chain kept — a whiteboard sketch, not an illustration tool. */
const MAX_HISTORY = 25;

/**
 * Draw a whiteboard directly, in place of uploading a photo of one.
 *
 * Only exists for "Record here" — see record-session.tsx. A drawn board
 * exports to exactly the PNG shape the existing whiteboard pipeline already
 * accepts (canvas.toBlob → File → the same boardFiles state record/page.tsx
 * already feeds into api.uploadWhiteboard), so nothing downstream of the
 * `onSave` callback needed to change.
 */
export function WhiteboardCanvas({
  onSave,
  onClose,
}: {
  onSave: (file: File) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  /** Snapshots taken before each stroke, popped by Undo. */
  const historyRef = useRef<ImageData[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [empty, setEmpty] = useState(true);

  function context(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null;
  }

  /** CSS pixels → the canvas's own logical pixel grid, since the two sizes differ. */
  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }

  function pushHistory(): void {
    const ctx = context();
    if (ctx === null) return;
    historyRef.current.push(ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setCanUndo(true);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
    setEmpty(false);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return;
    const ctx = context();
    const from = lastPointRef.current;
    if (ctx === null || from === null) return;
    const to = pointFromEvent(event);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    lastPointRef.current = to;
  }

  function stopDrawing(): void {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function undo(): void {
    const ctx = context();
    const previous = historyRef.current.pop();
    if (ctx === null || previous === undefined) return;
    ctx.putImageData(previous, 0, 0);
    setCanUndo(historyRef.current.length > 0);
  }

  function clear(): void {
    const ctx = context();
    if (ctx === null) return;
    pushHistory();
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    setEmpty(true);
  }

  function save(): void {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      onSave(new File([blob], 'whiteboard.png', { type: 'image/png' }));
    }, 'image/png');
  }

  return (
    <div
      role="dialog"
      aria-label="Draw a whiteboard"
      className="fixed inset-0 z-40 flex flex-col bg-canvas/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <p className="text-sm font-semibold">Draw a whiteboard</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close without saving"
          className="rounded-md p-1.5 text-faint transition hover:bg-raised hover:text-text"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
          className="size-full touch-none rounded-lg border border-line bg-white"
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!canUndo} onClick={undo}>
            <Redo2 aria-hidden="true" className="size-4 rotate-180" />
            Undo
          </Button>
          <Button variant="secondary" disabled={empty} onClick={clear}>
            <Eraser aria-hidden="true" className="size-4" />
            Clear
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={empty} onClick={save}>
            Add to meeting
          </Button>
        </div>
      </div>
    </div>
  );
}
