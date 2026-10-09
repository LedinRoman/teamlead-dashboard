import type { FlowStageId, FlowWorkflow, NormalizedIssue, StatusTransition } from '@shared/types';
import { durationDaysPrecise, flowStageLabel } from './flow-aging';
import { exclusiveStageOf, statusInList } from './flow-workflow';
import { statusEquals } from './rules';
import { parseDate } from './time';
import { sortTransitions } from './flow-timeline';

export interface FlowIssueTimeline {
  key: string;
  url: string;
  summary: string;
  status: string;
  assigneeName: string;
  created: string;
  firstInProgress?: string;
  doneAt?: string;
  transitions: StatusTransition[];
  truncatedHint?: string;
}

export interface FlowTimelineSegment {
  status: string;
  stage: FlowStageId;
  stageLabel: string;
  blocked: boolean;
  from: string;
  to: string;
  ms: number;
  days: number;
}

export interface FlowTimelineStatusTotal {
  status: string;
  stage: FlowStageId;
  stageLabel: string;
  blocked: boolean;
  days: number;
  visits: number;
}

export function toFlowIssueTimeline(issue: NormalizedIssue): FlowIssueTimeline {
  const transitions = issue.statusTransitions ?? [];
  return {
    key: issue.key,
    url: issue.url,
    summary: issue.summary,
    status: issue.status,
    assigneeName: issue.assigneeName,
    created: issue.created,
    firstInProgress: issue.firstInProgress,
    doneAt: issue.doneAt,
    transitions,
    truncatedHint:
      transitions.length >= 80
        ? 'История статусов может быть обрезана (~100 событий в ответе Jira).'
        : undefined,
  };
}

export function buildIssueTimelineSegments(
  issue: Pick<FlowIssueTimeline, 'created' | 'status' | 'transitions'>,
  workflow: FlowWorkflow,
  now: Date = new Date(),
  options?: { workingDays?: boolean; holidays?: Iterable<string> },
): FlowTimelineSegment[] {
  const ordered = sortTransitions(issue.transitions);
  const created = parseDate(issue.created) ?? (ordered[0] ? parseDate(ordered[0].at) : undefined);
  if (!created) return [];

  let cursor = created.getTime();
  let status = ordered[0]?.from || issue.status;
  const end = now.getTime();
  const slices: FlowTimelineSegment[] = [];

  const add = (name: string, from: number, to: number) => {
    if (to <= from || !name) return;
    const stage = exclusiveStageOf(name, workflow);
    const blocked = statusInList(name, workflow.blocked);
    slices.push({
      status: name,
      stage,
      stageLabel: blocked && stage === 'other' ? 'Blocked' : flowStageLabel(stage),
      blocked,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      ms: to - from,
      days: durationDaysPrecise(new Date(from), new Date(to), options?.workingDays, options?.holidays),
    });
  };

  for (const item of ordered) {
    const at = parseDate(item.at);
    if (!at) continue;
    const next = Math.min(at.getTime(), end);
    if (next > cursor) add(status, cursor, next);
    if (at.getTime() >= end) {
      cursor = end;
      break;
    }
    status = item.to;
    cursor = at.getTime();
  }
  if (end > cursor) add(status || issue.status, cursor, end);
  return slices;
}

export function visibleIssueTimelineSegments(
  segments: FlowTimelineSegment[],
  excludedStatuses: string[] = [],
): FlowTimelineSegment[] {
  if (excludedStatuses.length === 0) return segments;
  return segments.filter((segment) => !isTimelineStatusExcluded(segment.status, excludedStatuses));
}

export function isTimelineStatusExcluded(status: string, excluded: string[]): boolean {
  return excluded.some((name) => statusEquals(status, name));
}

/** One label per status: case and RU/EN aliases collapse. First spelling wins. */
export function uniqueTimelineStatusNames(names: string[]): string[] {
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (result.some((existing) => statusEquals(existing, trimmed))) continue;
    result.push(trimmed);
  }
  return result.sort((left, right) => left.localeCompare(right, 'ru'));
}

export function issueTimelineStatusTotals(segments: FlowTimelineSegment[]): FlowTimelineStatusTotal[] {
  const rows: FlowTimelineStatusTotal[] = [];
  const index = new Map<string, number>();
  for (const segment of segments) {
    const key = segment.status.trim().toLowerCase();
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, rows.length);
      rows.push({
        status: segment.status,
        stage: segment.stage,
        stageLabel: segment.stageLabel,
        blocked: segment.blocked,
        days: segment.days,
        visits: 1,
      });
      continue;
    }
    const row = rows[existing];
    if (!row) continue;
    row.days += segment.days;
    row.visits += 1;
  }
  return rows;
}

/** Visual weights so a 4-minute Fix is still a visible slice of the bar. */
export function timelineSegmentWeights(segments: Array<{ ms: number; days?: number }>, minPct: number): number[] {
  const values = segments.map((segment) => (segment.days !== undefined ? segment.days : segment.ms));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (segments.length === 0) return [];
  if (total <= 0) return segments.map(() => 1);
  const pct = Math.min(10, Math.max(0, minPct));
  const floor = total * (pct / 100);
  return values.map((value) => Math.max(value, floor));
}
