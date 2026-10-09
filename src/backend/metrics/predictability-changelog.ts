import type { EstimateChange, NamedChange } from './predictability-estimates';
import { parseStoryPointsValue } from './predictability-estimates';
import { parseSprintIdList, type SprintFieldChange } from './predictability-membership';

export interface ChangelogItem {
  field?: string;
  fieldId?: string;
  from?: string | null;
  to?: string | null;
  fromString?: string | null;
  toString?: string | null;
}

export interface ChangelogHistory {
  created: string;
  items?: ChangelogItem[];
}

export interface RawChangelogShape {
  startAt?: number;
  maxResults?: number;
  total?: number;
  histories?: ChangelogHistory[];
}

const SEARCH_CHANGELOG_CAP = 40;

export function changelogIsComplete(changelog?: RawChangelogShape): boolean {
  const histories = changelog?.histories;
  if (!histories) return false;
  const n = histories.length;
  if (typeof changelog?.total === 'number') return changelog.total <= n;
  if (n >= SEARCH_CHANGELOG_CAP) return false;
  return true;
}

export function isSprintField(item: ChangelogItem, sprintFieldId?: string): boolean {
  const field = (item.field ?? '').trim().toLowerCase();
  if (field === 'sprint' || field === 'спринт') return true;
  if (sprintFieldId && item.fieldId === sprintFieldId) return true;
  return false;
}

export function isStoryPointsField(item: ChangelogItem, storyPointsFieldId?: string): boolean {
  if (storyPointsFieldId && item.fieldId === storyPointsFieldId) return true;
  const field = (item.field ?? '').trim().toLowerCase();
  return field === 'story points' || field === 'story point estimate' || field === 'story point' || /story\s*points?/.test(field);
}

export function isIssueTypeField(item: ChangelogItem): boolean {
  const field = (item.field ?? '').trim().toLowerCase();
  const id = (item.fieldId ?? '').trim().toLowerCase();
  return field === 'issuetype' || field === 'issue type' || field === 'тип задачи' || id === 'issuetype';
}

export function extractSprintChanges(
  histories: ChangelogHistory[] | undefined,
  sprintFieldId?: string,
  nameToId?: Map<string, number>,
): SprintFieldChange[] {
  const changes: SprintFieldChange[] = [];
  for (const history of histories ?? []) {
    if (!history.created) continue;
    for (const item of history.items ?? []) {
      if (!isSprintField(item, sprintFieldId)) continue;
      changes.push({
        at: history.created,
        fromIds: parseSprintRefs(item.from, item.fromString, nameToId),
        toIds: parseSprintRefs(item.to, item.toString, nameToId),
      });
    }
  }
  return changes;
}

function parseSprintRefs(
  ids: string | null | undefined,
  names: string | null | undefined,
  nameToId?: Map<string, number>,
): number[] {
  const parsed = parseSprintIdList(ids);
  if (parsed.length > 0) return parsed;
  if (!nameToId || !names) return [];
  const out: number[] = [];
  for (const part of names.split(',')) {
    const id = nameToId.get(part.trim().toLowerCase());
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

export function extractEstimateChanges(
  histories: ChangelogHistory[] | undefined,
  storyPointsFieldId?: string,
): EstimateChange[] {
  const changes: EstimateChange[] = [];
  for (const history of histories ?? []) {
    if (!history.created) continue;
    for (const item of history.items ?? []) {
      if (!isStoryPointsField(item, storyPointsFieldId)) continue;
      changes.push({
        at: history.created,
        from: parseStoryPointsValue(item.fromString ?? item.from),
        to: parseStoryPointsValue(item.toString ?? item.to),
      });
    }
  }
  return changes;
}

export function extractTypeChanges(histories: ChangelogHistory[] | undefined): NamedChange[] {
  const changes: NamedChange[] = [];
  for (const history of histories ?? []) {
    if (!history.created) continue;
    for (const item of history.items ?? []) {
      if (!isIssueTypeField(item)) continue;
      const from = item.fromString?.trim() || undefined;
      const to = item.toString?.trim() || undefined;
      changes.push({ at: history.created, from, to });
    }
  }
  return changes;
}
