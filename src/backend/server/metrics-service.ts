import { cacheKey, readCache, writeCache } from '@backend/db/cache';
import { getFieldMappings, resolveFieldMapping } from '@backend/db/settings';
import { changelogNeedsPaging, type RawIssue } from '@backend/jira/client';
import { withSnapshot } from '@backend/server/snapshot';
import { resolveScope, type ResolvedScope } from '@backend/jira/scope';
import { buildMetricsModel } from '@backend/metrics/aggregate';
import { summarize } from '@backend/metrics/aggregate';
import { normalizeIssues, type NormalizeResult } from '@backend/metrics/normalize';
import { isEngineeringDone } from '@backend/metrics/rules';
import type {
  FieldMapping,
  MetricsModel,
  NormalizedIssue,
  PeopleComparison,
  PersonSummary,
  ScopeRequest,
  ScopeSpec,
  Team,
} from '@shared/types';
import { requireContext, type AppContext } from './context';

interface CachedSearch {
  issues: RawIssue[];
  truncated: boolean;
}

export interface ScopeDataset {
  scope: ResolvedScope;
  normalized: NormalizeResult;
  raw: RawIssue[];
  truncated: boolean;
  fromCache: boolean;
  queriedAt: string;
  windowDays: number;
  windowFrom?: string;
  mapping: FieldMapping;
  context: AppContext;
}

export async function loadScopeDataset(request: ScopeRequest, context?: AppContext): Promise<ScopeDataset> {
  const ctx = context ?? (await requireContext());
  return withSnapshot(ctx, request.refresh, () => loadScopeDatasetInner(request, ctx));
}

async function loadScopeDatasetInner(request: ScopeRequest, ctx: AppContext): Promise<ScopeDataset> {
  const windowDays = request.windowDays ?? ctx.rules.defaultWindowDays;
  const windowFrom = request.windowFrom;
  const scope = await resolveScope(
    request.scope,
    windowDays,
    {
      client: ctx.client,
      teams: ctx.teams,
      rules: ctx.rules,
    },
    windowFrom,
  );

  const detected = await ctx.client.resolvedFieldMapping();
  const scoped = await getFieldMappings();
  const { projectKey, boardId } = mappingScope(request.scope, ctx.teams);
  const mapping = resolveFieldMapping([
    detected,
    {
      storyPointsField: ctx.connection.storyPointsField,
      sprintField: ctx.connection.sprintField,
      epicLinkField: ctx.connection.epicLinkField,
    },
    scoped.defaults,
    projectKey ? scoped.projects[projectKey] : undefined,
    boardId !== undefined ? scoped.boards[String(boardId)] : undefined,
  ]);
  const storyPointFields = await ctx.client.storyPointFieldIds();
  const fields = ctx.client.scopeFields(mapping, [...storyPointFields, ...(request.extraFields ?? [])]);
  const withChangelog = Boolean(request.withChangelog);
  const fullChangelog = Boolean(request.fullChangelog);
  const key = cacheKey(['search', ctx.connection.id, scope.jql, fields, withChangelog, fullChangelog]);

  let search: CachedSearch;
  let fromCache = false;
  let queriedAt = new Date().toISOString();

  const cached = request.refresh ? undefined : await readCache<CachedSearch>(key);
  if (cached) {
    search = cached.payload;
    fromCache = true;
    queriedAt = new Date(cached.createdAt).toISOString();
  } else {
    const result = await ctx.client.search({ jql: scope.jql, fields, withChangelog });
    search = { issues: result.issues, truncated: result.truncated };
    await writeCache(key, search, ctx.rules.cacheTtlSeconds);
  }

  if (withChangelog) {
    const doneNames = new Set(ctx.rules.doneStatuses.map((status) => status.trim().toLowerCase()));
    const needChangelog = search.issues.filter((issue) =>
      needsChangelog(issue, doneNames, request.cycleEndStatus),
    );
    const missingHistories = needChangelog.filter((issue) => !Array.isArray(issue.changelog?.histories));
    if (missingHistories.length > 0) {
      await ctx.client.attachChangelogs(missingHistories);
    }
    const needPaging = fullChangelog
      ? search.issues.filter((issue) => changelogNeedsPaging(issue.changelog))
      : [];
    if (needPaging.length > 0) {
      await ctx.client.expandChangelogs(needPaging);
    }
    if (!fromCache || missingHistories.length > 0 || needPaging.length > 0) {
      await writeCache(key, search, ctx.rules.cacheTtlSeconds);
    }
  }

  const normalized = normalizeIssues(search.issues, {
    fields: mapping,
    rules: ctx.rules,
    issueUrl: (issueKey) => ctx.client.issueUrl(issueKey),
    sprintId: scope.sprint?.id,
    statusCatalog: await ctx.client.statuses(),
    storyPointFields,
    cycleStartStatus: request.cycleStartStatus,
    cycleEndStatus: request.cycleEndStatus,
    withTimeline: request.withTimeline === true,
  });

  if (!mapping.storyPointsField) {
    const inferred = storyPointFields.find((id) =>
      normalized.issues.some((issue) => issue.storyPoints !== undefined),
    );
    if (inferred) mapping.storyPointsField = inferred;
  }

  return {
    scope,
    normalized,
    raw: search.issues,
    truncated: search.truncated,
    fromCache,
    queriedAt,
    windowDays,
    windowFrom,
    mapping,
    context: ctx,
  };
}

export async function loadMetrics(
  request: ScopeRequest,
  options: { title?: string; context?: AppContext } = {},
): Promise<MetricsModel> {
  const dataset = await loadScopeDataset(request, options.context);
  return buildMetricsModel({
    scope: dataset.scope,
    normalized: dataset.normalized,
    rules: dataset.context.rules,
    title: options.title ?? dataset.scope.label,
    fromCache: dataset.fromCache,
    truncated: dataset.truncated,
    queriedAt: dataset.queriedAt,
    windowDays: dataset.windowDays,
    windowFrom: dataset.windowFrom,
    usedFields: dataset.mapping,
  });
}

/**
 * Per-person metrics for one team, plus the team medians they should be read
 * against. Cycle time needs changelogs, so this fetch is heavier than a snapshot.
 */
export async function loadPeopleComparison(
  teamId: string,
  options: { windowDays?: number; refresh?: boolean } = {},
): Promise<PeopleComparison> {
  const context = await requireContext();
  return withSnapshot(context, options.refresh, () => loadPeopleComparisonInner(teamId, options, context));
}

async function loadPeopleComparisonInner(
  teamId: string,
  options: { windowDays?: number; refresh?: boolean },
  context: AppContext,
): Promise<PeopleComparison> {
  const windowDays = options.windowDays ?? context.rules.defaultWindowDays;
  const dataset = await loadScopeDataset(
    {
      scope: { kind: 'team', teamId, mode: 'recent' },
      windowDays,
      withChangelog: true,
      refresh: options.refresh,
    },
    context,
  );

  const issues = dataset.normalized.issues;
  const done = issues.filter((issue) => issue.effectiveCategory === 'done');

  const buckets = new Map<string, { name: string; active?: boolean; issues: NormalizedIssue[] }>();
  const team = context.teams.find((candidate) => candidate.id === teamId);
  for (const member of team?.members ?? []) {
    buckets.set(member.id, { name: member.displayName, active: member.active, issues: [] });
  }
  for (const issue of issues) {
    if (!issue.assigneeId) continue;
    const bucket = buckets.get(issue.assigneeId);
    if (bucket) bucket.issues.push(issue);
    else
      buckets.set(issue.assigneeId, {
        name: issue.assigneeName,
        active: issue.assigneeActive,
        issues: [issue],
      });
  }

  const people: PersonSummary[] = [...buckets.entries()]
    .map(([id, bucket]) => summarizePerson(id, bucket.name, bucket.active, bucket.issues))
    .sort((a, b) => b.wip + b.notStarted - (a.wip + a.notStarted) || a.name.localeCompare(b.name));

  const caveats = [...dataset.scope.caveats];
  if (!dataset.normalized.coverage.changelog) {
    caveats.push('No changelog was returned, so cycle time is unavailable and only lead time is shown.');
  }
  if (dataset.truncated) {
    caveats.push('The team result was larger than the page budget, so per-person counts are partial.');
  }

  return {
    windowDays,
    teamMedianLeadTimeDays: summarize(done.map((issue) => issue.leadTimeDays))?.median ?? null,
    teamMedianCycleTimeDays: summarize(done.map((issue) => issue.cycleTimeDays))?.median ?? null,
    people,
    caveats,
    queriedAt: dataset.queriedAt,
    jql: dataset.scope.jql,
  };
}

function summarizePerson(
  id: string,
  name: string,
  active: boolean | undefined,
  issues: NormalizedIssue[],
): PersonSummary {
  const unfinished = issues.filter((issue) => issue.effectiveCategory !== 'done');
  const done = issues.filter((issue) => issue.effectiveCategory === 'done');
  const wipAges = unfinished
    .filter((issue) => issue.effectiveCategory === 'indeterminate')
    .map((issue) => issue.updatedAgeDays);

  return {
    id,
    name,
    active,
    wip: unfinished.filter((issue) => issue.effectiveCategory === 'indeterminate').length,
    notStarted: unfinished.filter((issue) => issue.effectiveCategory !== 'indeterminate').length,
    stale: unfinished.filter(
      (issue) => issue.signals.includes('stale') || issue.signals.includes('very-stale'),
    ).length,
    blocked: unfinished.filter(
      (issue) => issue.signals.includes('blocked') || issue.signals.includes('blocked-inferred'),
    ).length,
    doneInWindow: done.length,
    storyPointsDone: Math.round(done.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0) * 10) / 10,
    medianCycleTimeDays: summarize(done.map((issue) => issue.cycleTimeDays))?.median ?? null,
    medianLeadTimeDays: summarize(done.map((issue) => issue.leadTimeDays))?.median ?? null,
    oldestWipDays: wipAges.length > 0 ? Math.max(...wipAges) : null,
  };
}

function needsChangelog(issue: RawIssue, doneNames: Set<string>, cycleEndStatus?: string): boolean {
  if (Array.isArray(issue.changelog?.histories) && issue.changelog.histories.length > 0) return false;
  const fields = issue.fields ?? {};
  if (fields.resolutiondate) return true;
  const status = fields.status as { name?: string; statusCategory?: { key?: string } } | undefined;
  const name = status?.name?.trim().toLowerCase();
  if (isEngineeringDone(status?.name)) return true;
  if (cycleEndStatus && name && name === cycleEndStatus.trim().toLowerCase()) return true;
  if (name && doneNames.has(name)) return true;
  return status?.statusCategory?.key === 'done';
}

function mappingScope(spec: ScopeSpec, teams: Team[]): { projectKey?: string; boardId?: number } {
  if (spec.kind === 'team' || (spec.kind === 'person' && spec.teamId)) {
    const teamId = spec.kind === 'team' ? spec.teamId : spec.teamId;
    const team = teams.find((candidate) => candidate.id === teamId);
    return { projectKey: team?.projects[0], boardId: team?.boards[0]?.id };
  }
  if (spec.kind === 'board') return { boardId: spec.boardId };
  return {};
}
