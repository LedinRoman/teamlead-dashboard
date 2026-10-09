import { listHolidays } from '@backend/db/holidays';
import { getFlowWorkflow } from '@backend/db/settings';
import type { JiraSprintOption, Team } from '@shared/types';
import { uniqueAssignees, type CyclePerson } from '@backend/metrics/cycle-overview';
import { mergeFlowWorkflow } from '@backend/metrics/flow-workflow';
import {
  applyQualitySearchLimits,
  assignQualitySprint,
  attachQualityStage5,
  buildFieldDiagnostic,
  buildQualitySnapshot,
  qualityHistoryRow,
  type QualityHistoryRow,
  type QualitySnapshot,
} from '@backend/metrics/quality-model';
import {
  classifyQualityDefects,
  findBugsAfterTestField,
  readNumericCustom,
  toQualityDefectInput,
} from '@backend/metrics/quality-defects';
import { qualityDefectsJql, qualityHorizonJql, toQualityIssueInput } from '@backend/metrics/quality-source';
import { loadScopeDataset } from './metrics-service';
import { requireContext, type AppContext } from './context';
import { computedRead, computedWrite, stampIso, withSnapshot } from './snapshot';
import { collectTeamSprints, sortSprintsNewestFirst, sortSprintsOldestFirst } from './team-sprints';

export const DEFAULT_QUALITY_HISTORY = 6;
export const QUALITY_HISTORY_MAX = 10;

export interface QualityLoadRequest {
  teamIds: string[];
  sprintId: number;
  historySprints?: number;
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  workingDays?: boolean;
  refresh?: boolean;
}

export interface QualityPayload {
  snapshot: QualitySnapshot;
  history: QualityHistoryRow[];
  historyHorizon: { requested: number; used: number };
  people: CyclePerson[];
  asOf: string;
  queriedAt: string;
  fromCache: boolean;
}

export async function loadQuality(request: QualityLoadRequest, context?: AppContext): Promise<QualityPayload> {
  const ctx = context ?? (await requireContext());
  return withSnapshot(ctx, request.refresh, () => loadQualityInner(request, ctx));
}

async function loadQualityInner(request: QualityLoadRequest, ctx: AppContext): Promise<QualityPayload> {
  if (request.teamIds.length === 0) {
    throw new Error('Нужна хотя бы одна команда.');
  }

  const workflow = mergeFlowWorkflow(await getFlowWorkflow());
  const holidays = request.workingDays ? await listHolidays() : [];
  const requestedHistory = clampHistory(request.historySprints);
  const bugsAfterTestField = findBugsAfterTestField(await ctx.client.fieldOptions());
  const modelParts = [
    'quality-v3',
    [...request.teamIds].sort(),
    request.sprintId,
    requestedHistory,
    workflow,
    Boolean(request.excludeQaTitle),
    [...(request.excludedKeys ?? [])].map((key) => key.toUpperCase()).sort(),
    Boolean(request.workingDays),
    holidays,
    bugsAfterTestField?.id,
  ];
  const cached = await computedRead<QualityPayload>('quality', modelParts);
  if (cached) {
    return { ...cached.payload, fromCache: true, queriedAt: stampIso(cached.createdAt) };
  }

  const teams = ctx.teams.filter((team) => request.teamIds.includes(team.id));
  const sprints = sortSprintsOldestFirst(await collectTeamSprints(teams, ctx.client));
  const selected = sprints.find((sprint) => sprint.id === request.sprintId);
  if (!selected) {
    throw new Error('Выбранный спринт не найден на досках команды.');
  }

  const historySprints = pickHistorySprints(sprints, selected, requestedHistory);
  const needed = uniqueSprints([selected, ...historySprints]);
  const extraFields = bugsAfterTestField ? [bugsAfterTestField.id] : [];
  const dataset = await loadScopeDataset(
    {
      scope: { kind: 'jql', jql: qualityHorizonJql(needed, teams), label: 'Quality horizon' },
      withChangelog: true,
      fullChangelog: true,
      withTimeline: true,
      extraFields,
      refresh: request.refresh,
      cycleStartStatus: workflow.cycleStart,
      cycleEndStatus: workflow.cycleEnd,
    },
    ctx,
  );
  const defectsDataset = await loadScopeDataset(
    {
      scope: { kind: 'jql', jql: qualityDefectsJql(needed, teams), label: 'Quality defects' },
      refresh: request.refresh,
    },
    ctx,
  );

  const byKey = new Map(dataset.raw.map((issue) => [issue.key, issue]));
  const fieldId = bugsAfterTestField?.id;
  const inputs = dataset.normalized.issues.map((issue) =>
    toQualityIssueInput(
      issue,
      byKey.get(issue.key)?.changelog,
      fieldId ? readNumericCustom(byKey.get(issue.key)?.fields?.[fieldId]) : undefined,
    ),
  );
  const asOf = new Date();
  const filters = {
    excludeQaTitle: request.excludeQaTitle,
    excludedKeys: request.excludedKeys,
    useWorkingDays: request.workingDays,
    holidays,
  };

  const computed = new Map<number, QualitySnapshot>();
  for (const sprint of needed) {
    let snapshot = buildQualitySnapshot({
      issues: inputs,
      sprint,
      allSprints: sprints,
      asOf,
      workflow,
      filters,
    });
    snapshot = applyQualitySearchLimits(snapshot, dataset.truncated);
    computed.set(sprint.id, snapshot);
  }

  const doneAtByKey = new Map<string, string>();
  const cohortKeysBySprint = new Map<number, Set<string>>();
  for (const sprint of needed) {
    const snapshot = computed.get(sprint.id);
    if (!snapshot) continue;
    const keys = new Set<string>();
    for (const row of snapshot.issues) {
      keys.add(row.key);
      if (row.reachedDoneAt) doneAtByKey.set(row.key, row.reachedDoneAt);
    }
    cohortKeysBySprint.set(sprint.id, keys);
  }
  const defectsBySprint = classifyQualityDefects({
    bugs: defectsDataset.normalized.issues.map(toQualityDefectInput),
    sprints: needed,
    assignSprint: (created) => assignQualitySprint(created, sprints, asOf),
    doneAtByKey,
    cohortKeysBySprint,
  });
  for (const sprint of needed) {
    const snapshot = computed.get(sprint.id);
    if (!snapshot) continue;
    computed.set(
      sprint.id,
      attachQualityStage5(snapshot, {
        defects: defectsBySprint.get(sprint.id),
        fieldDiagnostic: buildFieldDiagnostic(
          snapshot.issues,
          bugsAfterTestField ? { id: bugsAfterTestField.id, name: bugsAfterTestField.name } : undefined,
        ),
      }),
    );
  }

  const current = computed.get(selected.id);
  if (!current) {
    throw new Error('Не удалось посчитать выбранный спринт.');
  }

  const history = sortSprintsOldestFirst(historySprints).flatMap((sprint) => {
    const snapshot = computed.get(sprint.id);
    return snapshot ? [qualityHistoryRow(snapshot, selected.id)] : [];
  });

  const people = uniqueAssignees(current.issues);

  const stamped: QualityPayload = {
    snapshot: current,
    history,
    historyHorizon: { requested: requestedHistory, used: history.length },
    people,
    asOf: current.asOf,
    fromCache: false,
    queriedAt: stampIso(Date.now()),
  };
  await computedWrite('quality', modelParts, stamped);
  return stamped;
}

function pickHistorySprints(
  sprints: JiraSprintOption[],
  selected: JiraSprintOption,
  count: number,
): JiraSprintOption[] {
  const newest = sortSprintsNewestFirst(sprints).slice(0, count);
  if (newest.some((sprint) => sprint.id === selected.id)) return newest;
  return uniqueSprints([selected, ...newest]).slice(0, count + 1);
}

function uniqueSprints(sprints: JiraSprintOption[]): JiraSprintOption[] {
  const seen = new Set<number>();
  const out: JiraSprintOption[] = [];
  for (const sprint of sprints) {
    if (seen.has(sprint.id)) continue;
    seen.add(sprint.id);
    out.push(sprint);
  }
  return out;
}

export function clampHistory(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) return DEFAULT_QUALITY_HISTORY;
  return Math.min(QUALITY_HISTORY_MAX, Math.max(1, n));
}

export { qualityHorizonJql, qualityJql, qualityDefectsJql } from '@backend/metrics/quality-source';
