import { Fragment, useMemo, useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { Hint, Pill } from '@frontend/components/ui';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import { qualityHints } from '@backend/metrics/quality-copy';
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
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
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
          <span className="caption">{t('Type', 'Тип')}</span>
          <select className="cycle-def-select" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{t('All', 'Все')}</option>
            {types.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="caption">
          {t(`${rows.length} of ${issues.length}`, `${rows.length} из ${issues.length}`)} · {t('filter', 'фильтр')}: {filterLabel(filter, t)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="caption">{t('No issues match the selected filters.', 'Нет задач по выбранным фильтрам.')}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('Key', 'Ключ')}</th>
                <th>{t('Summary', 'Название')}</th>
                <th>{t('Type', 'Тип')}</th>
                <th>{t('Assignee', 'Исполнитель')}</th>
                <th>
                  <Hint text={hints.firstQa}>{t('First QA', 'First QA')}</Hint>
                </th>
                <th className="num">
                  <Hint text={hints.returns}>{t('Returns', 'Возвраты')}</Hint>
                </th>
                <th>{t('Cycles', 'Циклы')}</th>
                <th>{t('History', 'История')}</th>
                <th>{t('Status', 'Статус')}</th>
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
                      <td>{cycleSummary(issue, t)}</td>
                      <td>
                        <Pill tone={historyTone(issue.historyQuality)}>{historyLabel(issue.historyQuality, t)}</Pill>
                      </td>
                      <td>{issue.status}</td>
                    </tr>
                    {open && (
                      <tr className="quality-detail">
                        <td colSpan={9}>{cycleDetails(issue, t)}</td>
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

function cycleSummary(issue: QualityIssueRow, t: (en: string, ru: string) => string): string {
  const parts: string[] = [];
  if (issue.completedCycles.length) {
    parts.push(t(`${issue.completedCycles.length} closed`, `${issue.completedCycles.length} закрыто`));
  }
  if (issue.interruptedCycles.length) {
    parts.push(t(`${issue.interruptedCycles.length} interrupted`, `${issue.interruptedCycles.length} прервано`));
  }
  if (issue.openCycle) parts.push(t('open', 'открыт'));
  return parts.join(' · ') || '—';
}

function cycleDetails(issue: QualityIssueRow, t: (en: string, ru: string) => string) {
  const cycles: QualityCycle[] = [
    ...issue.completedCycles,
    ...issue.interruptedCycles,
    ...(issue.openCycle ? [issue.openCycle] : []),
  ];
  if (cycles.length === 0) {
    return (
      <p className="caption">
        {t(
          'No returns to Fix. That is not proof of first pass yield until the issue is Done.',
          'Нет возвратов в Fix. Это не доказательство first pass yield, пока задача не в Готово.',
        )}
      </p>
    );
  }
  return (
    <ul className="quality-cycles">
      {issue.returns.map((event, index) => (
        <li key={`${event.at}-return-${index}`}>
          <strong>{t('Return', 'Возврат')}</strong>
          {' · '}
          {formatStamp(event.at)} · {event.from} → {event.to} · {reasonLabel(event.reasonLabel, t)}
        </li>
      ))}
      {cycles.map((cycle, index) => (
        <li key={`${cycle.startedAt}-${cycle.kind}-${index}`}>
          <strong>{cycleKindLabel(cycle, t)}</strong>
          {' · '}
          {formatStamp(cycle.startedAt)}
          {cycle.endedAt ? ` → ${formatStamp(cycle.endedAt)}` : ` → ${t('now', 'сейчас')}`}
          {cycle.durationDays !== undefined ? ` · ${formatCycleDuration(cycle.durationDays)}` : ''}
          {cycle.ageDays !== undefined ? ` · ${t('age', 'возраст')} ${formatCycleDuration(cycle.ageDays)}` : ''}
          {cycle.interruptReason === 'done' ? ` · ${t('interrupted by Done', 'прерван переходом в Готово')}` : ''}
        </li>
      ))}
    </ul>
  );
}

function reasonLabel(label: string, t: (en: string, ru: string) => string): string {
  if (label === 'Не записана') return t('Not recorded', 'Не записана');
  if (label === 'Комментарий') return t('Comment', 'Комментарий');
  if (label === 'Метка') return t('Label', 'Метка');
  if (label.startsWith('Метка: ')) return t(`Label: ${label.slice('Метка: '.length)}`, label);
  return label;
}

function cycleKindLabel(cycle: QualityCycle, t: (en: string, ru: string) => string): string {
  if (cycle.kind === 'completed') return t('Completed', 'Завершён');
  if (cycle.kind === 'interrupted') return t('Interrupted', 'Прерван');
  return t('Open', 'Открыт');
}

function historyLabel(quality: QualityIssueRow['historyQuality'], t: (en: string, ru: string) => string): string {
  if (quality === 'exact') return t('complete', 'полная');
  if (quality === 'partial') return t('partial', 'частичная');
  return t('no history', 'нет истории');
}

function historyTone(quality: QualityIssueRow['historyQuality']): 'neutral' | 'warning' | 'danger' {
  if (quality === 'exact') return 'neutral';
  if (quality === 'partial') return 'warning';
  return 'danger';
}

function filterLabel(filter: QualityTableFilter, t: (en: string, ru: string) => string): string {
  switch (filter) {
    case 'returns':
      return t('has returns', 'есть возвраты');
    case 'repeated':
      return t('repeated returns', 'повторные возвраты');
    case 'completed':
      return t('completed cycles', 'завершённые циклы');
    case 'open':
      return t('open cycles', 'открытые циклы');
    case 'unknown':
      return t('incomplete history', 'неполная история');
    case 'zero':
      return t('no returns', 'нет возвратов');
    case 'one':
      return t('one return', 'один возврат');
    case 'two':
      return t('two returns', 'два возврата');
    case 'threePlus':
      return t('3+ returns', '3+ возврата');
    case 'firstPass':
      return t('first pass, no return', 'первый проход без возврата');
    case 'pending':
      return t('first pass still open', 'первый проход ещё открыт');
    default:
      return t('all cohort issues', 'все задачи когорты');
  }
}

function formatStamp(value?: string): string {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}
