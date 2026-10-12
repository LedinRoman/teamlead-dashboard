import { useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import type { FlowStageTimeModel } from '@backend/metrics/flow-stages';
import { uiLabel } from '@shared/locale';

export function FlowStageTime({ model }: { model: FlowStageTimeModel }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | undefined>();
  if (model.emptyMessage && model.rows.length === 0) {
    return <p className="caption">{localizeStageEmpty(model.emptyMessage, t)}</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="caption">
        {t(
          `Counted across ${model.sampleSize} issues that have a first review and a changelog. Column n is how many of them visited this stage. Time runs until the first review; repeat visits are summed. To do is excluded. Unmapped statuses keep their own names. The changelog may be truncated.`,
          `Считается по ${model.sampleSize} задачам, у которых есть первая Проверка и changelog. Колонка n — сколько из них побывали на этой стадии. Время до первой проверки; повторные визиты суммируются. «К выполнению» не входит. Неразмеченные статусы показаны своими именами. Changelog может быть обрезан.`,
        )}
      </p>
      <table className="flow-aging">
        <thead>
          <tr>
            <th>{t('Stage', 'Стадия')}</th>
            <th>Median</th>
            <th>P85</th>
            <th>n</th>
            <th>{t('Share', 'Доля')}</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <button type="button" className="cycle-chart-key" onClick={() => setOpen(open === row.id ? undefined : row.id)}>
                  {uiLabel(row.label)}
                </button>
              </td>
              <td>{row.median === null ? '—' : formatCycleDuration(row.median)}</td>
              <td>{row.p85 === null ? '—' : formatCycleDuration(row.p85)}</td>
              <td>{row.n}</td>
              <td>{row.share === null ? '—' : `${row.share}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <ul className="oldest-wip-list">
          {(model.issuesByStage[open] ?? []).map((item) => (
            <li key={item.key}>
              <a className="cycle-chart-key" href={item.url} target="_blank" rel="noreferrer">
                {item.key}
              </a>{' '}
              {formatCycleDuration(item.days)} · {item.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function localizeStageEmpty(message: string, t: (en: string, ru: string) => string): string {
  if (message === 'Недостаточно данных для расчёта времени по этапам') {
    return t('Not enough data to calculate time by stage', 'Недостаточно данных для расчёта времени по этапам');
  }
  return message;
}
