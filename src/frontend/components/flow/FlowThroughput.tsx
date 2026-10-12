import { useI18n } from '@frontend/i18n/locale';
import { BarChart } from '@frontend/components/charts';
import type { FlowThroughputModel } from '@backend/metrics/flow-throughput';

export function FlowThroughput({
  model,
  filterNote,
}: {
  model: FlowThroughputModel;
  filterNote?: string;
}) {
  const { t } = useI18n();
  if (model.emptyMessage && model.points.every((point) => point.count === 0)) {
    return <p className="caption">{localizeThroughputEmpty(model.emptyMessage, t)}</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <BarChart
        data={model.points.map((point) => ({
          label: point.incomplete ? `${shortSprint(point.name)}*` : shortSprint(point.name),
          value: point.count,
          hint: t(
            `${point.name}: ${point.count} issues · ${point.storyPoints} SP${point.incomplete ? ' · incomplete sprint' : ''}`,
            `${point.name}: ${point.count} задач · ${point.storyPoints} SP${point.incomplete ? ' · неполный спринт' : ''}`,
          ),
        }))}
        xLabel={t('Sprint', 'Спринт')}
        yLabel={t('Issues', 'Задачи')}
        caption={t(
          'Unique issues with a first transition into review. * is the current incomplete sprint. Story points are only in the tooltip.',
          'Уникальные задачи с первым переходом в проверку. * — текущий неполный спринт. SP только в подсказке.',
        )}
      />
      <p className="caption">
        {t('Current', 'Текущий')}:{' '}
        {model.current
          ? t(
              `${model.current.count} issues${model.current.incomplete ? ' (incomplete)' : ''}`,
              `${model.current.count} задач${model.current.incomplete ? ' (неполный)' : ''}`,
            )
          : '—'}
        {model.median !== null ? t(` · median of closed: ${model.median}`, ` · медиана закрытых: ${model.median}`) : ''}
        {model.delta !== undefined
          ? t(
              ` · vs previous closed: ${model.delta > 0 ? '+' : ''}${model.delta}`,
              ` · к предыдущему закрытому: ${model.delta > 0 ? '+' : ''}${model.delta}`,
            )
          : ''}
        {filterNote ? ` · ${filterNote}` : ''}
      </p>
    </div>
  );
}

function localizeThroughputEmpty(message: string, t: (en: string, ru: string) => string): string {
  if (message === 'Нет спринтов для throughput.') {
    return t('No sprints for throughput.', 'Нет спринтов для throughput.');
  }
  if (message === 'В выбранном периоде нет задач, переданных на проверку') {
    return t(
      'No issues in this period have been handed to review',
      'В выбранном периоде нет задач, переданных на проверку',
    );
  }
  return message;
}

function shortSprint(name: string): string {
  return name.replace(/^Доска\s+/i, '').replace(/^Спринт\s+/i, 'S');
}
