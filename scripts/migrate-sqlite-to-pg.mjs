/**
 * Copies local SQLite state into PostgreSQL. Skips jira_cache (it rebuilds).
 *   npm run db:migrate-sqlite
 */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

import { pgConfig } from './load-env.mjs';

const sqlitePath = path.join(process.cwd(), 'data', 'metrics.db');
const config = pgConfig();

const TABLES = [
  'connections',
  'teams',
  'dashboards',
  'app_settings',
  'cycle_start_overrides',
  'cycle_time_overrides',
  'work_holidays',
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS connections (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, deployment TEXT NOT NULL,
     auth_kind TEXT NOT NULL, email TEXT, secret_enc TEXT NOT NULL, account_id TEXT, display_name TEXT,
     story_points_field TEXT, sprint_field TEXT, epic_link_field TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS teams (
     id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, name TEXT NOT NULL,
     members TEXT NOT NULL DEFAULT '[]', boards TEXT NOT NULL DEFAULT '[]', projects TEXT NOT NULL DEFAULT '[]',
     extra_jql TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS dashboards (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, widgets TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jira_cache (
     key TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS jira_cache_expires_idx ON jira_cache (expires_at)`,
  `CREATE TABLE IF NOT EXISTS cycle_start_overrides (
     issue_key TEXT PRIMARY KEY, started_at TEXT NOT NULL, updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS cycle_time_overrides (
     issue_key TEXT PRIMARY KEY, started_at TEXT, ended_at TEXT, updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS work_holidays (day TEXT PRIMARY KEY, updated_at TEXT NOT NULL)`,
];

const sqlite = new DatabaseSync(sqlitePath);
const client = new pg.Client(config);
await client.connect();

const counts = {};
try {
  await client.query('BEGIN');
  for (const statement of SCHEMA) await client.query(statement);
  for (const table of TABLES) {
    let rows = [];
    try {
      rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
    } catch {
      counts[table] = 'missing-in-sqlite';
      continue;
    }
    counts[table] = rows.length;
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0]);
    const quoted = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const sql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    for (const row of rows) {
      await client.query(
        sql,
        columns.map((column) => row[column] ?? null),
      );
    }
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  sqlite.close();
  await client.end();
}

console.log(JSON.stringify({ sqlitePath, counts }, null, 2));
