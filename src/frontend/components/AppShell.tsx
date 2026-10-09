'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAppData } from '@frontend/lib/app-data';

interface NavItem {
  href: string;
  label: string;
  count?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { connected, connections, teams, loading } = useAppData();
  const activeConnection = connections[0];

  const workspace: NavItem[] = [
    { href: '/overview', label: 'Team Overview' },
    { href: '/flow', label: 'Flow' },
    { href: '/predictability', label: 'Predictability' },
    { href: '/quality', label: 'Quality' },
  ];
  const setup: NavItem[] = [
    { href: '/teams', label: 'Teams', count: teams.length },
    { href: '/settings', label: 'Settings' },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <strong>Team Lead Dashboard</strong>
          <span>Jira, for the person running the team</span>
        </div>

        <nav className="nav">
          <span className="nav-section">Workspace</span>
          {workspace.map((item) => (
            <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && <span className="nav-count">{item.count}</span>}
            </Link>
          ))}

          <span className="nav-section">Setup</span>
          {setup.map((item) => (
            <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && <span className="nav-count">{item.count}</span>}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto' }} className="stack">
          {!loading && (
            <div className="caption" style={{ padding: '0 6px' }}>
              {connected && activeConnection ? (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>{activeConnection.displayName ?? 'Connected'}</div>
                  <div>{new URL(activeConnection.baseUrl).hostname}</div>
                  <div>{activeConnection.deployment === 'cloud' ? 'Jira Cloud' : 'Jira Server / DC'}</div>
                </>
              ) : (
                <div>Not connected to Jira yet.</div>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
