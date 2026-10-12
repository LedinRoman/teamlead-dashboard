import type { FlowStageId, FlowWorkflow, NormalizedIssue } from '@shared/types';
import { cycleTimeInMode } from './cycle-overview';
import { classifyFlowIssue } from './flow-classify';
import { lastEntryIntoStatus, reworkStartedAt } from './flow-timeline';
import { daysBetween, elapsedDays, parseDate, workingDaysBetween, workingElapsedDays } from './time';

export type FlowEpisodeKind = 'active' | 'rework';

export interface FlowAgingAges {
  kind: FlowEpisodeKind;
  episodeLabel: 'In progress';
  episodeDays: number;
  statusDays: number;
  /** Episode minus time in the current status. For Проверка, honors doneAt (incl. override). */
  executionDays: number;
  episodeStartedAt?: string;
  statusEnteredAt?: string;
  originalCycleTimeDays?: number;
}

export type FlowAgingAttention = 'blocked' | 'p85' | 'median';

export function durationDays(
  from: Date | undefined,
  to: Date,
  workingDays?: boolean,
  holidays?: Iterable<string>,
): number {
  if (!from) return 0;
  return workingDays ? workingDaysBetween(from, to, holidays ?? []) : daysBetween(from, to);
}

/** Same as `durationDays`, but without 0.1-day rounding so short visits still add up. */
export function durationDaysPrecise(
  from: Date | undefined,
  to: Date,
  workingDays?: boolean,
  holidays?: Iterable<string>,
): number {
  if (!from) return 0;
  return workingDays ? workingElapsedDays(from, to, holidays ?? []) : elapsedDays(from, to);
}

export function flowAgingAges(
  issue: NormalizedIssue,
  workflow: FlowWorkflow,
  now: Date,
  options?: { workingDays?: boolean; holidays?: Iterable<string> },
): FlowAgingAges | undefined {
  const classified = classifyFlowIssue(issue, workflow);
  if (!classified.inAging) return undefined;

  const firstStart = parseDate(issue.firstInProgress);
  const reworkStart =
    classified.rework && issue.statusTransitions
      ? reworkStartedAt(issue.statusTransitions, workflow, issue.doneAt)
      : classified.rework
        ? parseDate(issue.statusEnteredAt) ?? firstStart
        : undefined;
  const episodeStart = classified.rework ? reworkStart ?? firstStart : firstStart;
  if (!episodeStart) return undefined;

  const statusEntered =
    parseDate(issue.statusEnteredAt) ??
    (issue.statusTransitions
      ? parseDate(lastEntryIntoStatus(issue.statusTransitions, issue.status)?.at)
      : undefined) ??
    episodeStart;

  const working = options?.workingDays;
  const holidays = options?.holidays;
  const episodeDays = Math.max(0, durationDays(episodeStart, now, working, holidays));
  const statusDays = Math.max(0, durationDays(statusEntered, now, working, holidays));
  const executionEnd = classified.inReview
    ? parseDate(issue.doneAt) ?? statusEntered
    : statusEntered;

  return {
    kind: classified.rework ? 'rework' : 'active',
    episodeLabel: 'In progress',
    episodeDays,
    statusDays,
    executionDays: Math.max(0, durationDays(episodeStart, executionEnd, working, holidays)),
    episodeStartedAt: episodeStart.toISOString(),
    statusEnteredAt: statusEntered.toISOString(),
    originalCycleTimeDays: classified.rework ? cycleTimeInMode(issue, options) : undefined,
  };
}

export function isAgingCompletedStatus(stage: FlowStageId): boolean {
  return stage === 'inReview' || stage === 'done';
}

export function agingCompareDays(stage: FlowStageId, ages: FlowAgingAges): number {
  return isAgingCompletedStatus(stage) ? ages.executionDays : ages.episodeDays;
}

export function agingAttention(
  row: { blocked: boolean; stage: FlowStageId; ages: FlowAgingAges },
  thresholds: { median: number; p85: number } | null | undefined,
): FlowAgingAttention | undefined {
  if (row.blocked) return 'blocked';
  if (!thresholds) return undefined;
  const days = agingCompareDays(row.stage, row.ages);
  if (days > thresholds.p85) return 'p85';
  if (days > thresholds.median) return 'median';
  return undefined;
}

export function flowStageLabel(stage: FlowStageId): string {
  switch (stage) {
    case 'development':
      return 'Development';
    case 'review':
      return 'Review';
    case 'rework':
      return 'Development';
    case 'inReview':
      return 'In review';
    case 'qaQueue':
      return 'QA WIP';
    case 'qa':
      return 'QA';
    case 'readyForRelease':
      return 'Awaiting release';
    case 'notStarted':
      return 'To do';
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Other';
  }
}
