import type { JiraSprintOption, NormalizedIssue } from '@shared/types';
import { summarize } from './aggregate';
import { parseDate } from './time';

export interface FlowThroughputPoint {
  sprintId: number;
  name: string;
  count: number;
  storyPoints: number;
  active: boolean;
  incomplete: boolean;
}

export interface FlowThroughputModel {
  points: FlowThroughputPoint[];
  current?: FlowThroughputPoint;
  median: number | null;
  previousClosed?: FlowThroughputPoint;
  delta?: number;
  emptyMessage?: string;
}

/**
 * Unique issues whose first cycle-end (`doneAt`) falls inside the sprint window.
 * Repeat visits to review and transitions to Готово do not add extra counts.
 */
export function buildFlowThroughput(
  issues: NormalizedIssue[],
  sprints: JiraSprintOption[],
  now = new Date(),
): FlowThroughputModel {
  if (sprints.length === 0) {
    return { points: [], median: null, emptyMessage: 'Нет спринтов для throughput.' };
  }

  const points = sprints.map((sprint) => {
    const from = sprint.startDate?.slice(0, 10);
    const to = (sprint.completeDate ?? sprint.endDate)?.slice(0, 10);
    const active = sprint.state === 'active';
    const keys = new Set<string>();
    let storyPoints = 0;
    for (const issue of issues) {
      if (!issue.doneAt) continue;
      const day = issue.doneAt.slice(0, 10);
      if (from && day < from) continue;
      if (to && day > to) continue;
      if (keys.has(issue.key)) continue;
      keys.add(issue.key);
      storyPoints += issue.storyPoints ?? 0;
    }
    const end = parseDate(sprint.endDate);
    const incomplete = active || Boolean(end && end.getTime() > now.getTime());
    return {
      sprintId: sprint.id,
      name: sprint.name,
      count: keys.size,
      storyPoints,
      active,
      incomplete,
    };
  });

  const closedCounts = points.filter((point) => !point.incomplete).map((point) => point.count);
  const summary = summarize(closedCounts.length > 0 ? closedCounts : points.map((point) => point.count));
  const current = points.find((point) => point.active) ?? points[0];
  const previousClosed = [...points].reverse().find((point) => !point.incomplete && point.sprintId !== current?.sprintId);
  const delta =
    current && previousClosed && !current.incomplete ? current.count - previousClosed.count : undefined;

  return {
    points,
    current,
    median: summary?.median ?? null,
    previousClosed,
    delta,
    emptyMessage: points.every((point) => point.count === 0)
      ? 'В выбранном периоде нет задач, переданных на проверку'
      : undefined,
  };
}
