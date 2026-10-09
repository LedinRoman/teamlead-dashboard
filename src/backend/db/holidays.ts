import { db, nowIso, ownerFilter } from './index';
import { parseDayKey } from '@backend/metrics/time';

export async function listHolidays(): Promise<string[]> {
  const owner = await ownerFilter();
  const rows = (await (await db())
    .prepare(`SELECT day FROM work_holidays WHERE ${owner.sql} ORDER BY day ASC`)
    .all(...owner.params)) as unknown as Array<{ day: string }>;
  return rows.map((row) => row.day);
}

export async function addHoliday(day: string): Promise<string | undefined> {
  const key = parseDayKey(day);
  if (!key) return undefined;
  const owner = await ownerFilter();
  await (await db())
    .prepare(
      `INSERT INTO work_holidays (user_id, day, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(owner.id, key, nowIso());
  return key;
}

export async function removeHoliday(day: string): Promise<boolean> {
  const key = parseDayKey(day);
  if (!key) return false;
  const owner = await ownerFilter();
  const result = await (await db())
    .prepare(`DELETE FROM work_holidays WHERE ${owner.sql} AND day = ?`)
    .run(...owner.params, key);
  return Number(result.changes) > 0;
}
