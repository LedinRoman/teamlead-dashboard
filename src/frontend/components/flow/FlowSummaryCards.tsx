import { formatCycleDuration } from '@backend/metrics/cycle-overview';
import type { FlowSnapshot } from '@backend/metrics/flow-model';

export function FlowSummaryCards({
  flow,
  onSelect,
}: {
  flow: FlowSnapshot;
  onSelect: (filter: 'developmentWip' | 'qaWip' | 'inReview' | 'blocked' | 'oldest') => void;
}) {
  return (
    <div className="stat-bar cycle-stats flow-stats">
      <button
        type="button"
        className="stat flow-stat"
        title="Issues that need a developer right now: development and review. Not In review, and not the QA queue."
        onClick={() => onSelect('developmentWip')}
      >
        <span className="stat-label">Development WIP</span>
        <span className="stat-value">{flow.developmentWip}</span>
        <span className="stat-hint">Needs a developer right now</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="QA queue and QA work before In review or Fix. In review itself is not included."
        onClick={() => onSelect('qaWip')}
        disabled={!flow.qaWipAvailable}
      >
        <span className="stat-label">QA WIP</span>
        <span className="stat-value">{flow.qaWipAvailable ? flow.qaWip : '—'}</span>
        <span className="stat-hint">
          {flow.qaWipAvailable
            ? 'In the QA queue, until In review or Fix'
            : flow.qaUnavailableReason ?? 'QA WIP unavailable'}
        </span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Current status is In review. That is not necessarily active testing, and it is not the end of cycle time for aging."
        onClick={() => onSelect('inReview')}
      >
        <span className="stat-label">In review</span>
        <span className="stat-value">{flow.inReview}</span>
        <span className="stat-hint">Current status, not necessarily active testing</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Active issues in a blocked status or with a blocked label, still in development, review, or QA."
        onClick={() => onSelect('blocked')}
      >
        <span className="stat-label">Blocked</span>
        <span className="stat-value">{flow.blocked}</span>
        <span className="stat-hint">Active blocked issues</span>
      </button>
      <button
        type="button"
        className="stat flow-stat"
        title="Oldest active issue by the current episode, not by when the key was created."
        onClick={() => onSelect('oldest')}
        disabled={!flow.oldest}
      >
        <span className="stat-label">Oldest WIP</span>
        <span className="stat-value">
          {flow.oldest ? flow.oldest.key : '—'}
        </span>
        <span className="stat-hint">
          {flow.oldest
            ? `${flow.oldest.episodeLabel}: ${formatCycleDuration(flow.oldest.episodeDays)}`
            : 'Oldest active issue'}
        </span>
      </button>
    </div>
  );
}
