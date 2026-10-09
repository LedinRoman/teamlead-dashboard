import { createHash } from 'node:crypto';

import { db, ownerFilter } from './index';

export interface CacheHit<T> {
  payload: T;
  createdAt: number;
}

export function cacheKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40);
}

export async function readCache<T>(key: string): Promise<CacheHit<T> | undefined> {
  const owner = await ownerFilter();
  const row = (await (await db())
    .prepare(`SELECT payload, created_at FROM jira_cache WHERE ${owner.sql} AND key = ? AND expires_at > ?`)
    .get(...owner.params, key, Date.now())) as unknown as { payload: string; created_at: number } | undefined;
  if (!row) return undefined;
  try {
    return { payload: JSON.parse(row.payload) as T, createdAt: Number(row.created_at) };
  } catch {
    return undefined;
  }
}

export async function writeCache(key: string, payload: unknown, ttlSeconds: number): Promise<void> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
  const now = Date.now();
  const owner = await ownerFilter();
  await (await db())
    .prepare(
      `INSERT INTO jira_cache (user_id, key, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET payload = excluded.payload,
         created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .run(owner.id, key, JSON.stringify(payload), now, now + ttlSeconds * 1000);
}

export async function clearCache(): Promise<number> {
  const before = await countCache();
  const owner = await ownerFilter();
  await (await db()).prepare(`DELETE FROM jira_cache WHERE ${owner.sql}`).run(...owner.params);
  return before;
}

export async function pruneCache(): Promise<void> {
  await (await db()).prepare('DELETE FROM jira_cache WHERE expires_at <= ?').run(Date.now());
}

export async function countCache(): Promise<number> {
  const owner = await ownerFilter();
  const row = (await (await db())
    .prepare(`SELECT CAST(COUNT(*) AS INTEGER) AS total FROM jira_cache WHERE ${owner.sql}`)
    .get(...owner.params)) as unknown as { total: number } | undefined;
  return Number(row?.total ?? 0);
}
