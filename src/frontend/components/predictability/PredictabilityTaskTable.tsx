import { useMemo, useState } from 'react';

import { Hint, Pill } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import {
  CATEGORY_HINTS,
  METRIC_HINTS,
  PREDICTABILITY_TABLE_CATEGORIES,
} from '@backend/metrics/predictability-copy';
import type {
  PredictabilityCategory,
  PredictabilityTask,
} from '@backend/metrics/predictability-model';

const LABELS: Record<PredictabilityCategory, string> = {
  'committed-completed': 'Committed completed',
  spillover: 'Spillover',
  'still-unfinished': 'Still unfinished',
  removed: 'Removed',
  cancelled: 'Cancelled',
  'added-completed': 'Added completed',
  'added-unfinished': 'Added unfinished',
  'already-done': 'Завершена до старта',
  excluded: 'Excluded',
};

const MEMBERSHIP = new Set<PredictabilityCategory>(PREDICTABILITY_TABLE_CATEGORIES);

export function PredictabilityTaskTable({
  tasks,
  category,
  assigneeIds,
}: {
  tasks: PredictabilityTask[];
  category?: PredictabilityCategory;
  assigneeIds: string[];
}) {
  const membership = useMemo(
    () => tasks.filter((task) => MEMBERSHIP.has(task.category)),
    [tasks],
  );
  const types = useMemo(
    () => [...new Set(membership.map((task) => task.type))].sort((a, b) => a.localeCompare(b, 'ru')),
    [membership],
  );
  const [type, setType] = useState('');
  const [estimate, setEstimate] = useState<'all' | 'estimated' | 'unestimated'>('all');
  const [minSpillovers, setMinSpillovers] = useState(0);
  const [estimateChanged, setEstimateChanged] = useState(false);

  const rows = membership.filter((task) => {
    if (category && task.category !== category) return false;
    if (type && task.type !== type) return false;
    if (estimate === 'estimated' && task.unestimated) return false;
    if (estimate === 'unestimated' && !task.unestimated) return false;
    if (minSpillovers > 0 && task.spilloverCount < minSpillovers) return false;
    if (estimateChanged && !task.estimateDelta) return false;
    if (assigneeIds.length > 0) {
      const id = task.assigneeId || 'unassigned';
      if (!assigneeIds.includes(id)) return false;
    }
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
        <label className="cycle-filter">
          <span className="caption">Оценка</span>
          <select
            className="cycle-def-select"
            value={estimate}
            onChange={(event) => setEstimate(event.target.value as typeof estimate)}
          >
            <option value="all">Все</option>
            <option value="estimated">Оценены</option>
            <option value="unestimated">Без SP</option>
          </select>
        </label>
        <label className="cycle-filter">
          <span className="caption">Переносы ≥</span>
          <select
            className="cycle-def-select"
            value={minSpillovers}
            onChange={(event) => setMinSpillovers(Number(event.target.value))}
          >
            <option value={0}>Любые</option>
            <option value={1}>1</option>
            <option value={2}>2+</option>
          </select>
        </label>
        <label className="caption">
          <input
            type="checkbox"
            checked={estimateChanged}
            onChange={(event) => setEstimateChanged(event.target.checked)}
          />{' '}
          оценка менялась
        </label>
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
                <th className="num">
                  <Hint text={METRIC_HINTS.spBaseline}>SP baseline</Hint>
                </th>
                <th className="num">
                  <Hint text={METRIC_HINTS.spNow}>SP сейчас</Hint>
                </th>
                <th>
                  <Hint text="Категория по членству в спринте: на старте / добавлена / снята. Эпики и завершённые до старта скрыты.">
                    Категория
                  </Hint>
                </th>
                <th>
                  <Hint text={METRIC_HINTS.created}>Создана</Hint>
                </th>
                <th>Добавлена</th>
                <th>Удалена</th>
                <th>
                  <Hint text="Первый переход в Проверку. Это момент выполнения для Predictability, не статус Готово.">
                    Проверка
                  </Hint>
                </th>
                <th>Статус</th>
                <th className="num">
                  <Hint text={METRIC_HINTS.spillovers}>Переносы</Hint>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => (
                <tr key={task.key}>
                  <td>
                    <a href={task.url} target="_blank" rel="noreferrer">
                      {task.key}
                    </a>
                  </td>
                  <td>{task.summary}</td>
                  <td>{task.type}</td>
                  <td className="num">{task.unestimated ? '—' : formatStoryPoints(task.baselineStoryPoints ?? 0)}</td>
                  <td className="num">
                    {task.currentStoryPoints === undefined ? '—' : formatStoryPoints(task.currentStoryPoints)}
                  </td>
                  <td>
                    <Pill tone={pillTone(task.category)} title={originHint(task)}>
                      {LABELS[task.category]}
                    </Pill>
                  </td>
                  <td title={originHint(task)}>{day(task.created)}</td>
                  <td>{day(task.addedAt)}</td>
                  <td>{day(task.removedAt)}</td>
                  <td>{day(task.doneAt)}</td>
                  <td>{task.status}</td>
                  <td className="num">{task.spilloverCount || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function originHint(task: PredictabilityTask): string {
  const category = CATEGORY_HINTS[task.category];
  if (task.category === 'removed' || task.category.startsWith('added')) return category;
  if (task.createdInSprint) return `${category} Создана уже во время этого спринта.`;
  return `${category} Старый ключ — carry-over: задача была в этом спринте на старте.`;
}

function day(iso?: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

function pillTone(category: PredictabilityCategory): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (category === 'committed-completed' || category === 'added-completed') return 'success';
  if (category === 'spillover' || category === 'still-unfinished') return 'warning';
  if (category === 'removed' || category === 'cancelled') return 'danger';
  if (category === 'added-unfinished') return 'info';
  return 'neutral';
}
