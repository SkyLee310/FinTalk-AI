'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /**
   * `{ silent: true }` refetches without touching `loading` — for polling a
   * page that is already showing data, where flipping `loading` back to
   * true would blank the whole view every tick rather than update in place.
   */
  reload: (opts?: { silent?: boolean }) => void;
}

/** Turns any thrown value into something safe to render. */
export function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.detail;
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong.';
}

/**
 * Runs an async loader and tracks its state.
 *
 * The loader lives in a ref rather than an effect dependency, so an inline arrow
 * at the call site does not re-trigger the fetch on every render. `key` decides
 * when to refetch.
 */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Read by the effect below, which fires from the nonce change this sets in
  // motion — refs update synchronously, so the value this call wrote is
  // always the one that effect run sees, with no risk of an earlier queued
  // reload's flag leaking into it.
  const silentRef = useRef(false);

  const reload = useCallback((opts?: { silent?: boolean }) => {
    silentRef.current = opts?.silent ?? false;
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const silent = silentRef.current;
    if (!silent) setLoading(true);
    setError(null);

    loadRef
      .current()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled && !silent) setLoading(false);
      });

    // Stops a slow response from an abandoned key overwriting a newer one.
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  return { data, error, loading, reload };
}
