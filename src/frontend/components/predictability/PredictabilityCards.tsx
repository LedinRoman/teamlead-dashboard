import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { METRIC_HINTS } from '@backend/metrics/predictability-copy';
import type { PredictabilitySnapshot } from '@backend/metrics/predictability-model';

export function PredictabilityCards({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { summary, incomplete } = snapshot;
  const reliabilityTitle = incomplete ? 'Выполнено на текущий момент' : 'Commitment reliability';
  return (
    <div className="stat-bar predictability-stats">
      <div className="stat" title={METRIC_HINTS.reliability}>
        <span className="stat-label">
          <Hint text={incomplete ? `${METRIC_HINTS.reliability} Пока спринт открыт, это текущий прогресс, не итог.` : METRIC_HINTS.reliability}>
            {reliabilityTitle}
          </Hint>
        </span>
        <span className="stat-value">{formatPct(summary.reliability.taskPercent)}</span>
        <span className="stat-hint">
          {summary.reliability.committedTasks === 0
            ? 'Нет данных'
            : `${summary.reliability.completedTasks} из ${summary.reliability.committedTasks} задач`}
        </span>
        <span className="stat-hint" title={METRIC_HINTS.reliabilitySp}>
          {summary.reliability.committedSp === 0 && summary.reliability.unestimated > 0
            ? 'SP недоступны — часть задач без оценки'
            : summary.reliability.committedSp === 0
              ? ''
              : `${fmtSp(summary.reliability.completedSp)} из ${fmtSp(summary.reliability.committedSp)}`}
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
          завершено {summary.added.completedTasks} {taskWord(summary.added.completedTasks)}
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
        <span className="stat-hint">снято с commitment</span>
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
            ? 'нет выполненного объёма'
            : `${Math.round(summary.unplanned.percentOfCommitment)}% от выполненного`}
        </span>
      </div>
    </div>
  );
}

function formatPct(value: number | null): string {
  if (value === null) return 'Нет данных';
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
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return 'задача';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'задачи';
  return 'задач';
}
