import { useI18n } from '@frontend/i18n/locale';
import { Hint } from '@frontend/components/ui';
import { SegmentBar } from '@frontend/components/charts';
import { qualityHints } from '@backend/metrics/quality-copy';
import type { QualityReasonBucket } from '@backend/metrics/quality-model';

export function QualityReasons({ buckets }: { buckets: QualityReasonBucket[] }) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  if (buckets.length === 0) {
    return (
      <p className="caption">
        {t(
          'This cohort has no QA → Fix returns, so there are no reasons either.',
          'В этой когорте нет возвратов QA→Fix, поэтому причин тоже нет.',
        )}
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <SegmentBar
        caption={t(
          'What was on the changelog at the QA → Fix moment. Not a defect taxonomy.',
          'Что лежало в changelog в момент QA→Fix. Не классификация дефектов.',
        )}
        segments={buckets.map((bucket) => ({
          id: bucket.key,
          label: reasonLabel(bucket.label, t),
          value: bucket.count,
          tone: bucket.kind === 'none' ? 'warning' : 'neutral',
          title: `${reasonLabel(bucket.label, t)}: ${bucket.count}`,
        }))}
      />
      <ul className="plain">
        {buckets.map((bucket) => (
          <li key={bucket.key}>
            {reasonLabel(bucket.label, t)}: {bucket.count}
          </li>
        ))}
      </ul>
      <p className="caption">
        <Hint text={hints.reasons}>{hints.reasons}</Hint>
      </p>
    </div>
  );
}

function reasonLabel(label: string, t: (en: string, ru: string) => string): string {
  if (label === 'Не записана') return t('Not recorded', 'Не записана');
  if (label === 'Комментарий') return t('Comment', 'Комментарий');
  if (label === 'Метка') return t('Label', 'Метка');
  if (label.startsWith('Метка: ')) return t(`Label: ${label.slice('Метка: '.length)}`, label);
  return label;
}
