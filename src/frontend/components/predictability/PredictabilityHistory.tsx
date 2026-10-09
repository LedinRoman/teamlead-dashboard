import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { METRIC_HINTS } from '@backend/metrics/predictability-copy';
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
  if (rows.length === 0) {
    return <p className="caption">Нет предыдущих спринтов на досках команды.</p>;
  }
  const horizon =
    requested && used
      ? requested === used
        ? `Последние ${used} спринтов досок.`
        : `Запрошено ${requested}, на досках есть ${used}.`
      : undefined;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Спринт</th>
            <th>
              <Hint text={METRIC_HINTS.throughput}>Throughput</Hint>
            </th>
            <th>
              <Hint text={METRIC_HINTS.scopeAdded}>Scope added</Hint>
            </th>
            <th>
              <Hint text={METRIC_HINTS.scopeDrop}>Scope drop</Hint>
            </th>
            <th>
              <Hint text={METRIC_HINTS.doneTotal}>Done total</Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sprintId} className={row.current ? 'is-current' : undefined}>
              <td>
                {row.name}
                {row.current ? ' · текущий' : ''}
                {row.incomplete ? ' · неполный' : ''}
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
        {horizon} Throughput — первая Проверка в датах спринта. Done total — committed completed + added
        completed. Scope drop — снято с поля Sprint, не spillover.
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
