'use client';

import { useEffect, useMemo, useState } from 'react';

import { RequireSetup } from '@frontend/components/Guards';
import { Caveats, WidgetBody } from '@frontend/components/metric-blocks';
import { ScopeEditor, describeScope } from '@frontend/components/ScopeEditor';
import {
  Callout,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  LoadingCards,
  Pill,
  SourceAppendix,
  Spinner,
  formatTimestamp,
} from '@frontend/components/ui';
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { useBatchMetrics, type BatchEntry, type BatchRequest } from '@frontend/lib/use-metrics';
import {
  WIDGET_CATALOG,
  type Dashboard,
  type JiraBoardOption,
  type Team,
  type WidgetConfig,
  type WidgetType,
  type WidgetWidth,
} from '@shared/types';

export default function DashboardsPage() {
  return (
    <RequireSetup>
      <DashboardsView />
    </RequireSetup>
  );
}

function DashboardsView() {
  const { dashboards, teams, reload } = useAppData();
  const [boards, setBoards] = useState<JiraBoardOption[]>([]);
  const [selectedId, setSelectedId] = useState(dashboards[0]?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WidgetConfig[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const payload = await apiGet<{ boards: JiraBoardOption[] }>('/api/jira/meta');
        setBoards(payload.boards);
      } catch {
        setBoards([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!dashboards.some((dashboard) => dashboard.id === selectedId)) {
      setSelectedId(dashboards[0]?.id ?? '');
    }
  }, [dashboards, selectedId]);

  const dashboard = dashboards.find((candidate) => candidate.id === selectedId);
  const widgets = editing ? draft : dashboard?.widgets ?? [];

  const requests: BatchRequest[] = useMemo(
    () =>
      widgets.map((widget) => ({
        id: widget.id,
        scope: widget.scope,
        windowDays: widget.windowDays,
        withChangelog: widget.withChangelog,
        title: widget.title,
      })),
    [widgets],
  );

  const { byId, loading, error: batchError, refresh } = useBatchMetrics(editing ? [] : requests);

  const createDashboard = async (withTemplate: boolean) => {
    const name = window.prompt('Dashboard name', withTemplate ? 'Team delivery' : 'New dashboard');
    if (!name?.trim()) return;
    setSaving(true);
    try {
      const payload = await apiPost<{ dashboard: Dashboard }>('/api/dashboards', {
        name: name.trim(),
        widgets: withTemplate ? teamTemplate(teams) : [],
      });
      await reload();
      setSelectedId(payload.dashboard.id);
      setDraft(payload.dashboard.widgets);
      setEditing(payload.dashboard.widgets.length === 0);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setDraft(dashboard?.widgets ?? []);
    setEditing(true);
  };

  const saveLayout = async () => {
    if (!dashboard) return;
    setSaving(true);
    try {
      await apiPut(`/api/dashboards/${dashboard.id}`, { name: dashboard.name, widgets: draft });
      await reload();
      setEditing(false);
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const removeDashboard = async () => {
    if (!dashboard) return;
    if (!window.confirm(`Delete dashboard "${dashboard.name}"?`)) return;
    await apiDelete(`/api/dashboards/${dashboard.id}`);
    await reload();
    setEditing(false);
  };

  const renameDashboard = async () => {
    if (!dashboard) return;
    const name = window.prompt('Dashboard name', dashboard.name);
    if (!name?.trim()) return;
    await apiPut(`/api/dashboards/${dashboard.id}`, { name: name.trim() });
    await reload();
  };

  if (dashboards.length === 0) {
    return (
      <div className="stack">
        <header className="page-header">
          <div className="page-header-meta">
            <h1>Dashboards</h1>
            <div className="page-header-sub">
              Build your own layouts from the widget catalogue. Each widget carries its own scope.
            </div>
          </div>
        </header>
        {error && <ErrorNotice error={error} />}
        <EmptyState title="No saved dashboards yet">
          <span>
            Start from a template built around your first team, or from an empty layout and pick widgets yourself.
          </span>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="primary" onClick={() => createDashboard(true)} disabled={saving}>
              Start from team template
            </button>
            <button type="button" onClick={() => createDashboard(false)} disabled={saving}>
              Start empty
            </button>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>{dashboard?.name ?? 'Dashboards'}</h1>
          <div className="page-header-sub">
            <span>
              {widgets.length} {widgets.length === 1 ? 'widget' : 'widgets'}
            </span>
            {dashboard && <span>updated {formatTimestamp(dashboard.updatedAt)}</span>}
            {!editing && (
              <button type="button" className="subtle" onClick={refresh} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </div>
        </div>
        <div className="row">
          {dashboards.length > 1 && (
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} style={{ width: 190 }}>
              {dashboards.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          )}
          {editing ? (
            <>
              <button type="button" className="primary" onClick={saveLayout} disabled={saving}>
                {saving ? 'Saving…' : 'Save layout'}
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={startEditing}>
                Edit layout
              </button>
              <button type="button" onClick={renameDashboard}>
                Rename
              </button>
              <button type="button" onClick={() => createDashboard(false)}>
                New
              </button>
              <button type="button" className="danger" onClick={removeDashboard}>
                Delete
              </button>
            </>
          )}
        </div>
      </header>

      {error && <ErrorNotice error={error} />}
      {batchError && <ErrorNotice error={batchError} onRetry={refresh} />}

      {editing ? (
        <LayoutEditor
          widgets={draft}
          onChange={setDraft}
          teams={teams}
          boards={boards}
        />
      ) : (
        <>
          {widgets.length === 0 && (
            <EmptyState title="This dashboard has no widgets yet">
              <button type="button" className="primary" onClick={startEditing}>
                Add widgets
              </button>
            </EmptyState>
          )}
          {loading && widgets.length > 0 && Object.keys(byId).length === 0 && <LoadingCards count={4} />}
          <div className="grid">
            {widgets.map((widget) => {
              const entry = byId[widget.id];
              const catalogEntry = WIDGET_CATALOG.find((candidate) => candidate.type === widget.type);
              const title = widget.title ?? catalogEntry?.label ?? widget.type;

              if (entry?.error) {
                return (
                  <div key={widget.id} className={`col-${widget.width}`}>
                    <Card title={title} caption={describeScope(widget.scope, teams, boards)}>
                      <Callout tone="danger">{entry.error}</Callout>
                    </Card>
                  </div>
                );
              }

              if (!entry?.model) {
                return (
                  <div key={widget.id} className={`col-${widget.width}`}>
                    <Card title={title} caption={describeScope(widget.scope, teams, boards)}>
                      <Spinner />
                    </Card>
                  </div>
                );
              }

              const body = <WidgetBody widget={widget} model={entry.model} />;
              if (widget.type === 'stats' || widget.type === 'sprint-context') {
                // These widgets render their own frame.
                return (
                  <div key={widget.id} className={`col-${widget.width}`}>
                    {body ?? (
                      <Card title={title}>
                        <Callout tone="info">No data for this widget in the selected scope.</Callout>
                      </Card>
                    )}
                  </div>
                );
              }

              return (
                <div key={widget.id} className={`col-${widget.width}`}>
                  <Card title={title} caption={`${entry.model.scopeLabel} · ${entry.model.issueCount} work items`}>
                    {body ?? <Callout tone="info">No data for this widget in the selected scope.</Callout>}
                  </Card>
                </div>
              );
            })}
          </div>

          {widgets.length > 0 && <DashboardAppendix widgets={widgets} byId={byId} />}
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- editor --- */

function LayoutEditor({
  widgets,
  onChange,
  teams,
  boards,
}: {
  widgets: WidgetConfig[];
  onChange: (widgets: WidgetConfig[]) => void;
  teams: Team[];
  boards: JiraBoardOption[];
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= widgets.length) return;
    const next = [...widgets];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(widgets.filter((_, position) => position !== index));
    setEditingIndex(null);
  };

  const addWidget = (widget: WidgetConfig) => {
    onChange([...widgets, widget]);
    setEditingIndex(null);
  };

  const updateWidget = (index: number, widget: WidgetConfig) => {
    onChange(widgets.map((current, position) => (position === index ? widget : current)));
    setEditingIndex(null);
  };

  return (
    <div className="stack">
      <Callout tone="info">
        Editing the layout does not query Jira. Save and leave edit mode to load the widgets.
      </Callout>

      <Card title="Widgets in this dashboard" caption="Order here is the order on screen.">
        {widgets.length === 0 ? (
          <span className="caption">Nothing added yet. Use the catalogue below.</span>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Widget</th>
                  <th>Scope</th>
                  <th>Width</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {widgets.map((widget, index) => {
                  const catalogEntry = WIDGET_CATALOG.find((entry) => entry.type === widget.type);
                  return (
                    <tr key={widget.id}>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <span>{widget.title ?? catalogEntry?.label ?? widget.type}</span>
                          {catalogEntry?.needsChangelog && <Pill tone="warning">changelog</Pill>}
                        </div>
                      </td>
                      <td className="caption">{describeScope(widget.scope, teams, boards)}</td>
                      <td className="caption">{widget.width}</td>
                      <td className="tight">
                        <div className="row" style={{ gap: 2 }}>
                          <button type="button" className="subtle" onClick={() => move(index, -1)} disabled={index === 0}>
                            ↑
                          </button>
                          <button
                            type="button"
                            className="subtle"
                            onClick={() => move(index, 1)}
                            disabled={index === widgets.length - 1}
                          >
                            ↓
                          </button>
                          <button type="button" className="subtle" onClick={() => setEditingIndex(index)}>
                            Edit
                          </button>
                          <button type="button" className="subtle" onClick={() => remove(index)}>
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editingIndex !== null && widgets[editingIndex] && (
        <WidgetForm
          key={`edit-${editingIndex}`}
          initial={widgets[editingIndex]}
          teams={teams}
          boards={boards}
          onSubmit={(widget) => updateWidget(editingIndex, widget)}
          onCancel={() => setEditingIndex(null)}
        />
      )}

      {editingIndex === null && (
        <WidgetForm key="add" teams={teams} boards={boards} onSubmit={addWidget} />
      )}
    </div>
  );
}

function WidgetForm({
  initial,
  teams,
  boards,
  onSubmit,
  onCancel,
}: {
  initial?: WidgetConfig;
  teams: Team[];
  boards: JiraBoardOption[];
  onSubmit: (widget: WidgetConfig) => void;
  onCancel?: () => void;
}) {
  const [type, setType] = useState<WidgetType>(initial?.type ?? 'stats');
  const [width, setWidth] = useState<WidgetWidth>(initial?.width ?? 'full');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [windowDays, setWindowDays] = useState<number | ''>(initial?.windowDays ?? '');
  const [limit, setLimit] = useState<number | ''>(initial?.limit ?? '');
  const [scope, setScope] = useState(
    initial?.scope ?? { kind: 'team' as const, teamId: teams[0]?.id ?? '', mode: 'active-sprint' as const },
  );

  const catalogEntry = WIDGET_CATALOG.find((entry) => entry.type === type);

  const changeType = (nextType: WidgetType) => {
    setType(nextType);
    const entry = WIDGET_CATALOG.find((candidate) => candidate.type === nextType);
    if (entry) setWidth(entry.defaultWidth);
  };

  const submit = () => {
    onSubmit({
      id: initial?.id ?? `w_${Math.random().toString(36).slice(2, 10)}`,
      type,
      title: title.trim() || undefined,
      width,
      scope,
      windowDays: windowDays === '' ? undefined : Number(windowDays),
      withChangelog: catalogEntry?.needsChangelog ?? false,
      limit: limit === '' ? undefined : Number(limit),
    });
  };

  const supportsLimit = ['attention', 'issue-table'].includes(type);

  return (
    <Card
      title={initial ? 'Edit widget' : 'Add a widget'}
      caption={catalogEntry?.description}
      actions={
        onCancel && (
          <button type="button" className="subtle" onClick={onCancel}>
            Cancel
          </button>
        )
      }
    >
      <div className="stack">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <Field label="Widget">
            <select value={type} onChange={(event) => changeType(event.target.value as WidgetType)}>
              {WIDGET_CATALOG.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Width">
            <select value={width} onChange={(event) => setWidth(event.target.value as WidgetWidth)}>
              <option value="third">One third</option>
              <option value="half">One half</option>
              <option value="full">Full width</option>
            </select>
          </Field>
          <Field label="Title override (optional)">
            <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
        </div>

        <ScopeEditor value={scope} onChange={setScope} teams={teams} boards={boards} />

        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Field label="Window override (days)" hint="Leave empty to use the default from Settings.">
            <input
              type="number"
              min={1}
              value={windowDays}
              onChange={(event) => setWindowDays(event.target.value === '' ? '' : Number(event.target.value))}
            />
          </Field>
          {supportsLimit && (
            <Field label="Row limit" hint="How many rows this table shows.">
              <input
                type="number"
                min={1}
                value={limit}
                onChange={(event) => setLimit(event.target.value === '' ? '' : Number(event.target.value))}
              />
            </Field>
          )}
        </div>

        {catalogEntry?.needsChangelog && (
          <Callout tone="warning">
            This widget needs Jira changelogs, which makes its query noticeably heavier. Reuse the same scope on other
            widgets so the fetch is shared.
          </Callout>
        )}
        {catalogEntry?.sprintOnly && (
          <Callout tone="info">
            This widget only renders when the scope resolves to a single sprint. It is omitted for snapshots.
          </Callout>
        )}

        <div className="row">
          <button type="button" className="primary" onClick={submit}>
            {initial ? 'Update widget' : 'Add widget'}
          </button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- appendix --- */

function DashboardAppendix({
  widgets,
  byId,
}: {
  widgets: WidgetConfig[];
  byId: Record<string, BatchEntry>;
}) {
  const distinct = new Map<string, { label: string; jql: string }>();
  const caveats = new Set<string>();
  let queriedAt = '';
  let fromCache = true;
  let issueCount = 0;
  let coverage: Record<string, boolean> = {};

  for (const widget of widgets) {
    const model = byId[widget.id]?.model;
    if (!model) continue;
    distinct.set(model.jql, { label: model.scopeLabel, jql: model.jql });
    for (const caveat of model.caveats) caveats.add(caveat);
    if (!queriedAt || model.queriedAt > queriedAt) queriedAt = model.queriedAt;
    if (!model.fromCache) fromCache = false;
    issueCount += model.issueCount;
    coverage = { ...coverage, ...model.fieldCoverage };
  }

  if (distinct.size === 0) return null;
  const entries = [...distinct.values()];
  const first = entries[0];

  return (
    <div className="stack">
      {caveats.size > 0 && <Caveats caveats={[...caveats]} />}
      <SourceAppendix
        jql={first?.jql ?? ''}
        queriedAt={queriedAt || new Date().toISOString()}
        fromCache={fromCache}
        issueCount={issueCount}
        coverage={coverage}
        extraQueries={entries.slice(1).map((entry) => ({ label: entry.label, jql: entry.jql }))}
        assumptions={[
          `${entries.length} distinct ${entries.length === 1 ? 'query' : 'queries'} back the ${widgets.length} widgets on this dashboard.`,
          'Widgets sharing a scope share one cached Jira response.',
          'Work item counts are summed per widget, so overlapping scopes are counted more than once here.',
        ]}
      />
    </div>
  );
}

/* -------------------------------------------------------------- template --- */

function teamTemplate(teams: Team[]): WidgetConfig[] {
  const teamId = teams[0]?.id ?? '';
  const id = (suffix: string) => `w_${suffix}`;
  const activeSprint = { kind: 'team' as const, teamId, mode: 'active-sprint' as const };
  const recent = { kind: 'team' as const, teamId, mode: 'recent' as const };

  return [
    { id: id('stats'), type: 'stats', width: 'full', scope: activeSprint },
    { id: id('sprint'), type: 'sprint-context', width: 'half', scope: activeSprint },
    { id: id('remaining'), type: 'remaining', width: 'half', scope: activeSprint },
    { id: id('category'), type: 'status-category', width: 'third', scope: activeSprint },
    { id: id('aging'), type: 'aging-wip', width: 'third', scope: activeSprint },
    { id: id('priority'), type: 'priority-distribution', width: 'third', scope: activeSprint },
    { id: id('owners'), type: 'owner-load', width: 'full', scope: activeSprint },
    { id: id('attention'), type: 'attention', width: 'full', scope: activeSprint, limit: 12 },
    { id: id('throughput'), type: 'throughput', width: 'half', scope: recent },
    { id: id('lead'), type: 'lead-time', width: 'third', scope: recent },
    { id: id('issues'), type: 'issue-table', width: 'full', scope: activeSprint, limit: 15 },
  ];
}
