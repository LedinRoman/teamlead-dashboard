import { useI18n } from '@frontend/i18n/locale';
import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { metricHints } from '@backend/metrics/predictability-copy';
import type { PredictabilitySnapshot } from '@backend/metrics/predictability-model';

export function PredictabilityScopeChange({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { t, locale } = useI18n();
  const hints = metricHints(locale);
  const { summary } = snapshot;
  const rows = [
    { key: 'initial', label: t('At the start', 'На старте'), hint: hints.initial, value: formatPair(summary.initial.tasks, summary.initial.storyPoints, t) },
    { key: 'added', label: t('Added', 'Добавлено'), hint: hints.added, value: signed(summary.added.tasks, summary.added.storyPoints, t) },
    { key: 'removed', label: t('Removed', 'Удалено'), hint: hints.removed, value: signed(-summary.removed.tasks, -summary.removed.storyPoints, t) },
    {
      key: 'estimate',
      label: t('Estimate change', 'Изменение оценки'),
      hint: hints.estimate,
      value: summary.estimate.available
        ? `${fmtDelta(summary.estimate.increase)} / ${fmtDelta(-summary.estimate.decrease)}`
        : t('Story point change history is unavailable', 'История изменения Story Points недоступна'),
    },
    { key: 'final', label: t('Final scope', 'Финальный scope'), hint: hints.final, value: formatPair(summary.final.tasks, summary.final.storyPoints, t) },
  ];
  return (
    <div className="table-wrap">
      <table className="data">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th>
                <Hint text={row.hint}>{row.label}</Hint>
              </th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption">
        <Hint text={hints.final}>{t('Final scope', 'Финальный scope')}</Hint>{' '}
        {t('does not replace the initial commitment in the reliability calculation.', 'не заменяет initial commitment в расчёте reliability.')}
      </p>
    </div>
  );
}

function formatPair(tasks: number, sp: number, t: (en: string, ru: string) => string): string {
  return t(`${tasks} issues · ${formatStoryPoints(sp)}`, `${tasks} задач · ${formatStoryPoints(sp)}`);
}

function signed(tasks: number, sp: number, t: (en: string, ru: string) => string): string {
  const taskSign = tasks > 0 ? '+' : '';
  const spSign = sp > 0 ? '+' : '';
  return t(
    `${taskSign}${tasks} issues · ${spSign}${formatStoryPoints(sp)}`,
    `${taskSign}${tasks} задач · ${spSign}${formatStoryPoints(sp)}`,
  );
}

function fmtDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatStoryPoints(value)}`;
}
