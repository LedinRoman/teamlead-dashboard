'use client';

import { useEffect, useState } from 'react';

import { apiGet } from './api';
import type { JiraStatusOption } from '@shared/types';

const memory = new Map<string, JiraStatusOption[]>();

/**
 * Project (or site-wide) Jira statuses, kept in memory so Overview dropdowns
 * and later screens share one fetch.
 */
export function useJiraStatuses(projectKeys: string[]): {
  statuses: JiraStatusOption[];
  loading: boolean;
} {
  const key = projectKeys.map((item) => item.trim()).filter(Boolean).sort().join(',') || '*';
  const [statuses, setStatuses] = useState<JiraStatusOption[]>(() => memory.get(key) ?? []);
  const [loading, setLoading] = useState(!memory.has(key));

  useEffect(() => {
    const cached = memory.get(key);
    if (cached) {
      setStatuses(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await loadStatuses(projectKeys);
        if (cancelled) return;
        memory.set(key, list);
        setStatuses(list);
      } catch {
        if (cancelled) return;
        setStatuses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { statuses, loading };
}

export function rememberedStatuses(): JiraStatusOption[] {
  const merged = new Map<string, JiraStatusOption>();
  for (const list of memory.values()) {
    for (const status of list) merged.set(status.name.toLowerCase(), status);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

async function loadStatuses(projectKeys: string[]): Promise<JiraStatusOption[]> {
  const keys = [...new Set(projectKeys.map((item) => item.trim()).filter(Boolean))];
  if (keys.length === 0) {
    const payload = await apiGet<{ statuses: JiraStatusOption[] }>('/api/jira/statuses');
    return sortStatuses(payload.statuses);
  }
  const pages = await Promise.all(
    keys.map((project) =>
      apiGet<{ statuses: JiraStatusOption[] }>(`/api/jira/statuses?project=${encodeURIComponent(project)}`),
    ),
  );
  const merged = new Map<string, JiraStatusOption>();
  for (const page of pages) {
    for (const status of page.statuses) merged.set(status.name.toLowerCase(), status);
  }
  return sortStatuses([...merged.values()]);
}

function sortStatuses(statuses: JiraStatusOption[]): JiraStatusOption[] {
  return [...statuses].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
