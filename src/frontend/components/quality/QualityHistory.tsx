import { BarChart } from '@frontend/components/charts';
import { Hint } from '@frontend/components/ui';
import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
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
  if (rows.length === 0) {
    return <p className="caption">Нет предыдущих спринтов на досках команды.</p>;
  }
  const previous = currentSprintId ? previousClosedQuality(rows, currentSprintId) : undefined;
  const current = rows.find((row) => row.current);
  const nData = rows.map((row) => ({
    label: row.incomplete ? `${shortSprint(row.name)}*` : shortSprint(row.name),
    value: row.n,
    hint: `${row.name}: N=${row.n} · R=${row.r}${row.incomplete ? ' · неполный' : ''}`,
  }));
  const rateData = rows
    .filter((row) => row.rate !== null)
    .map((row) => ({
      label: row.incomplete ? `${shortSprint(row.name)}*` : shortSprint(row.name),
      value: Math.round((row.rate ?? 0) * 100),
      hint: `${row.name}: ${formatRate(row.rate)}${row.incomplete ? ' · неполный, не итог' : ''}`,
    }));
  const fpyData = rows
    .filter((row) => row.fpy !== null)
    .map((row) => ({
      label: row.incomplete ? `${shortSprint(row.name)}*` : shortSprint(row.name),
      value: Math.round((row.fpy ?? 0) * 100),
      hint: `${row.name}: FPY ${formatRate(row.fpy)}${row.incomplete ? ' · неполный, не итог' : ''}`,
    }));
  const horizon =
    requested && used
      ? requested === used
        ? `Последние ${used} спринтов.`
        : `Запрошено ${requested}, на досках есть ${used}.`
      : undefined;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <BarChart data={nData} xLabel="Спринт" yLabel="N" caption="Размер когорты First QA. * — активный, не финальный." />
      {rateData.length > 0 && (
        <BarChart
          data={rateData}
          xLabel="Спринт"
          yLabel="Rate %"
          tone="warning"
          caption="Return Rate каждого спринта отдельно. Спринты без точного Rate на график не попадают."
          formatY={(value) => `${Math.round(value)}%`}
        />
      )}
      {fpyData.length > 0 && (
        <BarChart
          data={fpyData}
          xLabel="Спринт"
          yLabel="FPY %"
          caption="First Pass Yield каждого спринта. Не корзина «0 возвратов»."
          formatY={(value) => `${Math.round(value)}%`}
        />
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Спринт</th>
              <th className="num">
                <Hint text={QUALITY_HINTS.firstQa}>N</Hint>
              </th>
              <th className="num">R</th>
              <th className="num">
                <Hint text={QUALITY_HINTS.rate}>Return Rate</Hint>
              </th>
              <th className="num">
                <Hint text={QUALITY_HINTS.fpy}>FPY</Hint>
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
                  {row.current ? ' · текущий' : ''}
                  {row.incomplete ? ' · неполный' : ''}
                </td>
                <td className="num">{row.n}</td>
                <td className="num">{row.r}</td>
                <td className="num">{formatRate(row.rate)}</td>
                <td className="num">{formatRate(row.fpy)}</td>
                <td className="num">{row.loops}</td>
                <td className="num">{row.r2}</td>
                <td className="num">{row.production + row.incidents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        {horizon} {QUALITY_HINTS.history}
        {current && previous
          ? ` К предыдущему закрытому (${previous.name}): Rate ${formatRate(current.rate)} vs ${formatRate(previous.rate)}; FPY ${formatRate(current.fpy)} vs ${formatRate(previous.fpy)}.`
          : ''}
      </p>
    </div>
  );
}

function formatRate(rate: number | null): string {
  if (rate === null) return 'Нет данных';
  return `${Math.round(rate * 100)}%`;
}

function shortSprint(name: string): string {
  return name.replace(/^Доска\s+/i, '').replace(/^Спринт\s+/i, 'S');
}
