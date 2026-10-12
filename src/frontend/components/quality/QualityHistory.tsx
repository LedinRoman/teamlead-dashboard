import { useI18n } from '@frontend/i18n/locale';
import { BarChart } from '@frontend/components/charts';
import { Hint } from '@frontend/components/ui';
import { qualityHints } from '@backend/metrics/quality-copy';
import { previousClosedQuality, type QualityHistoryRow } from '@backend/metrics/quality-model';

export function QualityHistory({
  rows,
  requested,
  used,
  currentSprintId,
}: {
  rows: QualityHistoryRow[];
  requested?: number;
  used?: number;
  currentSprintId?: number;
}) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  if (rows.length === 0) {
    return <p className="caption">{t('No earlier sprints on the team boards.', 'Нет предыдущих спринтов на досках команды.')}</p>;
  }
  const previous = currentSprintId ? previousClosedQuality(rows, currentSprintId) : undefined;
  const current = rows.find((row) => row.current);
  const nData = rows.map((row) => ({
    label: row.incomplete ? `${shortSprint(row.name)}*` : shortSprint(row.name),
    value: row.n,
    hint: t(
      `${row.name}: N=${row.n} · R=${row.r}${row.incomplete ? ' · incomplete' : ''}`,
      `${row.name}: N=${row.n} · R=${row.r}${row.incomplete ? ' · неполный' : ''}`,
    ),
  }));
  const rateData = rows
    .filter((row) => row.rate !== null)
    .map((row) => ({
      label: row.incomplete ? `${shortSprint(row.name)}*` : shortSprint(row.name),
      value: Math.round((row.rate ?? 0) * 100),
      hint: t(
        `${row.name}: ${formatRate(row.rate, t)}${row.incomplete ? ' · incomplete, not a total' : ''}`,
        `${row.name}: ${formatRate(row.rate, t)}${row.incomplete ? ' · неполный, не итог' : ''}`,
      ),
    }));
  const fpyData = rows
    .filter((row) => row.fpy !== null)
    .map((row) => ({
      label: row.incomplete ? `${shortSprint(row.name)}*` : shortSprint(row.name),
      value: Math.round((row.fpy ?? 0) * 100),
      hint: t(
        `${row.name}: FPY ${formatRate(row.fpy, t)}${row.incomplete ? ' · incomplete, not a total' : ''}`,
        `${row.name}: FPY ${formatRate(row.fpy, t)}${row.incomplete ? ' · неполный, не итог' : ''}`,
      ),
    }));
  const horizon =
    requested && used
      ? requested === used
        ? t(`Last ${used} sprints.`, `Последние ${used} спринтов.`)
        : t(`Requested ${requested}, the boards have ${used}.`, `Запрошено ${requested}, на досках есть ${used}.`)
      : undefined;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <BarChart
        data={nData}
        xLabel={t('Sprint', 'Спринт')}
        yLabel="N"
        caption={t(
          'Size of the First QA cohort. * is the active sprint, not final.',
          'Размер когорты First QA. * — активный, не финальный.',
        )}
      />
      {rateData.length > 0 && (
        <BarChart
          data={rateData}
          xLabel={t('Sprint', 'Спринт')}
          yLabel="Rate %"
          tone="warning"
          caption={t(
            'Return Rate of each sprint on its own. Sprints without an exact Rate are left off the chart.',
            'Return Rate каждого спринта отдельно. Спринты без точного Rate на график не попадают.',
          )}
          formatY={(value) => `${Math.round(value)}%`}
        />
      )}
      {fpyData.length > 0 && (
        <BarChart
          data={fpyData}
          xLabel={t('Sprint', 'Спринт')}
          yLabel="FPY %"
          caption={t(
            'First Pass Yield of each sprint. Not the “0 returns” bucket.',
            'First Pass Yield каждого спринта. Не корзина «0 возвратов».',
          )}
          formatY={(value) => `${Math.round(value)}%`}
        />
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('Sprint', 'Спринт')}</th>
              <th className="num">
                <Hint text={hints.firstQa}>N</Hint>
              </th>
              <th className="num">R</th>
              <th className="num">
                <Hint text={hints.rate}>{t('Return Rate', 'Return Rate')}</Hint>
              </th>
              <th className="num">
                <Hint text={hints.fpy}>FPY</Hint>
              </th>
              <th className="num">Loops</th>
              <th className="num">R₂</th>
              <th className="num">Prod</th>
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
                <td className="num">{row.n}</td>
                <td className="num">{row.r}</td>
                <td className="num">{formatRate(row.rate, t)}</td>
                <td className="num">{formatRate(row.fpy, t)}</td>
                <td className="num">{row.loops}</td>
                <td className="num">{row.r2}</td>
                <td className="num">{row.production + row.incidents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        {horizon} {hints.history}
        {current && previous
          ? t(
              ` Versus the previous closed sprint (${previous.name}): Rate ${formatRate(current.rate, t)} vs ${formatRate(previous.rate, t)}; FPY ${formatRate(current.fpy, t)} vs ${formatRate(previous.fpy, t)}.`,
              ` К предыдущему закрытому (${previous.name}): Rate ${formatRate(current.rate, t)} vs ${formatRate(previous.rate, t)}; FPY ${formatRate(current.fpy, t)} vs ${formatRate(previous.fpy, t)}.`,
            )
          : ''}
      </p>
    </div>
  );
}

function formatRate(rate: number | null, t: (en: string, ru: string) => string): string {
  if (rate === null) return t('No data', 'Нет данных');
  return `${Math.round(rate * 100)}%`;
}

function shortSprint(name: string): string {
  return name.replace(/^Доска\s+/i, '').replace(/^Спринт\s+/i, 'S');
}
