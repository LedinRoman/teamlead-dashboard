import type { FlowStageId, FlowWorkflow, JiraSprintOption, NormalizedIssue } from '@shared/types';
import { summarize } from './aggregate';
import { isCycleExcluded, listCyclePeople, type CycleOverviewFilters, type CyclePerson } from './cycle-overview';
import { classifyFlowIssue, isFlowScoped } from './flow-classify';
import { flowAgingAges, flowStageLabel, type FlowAgingAges } from './flow-aging';
import { buildFlowHistory, type FlowHistoryModel } from './flow-history';
import { toFlowIssueTimeline, type FlowIssueTimeline } from './flow-issue-timeline';
import { buildFlowStageTime, type FlowStageTimeModel } from './flow-stages';
import { buildFlowThroughput, type FlowThroughputModel } from './flow-throughput';
import { validateFlowWorkflow } from './flow-workflow';

export interface FlowAgingRow {
  key: string;
  url: string;
  summary: string;
  stage: FlowStageId;
  stageLabel: string;
  status: string;
  assigneeId: string;
  assigneeName: string;
  storyPoints?: number;
  blocked: boolean;
  rework: boolean;
  inDevelopmentWip: boolean;
  inQaWip: boolean;
  ages: FlowAgingAges;
  firstInProgress?: string;
  doneAt?: string;
  cycleTimeDays?: number;
}

export interface FlowStageShare {
  id: FlowStageId;
  label: string;
  count: number;
  share: number;
}

export interface FlowCardOldest {
  key: string;
  url: string;
  episodeLabel: string;
  episodeDays: number;
}

export interface FlowSnapshot {
  warnings: string[];
  errors: string[];
  qaWipAvailable: boolean;
  qaUnavailableReason?: string;
  snapshotNote?: string;
  developmentWip: number;
  inReview: number;
  qaWip: number;
  qaQueue: number;
  blocked: number;
  oldest?: FlowCardOldest;
  stages: FlowStageShare[];
  aging: FlowAgingRow[];
  /** Active board sprints that Aging WIP is limited to. Absent in tests = no extra filter. */
  agingSprints?: { id: number; name: string }[];
  people: CyclePerson[];
  issueTimelines: FlowIssueTimeline[];
  workflow: FlowWorkflow;
  thresholds: { median: number; p85: number; n: number } | null;
  stageTime: FlowStageTimeModel;
  throughput?: FlowThroughputModel;
  history: FlowHistoryModel;
  horizon?: { requested: number; used: number; from?: string; to?: string };
  throughputHorizon?: { requested: number; used: number };
  queriedAt?: string;
  fromCache?: boolean;
}

export interface FlowSnapshotOptions extends CycleOverviewFilters {
  workflow: FlowWorkflow;
  now?: Date;
  workingDays?: boolean;
  holidays?: string[];
  historicalSprint?: boolean;
  window?: { from: string; to: string };
  throughputSprints?: JiraSprintOption[];
  throughputIssues?: NormalizedIssue[];
  historyIssues?: NormalizedIssue[];
  horizon?: { requested: number; used: number };
  throughputHorizon?: { requested: number; used: number };
  /** When set, Aging WIP and current WIP cards keep only issues in these sprints. Empty → none. */
  agingSprintIds?: number[];
  agingSprints?: { id: number; name: string }[];
}

export function buildFlowSnapshot(issues: NormalizedIssue[], options: FlowSnapshotOptions): FlowSnapshot {
  const now = options.now ?? new Date();
  const workflow = options.workflow;
  const validation = validateFlowWorkflow(workflow);
  const scoped = issues.filter((issue) => isFlowScoped(issue, options));
  const classified = scoped.map((issue) => ({ issue, info: classifyFlowIssue(issue, workflow) }));
  /** Current WIP cards match Aging: active sprint only. Tests omit `agingSprintIds` and keep the full set. */
  const current = classified.filter((row) => inAgingSprint(row.issue.sprintIds, options.agingSprintIds));
  const people = listCyclePeople(
    issues.filter((issue) => {
      if (!isFlowScoped(issue, { excludeQaTitle: options.excludeQaTitle, excludedKeys: options.excludedKeys })) {
        return false;
      }
      if (!inAgingSprint(issue.sprintIds, options.agingSprintIds)) return false;
      return classifyFlowIssue(issue, workflow).inAging;
    }),
    { excludeQaTitle: options.excludeQaTitle, excludedKeys: options.excludedKeys },
  );

  const development = current.filter((row) => row.info.inDevelopmentWip);
  const inReview = current.filter((row) => row.info.inReview);
  const qaWip = current.filter((row) => row.info.inQaWip);
  const qaQueue = current.filter((row) => row.info.inQaQueue);
  const blocked = current.filter((row) => row.info.blocked && (row.info.inDevelopmentWip || row.info.inReview || row.info.inQaWip));

  const aging: FlowAgingRow[] = [];
  for (const { issue, info } of classified) {
    if (!inAgingSprint(issue.sprintIds, options.agingSprintIds)) continue;
    const ages = flowAgingAges(issue, workflow, now, options);
    if (!ages || !info.inAging) continue;
    aging.push({
      key: issue.key,
      url: issue.url,
      summary: issue.summary,
      stage: info.stage,
      stageLabel: flowStageLabel(info.stage),
      status: issue.status,
      assigneeId: issue.assigneeId || 'unassigned',
      assigneeName: issue.assigneeName || (issue.assigneeId ? issue.assigneeId : 'Unassigned'),
      storyPoints: issue.storyPoints,
      blocked: info.blocked,
      rework: info.rework,
      inDevelopmentWip: info.inDevelopmentWip,
      inQaWip: info.inQaWip,
      ages,
      firstInProgress: issue.firstInProgress,
      doneAt: issue.doneAt,
      cycleTimeDays: issue.cycleTimeDays,
    });
  }
  aging.sort((a, b) => b.ages.episodeDays - a.ages.episodeDays || a.key.localeCompare(b.key));

  const stageCounts = new Map<FlowStageId, number>();
  for (const row of [...development, ...inReview, ...qaWip]) {
    let stage = row.info.inDevelopmentWip && row.info.stage === 'other' && row.info.blocked ? 'development' : row.info.stage;
    if (stage === 'rework') stage = 'development';
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  }
  const stageTotal = [...stageCounts.values()].reduce((sum, value) => sum + value, 0);
  const stageOrder: FlowStageId[] = ['development', 'review', 'rework', 'qaQueue', 'inReview', 'other'];
  const stages = [...new Set([...stageOrder, ...stageCounts.keys()])]
    .filter((id) => (stageCounts.get(id) ?? 0) > 0)
    .map((id) => ({
      id,
      label: id === 'development' ? 'Development' : flowStageLabel(id),
      count: stageCounts.get(id) ?? 0,
      share: stageTotal > 0 ? Math.round(((stageCounts.get(id) ?? 0) / stageTotal) * 100) : 0,
    }));

  const completed = scoped.filter((issue) => issue.cycleTimeDays !== undefined && issue.doneAt);
  const summary = summarize(completed.map((issue) => issue.cycleTimeDays));
  const oldestRow = aging[0];

  const window = options.window;
  const historySource = options.historyIssues ?? scoped;
  const history = window
    ? buildFlowHistory(historySource, workflow, window.from, window.to)
    : { available: false, reason: 'Исторический WIP недоступен для имеющихся данных', points: [] };

  return {
    warnings: validation.warnings,
    errors: validation.errors,
    qaWipAvailable: validation.qaWipAvailable,
    qaUnavailableReason: validation.qaUnavailableReason,
    snapshotNote: undefined,
    developmentWip: development.length,
    inReview: inReview.length,
    qaWip: qaWip.length,
    qaQueue: qaQueue.length,
    blocked: blocked.length,
    oldest: oldestRow
      ? {
          key: oldestRow.key,
          url: oldestRow.url,
          episodeLabel: oldestRow.ages.episodeLabel,
          episodeDays: oldestRow.ages.episodeDays,
        }
      : undefined,
    stages,
    aging,
    agingSprints: options.agingSprints,
    people,
    issueTimelines: scoped.map(toFlowIssueTimeline),
    workflow,
    thresholds:
      summary && summary.count >= 5
        ? { median: summary.median, p85: summary.p85, n: summary.count }
        : null,
    stageTime: buildFlowStageTime(scoped, workflow, options),
    throughput: options.throughputSprints
      ? buildFlowThroughput(
          (options.throughputIssues ?? scoped).filter((issue) => isFlowScoped(issue, options)),
          options.throughputSprints,
          now,
        )
      : undefined,
    history,
    horizon: options.horizon
      ? { ...options.horizon, from: window?.from, to: window?.to }
      : undefined,
    throughputHorizon: options.throughputHorizon,
  };
}

export function filterFlowAging(aging: FlowAgingRow[], includeReview: boolean): FlowAgingRow[] {
  if (includeReview) return aging;
  return aging.filter((row) => row.stage !== 'inReview' && row.stage !== 'done');
}

function inAgingSprint(sprintIds: number[], allowed?: number[]): boolean {
  if (allowed === undefined) return true;
  if (allowed.length === 0) return false;
  return sprintIds.some((id) => allowed.includes(id));
}

export function oldestFromAging(aging: FlowAgingRow[]): FlowCardOldest | undefined {
  const row = aging[0];
  if (!row) return undefined;
  return {
    key: row.key,
    url: row.url,
    episodeLabel: row.ages.episodeLabel,
    episodeDays: row.ages.episodeDays,
  };
}

export { isCycleExcluded };
