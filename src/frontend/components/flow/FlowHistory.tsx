import { LineChart } from '@frontend/components/charts';
import type { FlowHistoryModel } from '@backend/metrics/flow-history';

export function FlowHistory({ model }: { model: FlowHistoryModel }) {
  if (!model.available) {
    return <p className="caption">{model.reason ?? 'Исторический WIP недоступен для имеющихся данных'}</p>;
  }
  return (
    <LineChart
      data={model.points.map((point) => ({
        label: point.day.slice(5),
        value: point.developmentWip,
        hint: `${point.day}: ${point.developmentWip} задач в Development WIP`,
      }))}
      xLabel="Дата"
      yLabel="Задачи"
      formatY={(value) => String(Math.round(value))}
      caption={
        model.reason
          ? `${model.reason} Ось Y — число задач в Development WIP на конец дня.`
          : 'Ось Y — число задач в Development WIP на конец дня.'
      }
    />
  );
}
