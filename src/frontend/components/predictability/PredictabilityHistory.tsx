import { useI18n } from '@frontend/i18n/locale';
import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { metricHints } from '@backend/metrics/predictability-copy';
import type { PredictabilityHistoryRow } from '@backend/metrics/predictability-model';

export function PredictabilityHistory({
  rows,
  unit,
  requested,
  used,
}: {
  rows: PredictabilityHistoryRow[];
  unit: 'tasks' | 'sp';
  requested?: number;
  used?: number;
}) {
  const { t, locale } = useI18n();
  const hints = metricHints(locale);
  if (rows.length === 0) {
    return <p className="caption">{t('No earlier sprints on the team boards.', 'Нет предыдущих спринтов на досках команды.')}</p>;
  }
  const horizon =
    requested && used
      ? requested === used
        ? t(`Last ${used} board sprints.`, `Последние ${used} спринтов досок.`)
        : t(`Requested ${requested}, the boards have ${used}.`, `Запрошено ${requested}, на досках есть ${used}.`)
      : undefined;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('Sprint', 'Спринт')}</th>
            <th>
              <Hint text={hints.throughput}>{t('Throughput', 'Throughput')}</Hint>
            </th>
            <th>
              <Hint text={hints.scopeAdded}>{t('Scope added', 'Добавленный scope')}</Hint>
            </th>
            <th>
              <Hint text={hints.scopeDrop}>{t('Scope drop', 'Снятый scope')}</Hint>
            </th>
            <th>
              <Hint text={hints.doneTotal}>{t('Done total', 'Всего завершено')}</Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sprintId} className={row.current ? 'is-current' : undefined}>
              <td>
                {row.name}
                {row.current ? t(' · current', ' · текущий') : ''}
                {row.incomplete ? t(' · incomplete', ' · неполный') : ''}
              </td>
              <td>{cell(row.throughputTasks, row.throughputSp, unit)}</td>
              <td>{cell(row.addedTasks, row.addedSp, unit, true)}</td>
              <td>{cell(row.dropTasks, row.dropSp, unit)}</td>
              <td>{cell(row.doneTasks, row.doneSp, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        {horizon}{' '}
        {t(
          'Throughput is the first review inside the sprint dates. Done total is committed completed plus added completed. Scope drop is removed from the Sprint field, not spillover.',
          'Throughput — первая Проверка в датах спринта. Done total — committed completed + added completed. Scope drop — снято с поля Sprint, не spillover.',
        )}
      </p>
    </div>
  );
}

function cell(tasks: number, sp: number, unit: 'tasks' | 'sp', signed = false): string {
  if (unit === 'sp') {
    const value = formatStoryPoints(sp);
    if (!signed || sp === 0) return value;
    return sp > 0 ? `+${value}` : value;
  }
  if (!signed || tasks === 0) return String(tasks);
  return tasks > 0 ? `+${tasks}` : String(tasks);
}
