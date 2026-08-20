'use client';

import {
  CheckSquare,
  FileText,
  type LucideIcon,
  Network,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SearchResultItem } from '@/lib/api';

const CATEGORY_META: Record<
  SearchResultItem['category'],
  { label: string; icon: LucideIcon; color: string }
> = {
  feature: {
    label: 'Features',
    icon: Sparkles,
    color: 'text-brand bg-brand-soft/80',
  },
  meeting: {
    label: 'Meetings',
    icon: FileText,
    color: 'text-sky-600 bg-sky-100 dark:bg-sky-950/70 dark:text-sky-300',
  },
  decision: {
    label: 'Decisions',
    icon: Scale,
    color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-950/70 dark:text-indigo-300',
  },
  action_item: {
    label: 'Action Items',
    icon: CheckSquare,
    color: 'text-amber-600 bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300',
  },
  shariah: {
    label: 'Shariah Findings',
    icon: ShieldAlert,
    color: 'text-rose-600 bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300',
  },
  knowledge: {
    label: 'Knowledge Graph',
    icon: Network,
    color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300',
  },
};

/**
 * Universal Search across meetings, decisions, graph nodes, knowledge, action items, Shariah flags, and app features.
 */
export function TopSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function onGlobalKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

  // Debounced search query
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      api
        .search(trimmed)
        .then((res) => {
          setResults(res.results);
          setSelectedIndex(-1);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => {
          setLoading(false);
        });
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Click outside and Escape handling
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: PointerEvent): void {
      const container = containerRef.current;
      if (container !== null && !container.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || results.length === 0) {
        if (event.key === 'Escape') setOpen(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const selected = results[selectedIndex] ?? results[0];
        if (selected) {
          setOpen(false);
          setQuery('');
          router.push(selected.href);
        }
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    },
    [open, results, selectedIndex, router],
  );

  const trimmed = query.trim();

  return (
    <div ref={containerRef} className="relative hidden w-full max-w-md lg:max-w-xl shrink sm:block">
      <Search
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#94a3b8] dark:text-[#64748b]"
      />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Search meetings, decisions, graph nodes, or action items..."
        aria-label="Search meetings, decisions, graph nodes, or action items"
        className="h-10 w-full rounded-full border border-[#dbe4ee] bg-[#f1f5f9]/80 pl-11 pr-5 text-sm text-[#0f172a] transition-all duration-200 placeholder:text-[#94a3b8] hover:bg-[#eaf0f6] focus:border-brand/60 focus:bg-surface focus:shadow-sm focus-visible:outline-none dark:border-[#334155] dark:bg-[#1e293b]/70 dark:text-[#f8fafc] dark:placeholder:text-[#64748b] dark:hover:bg-[#1e293b]"
      />

      {open && trimmed !== '' && (
        <div
          role="listbox"
          aria-label="Universal search results"
          className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-full min-w-[24rem] max-h-[28rem] overflow-y-auto rounded-2xl border border-line bg-surface/95 shadow-2xl backdrop-blur-md transition-all"
        >
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3.5 text-xs text-faint">
              <span className="size-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              Searching meetings, decisions, knowledge & rules…
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="px-4 py-5 text-center text-xs text-faint">
              No results found for &ldquo;<span className="text-text font-medium">{trimmed}</span>&rdquo;.
              <p className="mt-1 text-[0.7rem] text-faint">
                Try searching meeting titles, topics, decisions, action items, or Shariah terms.
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-1.5 divide-y divide-line/60">
              {results.map((item, index) => {
                const meta = CATEGORY_META[item.category] ?? CATEGORY_META.feature;
                const Icon = meta.icon;
                const isSelected = selectedIndex === index;

                return (
                  <Link
                    key={`${item.category}-${item.id}-${String(index)}`}
                    href={item.href}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`flex items-start gap-3 px-3.5 py-2.5 transition-colors text-left ${
                      isSelected ? 'bg-brand-soft/70' : 'hover:bg-raised/80'
                    }`}
                  >
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-lg ${meta.color}`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-text">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[0.62rem] font-medium text-faint border border-line">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <p className="truncate text-[0.72rem] text-muted">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
