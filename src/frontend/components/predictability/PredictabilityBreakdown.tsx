import { useI18n } from '@frontend/i18n/locale';
import { SegmentBar } from '@frontend/components/charts';
import { Hint, type Tone } from '@frontend/components/ui';
import { categoryHints, metricHints } from '@backend/metrics/predictability-copy';
import type { PredictabilityCategory, PredictabilitySnapshot } from '@backend/metrics/predictability-model';

const COMMITTED_ORDER: PredictabilityCategory[] = [
  'committed-completed',
  'spillover',
  'still-unfinished',
  'removed',
  'cancelled',
];
const ADDED_ORDER: PredictabilityCategory[] = ['added-completed', 'added-unfinished'];

const LABELS: Record<PredictabilityCategory, [string, string]> = {
  'committed-completed': ['Done', 'Завершено'],
  spillover: ['Spillover', 'Перенос'],
  'still-unfinished': ['Still open', 'Ещё открыто'],
  removed: ['Removed', 'Снято'],
  cancelled: ['Cancelled', 'Отменено'],
  'added-completed': ['Done', 'Завершено'],
  'added-unfinished': ['Not done', 'Не завершено'],
  'already-done': ['Before start', 'До старта'],
  excluded: ['Excluded', 'Исключено'],
};

const TONES: Partial<Record<PredictabilityCategory, Tone>> = {
  'committed-completed': 'success',
  'added-completed': 'success',
  spillover: 'warning',
  'still-unfinished': 'warning',
  removed: 'danger',
  cancelled: 'danger',
  'added-unfinished': 'info',
};

export function PredictabilityBreakdown({
  snapshot,
  unit,
  selected,
  onSelect,
}: {
  snapshot: PredictabilitySnapshot;
  unit: 'tasks' | 'sp';
  selected?: PredictabilityCategory;
  onSelect: (category: PredictabilityCategory | undefined) => void;
}) {
  const { t, locale } = useI18n();
  const hints = metricHints(locale);
  const categories = categoryHints(locale);
  const toggle = (id: string) => {
    const category = id as PredictabilityCategory;
    onSelect(selected === category ? undefined : category);
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="caption">
          <Hint text={hints.initial}>{t('Original plan', 'Исходный план')}</Hint>
        </div>
        <SegmentBar
          caption={t('Committed scope at the end of the sprint', 'Committed scope к концу спринта')}
          selected={selected}
          onSelect={toggle}
          segments={COMMITTED_ORDER.map((category) => {
            const row = snapshot.breakdown.committed.find((item) => item.category === category);
            return {
              id: category,
              label: t(LABELS[category][0], LABELS[category][1]),
              value: unit === 'sp' ? (row?.storyPoints ?? 0) : (row?.tasks ?? 0),
              tone: TONES[category],
              title: categories[category],
            };
          })}
        />
      </div>
      <div>
        <div className="caption">
          <Hint text={hints.added}>{t('Added after the start', 'Добавлено после старта')}</Hint>
        </div>
        <SegmentBar
          caption={t('Added scope at the end of the sprint', 'Добавленный scope к концу спринта')}
          selected={selected}
          onSelect={toggle}
          segments={ADDED_ORDER.map((category) => {
            const row = snapshot.breakdown.added.find((item) => item.category === category);
            return {
              id: category,
              label: t(LABELS[category][0], LABELS[category][1]),
              value: unit === 'sp' ? (row?.storyPoints ?? 0) : (row?.tasks ?? 0),
              tone: TONES[category],
              title: categories[category],
            };
          })}
        />
      </div>
    </div>
  );
}
