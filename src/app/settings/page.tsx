'use client';

import { useEffect, useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { ThemePicker } from '@frontend/theme/theme';
import { Callout, Card, Field, Pill, Segmented } from '@frontend/components/ui';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { readStoredExcludeQa, writeStoredExcludeQa } from '@frontend/lib/exclude-qa-title';
import { FlowWorkflowSettings } from '@frontend/components/flow/FlowWorkflowSettings';
import { mergeFlowWorkflow, validateFlowWorkflow } from '@backend/metrics/flow-workflow';
import type { Deployment, FlowWorkflow, MetricRules } from '@shared/types';

type DeploymentChoice = 'auto' | Deployment;

export default function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { rules, connections, reload } = useAppData();
  const connection = connections[0];
  const [draft, setDraft] = useState<MetricRules>(rules);
  const [workflow, setWorkflow] = useState<FlowWorkflow>(() => mergeFlowWorkflow());
  const [cachedResponses, setCachedResponses] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [jiraUrl, setJiraUrl] = useState(connection?.baseUrl ?? '');
  const [jiraEmail, setJiraEmail] = useState(connection?.email ?? '');
  const [jiraSecret, setJiraSecret] = useState('');
  const [jiraDeployment, setJiraDeployment] = useState<DeploymentChoice>(connection?.deployment ?? 'auto');

  useEffect(() => {
    setDraft({
      ...rules,
      excludeQaTitle: Boolean(rules.excludeQaTitle) || readStoredExcludeQa(),
    });
  }, [rules]);

  useEffect(() => {
    if (!connection) return;
    setJiraUrl(connection.baseUrl);
    setJiraEmail(connection.email ?? '');
    if (connection.deployment) setJiraDeployment(connection.deployment);
  }, [connection]);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await apiGet<{ cachedResponses: number; flowWorkflow?: FlowWorkflow }>('/api/settings');
        setCachedResponses(payload.cachedResponses);
        if (payload.flowWorkflow) setWorkflow(mergeFlowWorkflow(payload.flowWorkflow));
      } catch {
        setCachedResponses(null);
      }
    })();
  }, []);

  const save = async () => {
    const invalid = validateFlowWorkflow(workflow);
    if (invalid.errors.length > 0) {
      setError(invalid.errors[0]);
      return;
    }
    if (jiraSecret.trim() && !jiraUrl.trim()) {
      setError(t('Jira URL is required when saving a token.', 'Чтобы сохранить токен, нужен Jira URL.'));
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      await apiPatch('/api/settings', {
        staleDays: draft.staleDays,
        veryStaleDays: draft.veryStaleDays,
        defaultWindowDays: draft.defaultWindowDays,
        cacheTtlSeconds: draft.cacheTtlSeconds,
        excludeQaTitle: Boolean(draft.excludeQaTitle),
        flowWorkflow: workflow,
        ...(jiraSecret.trim()
          ? {
              jiraUrl: jiraUrl.trim(),
              jiraEmail: jiraEmail.trim() || undefined,
              jiraSecret: jiraSecret.trim(),
              jiraDeployment: jiraDeployment === 'auto' ? undefined : jiraDeployment,
            }
          : {}),
      });
      setJiraSecret('');
      writeStoredExcludeQa(Boolean(draft.excludeQaTitle));
      await reload();
      setSaved(true);
      setError(undefined);
      try {
        const payload = await apiGet<{ cachedResponses: number }>('/api/settings');
        setCachedResponses(payload.cachedResponses);
      } catch {
        // keep previous count
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const looksLikeCloud = /atlassian\.(net|com)/i.test(jiraUrl);
  const needsJiraEmail = jiraDeployment === 'cloud' || (jiraDeployment === 'auto' && looksLikeCloud);
  const canTestJira =
    jiraUrl.trim().length > 0 && jiraSecret.trim().length > 0 && (!needsJiraEmail || jiraEmail.trim().length > 0);

  const testJira = async () => {
    setTesting(true);
    setError(undefined);
    try {
      await apiPost('/api/connections/test', {
        baseUrl: jiraUrl.trim(),
        email: jiraEmail.trim() || undefined,
        secret: jiraSecret.trim(),
        deployment: jiraDeployment === 'auto' ? undefined : jiraDeployment,
      });
      setSaved(false);
      setError(undefined);
      window.alert(t('Jira accepted the URL and token.', 'Jira приняла URL и токен.'));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTesting(false);
    }
  };

  const clearCache = async () => {
    const payload = await apiDelete<{ cleared: number }>('/api/cache');
    setCachedResponses(0);
    window.alert(t(`Cleared ${payload.cleared} snapshot records.`, `Очищено записей снимка: ${payload.cleared}.`));
  };

  return (
    <div className="stack" style={{ maxWidth: 840 }}>
      <header className="page-header">
        <div className="page-header-meta">
          <h1>{t('Settings', 'Настройки')}</h1>
        </div>
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? t('Saving…', 'Сохраняю…') : t('Save', 'Сохранить')}
        </button>
      </header>

      {error && <Callout tone="danger">{error}</Callout>}
      {saved && <Callout tone="success">{t('Saved.', 'Сохранено.')}</Callout>}

      <Card
        title={t('Appearance', 'Оформление')}
        caption={t(
          'Language and color stay on this computer. They apply right away and are not part of Save.',
          'Язык и цвет остаются на этом компьютере. Они применяются сразу и не входят в «Сохранить».',
        )}
      >
        <div className="stack">
          <div className="locale-row">
            <span className="field-label">{t('Language', 'Язык')}</span>
            <div className="locale-choices" role="radiogroup" aria-label={t('Language', 'Язык')}>
              <button type="button" role="radio" aria-checked={locale === 'en'} data-active={locale === 'en'} onClick={() => setLocale('en')}>
                English
              </button>
              <button type="button" role="radio" aria-checked={locale === 'ru'} data-active={locale === 'ru'} onClick={() => setLocale('ru')}>
                Русский
              </button>
            </div>
          </div>
          <div>
            <span className="field-label">{t('Color theme', 'Цветовая тема')}</span>
            <ThemePicker />
          </div>
        </div>
      </Card>

      <Card
        title="Jira"
        caption={t(
          'One Jira URL and token for this dashboard. The token is encrypted in the database and only sent to your Jira site.',
          'Один URL и токен Jira для этого дашборда. Токен шифруется в базе и уходит только на ваш сайт Jira.',
        )}
      >
        <div className="stack">
          {connection && (
            <div className="row" style={{ gap: 6 }}>
              <Pill tone={connection.secretHint.includes('unreadable') ? 'danger' : 'neutral'}>
                {t('token', 'токен')} {connection.secretHint}
              </Pill>
              <Pill tone="info">{connection.displayName ?? t('connected', 'подключено')}</Pill>
              <Pill tone="neutral">{connection.deployment === 'cloud' ? 'Jira Cloud' : 'Jira Server / DC'}</Pill>
            </div>
          )}
          {connection?.secretHint.includes('unreadable') && (
            <Callout tone="warning" title={t('Saved token cannot be decrypted', 'Сохранённый токен не расшифровать')}>
              {t(
                'Enter the token again and save. The URL can stay as it is.',
                'Введите токен ещё раз и сохраните. URL можно оставить как есть.',
              )}
            </Callout>
          )}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <Field label={t('Jira URL', 'Jira URL')} hint={t('For example https://acme.atlassian.net', 'Например https://acme.atlassian.net')}>
                <input
                  type="url"
                  value={jiraUrl}
                  placeholder="https://acme.atlassian.net"
                  onChange={(event) => setJiraUrl(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <Field label={t('Deployment', 'Развёртывание')}>
                <div>
                  <Segmented<DeploymentChoice>
                    value={jiraDeployment}
                    onChange={setJiraDeployment}
                    options={[
                      { value: 'auto', label: t('Auto-detect', 'Определить автоматически') },
                      { value: 'cloud', label: 'Jira Cloud' },
                      { value: 'server', label: t('Server / DC', 'Server / DC') },
                    ]}
                  />
                </div>
              </Field>
            </div>
            <Field
              label={needsJiraEmail ? t('Account email', 'Email аккаунта') : t('Account email (optional)', 'Email аккаунта (необязательно)')}
              hint={
                needsJiraEmail
                  ? t('The account that owns the API token.', 'Аккаунт, которому принадлежит API token.')
                  : t('Empty means a bearer PAT for Server / DC.', 'Пусто — bearer PAT для Server / DC.')
              }
            >
              <input
                type="email"
                value={jiraEmail}
                placeholder="you@acme.com"
                onChange={(event) => setJiraEmail(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('API token', 'API token')}
              hint={
                connection
                  ? t('Leave empty to keep the saved token.', 'Оставьте пустым, чтобы не менять сохранённый токен.')
                  : t('Encrypted in the database. Not written to logs.', 'Шифруется в базе. В логи не пишется.')
              }
            >
              <input
                type="password"
                value={jiraSecret}
                onChange={(event) => setJiraSecret(event.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="row">
            <button type="button" onClick={() => void testJira()} disabled={!canTestJira || testing}>
              {testing ? t('Testing…', 'Проверяю…') : t('Test Jira', 'Проверить Jira')}
            </button>
          </div>
        </div>
      </Card>

      <Card title={t('Thresholds', 'Пороги')}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <NumberField
            label={t('Stale after (days)', 'Устаревает через (дней)')}
            value={draft.staleDays}
            onChange={(staleDays) => setDraft({ ...draft, staleDays })}
          />
          <NumberField
            label={t('Very stale after (days)', 'Сильно устаревает через (дней)')}
            value={draft.veryStaleDays}
            onChange={(veryStaleDays) => setDraft({ ...draft, veryStaleDays })}
          />
          <NumberField
            label={t('Default window (days)', 'Окно по умолчанию (дней)')}
            value={draft.defaultWindowDays}
            onChange={(defaultWindowDays) => setDraft({ ...draft, defaultWindowDays })}
          />
        </div>
      </Card>

      <Card title={t('Flow stages', 'Стадии Flow')}>
        <FlowWorkflowSettings value={workflow} onChange={setWorkflow} />
      </Card>

      <Card
        title={t('Data snapshot', 'Снимок данных')}
        caption={t(
          'Shared Jira responses (sprints, search, changelog) and calculated screens. While the snapshot is fresh, opening a page again does not call Jira. Refresh on a page drops the snapshot.',
          'Общие ответы Jira (спринты, поиск, changelog) и посчитанные экраны. Пока снимок свежий, повторный заход не ходит в Jira. «Обновить» на страницах сбрасывает снимок.',
        )}
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 12 }}>
          <NumberField
            label={t('Snapshot lifetime (minutes)', 'Срок жизни снимка (минуты)')}
            value={Math.max(0, Math.round(draft.cacheTtlSeconds / 60))}
            onChange={(minutes) =>
              setDraft({ ...draft, cacheTtlSeconds: Math.max(0, Math.round(minutes)) * 60 })
            }
          />
        </div>
        <p className="caption" style={{ marginBottom: 12 }}>
          {t(
            '0 means no snapshot: every visit goes to Jira. The default is 15 minutes.',
            '0 — без снимка, каждый заход идёт в Jira. По умолчанию 15 минут.',
          )}
        </p>
        <div className="row" style={{ gap: 8 }}>
          <Pill tone="neutral">
            {cachedResponses === null
              ? t('unknown', 'неизвестно')
              : t(`${cachedResponses} snapshot records`, `${cachedResponses} записей в снимке`)}
          </Pill>
          <button type="button" onClick={clearCache}>
            {t('Clear snapshot', 'Очистить снимок')}
          </button>
        </div>
      </Card>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input type="number" min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  );
}
