import type { JiraFieldOption, JiraSprintOption, NormalizedIssue } from '@shared/types';
import { isBugType } from './bug-list';
import { matchesAny } from './rules';
import { parseDate } from './time';

export const INCIDENT_TYPES = ['incident', 'инцидент', 'production incident'];
export const PRODUCTION_LABELS = ['production', 'prod', 'hotfix', 'incident', 'инцидент', 'prod-bug', 'production-bug'];

export type QualityDefectKind = 'incident' | 'production' | 'unproven' | 'qa-found';

export interface QualityDefectRow {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  created: string;
  kind: QualityDefectKind;
  reason: string;
  linkedKey?: string;
}

export interface QualityDefectInput {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  created: string;
  labels: string[];
  parentKey?: string;
  linkedKeys: string[];
}

export interface QualityDefects {
  created: number;
  production: number;
  incidents: number;
  unproven: number;
  items: QualityDefectRow[];
}

export function isIncidentType(type: string | undefined): boolean {
  return matchesAny(type, INCIDENT_TYPES);
}

export function isDefectType(type: string | undefined): boolean {
  return isBugType(type) || isIncidentType(type);
}

export function hasProductionLabel(labels: string[] | undefined): boolean {
  return (labels ?? []).some((label) => matchesAny(label, PRODUCTION_LABELS));
}

export function findBugsAfterTestField(fields: JiraFieldOption[]): JiraFieldOption | undefined {
  return fields.find((field) => /bugs?\s*after\s*test|баг[аи]?\s+после\s+тест/i.test(field.name));
}

export function readNumericCustom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === 'object') {
    const record = value as { value?: unknown };
    if ('value' in record) return readNumericCustom(record.value);
  }
  return undefined;
}

export function toQualityDefectInput(issue: NormalizedIssue): QualityDefectInput {
  return {
    key: issue.key,
    url: issue.url,
    summary: issue.summary,
    type: issue.type,
    status: issue.status,
    created: issue.created,
    labels: issue.labels,
    parentKey: issue.parentKey,
    linkedKeys: issue.links.map((link) => link.key),
  };
}

export function classifyQualityDefects(options: {
  bugs: QualityDefectInput[];
  sprints: JiraSprintOption[];
  assignSprint: (created: Date) => JiraSprintOption | undefined;
  doneAtByKey: Map<string, string>;
  cohortKeysBySprint: Map<number, Set<string>>;
}): Map<number, QualityDefects> {
  const bySprint = new Map<number, QualityDefectRow[]>();
  for (const sprint of options.sprints) bySprint.set(sprint.id, []);

  for (const bug of options.bugs) {
    if (!isDefectType(bug.type)) continue;
    const created = parseDate(bug.created);
    if (!created) continue;
    const sprint = options.assignSprint(created);
    if (!sprint) continue;
    const cohort = options.cohortKeysBySprint.get(sprint.id);
    const inCohort = Boolean(cohort?.has(bug.key));
    const related = relatedKeys(bug);
    const linkedDone = related.find((key) => {
      const doneAt = parseDate(options.doneAtByKey.get(key));
      return doneAt !== undefined && created.getTime() >= doneAt.getTime();
    });
    const incident = isIncidentType(bug.type);
    const prodLabel = hasProductionLabel(bug.labels);
    let kind: QualityDefectKind;
    let reason: string;
    if (inCohort) {
      kind = 'qa-found';
      reason = 'Уже в когорте First QA — находка на проверке, не production.';
    } else if (incident) {
      kind = 'incident';
      reason = 'Тип Incident.';
    } else if (prodLabel) {
      kind = 'production';
      reason = 'Метка production / hotfix / инцидент.';
    } else if (linkedDone) {
      kind = 'production';
      reason = `Создан после Готово у ${linkedDone}.`;
    } else {
      kind = 'unproven';
      reason = 'Создан в окне спринта, но нет признака production.';
    }
    bySprint.get(sprint.id)?.push({
      key: bug.key,
      url: bug.url,
      summary: bug.summary,
      type: bug.type,
      status: bug.status,
      created: bug.created,
      kind,
      reason,
      linkedKey: linkedDone,
    });
  }

  const result = new Map<number, QualityDefects>();
  for (const sprint of options.sprints) {
    const items = (bySprint.get(sprint.id) ?? []).sort((left, right) => left.key.localeCompare(right.key));
    const visible = items.filter((item) => item.kind !== 'qa-found');
    result.set(sprint.id, {
      created: visible.length,
      production: visible.filter((item) => item.kind === 'production').length,
      incidents: visible.filter((item) => item.kind === 'incident').length,
      unproven: visible.filter((item) => item.kind === 'unproven').length,
      items: visible,
    });
  }
  return result;
}

function relatedKeys(bug: QualityDefectInput): string[] {
  return [...new Set([bug.parentKey, ...bug.linkedKeys].filter((key): key is string => Boolean(key)))];
}
