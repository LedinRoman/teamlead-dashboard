import { isRu, tr } from '../../shared/locale';
import type { DistributionSummary, NormalizedIssue } from '@shared/types';
import { summarize } from './aggregate';
import {
  ENGINEERING_DONE_STATUS,
  isBlockedStatus,
  isEngineeringDone,
  isQaWipStatus,
  isReleaseStatus,
  isTodoStatus,
  matchesAny,
} from './rules';
import { sortTransitions, statusAt } from './flow-timeline';
import { daysBetween, elapsedDays, parseDate, workingDaysBetween, workingElapsedDays } from './time';

export const CYCLE_EMPTY_MESSAGE = 'No issues in this sprint have been handed to review yet';
/** Cycle Time counts only these work types. Everything else is ignored. */
export const ALLOWED_CYCLE_TYPES = [
  'bug',
  'баг',
  'ошибка',
  'task',
  'задача',
  'story',
  'история',
  'user story',
  'spike',
  'спайк',
];

export interface CycleOverviewWindow {
  from: string;
  to: string;
}

export interface CycleBar {
  key: string;
  url: string;
  summary: string;
  assigneeName: string;
  storyPoints?: number;
  firstInProgress?: string;
  /** Changelog start, kept when `startOverridden` is true. */
  changelogStart?: string;
  startOverridden?: boolean;
  doneAt: string;
  /** Changelog end, kept when `endOverridden` is true. */
  changelogDone?: string;
  endOverridden?: boolean;
  cycleTimeDays: number;
  /** Time in Ready to QA (and aliases) between start and first Проверка. */
  qaWipDays: number;
  /** Cycle time minus QA WIP. */
  devDays: number;
}

export interface CycleSummarySplit {
  label: string;
  value: string;
  hint?: string;
}

export interface CycleSummaryCard {
  label: string;
  value: string;
  hint: string;
  splits?: CycleSummarySplit[];
}

export interface OldestWipItem {
  key: string;
  url: string;
  summary: string;
  assigneeName: string;
  ageDays: number;
  status: string;
}

export interface CycleOverviewFilters {
  endStatus?: string;
  /** Drop work items whose summary contains `[QA]`. */
  excludeQaTitle?: boolean;
  /** Issue keys excluded from bars, median, P85, completed, and WIP. */
  excludedKeys?: string[];
  /** When set and non-empty, keep only these assignees (`unassigned` for none). */
  assigneeIds?: string[];
  now?: Date;
  /** Uppercased issue key → ISO start. Recomputes cycle time; does not change WIP. */
  startOverrides?: Record<string, string>;
  /** Uppercased issue key → ISO end. Recomputes cycle time; does not change the sprint window. */
  endOverrides?: Record<string, string>;
  /** Count Mon–Fri minus `holidays`; bars, Median, P85, QA split, compare, Oldest WIP. */
  workingDays?: boolean;
  /** Local `YYYY-MM-DD` dates skipped in working-day mode. */
  holidays?: string[];
}

export interface CyclePerson {
  id: string;
  name: string;
}

export interface CycleCompareLine {
  text: string;
  short: string;
  tone: 'success' | 'danger' | 'neutral';
}

export interface CycleOverviewModel {
  bars: CycleBar[];
  summary: DistributionSummary | null;
  completedCount: number;
  completedInReview: number;
  completedReleased: number;
  wipCount: number;
  devWipCount: number;
  qaWipCount: number;
  todoCount: number;
  oldestWip: OldestWipItem[];
  median: number | null;
  /** Median of cycle time excluding Ready to QA. */
  medianWithoutQa: number | null;
  /** Median Ready to QA wait among issues that entered the queue. */
  medianQa: number | null;
  p85: number | null;
  /** P85 of cycle time excluding Ready to QA. */
  p85WithoutQa: number | null;
  /** P85 Ready to QA wait among issues that entered the queue. */
  p85Qa: number | null;
  cards: CycleSummaryCard[];
  emptyMessage?: string;
}

export const QA_TITLE_MARKER = '[QA]';

/**
 * Overview Cycle Time: first selected start status → first selected end status,
 * only for Bug / Task / Story / Spike. Median and P85 reuse `summarize()`.
 */
export function buildCycleOverview(
  issues: NormalizedIssue[],
  window?: CycleOverviewWindow,
  options?: CycleOverviewFilters,
): CycleOverviewModel {
  const scoped = issues.filter(
    (issue) => isAllowedCycleType(issue.type) && !isCycleExcluded(issue, options),
  );
  const completed = scoped.filter((issue) => isCompletedInWindow(issue, window));
  const bars = completed
    .map((issue) => toBar(issue, options))
    .sort((a, b) => b.cycleTimeDays - a.cycleTimeDays || a.key.localeCompare(b.key));
  const summary = summarize(bars.map((bar) => bar.cycleTimeDays));
  const devWipCount = scoped.filter(isDevWip).length;
  const qaWipCount = scoped.filter(isQaWip).length;
  const todoCount = scoped.filter((issue) => isTodoStatus(issue.status)).length;
  const wipCount = devWipCount + qaWipCount;
  const oldestWip = listOldestWip(scoped, options?.now ?? new Date(), options);
  const completedInReview = completed.filter((issue) => isEngineeringDone(issue.status)).length;
  const completedReleased = completed.filter((issue) => isReleaseStatus(issue.status)).length;
  const median = summary?.median ?? null;
  const p85 = summary?.p85 ?? null;
  const withoutQa = summarize(bars.map((bar) => bar.devDays));
  const medianWithoutQa = withoutQa?.median ?? null;
  const p85WithoutQa = withoutQa?.p85 ?? null;
  const qaWaits = bars.filter((bar) => bar.qaWipDays > 0).map((bar) => bar.qaWipDays);
  const qaSummary = qaWaits.length ? summarize(qaWaits) : null;
  const medianQa = qaSummary?.median ?? (bars.length ? 0 : null);
  const p85Qa = qaSummary?.p85 ?? (bars.length ? 0 : null);
  const endStatus = options?.endStatus?.trim() || ENGINEERING_DONE_STATUS;

  return {
    bars,
    summary,
    completedCount: bars.length,
    completedInReview,
    completedReleased,
    wipCount,
    devWipCount,
    qaWipCount,
    todoCount,
    oldestWip,
    median,
    medianWithoutQa,
    medianQa,
    p85,
    p85WithoutQa,
    p85Qa,
    cards: cycleSummaryCards({
      median,
      medianWithoutQa,
      medianQa,
      p85,
      p85WithoutQa,
      p85Qa,
      completedCount: bars.length,
      completedInReview,
      completedReleased,
      wipCount,
      devWipCount,
      qaWipCount,
      todoCount,
      qaWaitCount: qaWaits.length,
    }),
    emptyMessage: bars.length === 0 ? emptyMessage(endStatus) : undefined,
  };
}

export function isAllowedCycleType(type: string | undefined): boolean {
  return matchesAny(type, ALLOWED_CYCLE_TYPES);
}

export function isCycleExcluded(
  issue: Pick<NormalizedIssue, 'key' | 'summary' | 'assigneeId'>,
  options?: CycleOverviewFilters,
): boolean {
  if (options?.excludeQaTitle && hasQaTitle(issue.summary)) return true;
  if (options?.excludedKeys && options.excludedKeys.length > 0) {
    const banned = new Set(options.excludedKeys.map((key) => key.trim().toUpperCase()).filter(Boolean));
    if (banned.has(issue.key.trim().toUpperCase())) return true;
  }
  if (options?.assigneeIds && options.assigneeIds.length > 0) {
    const id = issue.assigneeId || 'unassigned';
    if (!options.assigneeIds.includes(id)) return true;
  }
  return false;
}

/** Unique assignees. Unassigned appears only when at least one row has no assignee. */
export function uniqueAssignees(
  rows: Array<{ assigneeId?: string | null; assigneeName?: string | null }>,
): CyclePerson[] {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (!row.assigneeId) {
      names.set('unassigned', row.assigneeName || 'Unassigned');
    } else {
      names.set(row.assigneeId, row.assigneeName || row.assigneeId);
    }
  }
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** People who still have allowed-type work after QA/key filters, not the people filter. */
export function listCyclePeople(issues: NormalizedIssue[], options?: CycleOverviewFilters): CyclePerson[] {
  const scoped = issues.filter(
    (issue) =>
      isAllowedCycleType(issue.type) &&
      !isCycleExcluded(issue, { excludeQaTitle: options?.excludeQaTitle, excludedKeys: options?.excludedKeys }),
  );
  return uniqueAssignees(scoped);
}

/** Uppercased key → ISO start / end, for cycle override filters. */
export function cycleOverrideMaps(
  rows: Array<{ key: string; startedAt?: string; endedAt?: string }>,
): { startOverrides: Record<string, string>; endOverrides: Record<string, string> } {
  const startOverrides: Record<string, string> = {};
  const endOverrides: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim().toUpperCase();
    if (!key) continue;
    if (row.startedAt) startOverrides[key] = row.startedAt;
    if (row.endedAt) endOverrides[key] = row.endedAt;
  }
  return { startOverrides, endOverrides };
}

/** @deprecated Use `cycleOverrideMaps`. Kept for older verify imports. */
export function cycleStartOverrideMap(rows: Array<{ key: string; startedAt: string }>): Record<string, string> {
  return cycleOverrideMaps(rows).startOverrides;
}

export function hasQaTitle(summary: string | undefined): boolean {
  return (summary ?? '').toLowerCase().includes(QA_TITLE_MARKER.toLowerCase());
}

/** Pull Jira keys out of a typed or pasted blob (`CDR-12, cdr-13`). */
export function parseIssueKeys(raw: string): string[] {
  const found = raw.toUpperCase().match(/\b[A-Z][A-Z0-9_]+-\d+\b/g) ?? [];
  return [...new Set(found)];
}

/**
 * Cycle time: lower than the comparison sprint is an improvement.
 * Used on Median and P85 when a compare sprint is selected.
 */
export function formatCycleCompare(
  current: number | null,
  previous: number | null,
  previousLabel: string,
): CycleCompareLine | undefined {
  const label = previousLabel.trim() || tr('selected sprint', 'выбранный спринт');
  if (previous === null) {
    return {
      text: tr(`no data · ${label}`, `нет данных · ${label}`),
      short: tr('no data', 'нет данных'),
      tone: 'neutral',
    };
  }
  if (current === null) return undefined;
  if (current === previous) {
    return {
      text: tr(`same as ${label}: ${formatCycleDuration(previous)}`, `как ${label}: ${formatCycleDuration(previous)}`),
      short: tr('unchanged', 'как было'),
      tone: 'neutral',
    };
  }
  const improved = current < previous;
  const arrow = improved ? '↓' : '↑';
  const delta = formatCycleDuration(Math.abs(current - previous));
  return {
    text: `${arrow} ${delta} · ${label}: ${formatCycleDuration(previous)}`,
    short: `${arrow} ${delta}`,
    tone: improved ? 'success' : 'danger',
  };
}

export function isQaWip(issue: NormalizedIssue): boolean {
  return isQaWipStatus(issue.status);
}

export function isDevWip(issue: NormalizedIssue): boolean {
  if (
    isTodoStatus(issue.status) ||
    isBlockedStatus(issue.status) ||
    isEngineeringDone(issue.status) ||
    isReleaseStatus(issue.status) ||
    isQaWip(issue)
  ) {
    return false;
  }
  return Boolean(issue.status);
}

export function isCycleWip(issue: NormalizedIssue): boolean {
  return isDevWip(issue) || isQaWip(issue);
}

/** One oldest in-progress / Ready to QA item per assignee, oldest first. */
export function listOldestWip(
  issues: NormalizedIssue[],
  now: Date,
  options?: Pick<CycleOverviewFilters, 'workingDays' | 'holidays'>,
): OldestWipItem[] {
  const best = new Map<string, OldestWipItem>();
  for (const issue of issues.filter(isCycleWip)) {
    const id = issue.assigneeId || 'unassigned';
    const ageDays = wipAgeDays(issue, now, options);
    const current = best.get(id);
    if (
      !current ||
      ageDays > current.ageDays ||
      (ageDays === current.ageDays && issue.key.localeCompare(current.key) < 0)
    ) {
      best.set(id, {
        key: issue.key,
        url: issue.url,
        summary: issue.summary,
        assigneeName: issue.assigneeName || 'Unassigned',
        ageDays,
        status: issue.status,
      });
    }
  }
  return [...best.values()].sort(
    (left, right) =>
      right.ageDays - left.ageDays ||
      left.assigneeName.localeCompare(right.assigneeName) ||
      left.key.localeCompare(right.key),
  );
}

export function wipAgeDays(
  issue: NormalizedIssue,
  now: Date,
  options?: Pick<CycleOverviewFilters, 'workingDays' | 'holidays'>,
): number {
  const started = parseDate(issue.firstInProgress);
  if (options?.workingDays) {
    const from = started ?? parseDate(issue.created);
    if (from) return Math.max(0, workingDaysBetween(from, now, options.holidays ?? []));
    return issue.createdAgeDays;
  }
  if (started) return Math.max(0, daysBetween(started, now));
  return issue.createdAgeDays;
}

export function isCompletedInWindow(issue: NormalizedIssue, window?: CycleOverviewWindow): boolean {
  if (issue.cycleTimeDays === undefined || !issue.doneAt) return false;
  if (!window) return true;
  const day = issue.doneAt.slice(0, 10);
  return day >= window.from && day <= window.to;
}

export function cycleSummaryCards(options: {
  median: number | null;
  medianWithoutQa: number | null;
  medianQa: number | null;
  p85: number | null;
  p85WithoutQa: number | null;
  p85Qa: number | null;
  completedCount: number;
  completedInReview: number;
  completedReleased: number;
  wipCount: number;
  devWipCount: number;
  qaWipCount: number;
  todoCount: number;
  qaWaitCount?: number;
}): CycleSummaryCard[] {
  const qaWaitCount = options.qaWaitCount ?? 0;
  const ru = isRu();
  const splits = (withoutQa: number | null, qa: number | null): CycleSummarySplit[] => [
    {
      label: 'without QA',
      value: formatCycleMetric(withoutQa),
      hint: tr(
        'Development and other statuses, excluding Ready to QA',
        'Разработка и остальные статусы, без очереди Ready to QA',
      ),
    },
    {
      label: 'QA',
      value: formatCycleMetric(qa),
      hint:
        qa === null
          ? tr('Time in Ready to QA before the first review', 'Время в Ready to QA до первой проверки')
          : qaWaitCount > 0
            ? tr(
                `Issues that waited in Ready to QA (${qaWaitCount})`,
                `Задачи, которые ждали в Ready to QA (${qaWaitCount})`,
              )
            : tr('Nobody waited in Ready to QA', 'В Ready to QA никто не ждал'),
    },
  ];
  return [
    {
      label: 'Median CT',
      value: formatCycleMetric(options.median),
      hint: tr('Full cycle, including the QA queue', 'Полный цикл, включая очередь QA'),
      splits: splits(options.medianWithoutQa, options.medianQa),
    },
    {
      label: 'P85 CT',
      value: formatCycleMetric(options.p85),
      hint: tr('85% of issues finished faster', '85% задач завершились быстрее'),
      splits: splits(options.p85WithoutQa, options.p85Qa),
    },
    {
      label: 'Done',
      value: String(options.completedCount),
      hint: ru
        ? `${options.completedInReview} на проверке · ${options.completedReleased} выпущено`
        : `${options.completedInReview} in review · ${options.completedReleased} released`,
    },
    {
      label: 'WIP',
      value: String(options.wipCount),
      hint: ru
        ? `${options.devWipCount} в разработке · ${options.qaWipCount} в QA · ${options.todoCount} к выполнению`
        : `${options.devWipCount} in development · ${options.qaWipCount} in QA · ${options.todoCount} to do`,
    },
  ];
}

function formatCycleMetric(value: number | null): string {
  return value === null ? tr('No data', 'Нет данных') : formatCycleDuration(value);
}

export function cycleBarTooltip(bar: CycleBar, endStatus = ENGINEERING_DONE_STATUS): string {
  const lines = [
    bar.storyPoints === undefined ? bar.key : `${bar.key} · ${formatStoryPoints(bar.storyPoints)}`,
    bar.summary,
    `${tr('Assignee', 'Исполнитель')}: ${bar.assigneeName}`,
    `${tr('Started', 'Старт')}: ${formatStamp(bar.firstInProgress)}`,
  ];
  if (bar.startOverridden) {
    lines.push(`${tr('Original start', 'Исходный старт')}: ${formatStamp(bar.changelogStart)}`);
    lines.push(tr('Start override', 'Override старта'));
  }
  lines.push(`${endStatus}: ${formatStamp(bar.doneAt)}`);
  if (bar.endOverridden) {
    lines.push(`${tr('Original end', 'Исходный конец')}: ${formatStamp(bar.changelogDone)}`);
    lines.push(tr('End override', 'Override конца'));
  }
  lines.push(`${tr('Cycle time', 'Cycle time')}: ${formatCycleDuration(bar.cycleTimeDays)}`);
  lines.push(`${tr('Development', 'Разработка')}: ${formatCycleDuration(bar.devDays)}`);
  lines.push(`QA WIP: ${formatCycleDuration(bar.qaWipDays)}`);
  return lines.join('\n');
}

function emptyMessage(endStatus: string): string {
  if (endStatus === ENGINEERING_DONE_STATUS) {
    return tr(CYCLE_EMPTY_MESSAGE, 'В этом спринте ещё нет задач, переданных на проверку');
  }
  return tr(
    `No issues in this sprint have reached “${endStatus}” yet`,
    `В этом спринте ещё нет задач в статусе «${endStatus}»`,
  );
}

function ruDayWord(shown: number): string {
  if (!Number.isInteger(shown)) return 'дня';
  const mod10 = shown % 10;
  const mod100 = shown % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

/** Display-only. Callers keep the exact day values for medians and bar lengths. */
export function formatCycleDuration(days: number): string {
  const ru = isRu();
  if (!(days > 0)) return ru ? '0 ч' : '0 h';
  if (days < 1) {
    const hours = Math.round(days * 24 * 10) / 10;
    return `${formatShown(hours === 0 ? 0.1 : hours)} ${ru ? 'ч' : 'h'}`;
  }
  const shown = Math.round(days * 10) / 10;
  return `${formatShown(shown)} ${ru ? ruDayWord(shown) : shown === 1 ? 'day' : 'days'}`;
}

export function formatStoryPoints(value: number): string {
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  return `${shown} SP`;
}

function toBar(issue: NormalizedIssue, options?: CycleOverviewFilters): CycleBar {
  const key = issue.key.trim().toUpperCase();
  const overrideStart = parseDate(options?.startOverrides?.[key]);
  const overrideEnd = parseDate(options?.endOverrides?.[key]);
  const changelogStart = issue.firstInProgress;
  const changelogDone = issue.doneAt!;
  const started = overrideStart ?? parseDate(changelogStart);
  const done = overrideEnd ?? parseDate(changelogDone);
  const cycleTimeDays = cycleSpanDays(started, done, issue.cycleTimeDays, options, overrideStart, overrideEnd);
  const qaWipDays = Math.min(cycleTimeDays, cycleQaWipDays(issue, started, done, options));
  return {
    key: issue.key,
    url: issue.url,
    summary: issue.summary,
    assigneeName: issue.assigneeName,
    storyPoints: issue.storyPoints,
    firstInProgress: overrideStart ? overrideStart.toISOString() : changelogStart,
    changelogStart: overrideStart ? changelogStart : undefined,
    startOverridden: Boolean(overrideStart),
    doneAt: overrideEnd ? overrideEnd.toISOString() : changelogDone,
    changelogDone: overrideEnd ? changelogDone : undefined,
    endOverridden: Boolean(overrideEnd),
    cycleTimeDays,
    qaWipDays,
    devDays: Math.max(0, cycleTimeDays - qaWipDays),
  };
}

/** Time in Ready to QA between cycle start and first cycle-end. Repeat visits are summed. */
export function cycleQaWipDays(
  issue: Pick<NormalizedIssue, 'status' | 'created' | 'statusTransitions'>,
  started: Date | undefined,
  done: Date | undefined,
  options?: Pick<CycleOverviewFilters, 'workingDays' | 'holidays'>,
): number {
  if (!started || !done || done.getTime() <= started.getTime()) return 0;
  const transitions = issue.statusTransitions;
  if (!transitions || transitions.length === 0) return 0;
  const fromMs = started.getTime();
  const toMs = done.getTime();
  const ordered = sortTransitions(transitions);
  let status = statusAt(ordered, issue.status, issue.created, started);
  let cursor = fromMs;
  let qa = 0;
  const add = (name: string, from: number, to: number) => {
    if (to <= from || !isQaWipStatus(name)) return;
    qa += options?.workingDays
      ? workingElapsedDays(new Date(from), new Date(to), options.holidays ?? [])
      : elapsedDays(new Date(from), new Date(to));
  };
  for (const item of ordered) {
    const at = parseDate(item.at);
    if (!at) continue;
    const next = at.getTime();
    if (next <= cursor) {
      status = item.to;
      continue;
    }
    if (next >= toMs) {
      add(status, cursor, toMs);
      cursor = toMs;
      break;
    }
    add(status, cursor, next);
    status = item.to;
    cursor = next;
  }
  if (toMs > cursor) add(status, cursor, toMs);
  return Math.max(0, qa);
}

/**
 * Cycle length for the selected day mode.
 * Calendar mode keeps the stored span. Working mode drops weekends and holidays.
 */
export function cycleTimeInMode(
  issue: Pick<NormalizedIssue, 'firstInProgress' | 'doneAt' | 'cycleTimeDays'>,
  options?: { workingDays?: boolean; holidays?: Iterable<string> },
): number | undefined {
  if (!options?.workingDays) return issue.cycleTimeDays;
  const started = parseDate(issue.firstInProgress);
  const done = parseDate(issue.doneAt);
  if (!started || !done) return issue.cycleTimeDays;
  return Math.max(0, workingElapsedDays(started, done, options.holidays ?? []));
}

function cycleSpanDays(
  started: Date | undefined,
  done: Date | undefined,
  stored: number | undefined,
  options: CycleOverviewFilters | undefined,
  overrideStart: Date | undefined,
  overrideEnd: Date | undefined,
): number {
  if (started && done) {
    if (options?.workingDays) return Math.max(0, workingElapsedDays(started, done, options.holidays ?? []));
    if (overrideStart || overrideEnd) return Math.max(0, elapsedDays(started, done));
    if (typeof stored !== 'number' || stored <= 0) return Math.max(0, elapsedDays(started, done));
  }
  return stored ?? 0;
}

function formatStamp(iso?: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

function formatShown(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

