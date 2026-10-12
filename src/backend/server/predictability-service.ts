import { listCycleOverrides } from '@backend/db/cycle-overrides';
import { serverTr } from '@backend/server/locale';
import { getFlowWorkflow } from '@backend/db/settings';
import { andAll, jqlList, jqlValue, orAll, ORDER_RECENT, withOrderBy } from '@backend/jira/jql';
import type { FieldMapping, JiraSprintOption, NormalizedIssue, Team } from '@shared/types';
import { cycleOverrideMaps, isAllowedCycleType, isCycleExcluded, uniqueAssignees, type CyclePerson } from '@backend/metrics/cycle-overview';
import { computedRead, computedWrite, stampIso, withSnapshot } from './snapshot';
import {
  changelogIsComplete,
  extractEstimateChanges,
  extractSprintChanges,
  extractTypeChanges,
} from '@backend/metrics/predictability-changelog';
import {
  buildPredictability,
  comparePredictability,
  predictabilityHistoryRow,
  type PredictabilityIssueInput,
  type PredictabilitySnapshot,
} from '@backend/metrics/predictability-model';
import { PREDICTABILITY_TABLE_CATEGORIES } from '@backend/metrics/predictability-copy';
import { mergeFlowWorkflow } from '@backend/metrics/flow-workflow';
import { parseDate } from '@backend/metrics/time';
import { loadScopeDataset } from './metrics-service';
import { requireContext, type AppContext } from './context';
import { collectTeamSprints, sortSprintsNewestFirst, sortSprintsOldestFirst } from './team-sprints';

export const DEFAULT_PRED_HISTORY = 6;
export const PRED_HISTORY_MAX = 12;

export interface PredictabilityLoadRequest {
  teamIds: string[];
  sprintId: number;
  compareSprintId?: number;
  historySprints?: number;
  cycleStartStatus?: string;
  cycleEndStatus?: string;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  refresh?: boolean;
}

export interface PredictabilityPayload {
  predictability: PredictabilitySnapshot;
  people: CyclePerson[];
  queriedAt: string;
  fromCache: boolean;
}

export async function loadPredictability(
  request: PredictabilityLoadRequest,
  context?: AppContext,
): Promise<PredictabilityPayload> {
  const ctx = context ?? (await requireContext());
  return withSnapshot(ctx, request.refresh, () => loadPredictabilityInner(request, ctx));
}

async function loadPredictabilityInner(
  request: PredictabilityLoadRequest,
  ctx: AppContext,
): Promise<PredictabilityPayload> {
  if (request.teamIds.length === 0) {
    throw new Error(serverTr('Pick at least one team.', 'Нужна хотя бы одна команда.'));
  }

  const storedWorkflow = await getFlowWorkflow();
  const workflow = mergeFlowWorkflow({
    ...storedWorkflow,
    cycleStart: request.cycleStartStatus ?? storedWorkflow.cycleStart,
    cycleEnd: request.cycleEndStatus ?? storedWorkflow.cycleEnd,
  });
  const requestedHistory = clampHistory(request.historySprints);
  const overrides = await listCycleOverrides();
  const modelParts = [
    [...request.teamIds].sort(),
    request.sprintId,
    request.compareSprintId ?? null,
    requestedHistory,
    workflow,
    Boolean(request.excludeQaTitle),
    [...(request.excludedKeys ?? [])].map((key) => key.toUpperCase()).sort(),
    overrides.map((row) => [row.key, row.startedAt ?? '', row.endedAt ?? '']),
  ];
  const cached = await computedRead<PredictabilityPayload>('predictability', modelParts);
  if (cached) {
    return { ...cached.payload, fromCache: true, queriedAt: stampIso(cached.createdAt) };
  }

  const teams = ctx.teams.filter((team) => request.teamIds.includes(team.id));
  const sprints = sortSprintsOldestFirst(await collectTeamSprints(teams, ctx.client));
  const selected = sprints.find((sprint) => sprint.id === request.sprintId);
  if (!selected) {
    throw new Error(serverTr('That sprint is not on the team boards.', 'Выбранный спринт не найден на досках команды.'));
  }

  const current = await computeSprint(selected, sprints, teams, workflow, request, ctx, overrides);
  const computed = new Map<number, PredictabilitySnapshot>();
  computed.set(selected.id, current.predictability);
  if (request.compareSprintId && request.compareSprintId !== request.sprintId) {
    const other = sprints.find((sprint) => sprint.id === request.compareSprintId);
    if (other) {
      const previous = await computeSprint(other, sprints, teams, workflow, request, ctx, overrides);
      computed.set(other.id, previous.predictability);
      current.predictability.comparison = comparePredictability(current.predictability, previous.predictability);
    }
  }

  const historySprints = sortSprintsNewestFirst(sprints).slice(0, requestedHistory);
  const missing = historySprints.filter((sprint) => !computed.has(sprint.id));
  const extras = await Promise.all(
    missing.map((sprint) => computeSprint(sprint, sprints, teams, workflow, request, ctx, overrides)),
  );
  for (let index = 0; index < missing.length; index += 1) {
    const sprint = missing[index];
    const extra = extras[index];
    if (!sprint || !extra) continue;
    computed.set(sprint.id, extra.predictability);
  }
  current.predictability.history = historySprints.flatMap((sprint) => {
    const snapshot = computed.get(sprint.id);
    return snapshot ? [predictabilityHistoryRow(snapshot, selected.id)] : [];
  });
  current.predictability.historyHorizon = { requested: requestedHistory, used: historySprints.length };

  const stamped = { ...current, fromCache: false, queriedAt: stampIso(Date.now()) };
  await computedWrite('predictability', modelParts, stamped);
  return stamped;
}

async function computeSprint(
  sprint: JiraSprintOption,
  orderedSprints: JiraSprintOption[],
  teams: Team[],
  workflow: ReturnType<typeof mergeFlowWorkflow>,
  request: PredictabilityLoadRequest,
  ctx: AppContext,
  overrides: Awaited<ReturnType<typeof listCycleOverrides>>,
): Promise<Omit<PredictabilityPayload, 'queriedAt' | 'fromCache'>> {
  const jql = predictabilityJql(sprint, teams);
  const dataset = await loadScopeDataset(
    {
      scope: { kind: 'jql', jql, label: sprint.name },
      withChangelog: true,
      fullChangelog: true,
      withTimeline: true,
      refresh: request.refresh,
      cycleStartStatus: workflow.cycleStart,
      cycleEndStatus: workflow.cycleEnd,
    },
    ctx,
  );
  applyOverrides(dataset.normalized.issues, cycleOverrideMaps(overrides));

  const byKey = new Map(dataset.raw.map((issue) => [issue.key, issue]));
  const nameToId = new Map(orderedSprints.map((item) => [item.name.trim().toLowerCase(), item.id]));
  const inputs: PredictabilityIssueInput[] = dataset.normalized.issues.map((issue) =>
    toInput(issue, byKey.get(issue.key), dataset.mapping, nameToId),
  );

  const snapshot = buildPredictability({
    sprint,
    issues: inputs,
    orderedSprints,
    workflow,
    excludeQaTitle: request.excludeQaTitle,
    excludedKeys: request.excludedKeys,
    excludedTypes: ctx.rules.excludedTypes,
  });

  if (dataset.truncated) {
    snapshot.warnings.unshift(
      serverTr(
        'Jira truncated the search. Part of the sprint may be missing.',
        'Поиск обрезан лимитом Jira. Часть состава спринта может отсутствовать.',
      ),
    );
  }

  const reconstructed = new Set(snapshot.tasks.map((task) => task.key));
  const unexplained = dataset.normalized.issues.filter(
    (issue) =>
      issue.sprintIds.includes(sprint.id) &&
      !reconstructed.has(issue.key) &&
      isAllowedCycleType(issue.type) &&
      !isCycleExcluded(issue, { excludeQaTitle: request.excludeQaTitle, excludedKeys: request.excludedKeys }),
  ).length;
  if (unexplained > 0) {
    snapshot.warnings.push(
      serverTr(
        `${unexplained} issues are in the sprint now, but the Sprint field history could not be rebuilt, so they are not in the baseline`,
        `${unexplained} задач сейчас числятся в спринте, но история поля Sprint не восстановилась — они не вошли в baseline`,
      ),
    );
  }

  const people = uniqueAssignees(
    snapshot.tasks.filter((task) => PREDICTABILITY_TABLE_CATEGORIES.includes(task.category)),
  );

  return { predictability: snapshot, people };
}

function toInput(
  issue: NormalizedIssue,
  raw: { changelog?: Parameters<typeof changelogIsComplete>[0] } | undefined,
  mapping: FieldMapping,
  nameToId?: Map<string, number>,
): PredictabilityIssueInput {
  const histories = raw?.changelog?.histories;
  return {
    key: issue.key,
    url: issue.url,
    summary: issue.summary,
    type: issue.type,
    status: issue.status,
    created: issue.created,
    currentStoryPoints: issue.storyPoints,
    currentSprintIds: issue.sprintIds,
    assigneeId: issue.assigneeId,
    assigneeName: issue.assigneeName,
    doneAt: issue.doneAt,
    sprintChanges: extractSprintChanges(histories, mapping.sprintField, nameToId),
    estimateChanges: extractEstimateChanges(histories, mapping.storyPointsField),
    typeChanges: extractTypeChanges(histories),
    statusTransitions: issue.statusTransitions,
    changelogComplete: changelogIsComplete(raw?.changelog),
  };
}

export function predictabilityJql(sprint: JiraSprintOption, teams: Team[]): string {
  const projects = [...new Set(teams.flatMap((team) => team.projects))];
  const extras = teams.map((team) => team.extraJql?.trim()).filter((value): value is string => Boolean(value));
  const startDay = sprint.startDate?.slice(0, 10);
  const endDay = (sprint.completeDate ?? sprint.endDate)?.slice(0, 10);
  const membership = [`sprint = ${sprint.id}`];
  if (startDay && endDay && projects.length > 0) {
    const windowed = andAll([
      jqlList('project', projects),
      `updated >= ${jqlValue(startDay)}`,
      `updated <= ${jqlValue(endDay)}`,
    ]);
    if (windowed) membership.push(windowed);
  }
  const where = andAll([orAll(membership), extras.length > 0 ? orAll(extras) : undefined]);
  return withOrderBy(where || `sprint = ${sprint.id}`, ORDER_RECENT);
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

export function clampHistory(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) return DEFAULT_PRED_HISTORY;
  return Math.min(PRED_HISTORY_MAX, Math.max(1, n));
}