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
    snapshot.rate === null ? 'Нет данных' : `${Math.round(snapshot.rate * 100)}%`;
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
          {snapshot.n === 0 ? 'нет когорты' : `${snapshot.r} из ${snapshot.n} задач`}
        </span>
        {snapshot.nUnknown > 0 && (
          <span className="stat-hint">ещё {snapshot.nUnknown} с неполной историей</span>
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
          {snapshot.firstPass.fpy === null ? 'Нет данных' : `${Math.round(snapshot.firstPass.fpy * 100)}%`}
        </span>
        <span className="stat-hint">
          {snapshot.firstPass.passed + snapshot.firstPass.failed === 0
            ? 'нет завершённого первого прохода'
            : `${snapshot.firstPass.passed} без возврата до Готово · ${snapshot.firstPass.failed} с возвратом`}
        </span>
        {snapshot.firstPass.pending > 0 && (
          <span className="stat-hint">{snapshot.firstPass.pending} ещё без исхода, не в FPY</span>
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
          завершённых циклов · {snapshot.r} {taskWord(snapshot.r)} с возвратом
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
          {taskWord(snapshot.r2)} с двумя и более возвратами
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
          {median === undefined ? 'Нет данных' : formatCycleDuration(median)}
        </span>
        <span className="stat-hint">
          {cycleN === 0
            ? 'нет завершённых циклов'
            : `median · P85 ${p85 === undefined ? '—' : formatCycleDuration(p85)} · n=${cycleN}`}
        </span>
        <span className="stat-hint">открытых циклов: {snapshot.reworkWip}</span>
      </button>
    </div>
  );
}

function taskWord(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return 'задача';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'задачи';
  return 'задач';
}
