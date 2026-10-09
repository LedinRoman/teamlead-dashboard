import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { METRIC_HINTS } from '@backend/metrics/predictability-copy';
import type { PredictabilitySnapshot } from '@backend/metrics/predictability-model';

export function PredictabilityScopeChange({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { summary } = snapshot;
  const rows = [
    { label: 'На старте', hint: METRIC_HINTS.initial, value: formatPair(summary.initial.tasks, summary.initial.storyPoints) },
    { label: 'Добавлено', hint: METRIC_HINTS.added, value: signed(summary.added.tasks, summary.added.storyPoints) },
    { label: 'Удалено', hint: METRIC_HINTS.removed, value: signed(-summary.removed.tasks, -summary.removed.storyPoints) },
    {
      label: 'Изменение оценки',
      hint: METRIC_HINTS.estimate,
      value: summary.estimate.available
        ? `${fmtDelta(summary.estimate.increase)} / ${fmtDelta(-summary.estimate.decrease)}`
        : 'История изменения Story Points недоступна',
    },
    { label: 'Финальный scope', hint: METRIC_HINTS.final, value: formatPair(summary.final.tasks, summary.final.storyPoints) },
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>
                <Hint text={row.hint}>{row.label}</Hint>
              </th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        <Hint text={METRIC_HINTS.final}>Final scope</Hint> не заменяет initial commitment в расчёте reliability.
      </p>
    </div>
  );
}

function formatPair(tasks: number, sp: number): string {
  return `${tasks} задач · ${formatStoryPoints(sp)}`;
}

function signed(tasks: number, sp: number): string {
  const taskSign = tasks > 0 ? '+' : '';
  const spSign = sp > 0 ? '+' : '';
  return `${taskSign}${tasks} задач · ${spSign}${formatStoryPoints(sp)}`;
}

function fmtDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatStoryPoints(value)}`;
}
