import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import type { FlowStageTimeModel } from '@backend/metrics/flow-stages';
import { useState } from 'react';

export function FlowStageTime({ model }: { model: FlowStageTimeModel }) {
  const [open, setOpen] = useState<string | undefined>();
  if (model.emptyMessage && model.rows.length === 0) {
    return <p className="caption">{model.emptyMessage}</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="caption">
        Считается по {model.sampleSize} задачам, у которых есть первая Проверка и changelog. Колонка n — сколько из них
        побывали на этой стадии. Время до первой проверки; повторные визиты суммируются. «К выполнению» не входит.
        Неразмеченные статусы показаны своими именами. Changelog может быть обрезан.
      </p>
      <table className="flow-aging">
        <thead>
          <tr>
            <th>Стадия</th>
            <th>Median</th>
            <th>P85</th>
            <th>n</th>
            <th>Доля</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <button type="button" className="cycle-chart-key" onClick={() => setOpen(open === row.id ? undefined : row.id)}>
                  {row.label}
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
