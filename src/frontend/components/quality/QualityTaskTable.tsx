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
          <span className="caption">Тип</span>
          <select className="cycle-def-select" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Все</option>
            {types.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="caption">
          {rows.length} из {issues.length} · фильтр: {filterLabel(filter)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="caption">Нет задач с выбранными фильтрами.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Ключ</th>
                <th>Название</th>
                <th>Тип</th>
                <th>Исполнитель</th>
                <th>
                  <Hint text={QUALITY_HINTS.firstQa}>First QA</Hint>
                </th>
                <th className="num">
                  <Hint text={QUALITY_HINTS.returns}>Возвраты</Hint>
                </th>
                <th>Циклы</th>
                <th>История</th>
                <th>Статус</th>
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
  if (issue.completedCycles.length) parts.push(`${issue.completedCycles.length} закр.`);
  if (issue.interruptedCycles.length) parts.push(`${issue.interruptedCycles.length} прерв.`);
  if (issue.openCycle) parts.push('открыт');
  return parts.join(' · ') || '—';
}

function cycleDetails(issue: QualityIssueRow) {
  const cycles: QualityCycle[] = [
    ...issue.completedCycles,
    ...issue.interruptedCycles,
    ...(issue.openCycle ? [issue.openCycle] : []),
  ];
  if (cycles.length === 0) {
    return <p className="caption">Возвратов в Fix не было. Это не доказательство First Pass Yield, пока задача не в Готово.</p>;
  }
  return (
    <ul className="quality-cycles">
      {issue.returns.map((event, index) => (
        <li key={`${event.at}-return-${index}`}>
          <strong>Возврат</strong>
          {' · '}
          {formatStamp(event.at)} · {event.from} → {event.to} · {event.reasonLabel}
        </li>
      ))}
      {cycles.map((cycle, index) => (
        <li key={`${cycle.startedAt}-${cycle.kind}-${index}`}>
          <strong>{cycleKindLabel(cycle)}</strong>
          {' · '}
          {formatStamp(cycle.startedAt)}
          {cycle.endedAt ? ` → ${formatStamp(cycle.endedAt)}` : ' → сейчас'}
          {cycle.durationDays !== undefined ? ` · ${formatCycleDuration(cycle.durationDays)}` : ''}
          {cycle.ageDays !== undefined ? ` · возраст ${formatCycleDuration(cycle.ageDays)}` : ''}
          {cycle.interruptReason === 'done' ? ' · прерван Готово' : ''}
        </li>
      ))}
    </ul>
  );
}

function cycleKindLabel(cycle: QualityCycle): string {
  if (cycle.kind === 'completed') return 'Завершён';
  if (cycle.kind === 'interrupted') return 'Прерван';
  return 'Открыт';
}

function historyLabel(quality: QualityIssueRow['historyQuality']): string {
  if (quality === 'exact') return 'полная';
  if (quality === 'partial') return 'неполная';
  return 'нет истории';
}

function historyTone(quality: QualityIssueRow['historyQuality']): 'neutral' | 'warning' | 'danger' {
  if (quality === 'exact') return 'neutral';
  if (quality === 'partial') return 'warning';
  return 'danger';
}

function filterLabel(filter: QualityTableFilter): string {
  switch (filter) {
    case 'returns':
      return 'есть возвраты';
    case 'repeated':
      return 'повторные возвраты';
    case 'completed':
      return 'завершённые циклы';
    case 'open':
      return 'открытые циклы';
    case 'unknown':
      return 'неполная история';
    case 'zero':
      return 'без возвратов';
    case 'one':
      return 'один возврат';
    case 'two':
      return 'два возврата';
    case 'threePlus':
      return '3+ возврата';
    case 'firstPass':
      return 'первый проход без возврата';
    case 'pending':
      return 'первый проход ещё идёт';
    default:
      return 'все задачи когорты';
  }
}

function formatStamp(value?: string): string {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}
