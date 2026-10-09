'use client';

import { useEffect, useRef, useState } from 'react';

import { apiPost, errorMessage } from './api';
import type { CyclePerson } from '@backend/metrics/cycle-overview';
import type { QualityHistoryRow, QualitySnapshot } from '@backend/metrics/quality-model';

export interface QualityRequest {
  teamIds: string[];
  sprintId: number;
  historySprints?: number;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  workingDays?: boolean;
}

export function useQuality(request: QualityRequest | undefined): {
  snapshot?: QualitySnapshot;
  history: QualityHistoryRow[];
  historyHorizon?: { requested: number; used: number };
  people: CyclePerson[];
  asOf?: string;
  queriedAt?: string;
  fromCache?: boolean;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  refresh: () => void;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<QualitySnapshot | undefined>();
  const [history, setHistory] = useState<QualityHistoryRow[]>([]);
  const [historyHorizon, setHistoryHorizon] = useState<{ requested: number; used: number } | undefined>();
  const [people, setPeople] = useState<CyclePerson[]>([]);
  const [asOf, setAsOf] = useState<string | undefined>();
  const [queriedAt, setQueriedAt] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState<boolean | undefined>();
  const [loading, setLoading] = useState(Boolean(request));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const refreshRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const signature = JSON.stringify(request ?? null);

  useEffect(() => {
    if (!request || request.teamIds.length === 0 || !request.sprintId) {
      setSnapshot(undefined);
      setHistory([]);
      setHistoryHorizon(undefined);
      setPeople([]);
      setAsOf(undefined);
      setQueriedAt(undefined);
      setFromCache(undefined);
      setLoading(false);
      setRefreshing(false);
      setError(undefined);
      return;
    }
    let cancelled = false;
    const refresh = refreshRef.current;
    refreshRef.current = false;
    setRefreshing(true);
    setLoading(!snapshotRef.current || refresh);
    void (async () => {
      try {
        const payload = await apiPost<{
          snapshot: QualitySnapshot;
          history?: QualityHistoryRow[];
          historyHorizon?: { requested: number; used: number };
          people: CyclePerson[];
          asOf?: string;
          queriedAt?: string;
          fromCache?: boolean;
        }>('/api/quality', { ...request, refresh });
        if (cancelled) return;
        setSnapshot(payload.snapshot);
        setHistory(payload.history ?? []);
        setHistoryHorizon(payload.historyHorizon);
        setPeople(payload.people ?? []);
        setAsOf(payload.asOf);
        setQueriedAt(payload.queriedAt);
        setFromCache(payload.fromCache);
        setError(undefined);
      } catch (caught) {
        if (cancelled) return;
        setError(errorMessage(caught));
        setSnapshot(undefined);
        setHistory([]);
        setHistoryHorizon(undefined);
        setPeople([]);
        setAsOf(undefined);
        setQueriedAt(undefined);
        setFromCache(undefined);
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
    snapshot,
    history,
    historyHorizon,
    people,
    asOf,
    queriedAt,
    fromCache,
    loading: loading && !snapshot,
    refreshing,
    error,
    refresh: () => {
      refreshRef.current = true;
      setNonce((value) => value + 1);
    },
    reload: () => setNonce((value) => value + 1),
  };
}
