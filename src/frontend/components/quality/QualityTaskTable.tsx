import { Fragment, useMemo, useState } from 'react';

import { Hint, Pill } from '@frontend/components/ui';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
import type { QualityCycle, QualityIssueRow } from '@backend/metrics/quality-model';

export type QualityTableFilter =
  | 'all'
  | 'returns'
  | 'repeated'
  | 'completed'
  | 'open'
  | 'unknown'
  | 'zero'
  | 'one'
  | 'two'
  | 'threePlus'
  | 'firstPass'
  | 'pending';

export function QualityTaskTable({
  issues,
  filter,
  assigneeIds,
}: {
  issues: QualityIssueRow[];
  filter: QualityTableFilter;
  assigneeIds: string[];
}) {
  const types = useMemo(
    () => [...new Set(issues.map((issue) => issue.type))].sort((a, b) => a.localeCompare(b, 'ru')),
    [issues],
  );
  const [type, setType] = useState('');
  const [openKey, setOpenKey] = useState<string | undefined>();

  const rows = issues.filter((issue) => {
    if (type && issue.type !== type) return false;
    if (assigneeIds.length > 0) {
      const id = issue.assigneeId || 'unassigned';
      if (!assigneeIds.includes(id)) return false;
    }
    if (filter === 'returns' && issue.returnCount < 1) return false;
    if (filter === 'repeated' && issue.returnCount < 2) return false;
    if (filter === 'completed' && issue.completedCycles.length === 0) return false;
    if (filter === 'open' && !issue.openCycle) return false;
    if (filter === 'unknown' && issue.historyQuality === 'exact') return false;
    if (filter === 'zero' && (issue.returnCount !== 0 || issue.historyQuality !== 'exact')) return false;
    if (filter === 'one' && issue.returnCount !== 1) return false;
    if (filter === 'two' && issue.returnCount !== 2) return false;
    if (filter === 'threePlus' && issue.returnCount < 3) return false;
    if (filter === 'firstPass' && issue.firstPass !== 'passed') return false;
    if (filter === 'pending' && issue.firstPass !== 'pending') return false;
    return true;
  });

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <label className="cycle-filter">
          <span className="caption">Type</span>
          <select className="cycle-def-select" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All</option>
            {types.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="caption">
          {rows.length} of {issues.length} · filter: {filterLabel(filter)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="caption">No issues match the selected filters.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Type</th>
                <th>Assignee</th>
                <th>
                  <Hint text={QUALITY_HINTS.firstQa}>First QA</Hint>
                </th>
                <th className="num">
                  <Hint text={QUALITY_HINTS.returns}>Returns</Hint>
                </th>
                <th>Cycles</th>
                <th>History</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((issue) => {
                const open = openKey === issue.key;
                return (
                  <Fragment key={issue.key}>
                    <tr
                      data-selected={open ? 'true' : undefined}
                      onClick={() => setOpenKey(open ? undefined : issue.key)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <a href={issue.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                          {issue.key}
                        </a>
                      </td>
                      <td>{issue.summary}</td>
                      <td>{issue.type}</td>
                      <td>{issue.assigneeName || '—'}</td>
                      <td>
                        {formatStamp(issue.firstQaAt)}
                        {issue.firstQaTo ? ` → ${issue.firstQaTo}` : ''}
                      </td>
                      <td className="num">{issue.returnCount}</td>
                      <td>{cycleSummary(issue)}</td>
                      <td>
                        <Pill tone={historyTone(issue.historyQuality)}>{historyLabel(issue.historyQuality)}</Pill>
                      </td>
                      <td>{issue.status}</td>
                    </tr>
                    {open && (
                      <tr className="quality-detail">
                        <td colSpan={9}>{cycleDetails(issue)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function cycleSummary(issue: QualityIssueRow): string {
  const parts: string[] = [];
  if (issue.completedCycles.length) parts.push(`${issue.completedCycles.length} closed`);
  if (issue.interruptedCycles.length) parts.push(`${issue.interruptedCycles.length} interrupted`);
  if (issue.openCycle) parts.push('open');
  return parts.join(' · ') || '—';
}

function cycleDetails(issue: QualityIssueRow) {
  const cycles: QualityCycle[] = [
    ...issue.completedCycles,
    ...issue.interruptedCycles,
    ...(issue.openCycle ? [issue.openCycle] : []),
  ];
  if (cycles.length === 0) {
    return <p className="caption">No returns to Fix. That is not proof of first pass yield until the issue is Done.</p>;
  }
  return (
    <ul className="quality-cycles">
      {issue.returns.map((event, index) => (
        <li key={`${event.at}-return-${index}`}>
          <strong>Return</strong>
          {' · '}
          {formatStamp(event.at)} · {event.from} → {event.to} · {event.reasonLabel}
        </li>
      ))}
      {cycles.map((cycle, index) => (
        <li key={`${cycle.startedAt}-${cycle.kind}-${index}`}>
          <strong>{cycleKindLabel(cycle)}</strong>
          {' · '}
          {formatStamp(cycle.startedAt)}
          {cycle.endedAt ? ` → ${formatStamp(cycle.endedAt)}` : ' → now'}
          {cycle.durationDays !== undefined ? ` · ${formatCycleDuration(cycle.durationDays)}` : ''}
          {cycle.ageDays !== undefined ? ` · age ${formatCycleDuration(cycle.ageDays)}` : ''}
          {cycle.interruptReason === 'done' ? ' · interrupted by Done' : ''}
        </li>
      ))}
    </ul>
  );
}

function cycleKindLabel(cycle: QualityCycle): string {
  if (cycle.kind === 'completed') return 'Completed';
  if (cycle.kind === 'interrupted') return 'Interrupted';
  return 'Open';
}

function historyLabel(quality: QualityIssueRow['historyQuality']): string {
  if (quality === 'exact') return 'complete';
  if (quality === 'partial') return 'partial';
  return 'no history';
}

function historyTone(quality: QualityIssueRow['historyQuality']): 'neutral' | 'warning' | 'danger' {
  if (quality === 'exact') return 'neutral';
  if (quality === 'partial') return 'warning';
  return 'danger';
}

function filterLabel(filter: QualityTableFilter): string {
  switch (filter) {
    case 'returns':
      return 'has returns';
    case 'repeated':
      return 'repeated returns';
    case 'completed':
      return 'completed cycles';
    case 'open':
      return 'open cycles';
    case 'unknown':
      return 'incomplete history';
    case 'zero':
      return 'no returns';
    case 'one':
      return 'one return';
    case 'two':
      return 'two returns';
    case 'threePlus':
      return '3+ returns';
    case 'firstPass':
      return 'first pass, no return';
    case 'pending':
      return 'first pass still open';
    default:
      return 'all cohort issues';
  }
}

function formatStamp(value?: string): string {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}
