import { parseDate, round1 } from './time';

export interface EstimateChange {
  at: string;
  from?: number;
  to?: number;
}

export interface NamedChange {
  at: string;
  from?: string;
  to?: string;
}

export interface EstimateDelta {
  increase: number;
  decrease: number;
  changedTasks: number;
}

export function parseStoryPointsValue(value: string | number | null | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return round1(value);
  if (value == null) return undefined;
  const text = String(value).trim().replace(',', '.');
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? round1(parsed) : undefined;
}

export function sortEstimateChanges(changes: EstimateChange[]): EstimateChange[] {
  return [...changes].sort((left, right) => left.at.localeCompare(right.at));
}

export function sortNamedChanges(changes: NamedChange[]): NamedChange[] {
  return [...changes].sort((left, right) => left.at.localeCompare(right.at));
}

/** Story points on the issue at `at`. Missing is `undefined`, never coerced to 0. */
export function estimateAt(changes: EstimateChange[], at: Date): number | undefined {
  const atMs = at.getTime();
  const ordered = sortEstimateChanges(changes);
  let last: EstimateChange | undefined;
  for (const change of ordered) {
    const when = parseDate(change.at);
    if (!when || when.getTime() > atMs) break;
    last = change;
  }
  if (last) return last.to;
  const next = ordered.find((change) => {
    const when = parseDate(change.at);
    return Boolean(when && when.getTime() > atMs);
  });
  return next?.from;
}

export function namedValueAt(changes: NamedChange[], at: Date, fallback?: string): string | undefined {
  const atMs = at.getTime();
  const ordered = sortNamedChanges(changes);
  let last: NamedChange | undefined;
  for (const change of ordered) {
    const when = parseDate(change.at);
    if (!when || when.getTime() > atMs) break;
    last = change;
  }
  if (last) return last.to || fallback;
  const next = ordered.find((change) => {
    const when = parseDate(change.at);
    return Boolean(when && when.getTime() > atMs);
  });
  return next?.from || fallback;
}

export function estimateDeltaInWindow(changes: EstimateChange[], start: Date, end: Date): EstimateDelta {
  const startMs = start.getTime();
  const endMs = end.getTime();
  let increase = 0;
  let decrease = 0;
  let changedTasks = 0;
  for (const change of sortEstimateChanges(changes)) {
    const when = parseDate(change.at);
    if (!when || when.getTime() <= startMs || when.getTime() > endMs) continue;
    const from = change.from;
    const to = change.to;
    if (from === undefined && to === undefined) continue;
    if (from === to) continue;
    changedTasks += 1;
    if (from === undefined && to !== undefined) increase = round1(increase + to);
    else if (from !== undefined && to === undefined) decrease = round1(decrease + from);
    else if (from !== undefined && to !== undefined && to > from) increase = round1(increase + (to - from));
    else if (from !== undefined && to !== undefined && to < from) decrease = round1(decrease + (from - to));
  }
  return { increase, decrease, changedTasks: changedTasks > 0 ? 1 : 0 };
}

export function issueEstimateDelta(changes: EstimateChange[], start: Date, end: Date): number | undefined {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const baseline = estimateAt(changes, start);
  let latest = baseline;
  let saw = false;
  for (const change of sortEstimateChanges(changes)) {
    const when = parseDate(change.at);
    if (!when || when.getTime() <= startMs || when.getTime() > endMs) continue;
    latest = change.to;
    saw = true;
  }
  if (!saw) return undefined;
  if (baseline === undefined && latest === undefined) return undefined;
  return round1((latest ?? 0) - (baseline ?? 0));
}
