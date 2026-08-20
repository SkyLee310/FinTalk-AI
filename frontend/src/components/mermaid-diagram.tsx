'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Sanitizes and repairs raw Mermaid diagram source code.
 * Ensures node labels with nested brackets (like [NRIC_1]), colons (:),
 * percentages (%), and edge annotations (|...|) are properly quoted so Mermaid
 * parses them without throwing syntax errors.
 */
export function sanitizeMermaidSource(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';

  const lines = raw.split('\n');
  const sanitizedLines: string[] = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      sanitizedLines.push(line);
      continue;
    }

    // Don't modify header lines like "graph TD;" or "flowchart LR"
    if (
      /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|quadrantChart|mindmap|timeline)/i.test(
        trimmed,
      )
    ) {
      // Ensure header ends cleanly
      sanitizedLines.push(line);
      continue;
    }

    // 1. Sanitize edge text: |...| -> |"..."|
    line = line.replace(/(\|)([^"|\n]+)(\|)/g, (_match, p1, p2, p3) => {
      const escaped = p2.trim().replace(/"/g, "'");
      return `${p1}"${escaped}"${p3}`;
    });

    // 2. Sanitize square bracket node labels: NodeID[Label] -> NodeID["Label"]
    // Handles nested brackets like E[Applicant IC [NRIC_1]] -> E["Applicant IC [NRIC_1]"]
    line = line.replace(/([a-zA-Z0-9_-]+)\[([^"\n]+)\](?=[;\s\-]|$)/g, (_match, id, content) => {
      const cleanContent = content.trim().replace(/"/g, "'");
      return `${id}["${cleanContent}"]`;
    });

    // 3. Sanitize rounded bracket node labels: NodeID(Label) -> NodeID("Label")
    line = line.replace(/([a-zA-Z0-9_-]+)\(([^"\n]+)\)(?=[;\s\-]|$)/g, (_match, id, content) => {
      const cleanContent = content.trim().replace(/"/g, "'");
      return `${id}("${cleanContent}")`;
    });

    // 4. Sanitize diamond / curly node labels: NodeID{Label} -> NodeID{"Label"}
    line = line.replace(/([a-zA-Z0-9_-]+)\{([^"\n]+)\}(?=[;\s\-]|$)/g, (_match, id, content) => {
      const cleanContent = content.trim().replace(/"/g, "'");
      return `${id}{"${cleanContent}"}`;
    });

    sanitizedLines.push(line);
  }

  return sanitizedLines.join('\n');
}

/**
 * Removes global Mermaid error artifacts that Mermaid appends to document.body
 */
function cleanupMermaidErrorArtifacts(): void {
  if (typeof document === 'undefined') return;
  try {
    const errorElements = document.querySelectorAll(
      '.error-icon, [id^="dmermaid"], [id^="dwhiteboard-"], svg[aria-roledescription="error"]',
    );
    errorElements.forEach((el) => {
      if (!el.closest('#app-main-content')) {
        el.remove();
      }
    });
  } catch {
    // Ignore DOM cleanup errors
  }
}

/**
 * Draws a Mermaid diagram safely with auto-repair and automatic dark/light theming.
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

        const isDark =
          document.documentElement.getAttribute('data-theme') === 'dark' ||
          document.documentElement.classList.contains('dark');

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: isDark ? 'dark' : 'neutral',
          fontFamily: 'inherit',
          suppressErrorRendering: true,
        });

        // Auto-sanitize the source
        const cleanSource = sanitizeMermaidSource(source);

        // A fresh id per render
        const id = `wb-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, cleanSource);

        if (!cancelled && host.current !== null) {
          host.current.innerHTML = svg;
          cleanupMermaidErrorArtifacts();
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          cleanupMermaidErrorArtifacts();
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupMermaidErrorArtifacts();
    };
  }, [source]);

  if (failed) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-faint">
          This diagram could not be rendered graphically. Raw whiteboard structure:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-raised p-4 text-xs leading-relaxed font-mono text-text">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={host}
      className="overflow-x-auto rounded-lg border border-line bg-surface p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
    />
  );
}
