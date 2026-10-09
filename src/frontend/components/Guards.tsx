'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { EmptyState, ErrorNotice, Spinner } from './ui';
import { useAppData } from '@frontend/lib/app-data';

/**
 * Every metrics screen needs a connection and at least one team. This keeps that
 * check, and the instructions for fixing it, in one place.
 */
export function RequireSetup({ children }: { children: ReactNode }) {
  const { connected, teams, loading, error, reload } = useAppData();

  if (loading) return <Spinner label="Loading workspace" />;
  if (error) return <ErrorNotice error={error} onRetry={() => void reload()} />;

  if (!connected) {
    return (
      <EmptyState title="No Jira connection yet">
        <span>Add the Jira URL and API token in Settings to start building dashboards.</span>
        <Link href="/settings">Go to Settings</Link>
      </EmptyState>
    );
  }

  if (teams.length === 0) {
    return (
      <EmptyState title="No teams defined yet">
        <span>
          A team tells the tool which boards and people to measure. One team is enough to get the sprint and people
          views working.
        </span>
        <Link href="/teams">Create a team</Link>
      </EmptyState>
    );
  }

  return <>{children}</>;
}
