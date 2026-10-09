import { ENGINEERING_DONE_STATUS } from '@backend/metrics/rules';
import { JiraClient } from '@backend/jira/client';
import { ORDER_ATTENTION, ORDER_RECENT, andAll, jqlList, jqlValue, orAll, splitOrderBy, withOrderBy } from '@backend/jira/jql';
import type { JiraSprintOption, MetricRules, ScopeSpec, Team, TeamMember } from '@shared/types';

export interface ResolvedScope {
  jql: string;
  label: string;
  mode: 'sprint' | 'snapshot';
  sprint?: JiraSprintOption;
  windowDays?: number;
  windowFrom?: string;
  caveats: string[];
  members?: TeamMember[];
  /** Set for person scopes so metrics can single out the person. */
  personId?: string;
}

export interface ScopeResolverDeps {
  client: JiraClient;
  teams: Team[];
  rules: MetricRules;
}

export async function resolveScope(
  spec: ScopeSpec,
  windowDays: number,
  deps: ScopeResolverDeps,
  windowFrom?: string,
): Promise<ResolvedScope> {
  switch (spec.kind) {
    case 'jql':
      return resolveJqlScope(spec.jql, spec.label);
    case 'sprint':
      return resolveSprintScope(spec.sprintId, deps.client, spec.label);
    case 'board':
      return resolveBoardScope(spec.boardId, spec.mode, windowDays, deps, spec.label, windowFrom);
    case 'team':
      return resolveTeamScope(spec.teamId, spec.mode, windowDays, deps, spec.label, windowFrom);
    case 'person':
      return resolvePersonScope(spec.personId, spec.teamId, spec.mode, windowDays, deps, spec.label, windowFrom);
    default: {
      const exhaustive: never = spec;
      throw new Error(`Unsupported scope: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function resolveJqlScope(jql: string, label?: string): ResolvedScope {
  const trimmed = jql.trim();
  if (!trimmed) throw new ScopeError('JQL is empty.');
  const { where, orderBy } = splitOrderBy(trimmed);
  return {
    jql: withOrderBy(where, orderBy ?? ORDER_ATTENTION),
    label: label ?? 'Custom JQL',
    mode: 'snapshot',
    caveats: ['Scope comes from custom JQL, so sprint framing is not assumed.'],
  };
}

async function resolveSprintScope(
  sprintId: number,
  client: JiraClient,
  label?: string,
): Promise<ResolvedScope> {
  const sprint = await client.sprint(sprintId);
  return {
    jql: withOrderBy(`sprint = ${sprintId}`, ORDER_ATTENTION),
    label: label ?? sprint.name,
    mode: 'sprint',
    sprint,
    caveats: [],
  };
}

/**
 * Expresses "everything on this board" as JQL. The board's saved filter is the
 * accurate form; a project fallback is wider than the board and is called out.
 */
async function boardBaseClause(
  boardId: number,
  client: JiraClient,
): Promise<{ clause: string; name: string; caveats: string[]; boardType: string }> {
  const [board, filterId] = await Promise.all([client.board(boardId), client.boardFilterId(boardId)]);
  if (filterId) {
    return { clause: `filter = ${filterId}`, name: board.name, caveats: [], boardType: board.type };
  }
  if (board.projectKey) {
    return {
      clause: `project = ${jqlValue(board.projectKey)}`,
      name: board.name,
      caveats: [
        `The saved filter for board "${board.name}" was not readable, so the scope falls back to project ${board.projectKey}. That is wider than the board.`,
      ],
      boardType: board.type,
    };
  }
  throw new ScopeError(
    `Board ${boardId} exposes neither a readable filter nor a project, so its scope cannot be expressed as JQL.`,
  );
}

async function resolveBoardScope(
  boardId: number,
  mode: 'active-sprint' | 'open' | 'recent',
  windowDays: number,
  deps: ScopeResolverDeps,
  label?: string,
  windowFrom?: string,
): Promise<ResolvedScope> {
  const { client, rules } = deps;
  const base = await boardBaseClause(boardId, client);
  const caveats = [...base.caveats];

  if (mode === 'active-sprint') {
    const sprints = await client.sprints(boardId, 'active');
    const active = sprints.find((sprint) => sprint.state === 'active');
    if (active) {
      return {
        jql: withOrderBy(andAll([base.clause, `sprint = ${active.id}`]), ORDER_ATTENTION),
        label: label ?? `${base.name} — ${active.name}`,
        mode: 'sprint',
        sprint: active,
        caveats,
      };
    }
    caveats.push(
      base.boardType === 'simple'
        ? `Board "${base.name}" is team-managed and has no sprints, so this is a snapshot of unfinished work.`
        : `Board "${base.name}" has no active sprint, so this is a snapshot of unfinished work.`,
    );
    return {
      jql: withOrderBy(andAll([base.clause, unfinishedClause(rules)]), ORDER_ATTENTION),
      label: label ?? `${base.name} — snapshot`,
      mode: 'snapshot',
      caveats,
    };
  }

  if (mode === 'open') {
    return {
      jql: withOrderBy(andAll([base.clause, unfinishedClause(rules)]), ORDER_ATTENTION),
      label: label ?? `${base.name} — unfinished`,
      mode: 'snapshot',
      caveats,
    };
  }

  return {
    jql: withOrderBy(andAll([base.clause, recentClause(windowDays, rules, windowFrom)]), ORDER_RECENT),
    label: label ?? `${base.name} — last ${windowDays}d`,
    mode: 'snapshot',
    windowDays,
    windowFrom,
    caveats,
  };
}

async function teamBaseClause(
  team: Team,
  client: JiraClient,
): Promise<{ clause: string; caveats: string[]; sprintBoardIds: number[] }> {
  const caveats: string[] = [];
  const boardClauses: string[] = [];
  for (const board of team.boards) {
    const base = await boardBaseClause(board.id, client);
    boardClauses.push(base.clause);
    caveats.push(...base.caveats);
  }

  const parts: string[] = [];
  if (boardClauses.length > 0) {
    parts.push(orAll(boardClauses));
  } else if (team.projects.length > 0) {
    parts.push(jqlList('project', team.projects));
  } else if (team.members.length > 0) {
    parts.push(jqlList('assignee', team.members.map((member) => member.id)));
    caveats.push(
      `Team "${team.name}" has no board or project, so its scope is everything assigned to its members across Jira.`,
    );
  } else {
    throw new ScopeError(
      `Team "${team.name}" needs at least one board, project, or member before metrics can be built.`,
    );
  }

  if (team.extraJql?.trim()) parts.push(team.extraJql.trim());

  return {
    clause: andAll(parts),
    caveats,
    sprintBoardIds: team.boards.map((board) => board.id),
  };
}

async function resolveTeamScope(
  teamId: string,
  mode: 'active-sprint' | 'open' | 'recent',
  windowDays: number,
  deps: ScopeResolverDeps,
  label?: string,
  windowFrom?: string,
): Promise<ResolvedScope> {
  const team = deps.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new ScopeError(`Team ${teamId} no longer exists.`);
  const base = await teamBaseClause(team, deps.client);
  const caveats = [...base.caveats];

  if (mode === 'active-sprint') {
    const active = await findActiveSprint(base.sprintBoardIds, deps.client);
    if (active) {
      return {
        jql: withOrderBy(andAll([base.clause, `sprint = ${active.id}`]), ORDER_ATTENTION),
        label: label ?? `${team.name} — ${active.name}`,
        mode: 'sprint',
        sprint: active,
        caveats,
        members: team.members,
      };
    }
    caveats.push(
      base.sprintBoardIds.length === 0
        ? `Team "${team.name}" has no board attached, so sprint framing is unavailable and this is a snapshot.`
        : `No active sprint was found on this team's boards, so this is a snapshot of unfinished work.`,
    );
    return {
      jql: withOrderBy(andAll([base.clause, unfinishedClause(deps.rules)]), ORDER_ATTENTION),
      label: label ?? `${team.name} — snapshot`,
      mode: 'snapshot',
      caveats,
      members: team.members,
    };
  }

  if (mode === 'open') {
    return {
      jql: withOrderBy(andAll([base.clause, unfinishedClause(deps.rules)]), ORDER_ATTENTION),
      label: label ?? `${team.name} — unfinished`,
      mode: 'snapshot',
      caveats,
      members: team.members,
    };
  }

  return {
    jql: withOrderBy(andAll([base.clause, recentClause(windowDays, deps.rules, windowFrom)]), ORDER_RECENT),
    label: label ?? `${team.name} — last ${windowDays}d`,
    mode: 'snapshot',
    windowDays,
    windowFrom,
    sprint: await findActiveSprint(base.sprintBoardIds, deps.client),
    caveats,
    members: team.members,
  };
}

async function resolvePersonScope(
  personId: string,
  teamId: string | undefined,
  mode: 'open' | 'recent',
  windowDays: number,
  deps: ScopeResolverDeps,
  label?: string,
  windowFrom?: string,
): Promise<ResolvedScope> {
  const team = teamId ? deps.teams.find((candidate) => candidate.id === teamId) : undefined;
  const caveats: string[] = [];
  let base: string | undefined;
  if (team) {
    const teamBase = await teamBaseClause(team, deps.client);
    base = teamBase.clause;
    caveats.push(...teamBase.caveats);
  } else {
    caveats.push('No team was selected, so this covers the person across every project they can be seen in.');
  }

  const personName =
    team?.members.find((member) => member.id === personId)?.displayName ?? personId;
  const clause = andAll([
    base,
    `assignee = ${jqlValue(personId)}`,
    mode === 'open' ? unfinishedClause(deps.rules) : recentClause(windowDays, deps.rules, windowFrom),
  ]);

  return {
    jql: withOrderBy(clause, mode === 'open' ? ORDER_ATTENTION : ORDER_RECENT),
    label: label ?? `${personName} — ${mode === 'open' ? 'unfinished' : `last ${windowDays}d`}`,
    mode: 'snapshot',
    windowDays: mode === 'recent' ? windowDays : undefined,
    windowFrom: mode === 'recent' ? windowFrom : undefined,
    caveats,
    members: team?.members,
    personId,
  };
}

async function findActiveSprint(
  boardIds: number[],
  client: JiraClient,
): Promise<JiraSprintOption | undefined> {
  for (const boardId of boardIds) {
    const sprints = await client.sprints(boardId, 'active');
    const active = sprints.find((sprint) => sprint.state === 'active');
    if (active) return active;
  }
  return undefined;
}

/**
 * "Not finished" as JQL, widened to respect the configured rules.
 *
 * A status that Jira files under Done but the rules call unfinished would be cut
 * by `statusCategory != Done` before the metrics ever see it, so it has to be
 * named explicitly. The opposite case needs nothing: a status the rules call done
 * while Jira does not is already inside `statusCategory != Done`.
 */
function unfinishedClause(rules: MetricRules): string {
  const base = 'statusCategory != Done';
  if (rules.notDoneStatuses.length === 0) return base;
  return orAll([base, jqlList('status', rules.notDoneStatuses)]);
}

/**
 * Unfinished work plus anything completed inside the window. This single dataset
 * supports both WIP signals and throughput without a second query.
 */
function recentClause(windowDays: number, _rules: MetricRules, windowFrom?: string): string {
  const after = windowFrom ? jqlValue(windowFrom) : `-${windowDays}d`;
  return orAll([
    `status changed to ${jqlValue(ENGINEERING_DONE_STATUS)} after ${after}`,
    `status changed to "Review" after ${after}`,
    unfinishedClause(_rules),
  ]);
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}
