'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type MeetingSummary } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Longest match list shown at once — a scroll of fifty rows is not a search result. */
const MAX_RESULTS = 8;

/**
 * Search across meetings by title, from the header, on every signed-in page.
 *
 * v1 filters the same list GET /meetings already returns for the Review page —
 * fetched once, lazily, on first focus, and matched client-side. No new backend
 * endpoint: this corpus is small enough that a second round trip per keystroke
 * would be pure overhead. A server-side search is the natural next step once a
 * workspace's meeting count outgrows one page of results.
 */
export function TopSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const ensureLoaded = useCallback(() => {
    if (meetings !== null || loading) return;
    setLoading(true);
    api.meetings()
      .then((result) => setMeetings(result.meetings))
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false));
  }, [meetings, loading]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: PointerEvent): void {
      const container = containerRef.current;
      if (container !== null && !container.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const trimmed = query.trim().toLowerCase();
  const results = trimmed === ''
    ? []
    : (meetings ?? [])
      .filter((meeting) => meeting.title.toLowerCase().includes(trimmed))
      .slice(0, MAX_RESULTS);

  return (
    <div ref={containerRef} className="relative hidden w-64 shrink-0 sm:block">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
      />
      <input
        type="search"
        value={query}
        onFocus={() => {
          ensureLoaded();
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        placeholder="Search meetings"
        aria-label="Search meetings"
        className="w-full rounded-full border border-line-strong bg-surface py-1.5 pl-9 pr-3 text-sm transition placeholder:text-faint hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />

      {open && trimmed !== '' && (
        <div
          role="listbox"
          aria-label="Meeting results"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
        >
          {loading && (
            <p className="px-4 py-3 text-sm text-faint">Loading meetings…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-faint">
              No meetings match &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          {!loading && results.map((meeting) => (
            <Link
              key={meeting.id}
              href={`/meetings/${meeting.id}`}
              role="option"
              aria-selected={false}
              onClick={() => {
                setOpen(false);
                setQuery('');
              }}
              className="flex flex-col gap-0.5 border-b border-line px-4 py-2.5 text-sm last:border-b-0 hover:bg-raised"
            >
              <span className="truncate font-medium">{meeting.title}</span>
              <span className="text-[0.7rem] text-faint">{formatDate(meeting.occurredAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
