import { parseDate } from './time';

/** One Sprint-field changelog item: `from`/`to` are the full sprint-id lists. */
export interface SprintFieldChange {
  at: string;
  fromIds: number[];
  toIds: number[];
}

export interface SprintBound {
  id: number;
  start: Date;
  end: Date;
}

export function parseSprintIdList(value: string | null | undefined): number[] {
  if (value == null || String(value).trim() === '') return [];
  const ids: number[] = [];
  for (const part of String(value).split(',')) {
    const parsed = Number(part.trim());
    if (!Number.isInteger(parsed) || parsed <= 0 || ids.includes(parsed)) continue;
    ids.push(parsed);
  }
  return ids;
}

export function sortSprintChanges(changes: SprintFieldChange[]): SprintFieldChange[] {
  return [...changes].sort((left, right) => left.at.localeCompare(right.at));
}

/** Sprint ids on the issue at `at`. Uses `to` of the last change ≤ `at`, else `from` of the next change. */
export function sprintIdsAt(changes: SprintFieldChange[], at: Date): number[] {
  const atMs = at.getTime();
  const ordered = sortSprintChanges(changes);
  let last: SprintFieldChange | undefined;
  for (const change of ordered) {
    const when = parseDate(change.at);
    if (!when || when.getTime() > atMs) break;
    last = change;
  }
  if (last) return last.toIds;
  const next = ordered.find((change) => {
    const when = parseDate(change.at);
    return Boolean(when && when.getTime() > atMs);
  });
  return next ? next.fromIds : [];
}

export function inSprintAt(changes: SprintFieldChange[], sprintId: number, at: Date): boolean {
  return sprintIdsAt(changes, at).includes(sprintId);
}

export function firstAddedAfter(
  changes: SprintFieldChange[],
  sprintId: number,
  start: Date,
): Date | undefined {
  const startMs = start.getTime();
  for (const change of sortSprintChanges(changes)) {
    const when = parseDate(change.at);
    if (!when || when.getTime() <= startMs) continue;
    if (!change.fromIds.includes(sprintId) && change.toIds.includes(sprintId)) return when;
  }
  return undefined;
}

/**
 * Last time the issue left this sprint in `(start, end]`.
 * A later return in the same window clears the removal.
 */
export function lastRemovedInWindow(
  changes: SprintFieldChange[],
  sprintId: number,
  start: Date,
  end: Date,
): Date | undefined {
  const startMs = start.getTime();
  const endMs = end.getTime();
  let last: Date | undefined;
  for (const change of sortSprintChanges(changes)) {
    const when = parseDate(change.at);
    if (!when || when.getTime() <= startMs || when.getTime() > endMs) continue;
    const left = change.fromIds.includes(sprintId) && !change.toIds.includes(sprintId);
    const returned = !change.fromIds.includes(sprintId) && change.toIds.includes(sprintId);
    if (left) last = when;
    if (returned) last = undefined;
  }
  return last;
}

export function wasMemberInWindow(
  changes: SprintFieldChange[],
  sprintId: number,
  start: Date,
  end: Date,
): boolean {
  if (inSprintAt(changes, sprintId, start) || inSprintAt(changes, sprintId, end)) return true;
  const startMs = start.getTime();
  const endMs = end.getTime();
  for (const change of sortSprintChanges(changes)) {
    const when = parseDate(change.at);
    if (!when || when.getTime() <= startMs || when.getTime() > endMs) continue;
    if (change.fromIds.includes(sprintId) || change.toIds.includes(sprintId)) return true;
  }
  return false;
}

/**
 * Consecutive later sprints this issue was still in, unfinished at each previous
 * sprint end. The same transfer is counted once. Gaps break the streak.
 */
export function countConsecutiveSpillovers(
  changes: SprintFieldChange[],
  orderedSprints: SprintBound[],
  fromSprintId: number,
  doneAt?: Date,
): number {
  const index = orderedSprints.findIndex((sprint) => sprint.id === fromSprintId);
  if (index < 0) return 0;
  const origin = orderedSprints[index];
  if (doneAt && doneAt.getTime() <= origin.end.getTime()) return 0;
  let count = 0;
  for (let i = index + 1; i < orderedSprints.length; i += 1) {
    const previous = orderedSprints[i - 1];
    const sprint = orderedSprints[i];
    if (doneAt && doneAt.getTime() <= previous.end.getTime()) break;
    const carried =
      inSprintAt(changes, sprint.id, sprint.start) ||
      wasMemberInWindow(changes, sprint.id, sprint.start, sprint.end);
    if (!carried) break;
    count += 1;
  }
  return count;
}
