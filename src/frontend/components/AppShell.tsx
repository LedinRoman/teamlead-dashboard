'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { useAppData } from '@frontend/lib/app-data';

interface NavItem {
  href: string;
  label: string;
  count?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const { connected, connections, teams, loading } = useAppData();
  const activeConnection = connections[0];

  const workspace: NavItem[] = [
    { href: '/overview', label: t('Team Overview', 'Обзор команды') },
    { href: '/flow', label: t('Flow', 'Поток') },
    { href: '/predictability', label: t('Predictability', 'Предсказуемость') },
    { href: '/quality', label: t('Quality', 'Качество') },
  ];
  const setup: NavItem[] = [
    { href: '/teams', label: t('Teams', 'Команды'), count: teams.length },
    { href: '/settings', label: t('Settings', 'Настройки') },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <strong>Team Lead Dashboard</strong>
          <span>{t('Dashboard, for the person running the team', 'Dashboard для того, кто ведёт команду')}</span>
        </div>

        <nav className="nav">
          <span className="nav-section">{t('Workspace', 'Работа')}</span>
          {workspace.map((item) => (
            <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && <span className="nav-count">{item.count}</span>}
            </Link>
          ))}

          <span className="nav-section">{t('Setup', 'Настройка')}</span>
          {setup.map((item) => (
            <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
              <span>{item.label}</span>
              {item.count !== undefined && item.count > 0 && <span className="nav-count">{item.count}</span>}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto' }} className="stack">
          <div className="locale-switch" role="group" aria-label={t('Language', 'Язык')}>
            <button type="button" data-active={locale === 'en'} onClick={() => setLocale('en')}>
              EN
            </button>
            <button type="button" data-active={locale === 'ru'} onClick={() => setLocale('ru')}>
              RU
            </button>
          </div>
          {!loading && (
            <div className="caption" style={{ padding: '0 6px' }}>
              {connected && activeConnection ? (
                <>
                  <div style={{ color: 'var(--text-muted)' }}>{activeConnection.displayName ?? t('Connected', 'Подключено')}</div>
                  <div>{new URL(activeConnection.baseUrl).hostname}</div>
                  <div>{activeConnection.deployment === 'cloud' ? 'Jira Cloud' : 'Jira Server / DC'}</div>
                </>
              ) : (
                <div>{t('Not connected to Jira yet.', 'Jira ещё не подключена.')}</div>
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
