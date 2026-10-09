import { AsyncLocalStorage } from 'node:async_hooks';

import { cacheKey, readCache, writeCache, type CacheHit } from '@backend/db/cache';

interface SnapshotHost {
  connection: { id: string };
  rules: { cacheTtlSeconds: number };
}

interface SnapshotScope {
  connectionId: string;
  ttlSeconds: number;
  refresh: boolean;
}

const als = new AsyncLocalStorage<SnapshotScope>();

export function snapshotScope(): SnapshotScope | undefined {
  return als.getStore();
}

export async function withSnapshot<T>(
  ctx: SnapshotHost,
  refresh: boolean | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (als.getStore()) return fn();
  return als.run(
    {
      connectionId: ctx.connection.id,
      ttlSeconds: ctx.rules.cacheTtlSeconds,
      refresh: Boolean(refresh),
    },
    fn,
  );
}

export async function snapshotRead<T>(parts: unknown[]): Promise<CacheHit<T> | undefined> {
  const scope = als.getStore();
  if (!scope || scope.refresh || scope.ttlSeconds <= 0) return undefined;
  return readCache<T>(cacheKey(['jira', scope.connectionId, ...parts]));
}

export async function snapshotWrite(parts: unknown[], payload: unknown): Promise<void> {
  const scope = als.getStore();
  if (!scope || scope.ttlSeconds <= 0) return;
  await writeCache(cacheKey(['jira', scope.connectionId, ...parts]), payload, scope.ttlSeconds);
}

export async function computedRead<T>(kind: string, parts: unknown[]): Promise<CacheHit<T> | undefined> {
  const scope = als.getStore();
  if (!scope || scope.refresh || scope.ttlSeconds <= 0) return undefined;
  return readCache<T>(cacheKey(['model', kind, scope.connectionId, ...parts]));
}

export async function computedWrite(kind: string, parts: unknown[], payload: unknown): Promise<void> {
  const scope = als.getStore();
  if (!scope || scope.ttlSeconds <= 0) return;
  await writeCache(cacheKey(['model', kind, scope.connectionId, ...parts]), payload, scope.ttlSeconds);
}

export function stampIso(createdAt: number): string {
  return new Date(createdAt).toISOString();
}
