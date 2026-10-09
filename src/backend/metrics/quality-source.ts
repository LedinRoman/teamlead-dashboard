import { andAll, jqlList, jqlValue, orAll, ORDER_RECENT, withOrderBy } from '../jira/jql';
import type { JiraSprintOption, NormalizedIssue, Team } from '@shared/types';
import { changelogIsComplete, type RawChangelogShape } from './predictability-changelog';
import type { QualityIssueInput } from './quality-classify';

/**
 * Sprint membership plus issues touched in the cohort window. First QA is decided
 * from changelog, not from the current Sprint field.
 */
export function qualityJql(sprint: JiraSprintOption, teams: Team[]): string {
  return qualityHorizonJql([sprint], teams);
}

/** One search covering several sprint windows so history shares a single asOf. */
export function qualityHorizonJql(sprints: JiraSprintOption[], teams: Team[]): string {
  const usable = sprints.filter((sprint) => Number.isInteger(sprint.id));
  const fallback = usable[0];
  if (!fallback) return withOrderBy('', ORDER_RECENT);
  const projects = [...new Set(teams.flatMap((team) => team.projects))];
  const extras = teams.map((team) => team.extraJql?.trim()).filter((value): value is string => Boolean(value));
  const ids = [...new Set(usable.map((sprint) => sprint.id))];
  const membership = [
    ids.length === 1 ? `sprint = ${ids[0]}` : `sprint in (${ids.join(', ')})`,
  ];
  const startDay = minDay(usable.map((sprint) => sprint.startDate?.slice(0, 10)));
  const endDay = maxDay(usable.map((sprint) => (sprint.completeDate ?? sprint.endDate)?.slice(0, 10)));
  if (startDay && endDay && projects.length > 0) {
    const windowed = andAll([
      jqlList('project', projects),
      `updated >= ${jqlValue(startDay)}`,
      `updated <= ${jqlValue(endDay)}`,
    ]);
    if (windowed) membership.push(windowed);
  }
  const where = andAll([orAll(membership), extras.length > 0 ? orAll(extras) : undefined]);
  return withOrderBy(where || membership[0] || `sprint = ${fallback.id}`, ORDER_RECENT);
}

/** Bugs and incidents created in the horizon window. Not the First QA cohort. */
export function qualityDefectsJql(sprints: JiraSprintOption[], teams: Team[]): string {
  const projects = [...new Set(teams.flatMap((team) => team.projects))];
  const extras = teams.map((team) => team.extraJql?.trim()).filter((value): value is string => Boolean(value));
  const startDay = minDay(sprints.map((sprint) => sprint.startDate?.slice(0, 10)));
  const endDay = maxDay(sprints.map((sprint) => (sprint.completeDate ?? sprint.endDate)?.slice(0, 10)));
  const where = andAll([
    projects.length > 0 ? jqlList('project', projects) : undefined,
    'issuetype in ("Bug", "Баг", "Ошибка", "Incident", "Инцидент")',
    startDay ? `created >= ${jqlValue(startDay)}` : undefined,
    endDay ? `created <= ${jqlValue(endDay)}` : undefined,
    extras.length > 0 ? orAll(extras) : undefined,
  ]);
  return withOrderBy(where, ORDER_RECENT);
}

function minDay(days: Array<string | undefined>): string | undefined {
  const clean = days.filter((day): day is string => Boolean(day));
  if (clean.length === 0) return undefined;
  return clean.reduce((min, day) => (day < min ? day : min));
}

function maxDay(days: Array<string | undefined>): string | undefined {
  const clean = days.filter((day): day is string => Boolean(day));
  if (clean.length === 0) return undefined;
  return clean.reduce((max, day) => (day > max ? day : max));
}

export function toQualityIssueInput(
  issue: Pick<
    NormalizedIssue,
    | 'key'
    | 'url'
    | 'summary'
    | 'type'
    | 'status'
    | 'created'
    | 'assigneeId'
    | 'assigneeName'
    | 'storyPoints'
    | 'labels'
    | 'parentKey'
    | 'links'
    | 'statusTransitions'
  >,
  changelog?: RawChangelogShape,
  bugsAfterTest?: number,
): QualityIssueInput {
  return {
    key: issue.key,
    url: issue.url,
    summary: issue.summary,
    type: issue.type,
    status: issue.status,
    created: issue.created,
    assigneeId: issue.assigneeId,
    assigneeName: issue.assigneeName,
    storyPoints: issue.storyPoints,
    labels: issue.labels,
    parentKey: issue.parentKey,
    linkedKeys: issue.links?.map((link) => link.key) ?? [],
    statusTransitions: issue.statusTransitions,
    histories: changelog?.histories,
    changelogComplete: changelogIsComplete(changelog),
    bugsAfterTest,
  };
}
