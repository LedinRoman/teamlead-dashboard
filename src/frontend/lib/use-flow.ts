'use client';

import { useEffect, useRef, useState } from 'react';

import { apiPost, errorMessage } from './api';
import type { FlowSnapshot } from '@backend/metrics/flow-model';

export interface FlowRequest {
  teamIds: string[];
  throughputHorizon?: number;
  historyHorizon?: number;
  cycleStartStatus?: string;
  cycleEndStatus?: string;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  assigneeIds?: string[];
  workingDays?: boolean;
}

export function useFlow(request: FlowRequest | undefined): {
  flow?: FlowSnapshot;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  refresh: () => void;
  reload: () => void;
} {
  const [flow, setFlow] = useState<FlowSnapshot | undefined>();
  const [loading, setLoading] = useState(Boolean(request));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const refreshRef = useRef(false);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const signature = JSON.stringify(request ?? null);

  useEffect(() => {
    if (!request || request.teamIds.length === 0) {
      setFlow(undefined);
      setLoading(false);
      setRefreshing(false);
      setError(undefined);
      return;
    }
    let cancelled = false;
    const refresh = refreshRef.current;
    refreshRef.current = false;
    setRefreshing(true);
    setLoading(!flowRef.current || refresh);
    void (async () => {
      try {
        const payload = await apiPost<{ flow: FlowSnapshot }>('/api/flow', { ...request, refresh });
        if (cancelled) return;
        setFlow(payload.flow);
        setError(undefined);
      } catch (caught) {
        if (cancelled) return;
        setError(errorMessage(caught));
        setFlow(undefined);
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
    flow,
    loading: loading && !flow,
    refreshing,
    error,
    refresh: () => {
      refreshRef.current = true;
      setNonce((value) => value + 1);
    },
    reload: () => setNonce((value) => value + 1),
  };
}
