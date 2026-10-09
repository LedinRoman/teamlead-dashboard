import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
import type { QualityIssueRow } from '@backend/metrics/quality-model';

export function QualityOpenCycles({
  issues,
  onSelect,
}: {
  issues: QualityIssueRow[];
  onSelect?: () => void;
}) {
  const open = issues
    .filter((issue) => issue.openCycle)
    .sort((left, right) => (right.openCycle?.ageDays ?? 0) - (left.openCycle?.ageDays ?? 0));
  if (open.length === 0) {
    return <p className="caption">Нет открытых rework-циклов в этой когорте.</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ключ</th>
              <th>Название</th>
              <th>Исполнитель</th>
              <th>Возврат</th>
              <th>Возраст</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {open.map((issue) => (
              <tr key={issue.key}>
                <td>
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    {issue.key}
                  </a>
                </td>
                <td>{issue.summary}</td>
                <td>{issue.assigneeName || '—'}</td>
                <td>{issue.openCycle?.startedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                <td>{issue.openCycle?.ageDays !== undefined ? formatCycleDuration(issue.openCycle.ageDays) : '—'}</td>
                <td>{issue.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">
        {QUALITY_HINTS.openCycles}{' '}
        {onSelect && (
          <button type="button" className="text-button" onClick={onSelect}>
            Показать в таблице
          </button>
        )}
      </p>
    </div>
  );
}
