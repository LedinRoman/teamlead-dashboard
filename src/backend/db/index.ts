import { DatabaseSync } from 'node:sqlite';
import { Pool, types } from 'pg';

import { dataFile } from '@backend/server/paths';
import { ensureEncryptionKey } from '@backend/server/secrets';
import { bindUserFromSession, currentUserScope, GLOBAL_USER_ID } from '@backend/server/user';
import { pgPoolConfig, usesPostgres } from '@shared/env';

types.setTypeParser(20, (value) => Number(value));

export type SqlValue = string | number | boolean | null;

export interface SqlResult {
  changes: number;
}

export interface PreparedStatement {
  get(...params: SqlValue[]): Promise<Record<string, unknown> | undefined>;
  all(...params: SqlValue[]): Promise<Record<string, unknown>[]>;
  run(...params: SqlValue[]): Promise<SqlResult>;
}

export interface Database {
  exec(sql: string): Promise<void>;
  prepare(sql: string): PreparedStatement;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS connections (
     id                  TEXT PRIMARY KEY,
     user_id             TEXT NOT NULL DEFAULT '',
     name                TEXT NOT NULL,
     base_url            TEXT NOT NULL,
     deployment          TEXT NOT NULL,
     auth_kind           TEXT NOT NULL,
     email               TEXT,
     secret_enc          TEXT NOT NULL,
     account_id          TEXT,
     display_name        TEXT,
     story_points_field  TEXT,
     sprint_field        TEXT,
     epic_link_field     TEXT,
     created_at          TEXT NOT NULL,
     updated_at          TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS teams (
     id            TEXT PRIMARY KEY,
     user_id       TEXT NOT NULL DEFAULT '',
     connection_id TEXT NOT NULL,
     name          TEXT NOT NULL,
     members       TEXT NOT NULL DEFAULT '[]',
     boards        TEXT NOT NULL DEFAULT '[]',
     projects      TEXT NOT NULL DEFAULT '[]',
     extra_jql     TEXT,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS dashboards (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL DEFAULT '',
     name       TEXT NOT NULL,
     widgets    TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
     user_id TEXT NOT NULL DEFAULT '',
     key     TEXT NOT NULL,
     value   TEXT NOT NULL,
     PRIMARY KEY (user_id, key)
   )`,
  `CREATE TABLE IF NOT EXISTS jira_cache (
     user_id    TEXT NOT NULL DEFAULT '',
     key        TEXT NOT NULL,
     payload    TEXT NOT NULL,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     PRIMARY KEY (user_id, key)
   )`,
  `CREATE INDEX IF NOT EXISTS jira_cache_expires_idx ON jira_cache (expires_at)`,
  `CREATE TABLE IF NOT EXISTS cycle_start_overrides (
     user_id     TEXT NOT NULL DEFAULT '',
     issue_key   TEXT NOT NULL,
     started_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     PRIMARY KEY (user_id, issue_key)
   )`,
  `CREATE TABLE IF NOT EXISTS cycle_time_overrides (
     user_id     TEXT NOT NULL DEFAULT '',
     issue_key   TEXT NOT NULL,
     started_at  TEXT,
     ended_at    TEXT,
     updated_at  TEXT NOT NULL,
     PRIMARY KEY (user_id, issue_key)
   )`,
  `CREATE TABLE IF NOT EXISTS work_holidays (
     user_id     TEXT NOT NULL DEFAULT '',
     day         TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     PRIMARY KEY (user_id, day)
   )`,
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     id TEXT PRIMARY KEY
   )`,
];

type GlobalDb = typeof globalThis & {
  __metricsDb?: Promise<Database>;
  __metricsDbKind?: string;
  __metricsPgPool?: Pool;
};

const globalForDb = globalThis as GlobalDb;

function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function toSqliteValue(value: SqlValue): string | number | bigint | Uint8Array | null {
  if (value === true) return 1;
  if (value === false) return 0;
  return value;
}

function wrapSqlite(sqlite: DatabaseSync): Database {
  return {
    async exec(sql: string) {
      sqlite.exec(sql);
    },
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      return {
        async get(...params: SqlValue[]) {
          return statement.get(...params.map(toSqliteValue)) as Record<string, unknown> | undefined;
        },
        async all(...params: SqlValue[]) {
          return statement.all(...params.map(toSqliteValue)) as Record<string, unknown>[];
        },
        async run(...params: SqlValue[]) {
          const result = statement.run(...params.map(toSqliteValue));
          return { changes: Number(result.changes ?? 0) };
        },
      };
    },
  };
}

function wrapPostgres(pool: Pool): Database {
  return {
    async exec(sql: string) {
      await pool.query(sql);
    },
    prepare(sql: string) {
      const text = toPgPlaceholders(sql);
      return {
        async get(...params: SqlValue[]) {
          const result = await pool.query(text, params);
          return result.rows[0] as Record<string, unknown> | undefined;
        },
        async all(...params: SqlValue[]) {
          const result = await pool.query(text, params);
          return result.rows as Record<string, unknown>[];
        },
        async run(...params: SqlValue[]) {
          const result = await pool.query(text, params);
          return { changes: result.rowCount ?? 0 };
        },
      };
    },
  };
}

function columnLabel(row: Record<string, unknown>): string {
  return String(row.name ?? row.column_name ?? row.NAME ?? row.COLUMN_NAME ?? '').toLowerCase();
}

async function listColumns(store: Database, table: string): Promise<Set<string>> {
  if (usesPostgres()) {
    const rows = (await store
      .prepare(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = ? AND table_schema = ANY (current_schemas(false))`,
      )
      .all(table)) as Array<Record<string, unknown>>;
    return new Set(rows.map(columnLabel).filter(Boolean));
  }
  const rows = (await store.prepare(`PRAGMA table_info(${table})`).all()) as Array<Record<string, unknown>>;
  return new Set(rows.map(columnLabel).filter(Boolean));
}

async function addUserIdColumn(store: Database, table: string): Promise<void> {
  const columns = await listColumns(store, table);
  if (columns.has('user_id')) return;
  await store.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
}

async function rebuildWithUserPk(
  store: Database,
  table: string,
  createSql: string,
  copySql: string,
  after: string[] = [],
): Promise<void> {
  const columns = await listColumns(store, table);
  if (columns.has('user_id')) return;
  await store.exec(createSql);
  await store.exec(copySql);
  await store.exec(`DROP TABLE ${table}`);
  await store.exec(`ALTER TABLE ${table}_tenant RENAME TO ${table}`);
  for (const statement of after) await store.exec(statement);
}

async function tenantMigrationDone(store: Database): Promise<boolean> {
  const row = await store.prepare('SELECT id FROM schema_migrations WHERE id = ?').get('tenant-v1');
  return Boolean(row);
}

async function markTenantMigrationDone(store: Database): Promise<void> {
  await store
    .prepare('INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT(id) DO NOTHING')
    .run('tenant-v1');
}

async function ensureTenantSchema(store: Database): Promise<void> {
  if (await tenantMigrationDone(store)) return;
  await addUserIdColumn(store, 'connections');
  await addUserIdColumn(store, 'teams');
  await addUserIdColumn(store, 'dashboards');
  await rebuildWithUserPk(
    store,
    'app_settings',
    `CREATE TABLE app_settings_tenant (
       user_id TEXT NOT NULL DEFAULT '',
       key TEXT NOT NULL,
       value TEXT NOT NULL,
       PRIMARY KEY (user_id, key)
     )`,
    `INSERT INTO app_settings_tenant (user_id, key, value) SELECT '', key, value FROM app_settings`,
  );
  await rebuildWithUserPk(
    store,
    'jira_cache',
    `CREATE TABLE jira_cache_tenant (
       user_id TEXT NOT NULL DEFAULT '',
       key TEXT NOT NULL,
       payload TEXT NOT NULL,
       created_at BIGINT NOT NULL,
       expires_at BIGINT NOT NULL,
       PRIMARY KEY (user_id, key)
     )`,
    `INSERT INTO jira_cache_tenant (user_id, key, payload, created_at, expires_at)
     SELECT '', key, payload, created_at, expires_at FROM jira_cache`,
    ['CREATE INDEX IF NOT EXISTS jira_cache_expires_idx ON jira_cache (expires_at)'],
  );
  await rebuildWithUserPk(
    store,
    'cycle_time_overrides',
    `CREATE TABLE cycle_time_overrides_tenant (
       user_id TEXT NOT NULL DEFAULT '',
       issue_key TEXT NOT NULL,
       started_at TEXT,
       ended_at TEXT,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (user_id, issue_key)
     )`,
    `INSERT INTO cycle_time_overrides_tenant (user_id, issue_key, started_at, ended_at, updated_at)
     SELECT '', issue_key, started_at, ended_at, updated_at FROM cycle_time_overrides`,
  );
  await rebuildWithUserPk(
    store,
    'work_holidays',
    `CREATE TABLE work_holidays_tenant (
       user_id TEXT NOT NULL DEFAULT '',
       day TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (user_id, day)
     )`,
    `INSERT INTO work_holidays_tenant (user_id, day, updated_at) SELECT '', day, updated_at FROM work_holidays`,
  );
  await store.exec('CREATE INDEX IF NOT EXISTS connections_user_idx ON connections (user_id)');
  await store.exec('CREATE INDEX IF NOT EXISTS teams_user_idx ON teams (user_id)');
  await markTenantMigrationDone(store);
}

async function openSqlite(): Promise<Database> {
  const sqlite = new DatabaseSync(dataFile('metrics.db'));
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA busy_timeout = 5000');
  const instance = wrapSqlite(sqlite);
  for (const statement of MIGRATIONS) await instance.exec(statement);
  await ensureTenantSchema(instance);
  await ensureSharedWorkspace(instance);
  await ensureEncryptionKey(instance);
  return instance;
}

async function openPostgres(): Promise<Database> {
  if (!globalForDb.__metricsPgPool) {
    const config = pgPoolConfig();
    if ('connectionString' in config) {
      console.info('[db] postgres via DATABASE_URL');
    } else {
      console.info(`[db] postgres ${config.host}:${config.port}/${config.database}`);
    }
    const pool = new Pool(config);
    pool.on('error', () => {
      void pool.end().catch(() => {});
      globalForDb.__metricsPgPool = undefined;
      globalForDb.__metricsDb = undefined;
    });
    globalForDb.__metricsPgPool = pool;
  }
  const instance = wrapPostgres(globalForDb.__metricsPgPool);
  for (const statement of MIGRATIONS) await instance.exec(statement);
  await ensureTenantSchema(instance);
  await ensureSharedWorkspace(instance);
  await ensureEncryptionKey(instance);
  return instance;
}

async function migrationDone(store: Database, id: string): Promise<boolean> {
  const row = await store.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(id);
  return Boolean(row);
}

async function markMigration(store: Database, id: string): Promise<void> {
  await store.prepare('INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT(id) DO NOTHING').run(id);
}

async function collapseKeyedRows(
  store: Database,
  table: string,
  keyColumn: string,
): Promise<void> {
  const others = (await store
    .prepare(`SELECT user_id, ${keyColumn} AS row_key FROM ${table} WHERE user_id <> ?`)
    .all(GLOBAL_USER_ID)) as Array<{ user_id: string; row_key: string }>;
  const shared = new Set(
    (
      (await store
        .prepare(`SELECT ${keyColumn} AS row_key FROM ${table} WHERE user_id = ?`)
        .all(GLOBAL_USER_ID)) as Array<{ row_key: string }>
    ).map((row) => row.row_key),
  );
  for (const row of others) {
    if (shared.has(row.row_key)) {
      await store.prepare(`DELETE FROM ${table} WHERE user_id = ? AND ${keyColumn} = ?`).run(row.user_id, row.row_key);
      continue;
    }
    await store
      .prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ? AND ${keyColumn} = ?`)
      .run(GLOBAL_USER_ID, row.user_id, row.row_key);
    shared.add(row.row_key);
  }
}

async function ensureSharedWorkspace(store: Database): Promise<void> {
  if (await migrationDone(store, 'shared-v1')) return;
  for (const table of ['connections', 'teams', 'dashboards'] as const) {
    await store.prepare(`UPDATE ${table} SET user_id = ?`).run(GLOBAL_USER_ID);
  }
  await collapseKeyedRows(store, 'app_settings', 'key');
  await collapseKeyedRows(store, 'jira_cache', 'key');
  await collapseKeyedRows(store, 'cycle_time_overrides', 'issue_key');
  await collapseKeyedRows(store, 'work_holidays', 'day');
  const first = (await store
    .prepare('SELECT id FROM connections ORDER BY created_at ASC')
    .get()) as { id: string } | undefined;
  if (first) {
    await store.prepare('UPDATE teams SET connection_id = ?').run(first.id);
  }
  await markMigration(store, 'shared-v1');
}

async function openDatabase(): Promise<Database> {
  return usesPostgres() ? openPostgres() : openSqlite();
}

export async function db(): Promise<Database> {
  await bindUserFromSession();
  const kind = usesPostgres() ? 'postgres' : 'sqlite';
  if (globalForDb.__metricsDbKind !== kind) {
    globalForDb.__metricsDb = undefined;
    globalForDb.__metricsDbKind = kind;
  }
  if (!globalForDb.__metricsDb) {
    globalForDb.__metricsDb = openDatabase().catch((error) => {
      globalForDb.__metricsDb = undefined;
      throw error;
    });
  }
  return globalForDb.__metricsDb;
}

export function ownerIn(aliases: string[]): { sql: string; params: string[] } {
  if (aliases.length === 0) throw new Error('User scope is empty.');
  return { sql: aliases.map(() => '?').join(', '), params: aliases };
}

export async function ownerFilter(): Promise<{ sql: string; params: string[]; id: string }> {
  await currentUserScope();
  return { sql: '1=1', params: [], id: GLOBAL_USER_ID };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

/** Drivers may return `null` for missing columns; normalise to undefined. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string' && value.length > 0) {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value && typeof value === 'object') return value as T;
  return fallback;
}
