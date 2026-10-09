import { db, nowIso, ownerFilter, text } from './index';

export interface CycleTimeOverride {
  key: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
}

interface CycleTimeOverrideRow {
  issue_key: string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
}

function toOverride(row: CycleTimeOverrideRow): CycleTimeOverride {
  return {
    key: row.issue_key,
    startedAt: text(row.started_at),
    endedAt: text(row.ended_at),
    updatedAt: row.updated_at,
  };
}

async function getRow(key: string): Promise<CycleTimeOverride | undefined> {
  const owner = await ownerFilter();
  const row = (await (await db())
    .prepare(
      `SELECT issue_key, started_at, ended_at, updated_at FROM cycle_time_overrides WHERE ${owner.sql} AND issue_key = ?`,
    )
    .get(...owner.params, key)) as unknown as CycleTimeOverrideRow | undefined;
  return row ? toOverride(row) : undefined;
}

async function writeRow(
  key: string,
  startedAt: string | undefined,
  endedAt: string | undefined,
): Promise<CycleTimeOverride> {
  const updatedAt = nowIso();
  const owner = await ownerFilter();
  await (await db())
    .prepare(
      `INSERT INTO cycle_time_overrides (user_id, issue_key, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, issue_key) DO UPDATE SET
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         updated_at = excluded.updated_at`,
    )
    .run(owner.id, key, startedAt ?? null, endedAt ?? null, updatedAt);
  return { key, startedAt, endedAt, updatedAt };
}

export async function listCycleOverrides(): Promise<CycleTimeOverride[]> {
  const owner = await ownerFilter();
  const rows = (await (await db())
    .prepare(
      `SELECT issue_key, started_at, ended_at, updated_at FROM cycle_time_overrides WHERE ${owner.sql} ORDER BY issue_key ASC`,
    )
    .all(...owner.params)) as unknown as CycleTimeOverrideRow[];
  return rows.map(toOverride).filter((row) => row.startedAt || row.endedAt);
}

export async function upsertCycleOverride(
  key: string,
  patch: { startedAt?: string; endedAt?: string },
): Promise<CycleTimeOverride> {
  const current = await getRow(key);
  const startedAt = patch.startedAt !== undefined ? patch.startedAt : current?.startedAt;
  const endedAt = patch.endedAt !== undefined ? patch.endedAt : current?.endedAt;
  if (!startedAt && !endedAt) {
    const owner = await ownerFilter();
    await (await db())
      .prepare(`DELETE FROM cycle_time_overrides WHERE ${owner.sql} AND issue_key = ?`)
      .run(...owner.params, key);
    return { key, updatedAt: nowIso() };
  }
  return writeRow(key, startedAt, endedAt);
}

export async function removeCycleOverride(
  key: string,
  field?: 'start' | 'end',
): Promise<CycleTimeOverride | undefined> {
  const owner = await ownerFilter();
  if (!field) {
    await (await db())
      .prepare(`DELETE FROM cycle_time_overrides WHERE ${owner.sql} AND issue_key = ?`)
      .run(...owner.params, key);
    return undefined;
  }
  const current = await getRow(key);
  if (!current) return undefined;
  const startedAt = field === 'start' ? undefined : current.startedAt;
  const endedAt = field === 'end' ? undefined : current.endedAt;
  if (!startedAt && !endedAt) {
    await (await db())
      .prepare(`DELETE FROM cycle_time_overrides WHERE ${owner.sql} AND issue_key = ?`)
      .run(...owner.params, key);
    return undefined;
  }
  return writeRow(key, startedAt, endedAt);
}
