'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ErrorNotice, Spinner } from '@frontend/components/ui';
import { useAppData } from '@frontend/lib/app-data';

/** Sends you to the dashboards if Jira is connected, or to setup if it is not. */
export default function Home() {
  const router = useRouter();
  const { connected, loading, error, reload } = useAppData();

  useEffect(() => {
    if (loading || error) return;
    router.replace(connected ? '/overview' : '/settings');
  }, [connected, loading, error, router]);

  if (error) return <ErrorNotice error={error} onRetry={() => void reload()} />;
  return <Spinner label="Opening your workspace" />;
}
