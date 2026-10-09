import type { NormalizedIssue } from '@shared/types';
import { andAll, jqlList, withOrderBy } from '../jira/jql';
import { isReleaseStatus, isTodoStatus, matchesAny, statusEquals } from './rules';

export const BUG_TYPES = ['bug', 'баг', 'ошибка'];

export interface BugListItem {
  key: string;
  url: string;
  summary: string;
  status: string;
  priority?: string;
  storyPoints?: number;
  reporterName?: string;
  assigneeName: string;
  created: string;
  ageDays: number;
}

export type BugAgeSort = 'oldest' | 'newest';

export interface BugListFilters {
  /** When false, drop To Do / К выполнению. */
  includeBacklog?: boolean;
  /** Jira status names to hide. Matched with aliases (В работе / In Progress). */
  excludeStatuses?: string[];
  /** Default oldest first (highest created age). */
  ageSort?: BugAgeSort;
}

/** Unresolved bugs for the team's projects, oldest first. No sprint window. */
export function openBugsJql(projects: string[]): string {
  return withOrderBy(
    andAll([
      projects.length > 0 ? jqlList('project', projects) : undefined,
      'issuetype in ("Bug", "Баг", "Ошибка")',
      'statusCategory != Done',
    ]),
    'ORDER BY created ASC',
  );
}

export function isBugType(type: string | undefined): boolean {
  return matchesAny(type, BUG_TYPES);
}

export function listOpenBugs(issues: NormalizedIssue[], options?: BugListFilters): BugListItem[] {
  return sortBugsByAge(
    issues
      .filter((issue) => isBugType(issue.type) && !isReleaseStatus(issue.status))
      .filter((issue) => options?.includeBacklog || !isTodoStatus(issue.status))
      .filter((issue) => !isExcludedBugStatus(issue.status, options?.excludeStatuses))
      .map(toBugItem),
    options?.ageSort ?? 'oldest',
  );
}

export function uniqueBugStatuses(issues: NormalizedIssue[]): string[] {
  const names = new Map<string, string>();
  for (const issue of issues) {
    if (!isBugType(issue.type) || isReleaseStatus(issue.status)) continue;
    const status = issue.status?.trim();
    if (!status) continue;
    const key = status.toLowerCase();
    if (!names.has(key)) names.set(key, status);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

function isExcludedBugStatus(status: string | undefined, excluded: string[] | undefined): boolean {
  if (!status || !excluded || excluded.length === 0) return false;
  return excluded.some((name) => statusEquals(status, name));
}

export function sortBugsByAge(items: BugListItem[], ageSort: BugAgeSort = 'oldest'): BugListItem[] {
  const newestFirst = ageSort === 'newest';
  return [...items].sort(
    (left, right) =>
      (newestFirst ? left.ageDays - right.ageDays : right.ageDays - left.ageDays) ||
      left.key.localeCompare(right.key),
  );
}

export function formatBugCreated(iso: string | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

export function formatBugPoints(value: number | undefined): string {
  if (value === undefined) return '—';
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  return `${shown} SP`;
}

function toBugItem(issue: NormalizedIssue): BugListItem {
  return {
    key: issue.key,
    url: issue.url,
    summary: issue.summary,
    status: issue.status,
    priority: issue.priority,
    storyPoints: issue.storyPoints,
    reporterName: issue.reporterName,
    assigneeName: issue.assigneeName,
    created: issue.created,
    ageDays: issue.createdAgeDays,
  };
}
