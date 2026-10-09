import { listCycleOverrides } from '@backend/db/cycle-overrides';
import { listHolidays } from '@backend/db/holidays';
import { getFlowWorkflow } from '@backend/db/settings';
import { andAll, jqlList, jqlValue } from '@backend/jira/jql';
import type { JiraSprintOption, NormalizedIssue, Team } from '@shared/types';
import { cycleOverrideMaps, parseIssueKeys } from '@backend/metrics/cycle-overview';
import { isFlowScoped } from '@backend/metrics/flow-classify';
import { buildFlowSnapshot, type FlowSnapshot } from '@backend/metrics/flow-model';
import { toFlowIssueTimeline, type FlowIssueTimeline } from '@backend/metrics/flow-issue-timeline';
import { mergeFlowWorkflow } from '@backend/metrics/flow-workflow';
import { parseDate } from '@backend/metrics/time';
import { loadScopeDataset } from './metrics-service';
import { requireContext, type AppContext } from './context';
import { computedRead, computedWrite, stampIso, withSnapshot } from './snapshot';
import { collectTeamSprints, sortSprintsNewestFirst } from './team-sprints';
import { ValidationError } from './validate';

export const DEFAULT_FLOW_HORIZON = 6;
export const FLOW_HORIZON_MAX = 20;

export interface FlowLoadRequest {
  teamIds: string[];
  throughputHorizon?: number;
  historyHorizon?: number;
  /** @deprecated use throughputHorizon / historyHorizon */
  horizonSprints?: number;
  cycleStartStatus?: string;
  cycleEndStatus?: string;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  assigneeIds?: string[];
  workingDays?: boolean;
  refresh?: boolean;
}

export interface FlowIssueLoadRequest {
  key: string;
  teamIds: string[];
  cycleStartStatus?: string;
  cycleEndStatus?: string;
  refresh?: boolean;
}

export async function loadFlow(request: FlowLoadRequest, context?: AppContext): Promise<FlowSnapshot> {
  const ctx = context ?? (await requireContext());
  return withSnapshot(ctx, request.refresh, () => loadFlowInner(request, ctx));
}

async function loadFlowInner(request: FlowLoadRequest, ctx: AppContext): Promise<FlowSnapshot> {
  const throughputRequested = clampHorizon(request.throughputHorizon ?? request.horizonSprints);
  const historyRequested = clampHorizon(request.historyHorizon ?? request.horizonSprints);
  const fetchCount = Math.max(throughputRequested, historyRequested);
  if (request.teamIds.length === 0) {
    return stampFlow(
      buildFlowSnapshot([], {
        workflow: await getFlowWorkflow(),
        excludeQaTitle: request.excludeQaTitle,
        excludedKeys: request.excludedKeys,
        assigneeIds: request.assigneeIds,
        workingDays: request.workingDays,
        holidays: await listHolidays(),
        horizon: { requested: historyRequested, used: 0 },
        throughputHorizon: { requested: throughputRequested, used: 0 },
      }),
      false,
    );
  }

  const storedWorkflow = await getFlowWorkflow();
  const workflow = mergeFlowWorkflow({
    ...storedWorkflow,
    cycleStart: request.cycleStartStatus ?? storedWorkflow.cycleStart,
    cycleEnd: request.cycleEndStatus ?? storedWorkflow.cycleEnd,
  });
  const holidays = await listHolidays();
  const overrides = await listCycleOverrides();
  const sprints = sortSprintsNewestFirst(
    await collectTeamSprints(
      ctx.teams.filter((team) => request.teamIds.includes(team.id)),
      ctx.client,
    ),
  );
  const agingSprints = sprints.filter((sprint) => sprint.state === 'active').map((sprint) => ({
    id: sprint.id,
    name: sprint.name,
  }));
  const agingSprintIds = agingSprints.map((sprint) => sprint.id);
  const modelParts = flowModelParts(request, workflow, holidays, overrides, agingSprintIds);
  const cached = await computedRead<FlowSnapshot>('flow', modelParts);
  if (cached) return stampFlow(cached.payload, true, cached.createdAt);

  const issuesByKey = new Map<string, NormalizedIssue>();
  let truncated = false;
  const datasets = await Promise.all(
    request.teamIds.map((teamId) =>
      loadScopeDataset(
        {
          scope: { kind: 'team', teamId, mode: 'recent', label: 'Flow' },
          withChangelog: true,
          withTimeline: true,
          refresh: request.refresh,
          cycleStartStatus: workflow.cycleStart,
          cycleEndStatus: workflow.cycleEnd,
        },
        ctx,
      ),
    ),
  );
  const overrideMaps = cycleOverrideMaps(overrides);
  for (const dataset of datasets) {
    applyOverrides(dataset.normalized.issues, overrideMaps);
    truncated ||= dataset.truncated;
    for (const issue of dataset.normalized.issues) {
      if (!issuesByKey.has(issue.key)) issuesByKey.set(issue.key, issue);
    }
  }

  const fetchedSprints = pickHorizonSprints(sprints, fetchCount);
  const throughputSprints = pickHorizonSprints(sprints, throughputRequested);
  const historySprints = pickHorizonSprints(sprints, historyRequested);
  let horizonIssues: NormalizedIssue[] = [];
  if (fetchedSprints.length > 0) {
    const extra = await loadScopeDataset(
      {
        scope: {
          kind: 'jql',
          jql: `sprint in (${fetchedSprints.map((sprint) => sprint.id).join(', ')})`,
          label: 'Flow horizon',
        },
        withChangelog: true,
        withTimeline: true,
        refresh: request.refresh,
        cycleStartStatus: workflow.cycleStart,
        cycleEndStatus: workflow.cycleEnd,
      },
      ctx,
    );
    applyOverrides(extra.normalized.issues, overrideMaps);
    horizonIssues = extra.normalized.issues;
    truncated ||= extra.truncated;
  }

  const currentIssues = [...issuesByKey.values()];
  const window = sprintWindow(historySprints);

  const snapshot = buildFlowSnapshot(currentIssues, {
    workflow,
    excludeQaTitle: request.excludeQaTitle,
    excludedKeys: request.excludedKeys,
    assigneeIds: request.assigneeIds,
    workingDays: request.workingDays,
    holidays,
    historicalSprint: false,
    window,
    throughputSprints,
    throughputIssues: horizonIssues,
    historyIssues: horizonIssues.filter((issue) =>
      isFlowScoped(issue, { excludeQaTitle: request.excludeQaTitle, excludedKeys: request.excludedKeys }),
    ),
    horizon: { requested: historyRequested, used: historySprints.length },
    throughputHorizon: { requested: throughputRequested, used: throughputSprints.length },
    agingSprintIds,
    agingSprints,
  });
  if (truncated) {
    snapshot.warnings.unshift('Поиск обрезан лимитом Jira (~2500 задач). Часть потока может отсутствовать.');
  }
  const stamped = stampFlow(snapshot, false);
  await computedWrite('flow', modelParts, stamped);
  return stamped;
}

export async function loadFlowIssue(request: FlowIssueLoadRequest, context?: AppContext): Promise<FlowIssueTimeline> {
  const ctx = context ?? (await requireContext());
  return withSnapshot(ctx, request.refresh, () => loadFlowIssueInner(request, ctx));
}

async function loadFlowIssueInner(request: FlowIssueLoadRequest, ctx: AppContext): Promise<FlowIssueTimeline> {
  const key = parseIssueKeys(request.key)[0];
  if (!key) throw new ValidationError('Нужен ключ задачи, например CDR-2029.');
  if (request.teamIds.length === 0) throw new ValidationError('Нужна хотя бы одна команда.');

  const projects = teamProjectKeys(request.teamIds, ctx.teams);
  if (projects.length === 0) {
    throw new ValidationError('У выбранных команд нет проектов. Добавьте их на странице Teams.');
  }
  const project = projectOfKey(key);
  if (!projects.some((item) => item.toUpperCase() === project)) {
    throw new ValidationError(
      `${key} не из проектов выбранных команд (${projects.join(', ')}).`,
    );
  }

  const storedWorkflow = await getFlowWorkflow();
  const workflow = mergeFlowWorkflow({
    ...storedWorkflow,
    cycleStart: request.cycleStartStatus ?? storedWorkflow.cycleStart,
    cycleEnd: request.cycleEndStatus ?? storedWorkflow.cycleEnd,
  });

  const dataset = await loadScopeDataset(
    {
      scope: {
        kind: 'jql',
        jql: andAll([`key = ${jqlValue(key)}`, jqlList('project', projects)]),
        label: key,
      },
      withChangelog: true,
      fullChangelog: true,
      withTimeline: true,
      refresh: request.refresh,
      cycleStartStatus: workflow.cycleStart,
      cycleEndStatus: workflow.cycleEnd,
    },
    ctx,
  );
  applyOverrides(dataset.normalized.issues, cycleOverrideMaps(await listCycleOverrides()));
  const issue =
    dataset.normalized.issues.find((row) => row.key.toUpperCase() === key) ?? dataset.normalized.issues[0];
  if (!issue) throw new ValidationError(`Задача ${key} не найдена в проектах выбранных команд.`);
  return toFlowIssueTimeline(issue);
}

export function clampHorizon(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) return DEFAULT_FLOW_HORIZON;
  return Math.min(FLOW_HORIZON_MAX, Math.max(1, n));
}

function teamProjectKeys(teamIds: string[], teams: Team[]): string[] {
  return [
    ...new Set(
      teams
        .filter((team) => teamIds.includes(team.id))
        .flatMap((team) => team.projects.map((project) => project.trim()).filter(Boolean)),
    ),
  ];
}

function projectOfKey(key: string): string {
  return key.replace(/-\d+$/, '').toUpperCase();
}

function flowModelParts(
  request: FlowLoadRequest,
  workflow: ReturnType<typeof mergeFlowWorkflow>,
  holidays: string[],
  overrides: Awaited<ReturnType<typeof listCycleOverrides>>,
  agingSprintIds: number[],
): unknown[] {
  return [
    [...request.teamIds].sort(),
    clampHorizon(request.throughputHorizon ?? request.horizonSprints),
    clampHorizon(request.historyHorizon ?? request.horizonSprints),
    workflow,
    Boolean(request.excludeQaTitle),
    [...(request.excludedKeys ?? [])].map((key) => key.toUpperCase()).sort(),
    [...(request.assigneeIds ?? [])].sort(),
    Boolean(request.workingDays),
    holidays,
    overrides.map((row) => [row.key, row.startedAt ?? '', row.endedAt ?? '']),
    [...agingSprintIds].sort((a, b) => a - b),
    'flow-wip-sprint-v2',
  ];
}

function stampFlow(snapshot: FlowSnapshot, fromCache: boolean, createdAt = Date.now()): FlowSnapshot {
  return { ...snapshot, fromCache, queriedAt: stampIso(createdAt) };
}

function pickHorizonSprints(sprints: JiraSprintOption[], count: number): JiraSprintOption[] {
  return [...sprints].slice(0, count).sort((a, b) => {
    const aDate = a.startDate ?? a.endDate ?? '';
    const bDate = b.startDate ?? b.endDate ?? '';
    return aDate.localeCompare(bDate);
  });
}

function sprintWindow(sprints: JiraSprintOption[]): { from: string; to: string } | undefined {
  const starts = sprints.map((sprint) => sprint.startDate?.slice(0, 10)).filter(Boolean) as string[];
  const ends = sprints
    .flatMap((sprint) => [sprint.endDate, sprint.completeDate])
    .map((value) => value?.slice(0, 10))
    .filter(Boolean) as string[];
  if (starts.length === 0) return undefined;
  const from = starts.reduce((min, day) => (day < min ? day : min));
  const today = new Date().toISOString().slice(0, 10);
  const rawTo = ends.length > 0 ? ends.reduce((max, day) => (day > max ? day : max)) : today;
  return { from, to: rawTo > today ? today : rawTo };
}

function applyOverrides(
  issues: NormalizedIssue[],
  maps: { startOverrides: Record<string, string>; endOverrides: Record<string, string> },
) {
  for (const issue of issues) {
    const key = issue.key.trim().toUpperCase();
    const start = parseDate(maps.startOverrides[key]);
    const end = parseDate(maps.endOverrides[key]);
    if (start) issue.firstInProgress = start.toISOString();
    if (end) {
      issue.doneAt = end.toISOString();
      issue.doneAtSource = 'changelog';
    }
  }
}
