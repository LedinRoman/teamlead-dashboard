import type { RawChangelogEntry, RawIssue } from '@backend/jira/client';
import type {
  FieldMapping,
  IssueSignal,
  JiraStatusOption,
  NormalizedIssue,
  NormalizedLink,
  StatusCategory,
  MetricRules,
} from '@shared/types';
import {
  ENGINEERING_DONE_STATUS,
  effectiveCategory,
  isEngineeringDone,
  isOverridden,
  isReleaseStatus,
  matchesAny,
  startsWork,
  statusEquals,
} from './rules';
import { daysBetween, elapsedDays, parseDate, round1, signedDaysBetween } from './time';

export interface NormalizeOptions {
  fields: FieldMapping;
  rules: MetricRules;
  issueUrl: (key: string) => string;
  now?: Date;
  /** When the scope is a single sprint, ids present in more than one sprint are carry-over. */
  sprintId?: number;
  /** Site-wide statuses so changelog names still resolve when nobody currently sits in them. */
  statusCatalog?: JiraStatusOption[];
  /** Every candidate story-points field id, tried in order. */
  storyPointFields?: string[];
  /** First transition into this status starts cycle time. Empty = any in-progress. */
  cycleStartStatus?: string;
  /** First transition into this status ends cycle time. Defaults to Проверка. */
  cycleEndStatus?: string;
  /** Keep compact status transitions on the issue (Flow only). */
  withTimeline?: boolean;
}

export interface NormalizeResult {
  issues: NormalizedIssue[];
  coverage: {
    storyPoints: boolean;
    sprint: boolean;
    dueDate: boolean;
    changelog: boolean;
  };
  /** Work items dropped by the excluded-types rule, so the count can be disclosed. */
  excludedCount: number;
  /** Statuses in this scope whose category was changed by the rules. */
  overriddenStatuses: string[];
}

export function normalizeIssues(raw: RawIssue[], options: NormalizeOptions): NormalizeResult {
  const now = options.now ?? new Date();
  const statusCategoryByName = buildStatusCategoryMap(raw, options.rules, options.statusCatalog);
  const statusNameById = buildStatusNameById(raw, options.statusCatalog);

  const all = raw.map((issue) =>
    normalizeIssue(issue, options, now, statusCategoryByName, statusNameById),
  );
  const issues = all.filter((issue) => !matchesAny(issue.type, options.rules.excludedTypes));

  const overridden = new Set<string>();
  for (const issue of issues) {
    if (isOverridden(issue.status, options.rules)) overridden.add(issue.status);
  }

  return {
    issues,
    coverage: {
      storyPoints: issues.some((i) => i.storyPoints !== undefined),
      sprint: issues.some((i) => i.sprintNames.length > 0),
      dueDate: issues.some((i) => i.dueDate !== undefined),
      changelog: raw.some((issue) => Array.isArray(issue.changelog?.histories)),
    },
    excludedCount: all.length - issues.length,
    overriddenStatuses: [...overridden].sort((a, b) => a.localeCompare(b)),
  };
}

function normalizeIssue(
  raw: RawIssue,
  options: NormalizeOptions,
  now: Date,
  statusCategoryByName: Map<string, StatusCategory>,
  statusNameById: Map<string, string>,
): NormalizedIssue {
  const fields = raw.fields ?? {};
  const status = readNamed(fields.status) ?? 'Unknown';
  const statusCategory = readStatusCategory(fields.status);
  const category = effectiveCategory(status, statusCategory, options.rules);

  const created = parseDate(fields.created);
  const updated = parseDate(fields.updated);
  const resolved = parseDate(fields.resolutiondate);
  const dueDate = parseDate(fields.duedate);

  const assignee = readUser(fields.assignee);
  const sprints = readSprints(customValue(fields, options.fields.sprintField));

  const issue: NormalizedIssue = {
    key: raw.key,
    url: options.issueUrl(raw.key),
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    type: readNamed(fields.issuetype) ?? 'Unknown',
    status,
    statusCategory,
    effectiveCategory: category,
    priority: readNamed(fields.priority),
    assigneeId: assignee?.id,
    assigneeName: assignee?.displayName ?? 'Unassigned',
    assigneeActive: assignee?.active,
    reporterName: readUser(fields.reporter)?.displayName,
    created: created?.toISOString() ?? '',
    updated: updated?.toISOString() ?? '',
    resolved: resolved?.toISOString(),
    doneAt: undefined,
    doneAtSource: 'none',
    dueDate: dueDate?.toISOString(),
    createdAgeDays: created ? daysBetween(created, now) : 0,
    updatedAgeDays: updated ? daysBetween(updated, now) : 0,
    resolvedAgeDays: resolved ? daysBetween(resolved, now) : undefined,
    dueInDays: dueDate ? signedDaysBetween(now, dueDate) : undefined,
    storyPoints: readStoryPoints(fields, options.storyPointFields ?? [options.fields.storyPointsField]),
    labels: readStringArray(fields.labels),
    components: readNamedArray(fields.components),
    fixVersions: readNamedArray(fields.fixVersions),
    parentKey: readParentKey(fields, options.fields.epicLinkField),
    parentSummary: readParentSummary(fields),
    sprintNames: sprints.map((sprint) => sprint.name),
    sprintIds: sprints.map((sprint) => sprint.id).filter((id): id is number => id !== undefined),
    links: readLinks(fields.issuelinks, options.rules),
    signals: [],
  };

  applyTiming(
    issue,
    raw.changelog?.histories,
    statusCategoryByName,
    statusNameById,
    options,
    resolved,
    created,
    now,
  );
  issue.signals = deriveSignals(issue, options, sprints.length);
  return issue;
}

/* ----------------------------------------------------------------- timing --- */

/**
 * Establishes when the work started and when it finished, then derives cycle and
 * lead time from those two points.
 *
 * Jira's `resolutiondate` only exists for statuses in its own Done category, so a
 * rule such as "In Review counts as done" leaves the completion time to be read
 * from the changelog instead. Without a changelog such an item still counts in
 * state metrics but cannot appear in any duration, which the model reports rather
 * than papering over with the current time.
 */
function applyTiming(
  issue: NormalizedIssue,
  histories: RawChangelogEntry[] | undefined,
  statusCategoryByName: Map<string, StatusCategory>,
  statusNameById: Map<string, string>,
  options: NormalizeOptions,
  resolved: Date | undefined,
  created: Date | undefined,
  now: Date,
): void {
  let firstStarted: Date | undefined;
  let enteredDone: Date | undefined;
  let lastStatusAt: Date | undefined;
  const transitions: NonNullable<NormalizedIssue['statusTransitions']> = [];

  for (const history of histories ?? []) {
    const at = parseDate(history.created);
    if (!at) continue;
    for (const item of history.items ?? []) {
      const field = (item.field ?? item.fieldId ?? '').toLowerCase();
      if (field !== 'status') continue;
      const to = changelogStatusName(item.to, item.toString, statusNameById);
      if (!to) continue;
      const from = changelogStatusName(item.from, item.fromString, statusNameById);
      lastStatusAt = !lastStatusAt || at.getTime() >= lastStatusAt.getTime() ? at : lastStatusAt;
      if (options.withTimeline) {
        transitions.push({ at: at.toISOString(), from, to });
      }
      const category = statusCategoryByName.get(to.toLowerCase()) ?? 'unknown';
      const endStatus = options.cycleEndStatus ?? ENGINEERING_DONE_STATUS;
      const startStatus = options.cycleStartStatus;

      if (statusEquals(to, endStatus) || (statusEquals(endStatus, ENGINEERING_DONE_STATUS) && isEngineeringDone(to))) {
        if (!enteredDone || at.getTime() < enteredDone.getTime()) enteredDone = at;
        continue;
      }
      if (isReleaseStatus(to) && !statusEquals(to, endStatus)) continue;

      const started = startStatus
        ? statusEquals(to, startStatus)
        : startsWork(to, category, options.rules);
      if (started) {
        if (!firstStarted || at.getTime() < firstStarted.getTime()) firstStarted = at;
      }
    }
  }

  if (enteredDone) {
    issue.doneAt = enteredDone.toISOString();
    issue.doneAtSource = 'changelog';
  }

  const doneAt = parseDate(issue.doneAt);
  if (doneAt) issue.resolvedAgeDays = daysBetween(doneAt, now);
  if (created && doneAt) issue.leadTimeDays = daysBetween(created, doneAt);
  if (!firstStarted && enteredDone && created) firstStarted = created;
  if (firstStarted) issue.firstInProgress = firstStarted.toISOString();
  if (firstStarted && enteredDone) {
    issue.cycleTimeDays = Math.max(0, elapsedDays(firstStarted, enteredDone));
  }
  if (lastStatusAt) issue.statusEnteredAt = lastStatusAt.toISOString();
  if (options.withTimeline && transitions.length > 0) {
    issue.statusTransitions = transitions.sort((left, right) => left.at.localeCompare(right.at));
  }
}

/**
 * Changelogs record status names, not categories, so the category has to be
 * learned from the statuses present in the fetched issue set and then put through
 * the same rules as the issues themselves.
 */
/**
 * Cloud changelogs often keep the untranslated status name (`Review`) plus a
 * stable id, while `fields.status.name` is localised (`Проверка`). Prefer the
 * catalog or current-issue name for that id so rules still match.
 */
function changelogStatusName(
  id: string | null | undefined,
  fallback: string | null | undefined,
  statusNameById: Map<string, string>,
): string | undefined {
  if (id) {
    const named = statusNameById.get(String(id));
    if (named) return named;
  }
  const text = fallback?.trim();
  return text || undefined;
}

function buildStatusNameById(raw: RawIssue[], catalog?: JiraStatusOption[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const status of catalog ?? []) {
    if (status.id) map.set(String(status.id), status.name);
  }
  for (const issue of raw) {
    const status = issue.fields?.status;
    const id = readStatusId(status);
    const name = readNamed(status);
    if (id && name) map.set(id, name);
  }
  return map;
}

function buildStatusCategoryMap(
  raw: RawIssue[],
  rules: MetricRules,
  catalog?: JiraStatusOption[],
): Map<string, StatusCategory> {
  const map = new Map<string, StatusCategory>();
  for (const status of catalog ?? []) {
    map.set(status.name.toLowerCase(), effectiveCategory(status.name, status.category, rules));
  }
  for (const issue of raw) {
    const name = readNamed(issue.fields?.status);
    if (!name) continue;
    map.set(name.toLowerCase(), effectiveCategory(name, readStatusCategory(issue.fields?.status), rules));
  }
  for (const status of [...rules.doneStatuses, ...rules.activeStatuses]) {
    const key = status.trim().toLowerCase();
    // A status nobody currently sits in never appears in the fetched set, yet the
    // changelog still needs to recognise it as a finish or a start.
    if (key && !map.has(key)) {
      map.set(key, rules.doneStatuses.some((c) => c.trim().toLowerCase() === key) ? 'done' : 'indeterminate');
    }
  }
  // Changelog toString is often English even when the catalog is localised.
  if (!map.has('review')) map.set('review', effectiveCategory('Review', 'indeterminate', rules));
  if (!map.has('in progress')) map.set('in progress', 'indeterminate');
  if (!map.has('done')) map.set('done', effectiveCategory('Done', 'done', rules));
  return map;
}

/* ---------------------------------------------------------------- signals --- */

function deriveSignals(
  issue: NormalizedIssue,
  options: NormalizeOptions,
  sprintCount: number,
): IssueSignal[] {
  const { rules } = options;
  const signals: IssueSignal[] = [];
  const done = issue.effectiveCategory === 'done';

  if (done) {
    signals.push('done');
  } else if (issue.effectiveCategory === 'indeterminate') {
    signals.push('active');
  } else {
    signals.push('not-started');
  }

  if (!done) {
    if (issue.updatedAgeDays >= rules.veryStaleDays) signals.push('very-stale');
    else if (issue.updatedAgeDays >= rules.staleDays) signals.push('stale');

    const statusBlocked = matchesAny(issue.status, rules.blockedStatuses);
    const labelBlocked = issue.labels.some((label) => matchesAny(label, rules.blockedLabels));
    if (statusBlocked) signals.push('blocked');
    else if (labelBlocked) signals.push('blocked-inferred');

    if (!issue.assigneeId) signals.push('unowned');
    else if (issue.assigneeActive === false) signals.push('inactive-owner');

    if (issue.dueInDays !== undefined) {
      if (issue.dueInDays < 0) signals.push('overdue');
      else if (issue.dueInDays <= rules.dueSoonDays) signals.push('due-soon');
    }

    if (options.sprintId !== undefined && sprintCount > 1) signals.push('carry-over');
    if (options.fields.storyPointsField && issue.storyPoints === undefined) signals.push('no-estimate');

    // Only links that put this work item on the receiving end count. "blocks"
    // means the other item is waiting, and "relates to" says nothing at all, so
    // counting either would flag most of a healthy backlog.
    const blockedByLink = issue.links.some(
      (link) =>
        matchesAny(link.type, rules.blockingLinkTypes) &&
        link.statusCategory !== undefined &&
        link.statusCategory !== 'done',
    );
    if (blockedByLink) signals.push('unresolved-dependency');
  }

  return signals;
}

/* ----------------------------------------------------------------- readers --- */

/**
 * Custom field values normally arrive as top-level `customfield_*` keys, but some
 * Jira proxies nest them under `customFields`.
 */
function readStoryPoints(fields: Record<string, unknown>, candidates: Array<string | undefined>): number | undefined {
  for (const id of candidates) {
    const value = readNumber(customValue(fields, id));
    if (value !== undefined) return value;
  }
  return undefined;
}

function customValue(fields: Record<string, unknown>, fieldId: string | undefined): unknown {
  if (!fieldId) return undefined;
  if (fieldId in fields) return fields[fieldId];
  const nested = fields.customFields;
  if (nested && typeof nested === 'object') {
    return (nested as Record<string, unknown>)[fieldId];
  }
  return undefined;
}

function readNamed(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function readStatusId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = (value as { id?: unknown }).id;
  if (typeof id === 'string' && id.trim()) return id.trim();
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return undefined;
}

function readStatusCategory(value: unknown): StatusCategory {
  if (!value || typeof value !== 'object') return 'unknown';
  const category = (value as { statusCategory?: { key?: unknown } }).statusCategory;
  const key = category && typeof category === 'object' ? (category as { key?: unknown }).key : undefined;
  if (key === 'done' || key === 'indeterminate' || key === 'new') return key;
  return 'unknown';
}

function readUser(value: unknown): { id?: string; displayName: string; active?: boolean } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const user = value as {
    accountId?: string;
    name?: string;
    key?: string;
    displayName?: string;
    active?: boolean;
  };
  const id = user.accountId ?? user.name ?? user.key;
  return {
    id,
    displayName: user.displayName ?? id ?? 'Unknown',
    active: user.active,
  };
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return round1(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return round1(parsed);
  }
  return undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readNamedArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readNamed).filter((name): name is string => Boolean(name));
}

function readParentKey(fields: Record<string, unknown>, epicLinkField?: string): string | undefined {
  const parent = fields.parent;
  if (parent && typeof parent === 'object') {
    const key = (parent as { key?: unknown }).key;
    if (typeof key === 'string') return key;
  }
  const epicLink = customValue(fields, epicLinkField);
  return typeof epicLink === 'string' ? epicLink : undefined;
}

function readParentSummary(fields: Record<string, unknown>): string | undefined {
  const parent = fields.parent;
  if (!parent || typeof parent !== 'object') return undefined;
  const parentFields = (parent as { fields?: { summary?: unknown } }).fields;
  const summary = parentFields?.summary;
  return typeof summary === 'string' ? summary : undefined;
}

function readLinks(value: unknown, rules: MetricRules): NormalizedLink[] {
  if (!Array.isArray(value)) return [];
  const links: NormalizedLink[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const link = entry as {
      type?: { inward?: string; outward?: string; name?: string };
      inwardIssue?: { key?: string; fields?: { status?: unknown } };
      outwardIssue?: { key?: string; fields?: { status?: unknown } };
    };
    const target = link.outwardIssue ?? link.inwardIssue;
    if (!target?.key) continue;
    const direction: 'inward' | 'outward' = link.outwardIssue ? 'outward' : 'inward';
    const status = readNamed(target.fields?.status);
    links.push({
      key: target.key,
      type:
        (direction === 'outward' ? link.type?.outward : link.type?.inward) ?? link.type?.name ?? 'relates to',
      direction,
      status,
      statusCategory:
        target.fields?.status && status
          ? effectiveCategory(status, readStatusCategory(target.fields.status), rules)
          : undefined,
    });
  }
  return links;
}

/**
 * Cloud returns sprints as objects; Server/DC returns GreenHopper strings such as
 * `com.atlassian.greenhopper...Sprint@1[id=42,rapidViewId=7,name=Sprint 5,...]`.
 */
function readSprints(value: unknown): Array<{ id?: number; name: string }> {
  if (!Array.isArray(value)) return [];
  const sprints: Array<{ id?: number; name: string }> = [];
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const sprint = entry as { id?: unknown; name?: unknown };
      const name = typeof sprint.name === 'string' ? sprint.name : undefined;
      const id = typeof sprint.id === 'number' ? sprint.id : undefined;
      if (name) sprints.push({ id, name });
      continue;
    }
    if (typeof entry !== 'string') continue;
    const name = /(?:^|,)name=([^,\]]+)/.exec(entry)?.[1];
    const id = /(?:^|,|\[)id=(\d+)/.exec(entry)?.[1];
    if (name) sprints.push({ id: id ? Number(id) : undefined, name: name.trim() });
  }
  return sprints;
}
