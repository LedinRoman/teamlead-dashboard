import { BarChart } from '@frontend/components/charts';
import type { FlowThroughputModel } from '@backend/metrics/flow-throughput';

export function FlowThroughput({
  model,
  filterNote,
}: {
  model: FlowThroughputModel;
  filterNote?: string;
}) {
  if (model.emptyMessage && model.points.every((point) => point.count === 0)) {
    return <p className="caption">{model.emptyMessage}</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <BarChart
        data={model.points.map((point) => ({
          label: point.incomplete ? `${shortSprint(point.name)}*` : shortSprint(point.name),
          value: point.count,
          hint: `${point.name}: ${point.count} задач · ${point.storyPoints} SP${point.incomplete ? ' · неполный спринт' : ''}`,
        }))}
        xLabel="Спринт"
        yLabel="Задачи"
        caption="Уникальные задачи с первым переходом в проверку. * — текущий неполный спринт. SP только в подсказке."
      />
      <p className="caption">
        Текущий: {model.current ? `${model.current.count} задач${model.current.incomplete ? ' (неполный)' : ''}` : '—'}
        {model.median !== null ? ` · медиана закрытых: ${model.median}` : ''}
        {model.delta !== undefined ? ` · к предыдущему закрытому: ${model.delta > 0 ? '+' : ''}${model.delta}` : ''}
        {filterNote ? ` · ${filterNote}` : ''}
      </p>
    </div>
  );
}

function shortSprint(name: string): string {
  return name.replace(/^Доска\s+/i, '').replace(/^Спринт\s+/i, 'S');
}
