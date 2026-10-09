'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { apiPost, errorMessage } from './api';
import type { MetricsModel, ScopeRequest, ScopeSpec } from '@shared/types';

export interface BatchRequest {
  id: string;
  scope: ScopeSpec;
  windowDays?: number;
  windowFrom?: string;
  withChangelog?: boolean;
  withTimeline?: boolean;
  title?: string;
  cycleStartStatus?: string;
  cycleEndStatus?: string;
}

export interface BatchEntry {
  id: string;
  model?: MetricsModel;
  error?: string;
}

export interface BatchState {
  entries: BatchEntry[];
  byId: Record<string, BatchEntry>;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  refresh: () => void;
  reload: () => void;
}

/**
 * Resolves many scopes in one request. Scopes that are identical share a cached
 * Jira response on the server, so overlapping widgets cost one query.
 */
export function useBatchMetrics(requests: BatchRequest[]): BatchState {
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [loading, setLoading] = useState(requests.length > 0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const forceRefresh = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const signature = JSON.stringify(requests);

  useEffect(() => {
    const parsed = JSON.parse(signature) as BatchRequest[];
    if (parsed.length === 0) {
      setEntries([]);
      setLoading(false);
      setRefreshing(false);
      setError(undefined);
      return;
    }
    let cancelled = false;
    const refresh = forceRefresh.current;
    forceRefresh.current = false;
    setRefreshing(true);
    setLoading(entriesRef.current.length === 0 || refresh);

    void (async () => {
      try {
        const payload = await apiPost<{ results: BatchEntry[] }>('/api/metrics/batch', {
          requests: parsed,
          refresh,
        });
        if (cancelled) return;
        setEntries(payload.results);
        setError(undefined);
      } catch (caught) {
        if (cancelled) return;
        setError(errorMessage(caught));
        setEntries([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, nonce]);

  const byId = useMemo(() => {
    const map: Record<string, BatchEntry> = {};
    for (const entry of entries) map[entry.id] = entry;
    return map;
  }, [entries]);

  return {
    entries,
    byId,
    loading: loading && entries.length === 0,
    refreshing,
    error,
    refresh: () => {
      forceRefresh.current = true;
      setNonce((value) => value + 1);
    },
    reload: () => setNonce((value) => value + 1),
  };
}

export interface MetricsState {
  model?: MetricsModel;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  refresh: () => void;
  reload: () => void;
}

/**
 * Loads one scope. `scope` is compared by value so callers can build the spec
 * inline without triggering a fetch on every render.
 */
export function useMetrics(
  scope: ScopeSpec | undefined,
  options: { windowDays?: number; windowFrom?: string; withChangelog?: boolean; title?: string; slim?: boolean } = {},
): MetricsState {
  const [model, setModel] = useState<MetricsModel | undefined>();
  const [loading, setLoading] = useState(Boolean(scope));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const forceRefresh = useRef(false);
  const modelRef = useRef(model);
  modelRef.current = model;

  const signature = JSON.stringify({ scope, ...options });

  useEffect(() => {
    const request = JSON.parse(signature) as ScopeRequest & { title?: string; slim?: boolean };
    if (!request.scope) {
      setModel(undefined);
      setLoading(false);
      setRefreshing(false);
      setError(undefined);
      return;
    }

    // Switching scope while a slower request is in flight must not let the old
    // numbers land on the new screen.
    let cancelled = false;
    const refresh = forceRefresh.current;
    forceRefresh.current = false;
    setRefreshing(true);
    setLoading(!modelRef.current || refresh);

    void (async () => {
      try {
        const result = await apiPost<MetricsModel>('/api/metrics', { ...request, refresh });
        if (cancelled) return;
        setModel(result);
        setError(undefined);
      } catch (caught) {
        if (cancelled) return;
        setError(errorMessage(caught));
        setModel(undefined);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, nonce]);

  return {
    model,
    loading: loading && !model,
    refreshing,
    error,
    refresh: () => {
      forceRefresh.current = true;
      setNonce((value) => value + 1);
    },
    reload: () => setNonce((value) => value + 1),
  };
}
