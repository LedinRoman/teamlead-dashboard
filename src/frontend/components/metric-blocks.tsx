'use client';

import { BarChart, DonutChart, HBarList, LineChart, SegmentBar, shortLabel } from './charts';
import {
  Callout,
  Card,
  EmptyState,
  Pill,
  StatBar,
  formatDate,
  formatDays,
  formatTimestamp,
  type Tone,
} from './ui';
import type {
  AttentionItem,
  DistributionSummary,
  MetricsModel,
  NormalizedIssue,
  OwnerLoadRow,
  SprintContext,
  WidgetConfig,
} from '@shared/types';

/* ------------------------------------------------------------------- meta --- */

export function ScopeMeta({
  model,
  onRefresh,
  refreshing,
}: {
  model: MetricsModel;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="page-header-sub">
      <span>{model.scopeLabel}</span>
      <Pill tone={model.mode === 'sprint' ? 'info' : 'neutral'}>
        {model.mode === 'sprint' ? 'sprint' : 'snapshot'}
      </Pill>
      {model.windowDays && <span>last {model.windowDays}d</span>}
      <span>
        {model.fromCache ? 'cached ' : ''}
        {formatTimestamp(model.queriedAt)}
      </span>
      {onRefresh && (
        <button type="button" className="subtle" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}

export function Caveats({ caveats }: { caveats: string[] }) {
  if (caveats.length === 0) return null;
  return (
    <Callout tone="info" title={caveats.length === 1 ? 'Scope caveat' : 'Scope caveats'}>
      {caveats.length === 1 ? (
        caveats[0]
      ) : (
        <ul className="plain" style={{ marginTop: 2 }}>
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}
    </Callout>
  );
}

/* ----------------------------------------------------------------- sprint --- */

export function SprintCard({ sprint }: { sprint: SprintContext }) {
  const progress =
    sprint.daysTotal && sprint.daysElapsed !== undefined
      ? Math.min(100, Math.round((sprint.daysElapsed / sprint.daysTotal) * 100))
      : undefined;

  return (
    <Card title={sprint.name} caption={`${sprint.state} sprint`}>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="caption">
            Start <span style={{ color: 'var(--text)' }}>{formatDate(sprint.startDate)}</span>
          </span>
          <span className="caption">
            End <span style={{ color: 'var(--text)' }}>{formatDate(sprint.endDate)}</span>
          </span>
          {sprint.daysRemaining !== undefined && (
            <Pill tone={sprint.daysRemaining <= 2 ? 'warning' : 'neutral'}>
              {sprint.daysRemaining}d remaining
            </Pill>
          )}
        </div>
        {progress !== undefined && sprint.daysTotal !== undefined && (
          <SegmentBar
            segments={[
              { label: `Elapsed ${sprint.daysElapsed}d`, value: sprint.daysElapsed ?? 0, tone: 'info' },
              {
                label: `Remaining ${sprint.daysRemaining}d`,
                value: Math.max(0, sprint.daysTotal - (sprint.daysElapsed ?? 0)),
                tone: 'neutral',
              },
            ]}
            caption={`Sprint calendar: ${progress}% elapsed of ${sprint.daysTotal} days`}
          />
        )}
        {sprint.goal && (
          <div className="caption">
            Goal: <span style={{ color: 'var(--text)' }}>{sprint.goal}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- owner load --- */

const OWNER_STATUS_TONE: Record<OwnerLoadRow['ownerStatus'], Tone> = {
  active: 'neutral',
  inactive: 'danger',
  unassigned: 'warning',
  unknown: 'neutral',
};

export function OwnerLoadTable({
  rows,
  showStoryPoints,
  onSelect,
}: {
  rows: OwnerLoadRow[];
  showStoryPoints: boolean;
  onSelect?: (row: OwnerLoadRow) => void;
}) {
  if (rows.length === 0) return <EmptyState title="No assignees in this scope." />;
  const maxUnfinished = Math.max(...rows.map((row) => row.active + row.notStarted), 1);

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Owner</th>
            <th className="num">In progress</th>
            <th className="num">To do</th>
            <th className="num">Stale</th>
            <th className="num">Blocked</th>
            <th className="num">Done</th>
            {showStoryPoints && <th className="num">Points</th>}
            <th style={{ width: 120 }}>Unfinished load</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const unfinished = row.active + row.notStarted;
            return (
              <tr key={row.id ?? row.name}>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {onSelect && row.id ? (
                      <button type="button" className="subtle" onClick={() => onSelect(row)}>
                        {row.name}
                      </button>
                    ) : (
                      <span>{row.name}</span>
                    )}
                    {row.ownerStatus !== 'active' && row.ownerStatus !== 'unknown' && (
                      <Pill tone={OWNER_STATUS_TONE[row.ownerStatus]}>
                        {row.ownerStatus === 'unassigned' ? 'unassigned' : 'inactive in Jira'}
                      </Pill>
                    )}
                  </div>
                </td>
                <Num value={row.active} />
                <Num value={row.notStarted} />
                <Num value={row.stale} tone="warning" />
                <Num value={row.blocked} tone="danger" />
                <Num value={row.done} />
                {showStoryPoints && <Num value={row.storyPoints} />}
                <td>
                  <span className="hbar-track" style={{ display: 'block' }}>
                    <span
                      className="hbar-fill"
                      style={{
                        width: `${(unfinished / maxUnfinished) * 100}%`,
                        background: 'var(--accent)',
                        display: 'block',
                      }}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Num({ value, tone }: { value: number; tone?: Tone }) {
  return (
    <td className="num">
      {value === 0 ? (
        <span className="zero">0</span>
      ) : (
        <span style={tone ? { color: `var(--${tone === 'danger' ? 'danger' : 'warning'})` } : undefined}>
          {Number.isInteger(value) ? value : value.toFixed(1)}
        </span>
      )}
    </td>
  );
}

/* -------------------------------------------------------------- attention --- */

export function AttentionTable({ items, limit = 20 }: { items: AttentionItem[]; limit?: number }) {
  if (items.length === 0) {
    return (
      <Callout tone="success">
        Nothing matched the blocked, stale, unassigned, overdue or unresolved-dependency checks in this scope.
      </Callout>
    );
  }

  const rows = items.slice(0, limit);
  const hidden = items.length - rows.length;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Why</th>
              <th>Evidence</th>
              <th>Owner</th>
              <th className="num">Idle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key}>
                <td className="tight">
                  <a className="issue-key" href={item.url} target="_blank" rel="noreferrer">
                    {item.key}
                  </a>
                </td>
                <td>
                  <span className="truncate" title={item.summary}>
                    {item.summary}
                  </span>
                </td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {item.reasons.map((reason) => (
                      <Pill key={reason} tone={item.severity === 'high' ? 'danger' : 'warning'}>
                        {reason}
                      </Pill>
                    ))}
                  </div>
                </td>
                <td className="caption">{item.evidence}</td>
                <td className="tight">{item.owner}</td>
                <td className="num">{formatDays(item.ageDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <div className="caption">{hidden} more work items matched but are not listed.</div>}
    </div>
  );
}

/* ------------------------------------------------------------ issue table --- */

export function IssueTable({
  issues,
  limit = 25,
  showStoryPoints,
  unfinishedOnly = true,
}: {
  issues: NormalizedIssue[];
  limit?: number;
  showStoryPoints: boolean;
  unfinishedOnly?: boolean;
}) {
  const filtered = unfinishedOnly ? issues.filter((issue) => issue.effectiveCategory !== 'done') : issues;
  if (filtered.length === 0) return <EmptyState title="No work items to list in this scope." />;
  const rows = filtered.slice(0, limit);
  const hidden = filtered.length - rows.length;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Owner</th>
              {showStoryPoints && <th className="num">Points</th>}
              <th className="num">Idle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((issue) => (
              <tr key={issue.key}>
                <td className="tight">
                  <a className="issue-key" href={issue.url} target="_blank" rel="noreferrer">
                    {issue.key}
                  </a>
                </td>
                <td>
                  <span className="truncate" title={issue.summary}>
                    {issue.summary}
                  </span>
                </td>
                <td className="tight">
                  <Pill
                    tone={
                      issue.effectiveCategory === 'done'
                        ? 'success'
                        : issue.effectiveCategory === 'indeterminate'
                          ? 'info'
                          : 'neutral'
                    }
                    // A rule can move a status to another category, so the colour
                    // would otherwise silently disagree with Jira for no visible reason.
                    title={
                      issue.effectiveCategory === issue.statusCategory
                        ? issue.status
                        : `${issue.status} — counted as ${issue.effectiveCategory === 'done' ? 'done' : issue.effectiveCategory === 'indeterminate' ? 'in progress' : 'to do'} by your rules`
                    }
                  >
                    {issue.status}
                    {issue.effectiveCategory !== issue.statusCategory && ' *'}
                  </Pill>
                </td>
                <td className="tight caption">{issue.priority ?? '—'}</td>
                <td className="tight">{issue.assigneeName}</td>
                {showStoryPoints && (
                  <td className="num">{issue.storyPoints ?? <span className="zero">—</span>}</td>
                )}
                <td className="num">{formatDays(issue.updatedAgeDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <div className="caption">{hidden} more work items in scope are not listed.</div>}
    </div>
  );
}

/* ----------------------------------------------------------- distribution --- */

export function DistributionStat({
  summary,
  label,
}: {
  summary: DistributionSummary | null;
  label: string;
}) {
  if (!summary) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 18 }}>
        <Metric label="Median" value={formatDays(summary.median)} />
        <Metric label="p85" value={formatDays(summary.p85)} />
        <Metric label="Max" value={formatDays(summary.max)} />
      </div>
      <span className="caption">
        {label} across {summary.count} completed work items.
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <span className="stat-label">{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- widget --- */

/**
 * Renders one widget type from an already-fetched model. Returns null when the
 * model has nothing to show, so callers can omit the card entirely.
 */
export function WidgetBody({ widget, model }: { widget: WidgetConfig; model: MetricsModel }) {
  const showStoryPoints = model.fieldCoverage.storyPoints;

  switch (widget.type) {
    case 'stats':
      return <StatBar stats={model.stats} />;

    case 'sprint-context':
      return model.sprint ? <SprintCard sprint={model.sprint} /> : null;

    case 'status-distribution':
      return model.statusDistribution.length > 0 ? (
        <HBarList
          data={model.statusDistribution}
          caption={`Work items per Jira status · ${model.issueCount} in scope`}
        />
      ) : null;

    case 'status-category':
      return model.statusCategoryDistribution.length > 0 ? (
        <DonutChart
          data={model.statusCategoryDistribution}
          caption="Share of work items by status category"
        />
      ) : null;

    case 'owner-load':
      return model.ownerLoad.length > 0 ? (
        <OwnerLoadTable rows={model.ownerLoad} showStoryPoints={showStoryPoints} />
      ) : null;

    case 'attention':
      return <AttentionTable items={model.attention} limit={widget.limit ?? 12} />;

    case 'issue-table':
      return <IssueTable issues={model.issues} limit={widget.limit ?? 15} showStoryPoints={showStoryPoints} />;

    case 'throughput':
      return model.flow.throughputByWeek.length > 0 ? (
        <BarChart
          data={model.flow.throughputByWeek}
          xLabel="ISO week"
          yLabel="Resolved (work items)"
          tone="success"
          formatX={shortLabel}
          caption={`Resolved work items per ISO week · last ${model.windowDays ?? widget.windowDays ?? 60} days`}
        />
      ) : null;

    case 'resolved-per-day':
      return model.resolvedPerDay.length > 0 ? (
        <BarChart
          data={model.resolvedPerDay}
          xLabel="Day"
          yLabel="Resolved (work items)"
          tone="success"
          formatX={shortLabel}
          caption="Completed work items per calendar day, from resolution dates"
        />
      ) : null;

    case 'remaining':
      return model.remainingOverTime && model.remainingOverTime.length > 1 ? (
        <LineChart
          data={model.remainingOverTime}
          xLabel="Day"
          yLabel="Remaining (work items)"
          formatX={shortLabel}
          caption="Unfinished work per day, reconstructed from resolution dates. Scope added mid-sprint is not modelled."
        />
      ) : null;

    case 'aging-wip':
      return model.flow.agingWip.some((bucket) => bucket.value > 0) ? (
        <BarChart
          data={model.flow.agingWip}
          xLabel="Days since last update"
          yLabel="Unfinished (work items)"
          tone="warning"
          caption="Unfinished work bucketed by time since its last Jira update"
        />
      ) : null;

    case 'type-distribution':
      return model.typeDistribution.length > 0 ? (
        <HBarList data={model.typeDistribution} caption="Work items per issue type" />
      ) : null;

    case 'priority-distribution':
      return model.priorityDistribution.length > 0 ? (
        <HBarList data={model.priorityDistribution} caption="Work items per priority" />
      ) : null;

    case 'parent-distribution':
      return model.parentDistribution.length > 0 ? (
        <HBarList data={model.parentDistribution} caption="Work items per parent or epic" />
      ) : null;

    case 'cycle-time':
      return model.flow.cycleTimeDays ? (
        <DistributionStat
          summary={model.flow.cycleTimeDays}
          label="First transition into an in-progress status until resolution"
        />
      ) : null;

    case 'lead-time':
      return model.flow.leadTimeDays ? (
        <DistributionStat summary={model.flow.leadTimeDays} label="Created until resolved" />
      ) : null;

    default:
      return null;
  }
}
