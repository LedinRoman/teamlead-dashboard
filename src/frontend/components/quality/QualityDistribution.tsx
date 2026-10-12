import { useI18n } from '@frontend/i18n/locale';
import { SegmentBar } from '@frontend/components/charts';
import { qualityHints } from '@backend/metrics/quality-copy';
import type { QualitySnapshot } from '@backend/metrics/quality-model';
import type { QualityTableFilter } from './QualityTaskTable';

const SEGMENTS: Array<{ id: QualityTableFilter; label: string; color: string }> = [
  { id: 'zero', label: '0', color: 'var(--success)' },
  { id: 'one', label: '1', color: 'var(--warning)' },
  { id: 'two', label: '2', color: 'var(--caution)' },
  { id: 'threePlus', label: '3+', color: 'var(--danger)' },
  { id: 'unknown', label: 'Unknown', color: 'var(--text-faint)' },
];

export function QualityDistribution({
  snapshot,
  filter,
  onFilter,
}: {
  snapshot: QualitySnapshot;
  filter: QualityTableFilter;
  onFilter: (filter: QualityTableFilter) => void;
}) {
  const { t, locale } = useI18n();
  const hints = qualityHints(locale);
  const { distribution } = snapshot;
  const values: Record<string, number> = {
    zero: distribution.zero,
    one: distribution.one,
    two: distribution.two,
    threePlus: distribution.threePlus,
    unknown: distribution.unknown,
  };
  return (
    <SegmentBar
      selected={filter}
      onSelect={(id) => onFilter(id as QualityTableFilter)}
      caption={t(
        'Click a segment to filter the table. 0 means no return was observed.',
        'Клик по сегменту фильтрует таблицу. 0 — возврат ещё не наблюдался.',
      )}
      segments={SEGMENTS.map((segment) => ({
        id: segment.id,
        label: segment.id === 'unknown' ? t('Unknown', 'Неизвестно') : segment.label,
        color: segment.color,
        value: values[segment.id] ?? 0,
        title:
          segment.id === 'zero'
            ? t('No returns observed yet.', 'Возвратов пока не было.')
            : segment.id === 'unknown'
              ? hints.distribution
              : t(`${segment.label} return(s)`, `${segment.label} возврат(ов)`),
      }))}
    />
  );
}
