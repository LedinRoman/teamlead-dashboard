import type { FlowWorkflow, NormalizedIssue } from '@shared/types';
import { localDayKey } from './time';
import { exclusiveStageOf } from './flow-workflow';
import { isFlowDevelopmentWip } from './flow-classify';
import { statusAt } from './flow-timeline';

export interface FlowHistoryPoint {
  day: string;
  developmentWip: number;
}

export interface FlowHistoryModel {
  available: boolean;
  reason?: string;
  points: FlowHistoryPoint[];
}

/**
 * Reconstruct Development WIP at the end of each local day from status transitions.
 * Does not invent points from current status when changelog is missing.
 */
export function buildFlowHistory(
  issues: NormalizedIssue[],
  workflow: FlowWorkflow,
  fromDay: string,
  toDay: string,
): FlowHistoryModel {
  const withTimeline = issues.filter((issue) => (issue.statusTransitions?.length ?? 0) > 0);
  if (withTimeline.length === 0) {
    return {
      available: false,
      reason: 'Исторический WIP недоступен для имеющихся данных',
      points: [],
    };
  }
  if (withTimeline.length / Math.max(1, issues.length) < 0.5) {
    return {
      available: false,
      reason: 'Исторический WIP недоступен: у слишком многих задач нет полной истории статусов.',
      points: [],
    };
  }

  const points: FlowHistoryPoint[] = [];
  const cursor = new Date(`${fromDay}T12:00:00`);
  const last = new Date(`${toDay}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) {
    return { available: false, reason: 'Исторический WIP недоступен для имеющихся данных', points: [] };
  }

  let steps = 0;
  while (cursor.getTime() <= last.getTime() && steps < 400) {
    const endOfDay = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59, 999);
    let developmentWip = 0;
    for (const issue of withTimeline) {
      const status = statusAt(issue.statusTransitions ?? [], issue.status, issue.created, endOfDay);
      const stage = exclusiveStageOf(status, workflow);
      const blocked = workflow.blocked.some((name) => name.toLowerCase() === status.toLowerCase());
      if (isFlowDevelopmentWip(stage, blocked)) developmentWip += 1;
    }
    points.push({ day: localDayKey(cursor), developmentWip });
    cursor.setDate(cursor.getDate() + 1);
    steps += 1;
  }

  return {
    available: true,
    reason: 'Восстановлено по changelog выбранных задач. История Jira может быть обрезана (~100 событий). CFD не строится.',
    points,
  };
}
