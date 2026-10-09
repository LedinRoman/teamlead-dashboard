'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { apiGet, errorMessage } from './api';
import { DEFAULT_METRIC_RULES, type ConnectionPublic, type Dashboard, type Team, type MetricRules } from '@shared/types';

interface BootstrapPayload {
  connected: boolean;
  activeConnectionId?: string;
  connections: ConnectionPublic[];
  teams: Team[];
  dashboards: Dashboard[];
  rules: MetricRules;
}

interface AppData extends BootstrapPayload {
  loading: boolean;
  error?: string;
  reload: () => Promise<void>;
}

const AppDataContext = createContext<AppData | null>(null);

const EMPTY: BootstrapPayload = {
  connected: false,
  connections: [],
  teams: [],
  dashboards: [],
  rules: DEFAULT_METRIC_RULES,
};

export function AppDataProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onLogin = pathname === '/login';
  const [data, setData] = useState<BootstrapPayload>(EMPTY);
  const [loading, setLoading] = useState(!onLogin);
  const [error, setError] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (onLogin) return;
    setLoading(true);
    try {
      setData(await apiGet<BootstrapPayload>('/api/bootstrap'));
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [onLogin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<AppData>(() => ({ ...data, loading, error, reload }), [data, loading, error, reload]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppData {
  const context = useContext(AppDataContext);
  if (!context) throw new Error('useAppData must be used inside AppDataProvider.');
  return context;
}
