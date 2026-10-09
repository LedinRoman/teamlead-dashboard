import type { FlowWorkflow, JiraSprintOption, StatusTransition } from '@shared/types';
import { isAllowedCycleType, isCycleExcluded, type CycleOverviewFilters } from './cycle-overview';
import { exclusiveStageOf } from './flow-workflow';
import { statusAt } from './flow-timeline';
import { matchesAny } from './rules';
import { parseDate, round1 } from './time';
import { estimateAt, estimateDeltaInWindow, namedValueAt, type EstimateChange, type NamedChange } from './predictability-estimates';
import {
  countConsecutiveSpillovers,
  firstAddedAfter,
  inSprintAt,
  lastRemovedInWindow,
  wasMemberInWindow,
  type SprintBound,
  type SprintFieldChange,
} from './predictability-membership';

export type PredictabilityQuality = 'exact' | 'reconstructed' | 'partial' | 'unavailable';

export type PredictabilityCategory =
  | 'committed-completed'
  | 'spillover'
  | 'still-unfinished'
  | 'removed'
  | 'cancelled'
  | 'added-completed'
  | 'added-unfinished'
  | 'already-done'
  | 'excluded';

export interface PredictabilityIssueInput {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  created: string;
  currentStoryPoints?: number;
  currentSprintIds?: number[];
  assigneeId?: string;
  assigneeName?: string;
  doneAt?: string;
  sprintChanges: SprintFieldChange[];
  estimateChanges: EstimateChange[];
  typeChanges?: NamedChange[];
  statusTransitions?: StatusTransition[];
  changelogComplete: boolean;
}

export interface PredictabilityTask {
  key: string;
  url: string;
  summary: string;
  type: string;
  currentStoryPoints?: number;
  baselineStoryPoints?: number;
  category: PredictabilityCategory;
  addedAt?: string;
  removedAt?: string;
  doneAt?: string;
  status: string;
  spilloverCount: number;
  createdInSprint: boolean;
  created?: string;
  unestimated: boolean;
  estimateDelta?: number;
  assigneeId?: string;
  assigneeName?: string;
  quality: PredictabilityQuality;
}

export interface CountWithSp {
  tasks: number;
  storyPoints: number;
  unestimated: number;
}

export interface ReliabilityMetric {
  taskPercent: number | null;
  spPercent: number | null;
  completedTasks: number;
  committedTasks: number;
  completedSp: number;
  committedSp: number;
  unestimated: number;
}

export interface RatioMetric {
  tasks: number;
  storyPoints: number;
  unestimated: number;
  percentOfCommitment: number | null;
  completedTasks: number;
  completedSp: number;
}

export interface PredictabilitySummary {
  reliability: ReliabilityMetric;
  added: RatioMetric;
  removed: RatioMetric;
  spillover: CountWithSp;
  unplanned: RatioMetric;
  estimate: { increase: number; decrease: number; changedTasks: number; available: boolean };
  initial: CountWithSp;
  final: CountWithSp;
}

export interface PredictabilityBreakdown {
  committed: Array<{ category: PredictabilityCategory; tasks: number; storyPoints: number }>;
  added: Array<{ category: PredictabilityCategory; tasks: number; storyPoints: number }>;
}

export interface PredictabilitySnapshot {
  sprint: JiraSprintOption;
  incomplete: boolean;
  elapsedPct?: number;
  quality: PredictabilityQuality;
  warnings: string[];
  summary: PredictabilitySummary;
  breakdown: PredictabilityBreakdown;
  tasks: PredictabilityTask[];
  comparison?: PredictabilityComparison;
  history?: PredictabilityHistoryRow[];
  historyHorizon?: { requested: number; used: number };
}

export interface PredictabilityHistoryRow {
  sprintId: number;
  name: string;
  incomplete: boolean;
  current: boolean;
  throughputTasks: number;
  throughputSp: number;
  addedTasks: number;
  addedSp: number;
  dropTasks: number;
  dropSp: number;
  doneTasks: number;
  doneSp: number;
}

export interface PredictabilityComparison {
  sprint: JiraSprintOption;
  incomplete: boolean;
  quality: PredictabilityQuality;
  summary: PredictabilitySummary;
  deltas: {
    reliabilityTasks: number | null;
    reliabilitySp: number | null;
    initialTasks: number;
    initialSp: number;
    addedTasks: number;
    addedSp: number;
    removedTasks: number;
    removedSp: number;
    spilloverTasks: number;
    spilloverSp: number;
    unplannedTasks: number;
    unplannedSp: number;
  };
}

export interface BuildPredictabilityOptions {
  sprint: JiraSprintOption;
  issues: PredictabilityIssueInput[];
  orderedSprints?: JiraSprintOption[];
  workflow: FlowWorkflow;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  excludedTypes?: string[];
  now?: Date;
  sourceQuality?: PredictabilityQuality;
}

export function sprintAnalysisWindow(
  sprint: JiraSprintOption,
  now: Date,
): { start?: Date; end?: Date; plannedEnd?: Date; incomplete: boolean } {
  const start = parseDate(sprint.startDate);
  const plannedEnd = parseDate(sprint.endDate);
  const complete = parseDate(sprint.completeDate);
  const active = sprint.state === 'active';
  const incomplete = active || Boolean(plannedEnd && plannedEnd.getTime() > now.getTime());
  const end = incomplete ? now : complete ?? plannedEnd;
  return { start, end, plannedEnd, incomplete };
}

export function elapsedSprintPct(
  start: Date | undefined,
  plannedEnd: Date | undefined,
  now: Date,
): number | undefined {
  if (!start || !plannedEnd) return undefined;
  const span = plannedEnd.getTime() - start.getTime();
  if (span <= 0) return undefined;
  return round1(Math.max(0, Math.min(100, ((now.getTime() - start.getTime()) / span) * 100)));
}

export function buildPredictability(options: BuildPredictabilityOptions): PredictabilitySnapshot {
  const now = options.now ?? new Date();
  const window = sprintAnalysisWindow(options.sprint, now);
  const warnings: string[] = [];
  const tasks: PredictabilityTask[] = [];

  if (!options.workflow.cycleEnd?.trim() && options.workflow.inReview.length === 0) {
    warnings.push('Не настроена аналитическая точка завершения');
  }
  if (!window.start) {
    return emptySnapshot(options.sprint, window.incomplete, 'unavailable', [
      'История состава спринта недоступна: нет даты старта спринта',
    ]);
  }
  if (!window.end) {
    return emptySnapshot(options.sprint, window.incomplete, 'unavailable', [
      'История состава спринта недоступна: нет даты окончания спринта',
    ]);
  }

  const start = window.start;
  const end = window.end;
  const orderedSprints = toSprintBounds(options.orderedSprints ?? [options.sprint], now);
  const filters: CycleOverviewFilters = {
    excludeQaTitle: options.excludeQaTitle,
    excludedKeys: options.excludedKeys,
  };

  let anyIncompleteChangelog = false;
  let anyMember = false;

  for (const issue of options.issues) {
    const typeAtStart = namedValueAt(issue.typeChanges ?? [], start, issue.type) ?? issue.type;
    if (options.excludedTypes && options.excludedTypes.length > 0 && matchesAny(typeAtStart, options.excludedTypes)) {
      continue;
    }
    const excluded =
      !isAllowedCycleType(typeAtStart) ||
      isCycleExcluded({ key: issue.key, summary: issue.summary, assigneeId: issue.assigneeId }, filters);
    if (!issue.changelogComplete) anyIncompleteChangelog = true;

    const sprintChanges = effectiveSprintChanges(issue, options.sprint.id);
    const committed = inSprintAt(sprintChanges, options.sprint.id, start);
    const firstAdd = firstAddedAfter(sprintChanges, options.sprint.id, start);
    const memberInWindow = wasMemberInWindow(sprintChanges, options.sprint.id, start, end);
    const added = !committed && (Boolean(firstAdd) || memberInWindow);
    if (!committed && !added && !excluded) continue;
    anyMember = true;

    const inAtEnd = inSprintAt(sprintChanges, options.sprint.id, end);
    const removedAt = committed ? lastRemovedInWindow(sprintChanges, options.sprint.id, start, end) : undefined;
    const addedAt = added ? firstAdd ?? (memberInWindow ? start : undefined) : undefined;
    const baselineAt = committed ? start : addedAt ?? start;
    const baselineSp = estimateAt(issue.estimateChanges, baselineAt);
    const doneAt = parseDate(issue.doneAt);
    const completedBeforeStart = Boolean(doneAt && doneAt.getTime() < start.getTime());
    const completedInWindow = Boolean(doneAt && doneAt.getTime() >= start.getTime() && doneAt.getTime() <= end.getTime());
    const statusAtEnd = statusAt(issue.statusTransitions ?? [], issue.status, issue.created, end);
    const cancelled = exclusiveStageOf(statusAtEnd, options.workflow) === 'cancelled';
    const createdAt = parseDate(issue.created);
    const createdInSprint = Boolean(createdAt && createdAt.getTime() >= start.getTime());
    const delta = estimateDeltaInWindow(issue.estimateChanges, baselineAt, end);
    const estimateDelta =
      delta.changedTasks > 0 ? round1(delta.increase - delta.decrease) : undefined;
    const quality: PredictabilityQuality = issue.changelogComplete
      ? options.sourceQuality === 'exact'
        ? 'exact'
        : 'reconstructed'
      : 'partial';

    let category: PredictabilityCategory;
    if (excluded) category = 'excluded';
    else if (committed && completedBeforeStart) category = 'already-done';
    else if (committed && completedInWindow) category = 'committed-completed';
    else if (committed && cancelled && !completedInWindow) category = 'cancelled';
    else if (committed && removedAt && !inAtEnd) category = 'removed';
    else if (committed && window.incomplete) category = 'still-unfinished';
    else if (committed) category = 'spillover';
    else if (added && completedInWindow) category = 'added-completed';
    else category = 'added-unfinished';

    const spilloverCount =
      category === 'spillover' || category === 'still-unfinished'
        ? countConsecutiveSpillovers(sprintChanges, orderedSprints, options.sprint.id, doneAt)
        : 0;

    tasks.push({
      key: issue.key,
      url: issue.url,
      summary: issue.summary,
      type: typeAtStart,
      currentStoryPoints: issue.currentStoryPoints,
      baselineStoryPoints: baselineSp,
      category,
      addedAt: addedAt?.toISOString(),
      removedAt: removedAt?.toISOString(),
      doneAt: issue.doneAt,
      status: issue.status,
      spilloverCount,
      createdInSprint,
      created: issue.created,
      unestimated: baselineSp === undefined,
      estimateDelta,
      assigneeId: issue.assigneeId,
      assigneeName: issue.assigneeName,
      quality,
    });
  }

  tasks.sort(sortPredictabilityTasks);

  const quality: PredictabilityQuality = !anyMember
    ? 'reconstructed'
    : anyIncompleteChangelog
      ? 'partial'
      : options.sourceQuality === 'exact'
        ? 'exact'
        : 'reconstructed';

  if (anyIncompleteChangelog) {
    warnings.push('Метрика рассчитана по неполным данным: changelog части задач обрезан');
  }
  const unestimated = tasks.filter(
    (task) =>
      (task.category === 'committed-completed' ||
        task.category === 'spillover' ||
        task.category === 'still-unfinished' ||
        task.category === 'removed' ||
        task.category === 'cancelled') &&
      task.unestimated,
  ).length;
  if (unestimated > 0) {
    warnings.push(`В спринте есть ${unestimated} ${taskWord(unestimated)} без оценки`);
  }
  if (window.incomplete) {
    warnings.push('Спринт ещё не завершён — показан текущий прогресс');
  }

  const summary = summarizeTasks(tasks, !anyIncompleteChangelog);
  if (summary.reliability.committedTasks === 0) {
    warnings.unshift('В спринте не было первоначального commitment');
  }

  return {
    sprint: options.sprint,
    incomplete: window.incomplete,
    elapsedPct: window.incomplete ? elapsedSprintPct(start, window.plannedEnd, now) : undefined,
    quality,
    warnings: unique(warnings),
    summary,
    breakdown: {
      committed: breakdownRow(tasks, ['committed-completed', 'spillover', 'still-unfinished', 'removed', 'cancelled']),
      added: breakdownRow(tasks, ['added-completed', 'added-unfinished']),
    },
    tasks,
  };
}

export function predictabilityHistoryRow(
  snapshot: PredictabilitySnapshot,
  currentSprintId?: number,
  now = new Date(),
): PredictabilityHistoryRow {
  const window = sprintAnalysisWindow(snapshot.sprint, now);
  const start = window.start?.getTime();
  const end = window.end?.getTime();
  let throughputTasks = 0;
  let throughputSp = 0;
  for (const task of snapshot.tasks) {
    if (task.category === 'excluded' || task.category === 'already-done') continue;
    const done = parseDate(task.doneAt)?.getTime();
    if (done === undefined) continue;
    if (start !== undefined && done < start) continue;
    if (end !== undefined && done > end) continue;
    throughputTasks += 1;
    const points = task.baselineStoryPoints ?? task.currentStoryPoints;
    if (points !== undefined) throughputSp = round1(throughputSp + points);
  }
  const doneTasks = snapshot.summary.reliability.completedTasks + snapshot.summary.unplanned.tasks;
  const doneSp = round1(snapshot.summary.reliability.completedSp + snapshot.summary.unplanned.storyPoints);
  return {
    sprintId: snapshot.sprint.id,
    name: snapshot.sprint.name,
    incomplete: snapshot.incomplete,
    current: currentSprintId === snapshot.sprint.id,
    throughputTasks,
    throughputSp,
    addedTasks: snapshot.summary.added.tasks,
    addedSp: snapshot.summary.added.storyPoints,
    dropTasks: snapshot.summary.removed.tasks,
    dropSp: snapshot.summary.removed.storyPoints,
    doneTasks,
    doneSp,
  };
}

export function comparePredictability(
  current: PredictabilitySnapshot,
  previous: PredictabilitySnapshot,
): PredictabilityComparison {
  const a = current.summary;
  const b = previous.summary;
  return {
    sprint: previous.sprint,
    incomplete: previous.incomplete,
    quality: previous.quality,
    summary: b,
    deltas: {
      reliabilityTasks: deltaPct(a.reliability.taskPercent, b.reliability.taskPercent),
      reliabilitySp: deltaPct(a.reliability.spPercent, b.reliability.spPercent),
      initialTasks: a.initial.tasks - b.initial.tasks,
      initialSp: round1(a.initial.storyPoints - b.initial.storyPoints),
      addedTasks: a.added.tasks - b.added.tasks,
      addedSp: round1(a.added.storyPoints - b.added.storyPoints),
      removedTasks: a.removed.tasks - b.removed.tasks,
      removedSp: round1(a.removed.storyPoints - b.removed.storyPoints),
      spilloverTasks: a.spillover.tasks - b.spillover.tasks,
      spilloverSp: round1(a.spillover.storyPoints - b.spillover.storyPoints),
      unplannedTasks: a.unplanned.tasks - b.unplanned.tasks,
      unplannedSp: round1(a.unplanned.storyPoints - b.unplanned.storyPoints),
    },
  };
}

export function sortPredictabilityTasks(left: PredictabilityTask, right: PredictabilityTask): number {
  const rank = attentionRank(left) - attentionRank(right);
  if (rank !== 0) return rank;
  if (right.spilloverCount !== left.spilloverCount) return right.spilloverCount - left.spilloverCount;
  return left.key.localeCompare(right.key);
}

function attentionRank(task: PredictabilityTask): number {
  if (task.category === 'excluded' || task.category === 'already-done') return 6;
  if (task.spilloverCount >= 2) return 0;
  if (task.category === 'spillover' || task.category === 'still-unfinished') return 1;
  if (task.category === 'removed' || task.category === 'cancelled') return 2;
  if (task.category === 'added-unfinished') return 3;
  if (task.category === 'added-completed') return 4;
  return 5;
}

function summarizeTasks(tasks: PredictabilityTask[], estimatesAvailable: boolean): PredictabilitySummary {
  const committed = tasks.filter(isCommittedCategory);
  const committedDone = tasks.filter((task) => task.category === 'committed-completed');
  const added = tasks.filter((task) => task.category === 'added-completed' || task.category === 'added-unfinished');
  const addedDone = tasks.filter((task) => task.category === 'added-completed');
  const removed = tasks.filter((task) => task.category === 'removed');
  const spillover = tasks.filter(
    (task) => task.category === 'spillover' || task.category === 'still-unfinished',
  );
  const initial = countOf(committed);
  const committedDoneCount = countOf(committedDone);
  const addedCount = countOf(added);
  const addedDoneCount = countOf(addedDone);
  const removedCount = countOf(removed);
  const spilloverCount = countOf(spillover);
  const completedAllTasks = committedDoneCount.tasks + addedDoneCount.tasks;

  let increase = 0;
  let decrease = 0;
  let changedTasks = 0;
  for (const task of [...committed, ...added]) {
    if (task.estimateDelta === undefined || task.estimateDelta === 0) continue;
    changedTasks += 1;
    if (task.estimateDelta > 0) increase = round1(increase + task.estimateDelta);
    else decrease = round1(decrease + Math.abs(task.estimateDelta));
  }

  const finalTasks = committedDoneCount.tasks + spilloverCount.tasks + addedCount.tasks;
  const finalSp = round1(
    committedDoneCount.storyPoints + spilloverCount.storyPoints + addedCount.storyPoints,
  );

  return {
    reliability: {
      taskPercent: percent(committedDoneCount.tasks, initial.tasks),
      spPercent: percent(committedDoneCount.storyPoints, initial.storyPoints),
      completedTasks: committedDoneCount.tasks,
      committedTasks: initial.tasks,
      completedSp: committedDoneCount.storyPoints,
      committedSp: initial.storyPoints,
      unestimated: initial.unestimated,
    },
    added: {
      ...addedCount,
      percentOfCommitment: percent(addedCount.storyPoints, initial.storyPoints),
      completedTasks: addedDoneCount.tasks,
      completedSp: addedDoneCount.storyPoints,
    },
    removed: {
      ...removedCount,
      percentOfCommitment: percent(removedCount.storyPoints, initial.storyPoints),
      completedTasks: 0,
      completedSp: 0,
    },
    spillover: spilloverCount,
    unplanned: {
      ...addedDoneCount,
      percentOfCommitment:
        completedAllTasks > 0 ? percent(addedDoneCount.tasks, completedAllTasks) : null,
      completedTasks: addedDoneCount.tasks,
      completedSp: addedDoneCount.storyPoints,
    },
    estimate: { increase, decrease, changedTasks, available: estimatesAvailable },
    initial,
    final: { tasks: finalTasks, storyPoints: finalSp, unestimated: 0 },
  };
}

function isCommittedCategory(task: PredictabilityTask): boolean {
  return (
    task.category === 'committed-completed' ||
    task.category === 'spillover' ||
    task.category === 'still-unfinished' ||
    task.category === 'removed' ||
    task.category === 'cancelled'
  );
}

function countOf(tasks: PredictabilityTask[]): CountWithSp {
  const bucket: CountWithSp = { tasks: 0, storyPoints: 0, unestimated: 0 };
  for (const task of tasks) {
    bucket.tasks += 1;
    if (task.baselineStoryPoints === undefined) bucket.unestimated += 1;
    else bucket.storyPoints = round1(bucket.storyPoints + task.baselineStoryPoints);
  }
  return bucket;
}

function breakdownRow(
  tasks: PredictabilityTask[],
  categories: PredictabilityCategory[],
): Array<{ category: PredictabilityCategory; tasks: number; storyPoints: number }> {
  return categories
    .map((category) => {
      const slice = tasks.filter((task) => task.category === category);
      const counted = countOf(slice);
      return { category, tasks: counted.tasks, storyPoints: counted.storyPoints };
    })
    .filter((row) => row.tasks > 0);
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round1((numerator / denominator) * 100);
}

function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return round1(current - previous);
}

function toSprintBounds(sprints: JiraSprintOption[], now: Date): SprintBound[] {
  const bounds: SprintBound[] = [];
  for (const sprint of sprints) {
    const window = sprintAnalysisWindow(sprint, now);
    if (!window.start || !window.end) continue;
    bounds.push({ id: sprint.id, start: window.start, end: window.end });
  }
  return bounds.sort((left, right) => left.start.getTime() - right.start.getTime());
}

function emptySnapshot(
  sprint: JiraSprintOption,
  incomplete: boolean,
  quality: PredictabilityQuality,
  warnings: string[],
): PredictabilitySnapshot {
  const empty: CountWithSp = { tasks: 0, storyPoints: 0, unestimated: 0 };
  const emptyRatio: RatioMetric = { ...empty, percentOfCommitment: null, completedTasks: 0, completedSp: 0 };
  return {
    sprint,
    incomplete,
    quality,
    warnings,
    summary: {
      reliability: {
        taskPercent: null,
        spPercent: null,
        completedTasks: 0,
        committedTasks: 0,
        completedSp: 0,
        committedSp: 0,
        unestimated: 0,
      },
      added: emptyRatio,
      removed: emptyRatio,
      spillover: empty,
      unplanned: emptyRatio,
      estimate: { increase: 0, decrease: 0, changedTasks: 0, available: false },
      initial: empty,
      final: empty,
    },
    breakdown: { committed: [], added: [] },
    tasks: [],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function taskWord(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return 'задача';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'задачи';
  return 'задач';
}

/**
 * Complete changelog with no Sprint items means the current sprint field never
 * changed. Membership is then that field from created onward — not a guess from
 * whoever happens to sit in the sprint now after later moves.
 */
function effectiveSprintChanges(issue: PredictabilityIssueInput, sprintId: number): SprintFieldChange[] {
  if (issue.sprintChanges.length > 0) return issue.sprintChanges;
  const current = issue.currentSprintIds ?? [];
  if (!issue.changelogComplete || !current.includes(sprintId)) return issue.sprintChanges;
  return [{ at: issue.created, fromIds: [], toIds: current }];
}
