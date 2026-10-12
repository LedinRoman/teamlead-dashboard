import { useMemo, useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { Hint, Pill } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import {
  categoryHints,
  metricHints,
  PREDICTABILITY_TABLE_CATEGORIES,
} from '@backend/metrics/predictability-copy';
import type {
  PredictabilityCategory,
  PredictabilityTask,
} from '@backend/metrics/predictability-model';

const LABELS: Record<PredictabilityCategory, [string, string]> = {
  'committed-completed': ['Committed completed', 'Commitment выполнен'],
  spillover: ['Spillover', 'Перенос'],
  'still-unfinished': ['Still unfinished', 'Ещё не завершено'],
  removed: ['Removed', 'Снято'],
  cancelled: ['Cancelled', 'Отменено'],
  'added-completed': ['Added completed', 'Добавлено и выполнено'],
  'added-unfinished': ['Added unfinished', 'Добавлено, не завершено'],
  'already-done': ['Done before start', 'Завершено до старта'],
  excluded: ['Excluded', 'Исключено'],
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
  const { t, locale } = useI18n();
  const hints = metricHints(locale);
  const categories = categoryHints(locale);
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
        <label className="cycle-filter">
          <span className="caption">{t('Estimate', 'Оценка')}</span>
          <select
            className="cycle-def-select"
            value={estimate}
            onChange={(event) => setEstimate(event.target.value as typeof estimate)}
          >
            <option value="all">{t('All', 'Все')}</option>
            <option value="estimated">{t('Estimated', 'С оценкой')}</option>
            <option value="unestimated">{t('No SP', 'Без SP')}</option>
          </select>
        </label>
        <label className="cycle-filter">
          <span className="caption">{t('Carry-overs ≥', 'Переносы ≥')}</span>
          <select
            className="cycle-def-select"
            value={minSpillovers}
            onChange={(event) => setMinSpillovers(Number(event.target.value))}
          >
            <option value={0}>{t('Any', 'Любое')}</option>
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
          {t('estimate changed', 'оценка менялась')}
        </label>
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
                <th className="num">
                  <Hint text={hints.spBaseline}>{t('SP baseline', 'SP baseline')}</Hint>
                </th>
                <th className="num">
                  <Hint text={hints.spNow}>{t('SP now', 'SP сейчас')}</Hint>
                </th>
                <th>
                  <Hint
                    text={t(
                      'Category by sprint membership: at the start, added, or removed. Epics and issues done before the start are hidden.',
                      'Категория по членству в спринте: на старте, добавлена или снята. Эпики и задачи, завершённые до старта, скрыты.',
                    )}
                  >
                    {t('Category', 'Категория')}
                  </Hint>
                </th>
                <th>
                  <Hint text={hints.created}>{t('Created', 'Создана')}</Hint>
                </th>
                <th>{t('Added', 'Добавлена')}</th>
                <th>{t('Removed', 'Снята')}</th>
                <th>
                  <Hint
                    text={t(
                      'First transition into review. That is the completion moment for predictability, not the Done status.',
                      'Первый переход в проверку. Для predictability это момент выполнения, а не статус Готово.',
                    )}
                  >
                    {t('Review', 'Проверка')}
                  </Hint>
                </th>
                <th>{t('Status', 'Статус')}</th>
                <th className="num">
                  <Hint text={hints.spillovers}>{t('Carry-overs', 'Переносы')}</Hint>
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
                    <Pill tone={pillTone(task.category)} title={originHint(task, categories, t)}>
                      {t(LABELS[task.category][0], LABELS[task.category][1])}
                    </Pill>
                  </td>
                  <td title={originHint(task, categories, t)}>{day(task.created)}</td>
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

function originHint(
  task: PredictabilityTask,
  categories: Record<PredictabilityCategory, string>,
  t: (en: string, ru: string) => string,
): string {
  const category = categories[task.category];
  if (task.category === 'removed' || task.category.startsWith('added')) return category;
  if (task.createdInSprint) {
    return `${category} ${t('Created during this sprint.', 'Создана в этом спринте.')}`;
  }
  return `${category} ${t('Older key carried in: it was already in this sprint at the start.', 'Старый ключ — перенос: задача уже была в этом спринте на старте.')}`;
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
