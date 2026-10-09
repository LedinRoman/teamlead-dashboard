import type { MetricRules, StatusCategory } from '@shared/types';

/** Exact Jira name. First entry here ends engineering cycle time and clears WIP. */
export const ENGINEERING_DONE_STATUS = 'Проверка';
/** Default first in-progress status for the Overview cycle-time clock. */
export const DEFAULT_CYCLE_START_STATUS = 'В работе';
/** Release status. Ignored for cycle time and WIP unless chosen as the cycle end. */
export const RELEASE_STATUS = 'Готово';
/** Board backlog. Not development WIP and not QA WIP. */
export const TODO_STATUS = 'К выполнению';
/** Waiting on QA. Counted as QA WIP, not development WIP. */
export const QA_WIP_STATUS = 'Ready to QA';

/**
 * Cloud changelogs keep the default English status name even when the issue
 * payload and the board UI are localised. Match both so a Russian dropdown
 * value still hits the English changelog string.
 */
const STATUS_ALIASES: Record<string, string[]> = {
  проверка: ['review'],
  review: ['проверка'],
  готово: ['done'],
  done: ['готово'],
  'в работе': ['in progress'],
  'in progress': ['в работе'],
  'к выполнению': ['to do', 'todo'],
  'to do': ['к выполнению'],
  todo: ['к выполнению'],
};

export function statusEquals(actual: string | undefined, expected: string | undefined): boolean {
  const left = actual?.trim().toLowerCase();
  const right = expected?.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return (STATUS_ALIASES[right] ?? []).includes(left);
}

export function isEngineeringDone(status: string | undefined): boolean {
  return statusEquals(status, ENGINEERING_DONE_STATUS);
}

export function isReleaseStatus(status: string | undefined): boolean {
  return statusEquals(status, RELEASE_STATUS);
}

export function isTodoStatus(status: string | undefined): boolean {
  return statusEquals(status, TODO_STATUS);
}

export function isQaWipStatus(status: string | undefined): boolean {
  return statusEquals(status, QA_WIP_STATUS) || matchesAny(status, ['ready to qa']);
}

export function isBlockedStatus(status: string | undefined): boolean {
  return matchesAny(status, ['blocked']);
}

/** Case-insensitive membership test used for every status and label rule. */
export function matchesAny(value: string | undefined, candidates: string[]): boolean {
  if (!value) return false;
  const needle = value.trim().toLowerCase();
  return candidates.some((candidate) => candidate.trim().toLowerCase() === needle);
}

/**
 * The category a metric should use, after the configured overrides are applied to
 * the category Jira reports.
 *
 * Precedence is fixed and deliberate: "never done" beats "counts as done", so a
 * status listed in both lists is treated as unfinished. Without that rule the
 * outcome would depend on list order, which is not something a reader of the
 * Settings screen could predict.
 */
export function effectiveCategory(
  status: string,
  reported: StatusCategory,
  rules: MetricRules,
): StatusCategory {
  if (isEngineeringDone(status)) return 'done';
  if (matchesAny(status, rules.notDoneStatuses)) {
    return reported === 'done' ? 'indeterminate' : reported;
  }
  if (matchesAny(status, rules.doneStatuses)) return 'done';
  if (matchesAny(status, rules.activeStatuses)) return 'indeterminate';
  return reported;
}

/** True when the rules make this status differ from what Jira itself reports. */
export function isOverridden(status: string, rules: MetricRules): boolean {
  return (
    matchesAny(status, rules.notDoneStatuses) ||
    matchesAny(status, rules.doneStatuses) ||
    matchesAny(status, rules.activeStatuses)
  );
}

/**
 * Whether entering this status starts the cycle-time clock. With no configured
 * statuses the clock starts on the first move into any in-progress status.
 */
export function startsWork(
  status: string,
  category: StatusCategory,
  rules: MetricRules,
): boolean {
  if (isEngineeringDone(status) || isReleaseStatus(status)) return false;
  if (rules.workStartedStatuses.length > 0) return matchesAny(status, rules.workStartedStatuses);
  return category === 'indeterminate';
}

/**
 * One sentence naming the current definition of done, for screens that show a
 * number a reader might otherwise take as Jira's own.
 */
export function describeDone(rules: MetricRules): string {
  const parts = ["Jira's own Done category"];
  if (rules.doneStatuses.length > 0) parts.push(`statuses ${rules.doneStatuses.join(', ')}`);
  let sentence = `Done means ${parts.join(' plus ')}`;
  if (rules.notDoneStatuses.length > 0) {
    sentence += `, excluding ${rules.notDoneStatuses.join(', ')}`;
  }
  return `${sentence}.`;
}

/** True when any rule changes a metric away from stock Jira behaviour. */
export function hasStatusOverrides(rules: MetricRules): boolean {
  return (
    rules.doneStatuses.length > 0 ||
    rules.notDoneStatuses.length > 0 ||
    rules.activeStatuses.length > 0
  );
}

/**
 * Combinations that are accepted but will not do what the reader expects. These
 * are warnings rather than validation errors: the rules still resolve to one
 * predictable outcome, the point is to say which.
 */
export function ruleWarnings(rules: MetricRules): string[] {
  const warnings: string[] = [];

  for (const status of rules.doneStatuses) {
    if (matchesAny(status, rules.notDoneStatuses)) {
      warnings.push(
        `"${status}" is listed as both done and never done. Never done wins, so it counts as unfinished.`,
      );
    }
    if (matchesAny(status, rules.activeStatuses)) {
      warnings.push(`"${status}" is listed as both done and in progress. Done wins.`);
    }
    if (matchesAny(status, rules.blockedStatuses)) {
      warnings.push(
        `"${status}" counts as done, so it can never be reported as blocked. Blocked signals are only derived for unfinished work.`,
      );
    }
  }

  if (rules.veryStaleDays < rules.staleDays) {
    warnings.push(
      `Very stale (${rules.veryStaleDays}d) is shorter than stale (${rules.staleDays}d), so nothing will ever be merely stale.`,
    );
  }

  if (rules.attentionSignals.length === 0) {
    warnings.push('No attention signals are selected, so "needs attention" will always read zero.');
  }

  if (rules.cacheTtlSeconds === 0) {
    warnings.push('Snapshot lifetime is zero, so every screen refetches from Jira and rate limits come quickly.');
  }

  return warnings;
}
