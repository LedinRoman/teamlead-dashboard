import type { DistributionSummary, FlowWorkflow, JiraSprintOption } from '@shared/types';
import { summarize } from './aggregate';
import { isAllowedCycleType, isCycleExcluded } from './cycle-overview';
import { DEFAULT_FLOW_WORKFLOW } from './flow-workflow';
import {
  qualityWorkflowReady,
  replayIssueQuality,
  type QualityCycle,
  type QualityHistoryQuality,
  type QualityIssueInput,
  type QualityReasonKind,
  type QualityReplay,
  type QualityReturnEvent,
} from './quality-classify';
import { parseDate } from './time';
import type { QualityDefects } from './quality-defects';

export type { QualityCycle, QualityHistoryQuality, QualityIssueInput, QualityReasonKind, QualityReturnEvent };

export interface QualityFilters {
  excludeQaTitle?: boolean;
  excludedKeys?: string[];
  useWorkingDays?: boolean;
  holidays?: string[];
}

export interface QualityIssueRow {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  assigneeId?: string;
  assigneeName: string;
  storyPoints?: number;
  firstQaAt?: string;
  firstQaTo?: string;
  returnCount: number;
  historyQuality: QualityHistoryQuality;
  completedCycles: QualityCycle[];
  interruptedCycles: QualityCycle[];
  openCycle?: QualityCycle;
  reachedDoneAt?: string;
  firstPass: 'passed' | 'failed' | 'pending' | 'unknown';
  returns: QualityReturnEvent[];
  bugsAfterTest?: number;
  reason?: string;
}

export interface QualityDistribution {
  zero: number;
  one: number;
  two: number;
  threePlus: number;
  unknown: number;
}

export interface QualityFirstPass {
  passed: number;
  failed: number;
  pending: number;
  fpy: number | null;
}

export interface QualityReasonBucket {
  key: string;
  kind: QualityReasonKind;
  label: string;
  count: number;
}

export interface QualityFieldDiagnostic {
  fieldId?: string;
  fieldName?: string;
  compared: number;
  match: number;
  changelogOnly: number;
  fieldOnly: number;
  disagree: number;
  missingField: number;
}

export type QualityDataQuality = 'exact' | 'partial' | 'unavailable' | 'invalid_configuration';

export interface QualitySnapshot {
  sprintId: number;
  sprintName: string;
  window: { start?: string; end?: string; incomplete: boolean };
  asOf: string;
  dataQuality: QualityDataQuality;
  truncated?: boolean;
  n: number;
  nUnknown: number;
  r: number;
  r2: number;
  loops: number;
  rate: number | null;
  firstPass: QualityFirstPass;
  reasons: QualityReasonBucket[];
  defects: QualityDefects;
  fieldDiagnostic?: QualityFieldDiagnostic;
  distribution: QualityDistribution;
  reworkWip: number;
  reworkSummary: DistributionSummary | null;
  issues: QualityIssueRow[];
  excludedCount: number;
  warnings: string[];
}

export interface BuildQualitySnapshotOptions {
  issues: QualityIssueInput[];
  sprint: JiraSprintOption;
  /** When set, overlapping windows assign the issue to the earlier startDate, then smaller id. */
  allSprints?: JiraSprintOption[];
  asOf: Date;
  workflow?: FlowWorkflow;
  filters?: QualityFilters;
}

/**
 * Half-open cohort window: [startDate, completeDate ?? endDate).
 * Active (or not-yet-ended) sprints close at `asOf`.
 */
export function qualityCohortWindow(
  sprint: Pick<JiraSprintOption, 'startDate' | 'endDate' | 'completeDate' | 'state'>,
  asOf: Date,
): { start?: Date; end?: Date; incomplete: boolean } {
  const start = parseDate(sprint.startDate);
  const plannedEnd = parseDate(sprint.endDate);
  const complete = parseDate(sprint.completeDate);
  const active = String(sprint.state).toLowerCase() === 'active';
  if (active) {
    return { start, end: asOf, incomplete: true };
  }
  return { start, end: complete ?? plannedEnd, incomplete: false };
}

export function inQualityWindow(at: Date, start?: Date, end?: Date): boolean {
  if (!start || !end) return false;
  return at.getTime() >= start.getTime() && at.getTime() < end.getTime();
}

export function assignQualitySprint(
  firstQaAt: Date,
  sprints: JiraSprintOption[],
  asOf: Date,
): JiraSprintOption | undefined {
  const hits = sprints.filter((sprint) => {
    const window = qualityCohortWindow(sprint, asOf);
    return inQualityWindow(firstQaAt, window.start, window.end);
  });
  hits.sort((left, right) => {
    const startLeft = parseDate(left.startDate)?.getTime() ?? Number.POSITIVE_INFINITY;
    const startRight = parseDate(right.startDate)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (startLeft !== startRight) return startLeft - startRight;
    return left.id - right.id;
  });
  return hits[0];
}

export function buildQualitySnapshot(options: BuildQualitySnapshotOptions): QualitySnapshot {
  const workflow = options.workflow ?? DEFAULT_FLOW_WORKFLOW;
  const asOf = options.asOf;
  const window = qualityCohortWindow(options.sprint, asOf);
  const filters = options.filters ?? {};
  const warnings: string[] = [];
  const ready = qualityWorkflowReady(workflow);
  if (!ready.ok && ready.reason) warnings.push(ready.reason);

  const scoped = options.issues.filter((issue) => isAllowedCycleType(issue.type));
  const excludedCount = scoped.filter((issue) =>
    isCycleExcluded(issue, { excludeQaTitle: filters.excludeQaTitle, excludedKeys: filters.excludedKeys }),
  ).length;
  const candidates = scoped.filter(
    (issue) => !isCycleExcluded(issue, { excludeQaTitle: filters.excludeQaTitle, excludedKeys: filters.excludedKeys }),
  );

  const rows: QualityIssueRow[] = [];
  for (const issue of candidates) {
    const replay = replayIssueQuality(issue, {
      asOf,
      workflow,
      useWorkingDays: filters.useWorkingDays,
      holidays: filters.holidays,
    });
    if (!belongsToSprint(replay, options.sprint, options.allSprints, asOf)) continue;
    rows.push(toRow(issue, replay));
  }

  rows.sort((left, right) => left.key.localeCompare(right.key));

  const exact = rows.filter((row) => row.historyQuality === 'exact' && row.firstQaAt);
  const unknown = rows.filter((row) => row.historyQuality !== 'exact' || !row.firstQaAt);
  const n = exact.length;
  const nUnknown = unknown.length;
  const r = exact.filter((row) => row.returnCount >= 1).length;
  const r2 = exact.filter((row) => row.returnCount >= 2).length;
  const loops = exact.reduce((total, row) => total + row.completedCycles.length, 0);
  const rate = n > 0 && nUnknown === 0 ? r / n : null;
  const passed = exact.filter((row) => row.firstPass === 'passed').length;
  const failed = exact.filter((row) => row.firstPass === 'failed').length;
  const pending = exact.filter((row) => row.firstPass === 'pending').length;
  const firstPass: QualityFirstPass = {
    passed,
    failed,
    pending,
    fpy: nUnknown === 0 && passed + failed > 0 ? passed / (passed + failed) : null,
  };
  const reasons = reasonBuckets(exact);
  const completedDays = exact.flatMap((row) =>
    row.completedCycles.map((cycle) => cycle.durationDays).filter((value): value is number => typeof value === 'number'),
  );
  const reworkWip = exact.filter((row) => row.openCycle).length;

  if (nUnknown > 0) warnings.push('Неполная история: точный Rate и FPY по всей когорте недоступны');
  if (n === 0 && nUnknown === 0) warnings.push('В выбранном спринте нет задач с известным First QA Entry');

  const dataQuality: QualityDataQuality = !ready.ok
    ? 'invalid_configuration'
    : nUnknown > 0
      ? 'partial'
      : n === 0
        ? 'unavailable'
        : 'exact';

  return {
    sprintId: options.sprint.id,
    sprintName: options.sprint.name,
    window: {
      start: window.start?.toISOString(),
      end: window.end?.toISOString(),
      incomplete: window.incomplete,
    },
    asOf: asOf.toISOString(),
    dataQuality,
    n,
    nUnknown,
    r,
    r2,
    loops,
    rate,
    firstPass,
    reasons,
    defects: EMPTY_DEFECTS,
    distribution: {
      zero: exact.filter((row) => row.returnCount === 0).length,
      one: exact.filter((row) => row.returnCount === 1).length,
      two: exact.filter((row) => row.returnCount === 2).length,
      threePlus: exact.filter((row) => row.returnCount >= 3).length,
      unknown: nUnknown,
    },
    reworkWip,
    reworkSummary: summarize(completedDays),
    issues: rows,
    excludedCount,
    warnings,
  };
}

function belongsToSprint(
  replay: QualityReplay,
  sprint: JiraSprintOption,
  allSprints: JiraSprintOption[] | undefined,
  asOf: Date,
): boolean {
  const firstQa = parseDate(replay.firstQaAt);
  if (!firstQa) return false;
  if (allSprints && allSprints.length > 0) {
    const assigned = assignQualitySprint(firstQa, allSprints, asOf);
    return assigned?.id === sprint.id;
  }
  const window = qualityCohortWindow(sprint, asOf);
  return inQualityWindow(firstQa, window.start, window.end);
}

function toRow(issue: QualityIssueInput, replay: QualityReplay): QualityIssueRow {
  const completedCycles = replay.cycles.filter((cycle) => cycle.kind === 'completed');
  const interruptedCycles = replay.cycles.filter((cycle) => cycle.kind === 'interrupted');
  const openCycle = replay.cycles.find((cycle) => cycle.kind === 'open');
  return {
    key: issue.key,
    url: issue.url ?? '',
    summary: issue.summary,
    type: issue.type,
    status: issue.status,
    assigneeId: issue.assigneeId,
    assigneeName: issue.assigneeName ?? '',
    storyPoints: issue.storyPoints,
    firstQaAt: replay.firstQaAt,
    firstQaTo: replay.firstQaTo,
    returnCount: replay.returns.length,
    historyQuality: replay.historyQuality,
    completedCycles,
    interruptedCycles,
    openCycle,
    reachedDoneAt: replay.reachedDoneAt,
    firstPass: firstPassOf(replay),
    returns: replay.returns,
    bugsAfterTest: issue.bugsAfterTest,
    reason: replay.reason,
  };
}

function firstPassOf(replay: QualityReplay): QualityIssueRow['firstPass'] {
  if (replay.historyQuality !== 'exact' || !replay.firstQaAt) return 'unknown';
  if (replay.returns.length >= 1) return 'failed';
  if (replay.reachedDoneAt) return 'passed';
  return 'pending';
}

function reasonBuckets(rows: QualityIssueRow[]): QualityReasonBucket[] {
  const counts = new Map<string, QualityReasonBucket>();
  for (const row of rows) {
    for (const event of row.returns) {
      const key = `${event.reasonKind}:${event.reasonLabel}`;
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { key, kind: event.reasonKind, label: event.reasonLabel, count: 1 });
    }
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ru'));
}

const EMPTY_DEFECTS: QualityDefects = { created: 0, production: 0, incidents: 0, unproven: 0, items: [] };

export function attachQualityStage5(
  snapshot: QualitySnapshot,
  extra: { defects?: QualityDefects; fieldDiagnostic?: QualityFieldDiagnostic },
): QualitySnapshot {
  return {
    ...snapshot,
    defects: extra.defects ?? snapshot.defects,
    fieldDiagnostic: extra.fieldDiagnostic ?? snapshot.fieldDiagnostic,
  };
}

export function buildFieldDiagnostic(
  rows: QualityIssueRow[],
  field?: { id: string; name: string },
): QualityFieldDiagnostic | undefined {
  if (!field) return undefined;
  const exact = rows.filter((row) => row.historyQuality === 'exact');
  let match = 0;
  let changelogOnly = 0;
  let fieldOnly = 0;
  let disagree = 0;
  let missingField = 0;
  for (const row of exact) {
    const fieldValue = row.bugsAfterTest;
    const returns = row.returnCount;
    if (fieldValue === undefined) {
      missingField += 1;
      if (returns > 0) changelogOnly += 1;
      continue;
    }
    if (fieldValue === returns) match += 1;
    else if (fieldValue > 0 && returns === 0) fieldOnly += 1;
    else if (returns > 0 && fieldValue === 0) changelogOnly += 1;
    else disagree += 1;
  }
  return {
    fieldId: field.id,
    fieldName: field.name,
    compared: exact.length,
    match,
    changelogOnly,
    fieldOnly,
    disagree,
    missingField,
  };
}

const TRUNCATED_WARNING = 'Поиск обрезан лимитом Jira. Часть когорты может отсутствовать.';

/** Truncation is missing coverage, not zero returns. Keep confirmed counts; hide exact Rate. */
export function applyQualitySearchLimits(snapshot: QualitySnapshot, truncated: boolean): QualitySnapshot {
  if (!truncated) return snapshot;
  const warnings = snapshot.warnings.includes(TRUNCATED_WARNING)
    ? snapshot.warnings
    : [TRUNCATED_WARNING, ...snapshot.warnings];
  return {
    ...snapshot,
    truncated: true,
    dataQuality: snapshot.dataQuality === 'invalid_configuration' ? snapshot.dataQuality : 'partial',
    rate: null,
    firstPass: { ...snapshot.firstPass, fpy: null },
    warnings,
  };
}

export interface QualityHistoryRow {
  sprintId: number;
  name: string;
  n: number;
  nUnknown: number;
  r: number;
  r2: number;
  loops: number;
  rate: number | null;
  fpy: number | null;
  passed: number;
  failed: number;
  pending: number;
  production: number;
  incidents: number;
  distribution: QualityDistribution;
  reworkWip: number;
  dataQuality: QualityDataQuality;
  current: boolean;
  incomplete: boolean;
  asOf: string;
}

export function qualityHistoryRow(snapshot: QualitySnapshot, currentSprintId: number): QualityHistoryRow {
  return {
    sprintId: snapshot.sprintId,
    name: snapshot.sprintName,
    n: snapshot.n,
    nUnknown: snapshot.nUnknown,
    r: snapshot.r,
    r2: snapshot.r2,
    loops: snapshot.loops,
    rate: snapshot.rate,
    fpy: snapshot.firstPass.fpy,
    passed: snapshot.firstPass.passed,
    failed: snapshot.firstPass.failed,
    pending: snapshot.firstPass.pending,
    production: snapshot.defects.production,
    incidents: snapshot.defects.incidents,
    distribution: snapshot.distribution,
    reworkWip: snapshot.reworkWip,
    dataQuality: snapshot.dataQuality,
    current: snapshot.sprintId === currentSprintId,
    incomplete: snapshot.window.incomplete,
    asOf: snapshot.asOf,
  };
}

export function previousClosedQuality(
  history: QualityHistoryRow[],
  currentSprintId: number,
): QualityHistoryRow | undefined {
  const index = history.findIndex((row) => row.sprintId === currentSprintId);
  const before = index >= 0 ? history.slice(0, index) : history;
  return [...before].reverse().find((row) => !row.incomplete);
}
