'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Draws a Mermaid diagram, degrading to its source.
 *
 * Three things here are deliberate.
 *
 * `securityLevel: 'strict'` because the source is not ours: it came from a vision
 * model reading a photograph of a whiteboard, which is untrusted input that ends
 * up in innerHTML. Strict mode sanitises labels and disables click bindings.
 *
 * The fallback shows the source rather than nothing. Model output is not
 * guaranteed to be valid Mermaid, and the source is the auditable artefact — it
 * is exactly what was stored — so a diagram that will not parse must still show
 * what the record contains.
 *
 * mermaid is imported dynamically. It is a large dependency and no page needs it
 * until a meeting actually has a board attached.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'inherit',
        });

        // A fresh id per render: mermaid keys its internal state by it, and a
        // reused id leaves the previous diagram's definitions in place.
        const id = `whiteboard-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, source);

        if (!cancelled && host.current !== null) {
          host.current.innerHTML = svg;
        }
      } catch {
        // The reason is not surfaced: a parse error quotes the offending line,
        // and that line is whiteboard content.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (failed) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-faint">
          This diagram could not be drawn. The stored source is shown instead.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-raised p-4 text-xs leading-relaxed">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={host}
      className="overflow-x-auto rounded-lg border border-line bg-raised p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
    />
  );
}
