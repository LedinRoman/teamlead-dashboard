/**
 * Snapshot of PostgreSQL app tables (no Jira cache, no secret_enc).
 *   node scripts/dump-db.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const host = process.env.DB_HOST?.trim();
const user = process.env.DB_USERNAME?.trim();
const database = process.env.DB_DATABASE?.trim();
const password = process.env.DB_PASSWORD ?? '';
const port = Number(process.env.DB_PORT ?? 5432);
if (!host || !user || !database) {
  console.error('Set DB_HOST, DB_USERNAME and DB_DATABASE in .env');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({ host, port, user, password, database });
  await client.connect();
  async function all(sql) {
    return (await client.query(sql)).rows;
  }
  const snapshot = {
    dumpedAt: new Date().toISOString(),
    teams: await all('SELECT * FROM teams'),
    dashboards: await all('SELECT * FROM dashboards'),
    app_settings: await all('SELECT * FROM app_settings'),
    cycle_time_overrides: await all('SELECT * FROM cycle_time_overrides'),
    cycle_start_overrides: await all('SELECT * FROM cycle_start_overrides'),
    work_holidays: await all('SELECT * FROM work_holidays'),
    connections: await all(
      'SELECT id, name, base_url, deployment, auth_kind, email, account_id, display_name, story_points_field, sprint_field, epic_link_field, created_at, updated_at FROM connections',
    ),
  };
  await client.end();
  const dest = path.join(root, 'data', 'pg-dump.json');
  fs.writeFileSync(dest, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ dest, tables: Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'dumpedAt').map(([key, rows]) => [key, rows.length])) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
