import type { FlowStageId, FlowWorkflow, StatusTransition } from '@shared/types';
import { exclusiveStageOf, statusInList } from './flow-workflow';
import { parseDate } from './time';

export function sortTransitions(transitions: StatusTransition[] | undefined): StatusTransition[] {
  if (!transitions || transitions.length === 0) return [];
  return [...transitions].sort((left, right) => left.at.localeCompare(right.at) || left.to.localeCompare(right.to));
}

export function firstEntryMatching(
  transitions: StatusTransition[],
  match: (status: string) => boolean,
): StatusTransition | undefined {
  return sortTransitions(transitions).find((item) => match(item.to));
}

export function lastEntryMatching(
  transitions: StatusTransition[],
  match: (status: string) => boolean,
  after?: Date,
): StatusTransition | undefined {
  const afterMs = after?.getTime();
  let found: StatusTransition | undefined;
  for (const item of sortTransitions(transitions)) {
    const at = parseDate(item.at);
    if (!at) continue;
    if (afterMs !== undefined && at.getTime() <= afterMs) continue;
    if (match(item.to)) found = item;
  }
  return found;
}

export function lastEntryIntoStatus(transitions: StatusTransition[], status: string): StatusTransition | undefined {
  return lastEntryMatching(transitions, (to) => to.trim().toLowerCase() === status.trim().toLowerCase());
}

export function firstCycleEndAt(transitions: StatusTransition[], workflow: FlowWorkflow): Date | undefined {
  const hit = firstEntryMatching(
    transitions,
    (to) => statusInList(to, workflow.inReview) || statusInList(to, [workflow.cycleEnd]),
  );
  return hit ? parseDate(hit.at) : undefined;
}

export function reworkStartedAt(
  transitions: StatusTransition[],
  workflow: FlowWorkflow,
  firstDoneAt?: string,
): Date | undefined {
  const after = parseDate(firstDoneAt);
  if (!after) return undefined;
  const hit = lastEntryMatching(
    transitions,
    (to) => {
      const stage = exclusiveStageOf(to, workflow);
      return stage === 'development' || stage === 'review' || stage === 'rework';
    },
    after,
  );
  return hit ? parseDate(hit.at) : undefined;
}

export interface StageInterval {
  stage: FlowStageId;
  status?: string;
  from: number;
  to: number;
  ms: number;
}

/**
 * Time spent in each exclusive stage from created (or first transition from)
 * until the first cycle-end. Repeat visits are summed. Unknown names keep the
 * Jira status so «Другое» can be split.
 */
export function stageIntervalsUntilFirstReview(
  transitions: StatusTransition[],
  workflow: FlowWorkflow,
  created?: string,
  firstDoneAt?: string,
): StageInterval[] {
  const ordered = sortTransitions(transitions);
  const end = parseDate(firstDoneAt) ?? firstCycleEndAt(ordered, workflow);
  if (!end) return [];
  const start = parseDate(created) ?? (ordered[0] ? parseDate(ordered[0].at) : undefined);
  if (!start) return [];

  let cursor = start.getTime();
  let status = ordered[0]?.from ?? '';
  let stage: FlowStageId = status ? exclusiveStageOf(status, workflow) : 'notStarted';
  const slices: StageInterval[] = [];

  const add = (id: FlowStageId, name: string, from: number, to: number) => {
    if (to <= from) return;
    slices.push({ stage: id, status: name || undefined, from, to, ms: to - from });
  };

  for (const item of ordered) {
    const at = parseDate(item.at);
    if (!at) continue;
    const next = Math.min(at.getTime(), end.getTime());
    if (next > cursor) add(stage, status, cursor, next);
    if (at.getTime() >= end.getTime()) {
      cursor = end.getTime();
      break;
    }
    status = item.to;
    stage = exclusiveStageOf(item.to, workflow);
    cursor = at.getTime();
  }
  if (end.getTime() > cursor) add(stage, status, cursor, end.getTime());
  return slices;
}

export function statusAt(
  transitions: StatusTransition[],
  currentStatus: string,
  created: string | undefined,
  at: Date,
): string {
  const ordered = sortTransitions(transitions);
  if (ordered.length === 0) return currentStatus;
  const createdAt = parseDate(created);
  let status = ordered[0]?.from ?? currentStatus;
  if (createdAt && at.getTime() < createdAt.getTime()) return status;
  for (const item of ordered) {
    const when = parseDate(item.at);
    if (!when || when.getTime() > at.getTime()) break;
    status = item.to;
  }
  return status;
}
