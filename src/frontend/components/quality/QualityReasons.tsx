import { Hint } from '@frontend/components/ui';
import { SegmentBar } from '@frontend/components/charts';
import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
import type { QualityReasonBucket } from '@backend/metrics/quality-model';

export function QualityReasons({ buckets }: { buckets: QualityReasonBucket[] }) {
  if (buckets.length === 0) {
    return <p className="caption">В этой когорте нет возвратов QA→Fix, поэтому причин тоже нет.</p>;
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <SegmentBar
        caption="Что лежало в changelog в момент QA→Fix. Не классификация дефектов."
        segments={buckets.map((bucket) => ({
          id: bucket.key,
          label: bucket.label,
          value: bucket.count,
          tone: bucket.kind === 'none' ? 'warning' : 'neutral',
          title: `${bucket.label}: ${bucket.count}`,
        }))}
      />
      <ul className="plain">
        {buckets.map((bucket) => (
          <li key={bucket.key}>
            {bucket.label}: {bucket.count}
          </li>
        ))}
      </ul>
      <p className="caption">
        <Hint text={QUALITY_HINTS.reasons}>{QUALITY_HINTS.reasons}</Hint>
      </p>
    </div>
  );
}
