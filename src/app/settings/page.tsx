'use client';

import { useEffect, useState } from 'react';

import { Callout, Card, Field, Pill, Segmented } from '@frontend/components/ui';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { readStoredExcludeQa, writeStoredExcludeQa } from '@frontend/lib/exclude-qa-title';
import { FlowWorkflowSettings } from '@frontend/components/flow/FlowWorkflowSettings';
import { mergeFlowWorkflow, validateFlowWorkflow } from '@backend/metrics/flow-workflow';
import type { Deployment, FlowWorkflow, MetricRules } from '@shared/types';

type DeploymentChoice = 'auto' | Deployment;

export default function SettingsPage() {
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
      setError('Jira URL is required when saving a token.');
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
      window.alert('Jira accepted the URL and token.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setTesting(false);
    }
  };

  const clearCache = async () => {
    const payload = await apiDelete<{ cleared: number }>('/api/cache');
    setCachedResponses(0);
    window.alert(`Cleared ${payload.cleared} snapshot records.`);
  };

  return (
    <div className="stack" style={{ maxWidth: 840 }}>
      <header className="page-header">
        <div className="page-header-meta">
          <h1>Settings</h1>
        </div>
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {error && <Callout tone="danger">{error}</Callout>}
      {saved && <Callout tone="success">Saved.</Callout>}

      <Card
        title="Jira"
        caption="One Jira URL and token for this dashboard. The token is encrypted in the database and only sent to your Jira site."
      >
        <div className="stack">
          {connection && (
            <div className="row" style={{ gap: 6 }}>
              <Pill tone={connection.secretHint.includes('unreadable') ? 'danger' : 'neutral'}>
                token {connection.secretHint}
              </Pill>
              <Pill tone="info">{connection.displayName ?? 'connected'}</Pill>
              <Pill tone="neutral">{connection.deployment === 'cloud' ? 'Jira Cloud' : 'Jira Server / DC'}</Pill>
            </div>
          )}
          {connection?.secretHint.includes('unreadable') && (
            <Callout tone="warning" title="Saved token cannot be decrypted">
              Введите токен ещё раз и сохраните. URL можно оставить как есть.
            </Callout>
          )}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="Jira URL" hint="Например https://acme.atlassian.net">
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
              <Field label="Deployment">
                <div>
                  <Segmented<DeploymentChoice>
                    value={jiraDeployment}
                    onChange={setJiraDeployment}
                    options={[
                      { value: 'auto', label: 'Auto-detect' },
                      { value: 'cloud', label: 'Jira Cloud' },
                      { value: 'server', label: 'Server / DC' },
                    ]}
                  />
                </div>
              </Field>
            </div>
            <Field
              label={needsJiraEmail ? 'Account email' : 'Account email (optional)'}
              hint={needsJiraEmail ? 'Аккаунт, которому принадлежит API token.' : 'Пусто — bearer PAT для Server / DC.'}
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
              label="API token"
              hint={connection ? 'Оставьте пустым, чтобы не менять сохранённый токен.' : 'Шифруется в базе. В логи не пишется.'}
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
              {testing ? 'Testing…' : 'Test Jira'}
            </button>
          </div>
        </div>
      </Card>

      <Card title="Thresholds">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <NumberField
            label="Stale after (days)"
            value={draft.staleDays}
            onChange={(staleDays) => setDraft({ ...draft, staleDays })}
          />
          <NumberField
            label="Very stale after (days)"
            value={draft.veryStaleDays}
            onChange={(veryStaleDays) => setDraft({ ...draft, veryStaleDays })}
          />
          <NumberField
            label="Default window (days)"
            value={draft.defaultWindowDays}
            onChange={(defaultWindowDays) => setDraft({ ...draft, defaultWindowDays })}
          />
        </div>
      </Card>

      <Card
        title="Фильтры задач"
        caption="Общие для Overview, Flow, Predictability и Quality. Сохраните, чтобы применить на всех экранах."
      >
        <label className="caption" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={Boolean(draft.excludeQaTitle)}
            onChange={(event) => setDraft({ ...draft, excludeQaTitle: event.target.checked })}
          />
          Исключить [QA]
        </label>
        <p className="caption" style={{ marginTop: 8 }}>
          Задачи с [QA] в названии не входят в cycle time, поток, predictability и quality.
        </p>
      </Card>

      <Card title="Стадии Flow">
        <FlowWorkflowSettings value={workflow} onChange={setWorkflow} />
      </Card>

      <Card
        title="Снимок данных"
        caption="Общие ответы Jira (спринты, поиск, changelog) и посчитанные экраны. Пока снимок свежий, повторный заход не ходит в Jira. «Обновить» на страницах сбрасывает снимок."
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 12 }}>
          <NumberField
            label="Срок жизни снимка (минуты)"
            value={Math.max(0, Math.round(draft.cacheTtlSeconds / 60))}
            onChange={(minutes) =>
              setDraft({ ...draft, cacheTtlSeconds: Math.max(0, Math.round(minutes)) * 60 })
            }
          />
        </div>
        <p className="caption" style={{ marginBottom: 12 }}>
          0 — без снимка, каждый заход идёт в Jira. По умолчанию 15 минут.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <Pill tone="neutral">
            {cachedResponses === null ? 'unknown' : `${cachedResponses} записей в снимке`}
          </Pill>
          <button type="button" onClick={clearCache}>
            Очистить снимок
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
