import { SegmentBar } from '@frontend/components/charts';
import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
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
      caption="Click a segment to filter the table. 0 means no return was observed."
      segments={SEGMENTS.map((segment) => ({
        id: segment.id,
        label: segment.label,
        color: segment.color,
        value: values[segment.id] ?? 0,
        title:
          segment.id === 'zero'
            ? 'No returns observed yet.'
            : segment.id === 'unknown'
              ? QUALITY_HINTS.distribution
              : `${segment.label} return(s)`,
      }))}
    />
  );
}
