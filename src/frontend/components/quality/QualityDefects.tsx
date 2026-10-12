import { useI18n } from '@frontend/i18n/locale';
import { qualityHints } from '@backend/metrics/quality-copy';
import type { QualityDefects } from '@backend/metrics/quality-defects';

export function QualityDefectsPanel({ defects }: { defects: QualityDefects }) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  const proven = defects.items.filter((item) => item.kind === 'production' || item.kind === 'incident');
  const unproven = defects.items.filter((item) => item.kind === 'unproven');
  if (defects.created === 0) {
    return (
      <p className="caption">
        {t(
          'No bugs or incidents outside the First QA cohort were created in the sprint window.',
          'В окне спринта нет багов или инцидентов вне когорты First QA.',
        )}
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="caption">
        {t(
          `${defects.production + defects.incidents} with a production/incident signal · ${defects.unproven} without a signal.`,
          `${defects.production + defects.incidents} с признаком production/инцидент · ${defects.unproven} без признака.`,
        )}{' '}
        {hints.defects}
      </p>
      {proven.length > 0 && (
        <DefectTable title={t('Production / incidents', 'Production / инциденты')} items={proven} />
      )}
      {unproven.length > 0 && (
        <DefectTable
          title={t('Created in the window, production signal not proven', 'Созданы в окне, признак production не доказан')}
          items={unproven}
        />
      )}
    </div>
  );
}

function defectReason(reason: string, t: (en: string, ru: string) => string): string {
  if (reason === 'Уже в когорте First QA — находка на проверке, не production.') {
    return t('Already in the First QA cohort — a review finding, not production.', reason);
  }
  if (reason === 'Тип Incident.') return t('Type is Incident.', reason);
  if (reason === 'Метка production / hotfix / инцидент.') {
    return t('Label: production / hotfix / incident.', reason);
  }
  const afterDone = /^Создан после Готово у (.+)\.$/.exec(reason);
  if (afterDone) return t(`Created after ${afterDone[1]} reached Done.`, reason);
  if (reason === 'Создан в окне спринта, но нет признака production.') {
    return t('Created in the sprint window, but there is no production signal.', reason);
  }
  return reason;
}

function DefectTable({
  title,
  items,
}: {
  title: string;
  items: QualityDefects['items'];
}) {
  const { t } = useI18n();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="caption">{title}</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('Key', 'Ключ')}</th>
              <th>{t('Summary', 'Название')}</th>
              <th>{t('Type', 'Тип')}</th>
              <th>{t('Created', 'Создан')}</th>
              <th>{t('Signal', 'Признак')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.key}
                  </a>
                </td>
                <td>{item.summary}</td>
                <td>{item.type}</td>
                <td>{item.created.slice(0, 10)}</td>
                <td>{defectReason(item.reason, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
