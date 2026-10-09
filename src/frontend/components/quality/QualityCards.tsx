import { Hint } from '@frontend/components/ui';
import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import { QUALITY_HINTS } from '@backend/metrics/quality-copy';
import type { QualitySnapshot } from '@backend/metrics/quality-model';
import type { QualityTableFilter } from './QualityTaskTable';

export function QualityCards({
  snapshot,
  filter,
  onFilter,
}: {
  snapshot: QualitySnapshot;
  filter: QualityTableFilter;
  onFilter: (filter: QualityTableFilter) => void;
}) {
  const rateLabel =
    snapshot.rate === null ? 'No data' : `${Math.round(snapshot.rate * 100)}%`;
  const median = snapshot.reworkSummary?.median;
  const p85 = snapshot.reworkSummary?.p85;
  const cycleN = snapshot.reworkSummary?.count ?? 0;
  return (
    <div className="stat-bar quality-stats">
      <button
        type="button"
        className="stat"
        data-active={filter === 'returns'}
        onClick={() => onFilter('returns')}
      >
        <span className="stat-label">
          <Hint text={QUALITY_HINTS.rate}>Return Rate</Hint>
        </span>
        <span className="stat-value">{rateLabel}</span>
        <span className="stat-hint">
          {snapshot.n === 0 ? 'no cohort' : `${snapshot.r} of ${snapshot.n} issues`}
        </span>
        {snapshot.nUnknown > 0 && (
          <span className="stat-hint">{snapshot.nUnknown} more with incomplete history</span>
        )}
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'firstPass'}
        onClick={() => onFilter('firstPass')}
      >
        <span className="stat-label">
          <Hint text={QUALITY_HINTS.fpy}>First Pass Yield</Hint>
        </span>
        <span className="stat-value">
          {snapshot.firstPass.fpy === null ? 'No data' : `${Math.round(snapshot.firstPass.fpy * 100)}%`}
        </span>
        <span className="stat-hint">
          {snapshot.firstPass.passed + snapshot.firstPass.failed === 0
            ? 'no finished first pass'
            : `${snapshot.firstPass.passed} reached Done without a return · ${snapshot.firstPass.failed} returned`}
        </span>
        {snapshot.firstPass.pending > 0 && (
          <span className="stat-hint">{snapshot.firstPass.pending} still open, not in FPY</span>
        )}
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'completed'}
        onClick={() => onFilter('completed')}
      >
        <span className="stat-label">
          <Hint text={QUALITY_HINTS.loops}>Rework Loops</Hint>
        </span>
        <span className="stat-value">{snapshot.loops}</span>
        <span className="stat-hint">
          completed cycles · {snapshot.r} {taskWord(snapshot.r)} returned
        </span>
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'repeated'}
        onClick={() => onFilter('repeated')}
      >
        <span className="stat-label">
          <Hint text={QUALITY_HINTS.repeated}>Repeated Rework</Hint>
        </span>
        <span className="stat-value">{snapshot.r2}</span>
        <span className="stat-hint">
          {taskWord(snapshot.r2)} with two or more returns
        </span>
      </button>
      <button
        type="button"
        className="stat"
        data-active={filter === 'completed'}
        onClick={() => onFilter('completed')}
      >
        <span className="stat-label">
          <Hint text={QUALITY_HINTS.reworkTime}>Rework Time</Hint>
        </span>
        <span className="stat-value">
          {median === undefined ? 'No data' : formatCycleDuration(median)}
        </span>
        <span className="stat-hint">
          {cycleN === 0
            ? 'no completed cycles'
            : `median · P85 ${p85 === undefined ? '—' : formatCycleDuration(p85)} · n=${cycleN}`}
        </span>
        <span className="stat-hint">open cycles: {snapshot.reworkWip}</span>
      </button>
    </div>
  );
}

function taskWord(count: number): string {
  return count === 1 ? 'issue' : 'issues';
}
