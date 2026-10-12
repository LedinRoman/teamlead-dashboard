import { useI18n } from '@frontend/i18n/locale';
import { Hint } from '@frontend/components/ui';
import { formatStoryPoints } from '@backend/metrics/cycle-overview';
import { metricHints } from '@backend/metrics/predictability-copy';
import type { PredictabilitySnapshot } from '@backend/metrics/predictability-model';

export function PredictabilityCards({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { t, locale } = useI18n();
  const hints = metricHints(locale);
  const { summary, incomplete } = snapshot;
  const reliabilityTitle = incomplete ? t('Done so far', 'Сделано пока') : t('Commitment reliability', 'Надёжность commitment');
  const openNote = t(
    'While the sprint is open, this is progress so far, not a final score.',
    'Пока спринт открыт, это текущий прогресс, а не итоговая оценка.',
  );
  return (
    <div className="stat-bar predictability-stats">
      <div className="stat" title={hints.reliability}>
        <span className="stat-label">
          <Hint text={incomplete ? `${hints.reliability} ${openNote}` : hints.reliability}>
            {reliabilityTitle}
          </Hint>
        </span>
        <span className="stat-value">{formatPct(summary.reliability.taskPercent, t)}</span>
        <span className="stat-hint">
          {summary.reliability.committedTasks === 0
            ? t('No data', 'Нет данных')
            : t(
                `${summary.reliability.completedTasks} of ${summary.reliability.committedTasks} issues`,
                `${summary.reliability.completedTasks} из ${summary.reliability.committedTasks} задач`,
              )}
        </span>
        <span className="stat-hint" title={hints.reliabilitySp}>
          {summary.reliability.committedSp === 0 && summary.reliability.unestimated > 0
            ? t('Story points unavailable — some issues are unestimated', 'Story points недоступны — часть задач без оценки')
            : summary.reliability.committedSp === 0
              ? ''
              : `${fmtSp(summary.reliability.completedSp)} ${t('of', 'из')} ${fmtSp(summary.reliability.committedSp)}`}
        </span>
      </div>
      <div className="stat" title={hints.scopeAdded}>
        <span className="stat-label">
          <Hint text={hints.scopeAdded}>{t('Scope added', 'Добавленный scope')}</Hint>
        </span>
        <span className="stat-value">
          {summary.added.percentOfCommitment === null
            ? absAdded(summary.added.tasks, summary.added.storyPoints)
            : signedPct(summary.added.percentOfCommitment)}
        </span>
        <span className="stat-hint">
          {summary.added.tasks} {taskWord(summary.added.tasks, locale)} · {fmtSp(summary.added.storyPoints)}
        </span>
        <span className="stat-hint">
          {t(
            `${summary.added.completedTasks} ${taskWord(summary.added.completedTasks, 'en')} completed`,
            `${summary.added.completedTasks} ${taskWord(summary.added.completedTasks, 'ru')} завершено`,
          )}
        </span>
      </div>
      <div className="stat" title={hints.scopeDrop}>
        <span className="stat-label">
          <Hint text={hints.scopeDrop}>{t('Scope drop', 'Снятый scope')}</Hint>
        </span>
        <span className="stat-value">
          {summary.removed.percentOfCommitment === null
            ? absAdded(summary.removed.tasks, summary.removed.storyPoints)
            : signedPct(-Math.abs(summary.removed.percentOfCommitment))}
        </span>
        <span className="stat-hint">
          {summary.removed.tasks} {taskWord(summary.removed.tasks, locale)} · {fmtSp(summary.removed.storyPoints)}
        </span>
        <span className="stat-hint">{t('removed from commitment', 'снято с commitment')}</span>
      </div>
      <div className="stat" title={hints.spillover}>
        <span className="stat-label">
          <Hint text={hints.spillover}>{incomplete ? t('Still unfinished', 'Ещё не завершено') : t('Spillover', 'Перенос')}</Hint>
        </span>
        <span className="stat-value">{summary.spillover.tasks}</span>
        <span className="stat-hint">
          {taskWord(summary.spillover.tasks, locale)} · {fmtSp(summary.spillover.storyPoints)}
        </span>
      </div>
      <div className="stat" title={hints.unplanned}>
        <span className="stat-label">
          <Hint text={hints.unplanned}>{t('Unplanned delivered', 'Вне плана, сдано')}</Hint>
        </span>
        <span className="stat-value">{summary.unplanned.tasks}</span>
        <span className="stat-hint">
          {taskWord(summary.unplanned.tasks, locale)} · {fmtSp(summary.unplanned.storyPoints)}
        </span>
        <span className="stat-hint">
          {summary.unplanned.percentOfCommitment === null
            ? t('no completed work yet', 'завершённой работы ещё нет')
            : t(
                `${Math.round(summary.unplanned.percentOfCommitment)}% of completed`,
                `${Math.round(summary.unplanned.percentOfCommitment)}% от завершённого`,
              )}
        </span>
      </div>
    </div>
  );
}

function formatPct(value: number | null, t: (en: string, ru: string) => string): string {
  if (value === null) return t('No data', 'Нет данных');
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

function taskWord(count: number, locale: 'en' | 'ru'): string {
  if (locale !== 'ru') return count === 1 ? 'issue' : 'issues';
  const n10 = Math.abs(count) % 10;
  const n100 = Math.abs(count) % 100;
  if (n10 === 1 && n100 !== 11) return 'задача';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'задачи';
  return 'задач';
}
