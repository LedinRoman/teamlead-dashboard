import type { FlowWorkflow, StatusTransition } from '@shared/types';
import { statusInList } from './flow-workflow';
import { sortTransitions } from './flow-timeline';
import { QUALITY_FIX_STATUS } from './quality-copy';
import { isReleaseStatus, statusEquals } from './rules';
import { elapsedDays, parseDate, workingElapsedDays } from './time';

export type QualityHistoryQuality = 'exact' | 'partial' | 'unavailable';
export type QualityCycleKind = 'completed' | 'open' | 'interrupted';
export type QualityReasonKind = 'comment' | 'label' | 'resolution' | 'custom' | 'none';

export interface QualityChangelogItem {
  field?: string;
  fieldId?: string;
  from?: string | null;
  to?: string | null;
  fromString?: string | null;
  toString?: string | null;
}

export interface QualityChangelogHistory {
  created?: string;
  items?: QualityChangelogItem[];
}

export interface QualityReturnEvidence {
  field: string;
  fieldId?: string;
  value?: string;
}

export interface QualityReturnEvent {
  at: string;
  from: string;
  to: string;
  reasonKind: QualityReasonKind;
  reasonLabel: string;
  evidence: QualityReturnEvidence[];
}

export interface QualityCycle {
  startedAt: string;
  endedAt?: string;
  kind: QualityCycleKind;
  /** Set when `kind` is `interrupted`. Готово does not undo the QA Return. */
  interruptReason?: 'done';
  /** Completed cycles only. Time from Fix return until the next QA-group entry. */
  durationDays?: number;
  /** Open cycles only. Age from the return until `asOf`. */
  ageDays?: number;
}

export interface QualityIssueInput {
  key: string;
  url?: string;
  summary: string;
  type: string;
  status: string;
  created?: string;
  assigneeId?: string;
  assigneeName?: string;
  storyPoints?: number;
  labels?: string[];
  parentKey?: string;
  linkedKeys?: string[];
  statusTransitions?: StatusTransition[];
  histories?: QualityChangelogHistory[];
  changelogComplete: boolean;
  bugsAfterTest?: number;
}

export interface QualityReplayOptions {
  asOf: Date;
  workflow: FlowWorkflow;
  useWorkingDays?: boolean;
  holidays?: string[];
}

export interface QualityReplay {
  firstQaAt?: string;
  firstQaTo?: string;
  reachedDoneAt?: string;
  returns: QualityReturnEvent[];
  cycles: QualityCycle[];
  historyQuality: QualityHistoryQuality;
  reason?: string;
}

export function isQualityQaStatus(status: string | undefined, workflow: FlowWorkflow): boolean {
  return statusInList(status, workflow.qaQueue) || statusInList(status, workflow.inReview);
}

export function isQualityFixStatus(status: string | undefined): boolean {
  return statusEquals(status, QUALITY_FIX_STATUS);
}

export function isQualityDoneStatus(status: string | undefined, workflow: FlowWorkflow): boolean {
  return statusInList(status, workflow.done) || isReleaseStatus(status);
}

export function qualityQaStatusNames(workflow: FlowWorkflow): string[] {
  return [...workflow.qaQueue, ...workflow.inReview];
}

export function qualityWorkflowReady(workflow: FlowWorkflow): { ok: boolean; reason?: string } {
  if (qualityQaStatusNames(workflow).length === 0) {
    return { ok: false, reason: 'Не настроена QA-группа (Ready to QA / Проверка)' };
  }
  return { ok: true };
}

/**
 * Replay changelog status transitions into First QA, QA Returns, and rework cycles.
 * Does not invent missing timestamps. Internal QA moves are not returns.
 */
export function replayIssueQuality(issue: QualityIssueInput, options: QualityReplayOptions): QualityReplay {
  const { workflow, asOf } = options;
  const asOfMs = asOf.getTime();
  const prepared = prepareTransitions(issue.statusTransitions);
  const later = prepared.items.filter((item) => (parseDate(item.at)?.getTime() ?? 0) > asOfMs);
  const ordered = prepared.items.filter((item) => {
    const at = parseDate(item.at);
    return at !== undefined && at.getTime() <= asOfMs;
  });

  if (ordered.length === 0) {
    if (!issue.changelogComplete && later.length === 0) {
      return { returns: [], cycles: [], historyQuality: 'unavailable', reason: 'changelog incomplete' };
    }
    const statusAtAsOf = later[0]?.from ?? (issue.changelogComplete ? issue.status : undefined);
    if (isQualityQaStatus(statusAtAsOf, workflow)) {
      if (!parseDate(issue.created)) {
        return { returns: [], cycles: [], historyQuality: 'unavailable', reason: 'missing created for First QA' };
      }
      return {
        firstQaAt: issue.created,
        firstQaTo: statusAtAsOf,
        returns: [],
        cycles: [],
        historyQuality: resolveHistoryQuality(issue.changelogComplete, prepared.skippedInvalid, 0, false),
      };
    }
    return {
      returns: [],
      cycles: [],
      historyQuality: resolveHistoryQuality(issue.changelogComplete, prepared.skippedInvalid, later.length, false),
    };
  }

  const returns: QualityReturnEvent[] = [];
  const cycles: QualityCycle[] = [];
  let firstQaAt: string | undefined;
  let firstQaTo: string | undefined;
  let reachedDoneAt: string | undefined;
  let open: QualityCycle | undefined;
  let status = ordered[0]?.from;
  const ambiguous = hasAmbiguousTimestamps(ordered);

  if (status && isQualityQaStatus(status, workflow)) {
    if (!parseDate(issue.created)) {
      return { returns: [], cycles: [], historyQuality: 'unavailable', reason: 'missing created for First QA' };
    }
    firstQaAt = issue.created;
    firstQaTo = status;
  }

  for (const item of ordered) {
    const prev = item.from ?? status;
    const next = item.to;

    if (open && isQualityDoneStatus(next, workflow)) {
      open.kind = 'interrupted';
      open.interruptReason = 'done';
      open.endedAt = item.at;
      delete open.ageDays;
      cycles.push(open);
      open = undefined;
    }

    const fromQa = isQualityQaStatus(prev, workflow);
    const toQa = isQualityQaStatus(next, workflow);
    const toFix = isQualityFixStatus(next);

    if (firstQaAt && !reachedDoneAt && isQualityDoneStatus(next, workflow)) {
      reachedDoneAt = item.at;
    }

    if (fromQa && toFix) {
      const evidence = evidenceAt(issue.histories, item.at);
      returns.push({
        at: item.at,
        from: prev ?? next,
        to: next,
        reasonKind: evidence.kind,
        reasonLabel: evidence.label,
        evidence: evidence.items,
      });
      open = { startedAt: item.at, kind: 'open' };
    } else if (toQa && !fromQa) {
      if (!firstQaAt) {
        firstQaAt = item.at;
        firstQaTo = next;
      }
      if (open) {
        const durationDays = spanDays(open.startedAt, item.at, options);
        open.kind = 'completed';
        open.endedAt = item.at;
        if (durationDays !== undefined) open.durationDays = durationDays;
        delete open.ageDays;
        cycles.push(open);
        open = undefined;
      }
    }

    status = next;
  }

  if (open) {
    const ageDays = spanDays(open.startedAt, asOf.toISOString(), options);
    if (ageDays !== undefined) open.ageDays = ageDays;
    cycles.push(open);
  }

  const historyQuality = resolveHistoryQuality(
    issue.changelogComplete,
    prepared.skippedInvalid,
    ordered.length,
    ambiguous,
  );

  return { firstQaAt, firstQaTo, reachedDoneAt, returns, cycles, historyQuality };
}

const NOISE_FIELDS =
  /^(status|sprint|assignee|issuetype|parent|rank|timeestimate|timespent|worklog|attachment|issueparentassociation|description|summary|timeoriginalestimate|aggregatetimeoriginalestimate)$/i;

export function classifyReturnReason(items: QualityChangelogItem[]): {
  kind: QualityReasonKind;
  label: string;
  items: QualityReturnEvidence[];
} {
  const evidence: QualityReturnEvidence[] = [];
  for (const item of items) {
    const field = (item.field ?? item.fieldId ?? '').trim();
    if (!field || NOISE_FIELDS.test(field) || NOISE_FIELDS.test(item.fieldId ?? '')) continue;
    const value = (item.toString ?? item.to ?? undefined)?.trim() || undefined;
    evidence.push({ field, fieldId: item.fieldId ?? undefined, value });
  }
  const comment = evidence.find((item) => /^comment$/i.test(item.field) || item.fieldId === 'comment');
  if (comment) return { kind: 'comment', label: 'Комментарий', items: evidence };
  const label = evidence.find((item) => /^labels?$/i.test(item.field));
  if (label) return { kind: 'label', label: label.value ? `Метка: ${label.value}` : 'Метка', items: evidence };
  const resolution = evidence.find((item) => /^resolution$/i.test(item.field));
  if (resolution) {
    return {
      kind: 'resolution',
      label: resolution.value ? `Resolution: ${resolution.value}` : 'Resolution',
      items: evidence,
    };
  }
  const custom = evidence[0];
  if (custom) return { kind: 'custom', label: custom.value ? `${custom.field}: ${custom.value}` : custom.field, items: evidence };
  return { kind: 'none', label: 'Не записана', items: [] };
}

function evidenceAt(histories: QualityChangelogHistory[] | undefined, at: string) {
  const target = parseDate(at)?.getTime();
  const items: QualityChangelogItem[] = [];
  for (const history of histories ?? []) {
    if (parseDate(history.created)?.getTime() !== target) continue;
    items.push(...(history.items ?? []));
  }
  return classifyReturnReason(items);
}

function resolveHistoryQuality(
  changelogComplete: boolean,
  skippedInvalid: boolean,
  seenEvents: number,
  ambiguous: boolean,
): QualityHistoryQuality {
  if (!changelogComplete && seenEvents === 0) return 'unavailable';
  if (!changelogComplete || skippedInvalid || ambiguous) return 'partial';
  return 'exact';
}

function spanDays(fromIso: string, toIso: string, options: QualityReplayOptions): number | undefined {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  if (!from || !to) return undefined;
  if (options.useWorkingDays) return workingElapsedDays(from, to, options.holidays ?? []);
  return elapsedDays(from, to);
}

function prepareTransitions(transitions: StatusTransition[] | undefined): {
  items: StatusTransition[];
  skippedInvalid: boolean;
} {
  const raw = transitions ?? [];
  const skippedInvalid = raw.some((item) => !parseDate(item.at));
  const seen = new Set<string>();
  const items: StatusTransition[] = [];
  for (const item of sortTransitions(raw)) {
    if (!parseDate(item.at)) continue;
    const key = `${item.at}|${item.from ?? ''}|${item.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return { items, skippedInvalid };
}

function hasAmbiguousTimestamps(items: StatusTransition[]): boolean {
  for (let i = 1; i < items.length; i += 1) {
    if (items[i]?.at === items[i - 1]?.at) return true;
  }
  return false;
}
