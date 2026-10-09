import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { METRIC_HINTS } from '@backend/metrics/predictability-copy';
import type { PredictabilitySnapshot } from '@backend/metrics/predictability-model';

export function PredictabilityCards({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { summary, incomplete } = snapshot;
  const reliabilityTitle = incomplete ? 'Done so far' : 'Commitment reliability';
  return (
    <div className="stat-bar predictability-stats">
      <div className="stat" title={METRIC_HINTS.reliability}>
        <span className="stat-label">
          <Hint text={incomplete ? `${METRIC_HINTS.reliability} While the sprint is open, this is progress so far, not a final score.` : METRIC_HINTS.reliability}>
            {reliabilityTitle}
          </Hint>
        </span>
        <span className="stat-value">{formatPct(summary.reliability.taskPercent)}</span>
        <span className="stat-hint">
          {summary.reliability.committedTasks === 0
            ? 'No data'
            : `${summary.reliability.completedTasks} of ${summary.reliability.committedTasks} issues`}
        </span>
        <span className="stat-hint" title={METRIC_HINTS.reliabilitySp}>
          {summary.reliability.committedSp === 0 && summary.reliability.unestimated > 0
            ? 'Story points unavailable — some issues are unestimated'
            : summary.reliability.committedSp === 0
              ? ''
              : `${fmtSp(summary.reliability.completedSp)} of ${fmtSp(summary.reliability.committedSp)}`}
        </span>
      </div>
      <div className="stat" title={METRIC_HINTS.scopeAdded}>
        <span className="stat-label">
          <Hint text={METRIC_HINTS.scopeAdded}>Scope added</Hint>
        </span>
        <span className="stat-value">
          {summary.added.percentOfCommitment === null
            ? absAdded(summary.added.tasks, summary.added.storyPoints)
            : signedPct(summary.added.percentOfCommitment)}
        </span>
        <span className="stat-hint">
          {summary.added.tasks} {taskWord(summary.added.tasks)} · {fmtSp(summary.added.storyPoints)}
        </span>
        <span className="stat-hint">
          {summary.added.completedTasks} {taskWord(summary.added.completedTasks)} completed
        </span>
      </div>
      <div className="stat" title={METRIC_HINTS.scopeDrop}>
        <span className="stat-label">
          <Hint text={METRIC_HINTS.scopeDrop}>Scope drop</Hint>
        </span>
        <span className="stat-value">
          {summary.removed.percentOfCommitment === null
            ? absAdded(summary.removed.tasks, summary.removed.storyPoints)
            : signedPct(-Math.abs(summary.removed.percentOfCommitment))}
        </span>
        <span className="stat-hint">
          {summary.removed.tasks} {taskWord(summary.removed.tasks)} · {fmtSp(summary.removed.storyPoints)}
        </span>
        <span className="stat-hint">removed from commitment</span>
      </div>
      <div className="stat" title={METRIC_HINTS.spillover}>
        <span className="stat-label">
          <Hint text={METRIC_HINTS.spillover}>{incomplete ? 'Still unfinished' : 'Spillover'}</Hint>
        </span>
        <span className="stat-value">{summary.spillover.tasks}</span>
        <span className="stat-hint">
          {taskWord(summary.spillover.tasks)} · {fmtSp(summary.spillover.storyPoints)}
        </span>
      </div>
      <div className="stat" title={METRIC_HINTS.unplanned}>
        <span className="stat-label">
          <Hint text={METRIC_HINTS.unplanned}>Unplanned delivered</Hint>
        </span>
        <span className="stat-value">{summary.unplanned.tasks}</span>
        <span className="stat-hint">
          {taskWord(summary.unplanned.tasks)} · {fmtSp(summary.unplanned.storyPoints)}
        </span>
        <span className="stat-hint">
          {summary.unplanned.percentOfCommitment === null
            ? 'no completed work yet'
            : `${Math.round(summary.unplanned.percentOfCommitment)}% of completed`}
        </span>
      </div>
    </div>
  );
}

function formatPct(value: number | null): string {
  if (value === null) return 'No data';
  return `${Math.round(value)}%`;
}

function signedPct(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function absAdded(tasks: number, sp: number): string {
  return `${tasks} · ${fmtSp(sp)}`;
}

function fmtSp(value: number): string {
  return formatStoryPoints(value);
}

function taskWord(count: number): string {
  return count === 1 ? 'issue' : 'issues';
}
