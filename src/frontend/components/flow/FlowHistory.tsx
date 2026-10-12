import { useI18n } from '@frontend/i18n/locale';
import { LineChart } from '@frontend/components/charts';
import type { FlowHistoryModel } from '@backend/metrics/flow-history';

export function FlowHistory({ model }: { model: FlowHistoryModel }) {
  const { t } = useI18n();
  if (!model.available) {
    return (
      <p className="caption">
        {localizeHistoryReason(model.reason, t) ??
          t('Historical WIP is unavailable for the available data', 'Исторический WIP недоступен для имеющихся данных')}
      </p>
    );
  }
  const axis = t(
    'The Y axis is how many issues were in Development WIP at the end of the day.',
    'Ось Y — число задач в Development WIP на конец дня.',
  );
  const reason = model.reason ? localizeHistoryReason(model.reason, t) : undefined;
  return (
    <LineChart
      data={model.points.map((point) => ({
        label: point.day.slice(5),
        value: point.developmentWip,
        hint: t(
          `${point.day}: ${point.developmentWip} issues in Development WIP`,
          `${point.day}: ${point.developmentWip} задач в Development WIP`,
        ),
      }))}
      xLabel={t('Date', 'Дата')}
      yLabel={t('Issues', 'Задачи')}
      formatY={(value) => String(Math.round(value))}
      caption={reason ? `${reason} ${axis}` : axis}
    />
  );
}

function localizeHistoryReason(reason: string | undefined, t: (en: string, ru: string) => string): string | undefined {
  if (!reason) return undefined;
  if (reason === 'Исторический WIP недоступен для имеющихся данных') {
    return t('Historical WIP is unavailable for the available data', 'Исторический WIP недоступен для имеющихся данных');
  }
  if (reason === 'Исторический WIP недоступен: у слишком многих задач нет полной истории статусов.') {
    return t(
      'Historical WIP is unavailable: too many issues lack a full status history.',
      'Исторический WIP недоступен: у слишком многих задач нет полной истории статусов.',
    );
  }
  if (reason === 'Восстановлено по changelog выбранных задач. История Jira может быть обрезана (~100 событий). CFD не строится.') {
    return t(
      'Rebuilt from the changelog of the selected issues. Jira history may be truncated (~100 events). A CFD is not built.',
      'Восстановлено по changelog выбранных задач. История Jira может быть обрезана (~100 событий). CFD не строится.',
    );
  }
  return reason;
}
