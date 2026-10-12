import { isRu } from '../../shared/locale';

export const MS_PER_DAY = 86_400_000;

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function daysBetween(from: Date, to: Date): number {
  return round1(elapsedDays(from, to));
}

/** Signed day delta. Negative means `to` is before `from` (used for due dates). */
export function signedDaysBetween(from: Date, to: Date): number {
  return round1((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Unrounded calendar elapsed time in days. */
export function elapsedDays(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function daysSince(value: Date, now: Date): number {
  return daysBetween(value, now);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Local calendar date `YYYY-MM-DD`, same basis as `datetime-local` and holiday input. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isLocalWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Elapsed time with Saturday, Sunday, and listed local calendar dates removed.
 * Hours on remaining weekdays stay fractional, like `daysBetween`.
 */
export function workingDaysBetween(from: Date, to: Date, holidays: Iterable<string> = []): number {
  return round1(workingElapsedDays(from, to, holidays));
}

/** Unrounded weekday elapsed time in days (weekends and holidays removed). */
export function workingElapsedDays(from: Date, to: Date, holidays: Iterable<string> = []): number {
  return workingMsBetween(from, to, holidays) / MS_PER_DAY;
}

function workingMsBetween(from: Date, to: Date, holidays: Iterable<string> = []): number {
  if (to.getTime() <= from.getTime()) return 0;
  const banned = holidays instanceof Set ? holidays : new Set(holidays);
  let ms = 0;
  const cursor = startOfLocalDay(from);
  const last = startOfLocalDay(to);
  let steps = 0;
  while (cursor.getTime() <= last.getTime() && steps < 400) {
    const key = localDayKey(cursor);
    if (!isLocalWeekend(cursor) && !banned.has(key)) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      const sliceStart = Math.max(from.getTime(), cursor.getTime());
      const sliceEnd = Math.min(to.getTime(), next.getTime());
      if (sliceEnd > sliceStart) ms += sliceEnd - sliceStart;
    }
    cursor.setDate(cursor.getDate() + 1);
    steps += 1;
  }
  return ms;
}

/** `YYYY-MM-DD` that is a real local calendar date. */
export function parseDayKey(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return value;
}

/** ISO week label such as `2026-W12`, used for throughput buckets. */
export function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Compact age for snapshot captions, e.g. `3 мин назад`. */
export function formatSnapshotAge(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const ru = isRu();
  if (seconds < 15) return ru ? 'только что' : 'just now';
  if (seconds < 60) return ru ? `${seconds} с назад` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return ru ? `${minutes} мин назад` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ru ? `${hours} ч назад` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return ru ? `${days} дн назад` : `${days}d ago`;
}

export function eachDay(from: Date, to: Date, maxDays = 400): Date[] {
  const days: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= end.getTime() && days.length < maxDays) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
