import type { FlowStageId, FlowWorkflow, NormalizedIssue } from '@shared/types';
import { summarize } from './aggregate';
import { durationDays, flowStageLabel } from './flow-aging';
import { stageIntervalsUntilFirstReview } from './flow-timeline';
import { round1 } from './time';

export interface FlowStageTimeRow {
  id: string;
  stage: FlowStageId;
  status?: string;
  label: string;
  median: number | null;
  p85: number | null;
  n: number;
  share: number | null;
}

export interface FlowStageTimeIssue {
  key: string;
  url: string;
  summary: string;
  days: number;
}

export interface FlowStageTimeModel {
  rows: FlowStageTimeRow[];
  issuesByStage: Record<string, FlowStageTimeIssue[]>;
  sampleSize: number;
  emptyMessage?: string;
}

export function buildFlowStageTime(
  issues: NormalizedIssue[],
  workflow: FlowWorkflow,
  options?: { workingDays?: boolean; holidays?: Iterable<string> },
): FlowStageTimeModel {
  const completed = issues.filter((issue) => issue.doneAt && (issue.statusTransitions?.length ?? 0) > 0);
  if (completed.length === 0) {
    return {
      rows: [],
      issuesByStage: {},
      sampleSize: 0,
      emptyMessage: 'Недостаточно данных для расчёта времени по этапам',
    };
  }

  const perKeyDays = new Map<string, number[]>();
  const meta = new Map<string, { stage: FlowStageId; status?: string; label: string }>();
  const issuesByStage: Record<string, FlowStageTimeIssue[]> = {};

  for (const issue of completed) {
    const intervals = stageIntervalsUntilFirstReview(
      issue.statusTransitions ?? [],
      workflow,
      issue.created,
      issue.doneAt,
    );
    const summed = new Map<string, number>();
    for (const interval of intervals) {
      if (interval.stage === 'notStarted') continue;
      const days = durationDays(
        new Date(interval.from),
        new Date(interval.to),
        options?.workingDays,
        options?.holidays,
      );
      const key = rowKey(interval.stage, interval.status);
      if (!meta.has(key)) {
        meta.set(key, {
          stage: interval.stage,
          status: interval.stage === 'other' ? interval.status : undefined,
          label: interval.stage === 'other' ? interval.status || flowStageLabel('other') : flowStageLabel(interval.stage),
        });
      }
      summed.set(key, round1((summed.get(key) ?? 0) + days));
    }
    for (const [key, days] of summed) {
      const list = perKeyDays.get(key) ?? [];
      list.push(days);
      perKeyDays.set(key, list);
      const bucket = issuesByStage[key] ?? [];
      bucket.push({ key: issue.key, url: issue.url, summary: issue.summary, days });
      issuesByStage[key] = bucket;
    }
  }

  const total = [...perKeyDays.values()].flat().reduce((sum, value) => sum + value, 0);
  const stageOrder: FlowStageId[] = ['development', 'review', 'rework', 'qaQueue', 'qa', 'inReview', 'other'];
  const rows = [...perKeyDays.keys()]
    .sort((left, right) => {
      const leftMeta = meta.get(left);
      const rightMeta = meta.get(right);
      const leftRank = stageOrder.indexOf(leftMeta?.stage ?? 'other');
      const rightRank = stageOrder.indexOf(rightMeta?.stage ?? 'other');
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (leftMeta?.label ?? left).localeCompare(rightMeta?.label ?? right, 'ru');
    })
    .map((key) => {
      const values = perKeyDays.get(key) ?? [];
      const info = meta.get(key);
      const summary = summarize(values);
      const stageTotal = values.reduce((sum, value) => sum + value, 0);
      return {
        id: key,
        stage: info?.stage ?? 'other',
        status: info?.status,
        label: info?.label ?? key,
        median: summary?.median ?? null,
        p85: summary?.p85 ?? null,
        n: values.length,
        share: total > 0 ? round1((stageTotal / total) * 100) : null,
      } satisfies FlowStageTimeRow;
    });

  for (const key of Object.keys(issuesByStage)) {
    issuesByStage[key] = [...issuesByStage[key]].sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
  }

  return { rows, issuesByStage, sampleSize: completed.length };
}

function rowKey(stage: FlowStageId, status?: string): string {
  if (stage !== 'other') return stage;
  const name = status?.trim();
  return name ? `other:${name}` : 'other';
}
