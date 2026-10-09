import { SegmentBar } from '@frontend/components/charts';
import { Hint, type Tone } from '@frontend/components/ui';
import { CATEGORY_HINTS, METRIC_HINTS } from '@backend/metrics/predictability-copy';
import type { PredictabilityCategory, PredictabilitySnapshot } from '@backend/metrics/predictability-model';

const COMMITTED_ORDER: PredictabilityCategory[] = [
  'committed-completed',
  'spillover',
  'still-unfinished',
  'removed',
  'cancelled',
];
const ADDED_ORDER: PredictabilityCategory[] = ['added-completed', 'added-unfinished'];

const LABELS: Record<PredictabilityCategory, string> = {
  'committed-completed': 'Выполнено',
  spillover: 'Перенесено',
  'still-unfinished': 'Ещё не завершено',
  removed: 'Удалено',
  cancelled: 'Отменено',
  'added-completed': 'Выполнено',
  'added-unfinished': 'Не выполнено',
  'already-done': 'До старта',
  excluded: 'Исключено',
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
  const toggle = (id: string) => {
    const category = id as PredictabilityCategory;
    onSelect(selected === category ? undefined : category);
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="caption">
          <Hint text={METRIC_HINTS.initial}>Первоначальный план</Hint>
        </div>
        <SegmentBar
          caption="Committed scope к концу спринта"
          selected={selected}
          onSelect={toggle}
          segments={COMMITTED_ORDER.map((category) => {
            const row = snapshot.breakdown.committed.find((item) => item.category === category);
            return {
              id: category,
              label: LABELS[category],
              value: unit === 'sp' ? (row?.storyPoints ?? 0) : (row?.tasks ?? 0),
              tone: TONES[category],
              title: CATEGORY_HINTS[category],
            };
          })}
        />
      </div>
      <div>
        <div className="caption">
          <Hint text={METRIC_HINTS.added}>Добавлено после старта</Hint>
        </div>
        <SegmentBar
          caption="Added scope к концу спринта"
          selected={selected}
          onSelect={toggle}
          segments={ADDED_ORDER.map((category) => {
            const row = snapshot.breakdown.added.find((item) => item.category === category);
            return {
              id: category,
              label: LABELS[category],
              value: unit === 'sp' ? (row?.storyPoints ?? 0) : (row?.tasks ?? 0),
              tone: TONES[category],
              title: CATEGORY_HINTS[category],
            };
          })}
        />
      </div>
    </div>
  );
}
