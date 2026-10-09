'use client';

import { useEffect, useRef, useState } from 'react';

import { apiPost, errorMessage } from './api';
import type { CyclePerson } from '@backend/metrics/cycle-overview';
import type { PredictabilitySnapshot } from '@backend/metrics/predictability-model';

export interface PredictabilityRequest {
  teamIds: string[];
  sprintId: number;
  compareSprintId?: number;
  historySprints?: number;
  cycleStartStatus?: string;
  cycleEndStatus?: string;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
}

export function usePredictability(request: PredictabilityRequest | undefined): {
  snapshot?: PredictabilitySnapshot;
  people: CyclePerson[];
  queriedAt?: string;
  fromCache?: boolean;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  refresh: () => void;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<PredictabilitySnapshot | undefined>();
  const [people, setPeople] = useState<CyclePerson[]>([]);
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
      setPeople([]);
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
          predictability: PredictabilitySnapshot;
          people: CyclePerson[];
          queriedAt?: string;
          fromCache?: boolean;
        }>('/api/predictability', { ...request, refresh });
        if (cancelled) return;
        setSnapshot(payload.predictability);
        setPeople(payload.people ?? []);
        setQueriedAt(payload.queriedAt);
        setFromCache(payload.fromCache);
        setError(undefined);
      } catch (caught) {
        if (cancelled) return;
        setError(errorMessage(caught));
        setSnapshot(undefined);
        setPeople([]);
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
    people,
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
