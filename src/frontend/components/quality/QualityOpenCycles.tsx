import { useI18n } from '@frontend/i18n/locale';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import { qualityHints } from '@backend/metrics/quality-copy';
import type { QualityIssueRow } from '@backend/metrics/quality-model';

export function QualityOpenCycles({
  issues,
  onSelect,
}: {
  issues: QualityIssueRow[];
  onSelect?: () => void;
}) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  const open = issues
    .filter((issue) => issue.openCycle)
    .sort((left, right) => (right.openCycle?.ageDays ?? 0) - (left.openCycle?.ageDays ?? 0));
  if (open.length === 0) {
    return <p className="caption">{t('No open rework cycles in this cohort.', 'Нет открытых rework-циклов в этой когорте.')}</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('Key', 'Ключ')}</th>
              <th>{t('Summary', 'Название')}</th>
              <th>{t('Assignee', 'Исполнитель')}</th>
              <th>{t('Return', 'Возврат')}</th>
              <th>{t('Age', 'Возраст')}</th>
              <th>{t('Status', 'Статус')}</th>
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
        {hints.openCycles}{' '}
        {onSelect && (
          <button type="button" className="text-button" onClick={onSelect}>
            {t('Show in the table', 'Показать в таблице')}
          </button>
        )}
      </p>
    </div>
  );
}
