/**
 * Starts a local PostgreSQL cluster in data/pg if it is not already up.
 *   npm run db:up
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { pgConfig } from './load-env.mjs';

const root = process.cwd();
const binDir = path.join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const dataDir = path.join(root, 'data', 'pg16');

function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${name}`);
  }
  return name;
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: binDir,
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${file} exited ${code}\n${stderr || stdout}`));
    });
  });
}

async function canConnect(config, database = config.database) {
  const client = new pg.Client({
    ...config,
    database,
    connectionTimeoutMillis: 800,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      // ignore
    }
    return false;
  }
}

export async function ensurePostgres() {
  const db = pgConfig();
  const host = '127.0.0.1';
  const { port, user, password, database } = db;
  const config = { host, port, user, password, database };

  if (await canConnect(config)) {
    console.log(`PostgreSQL already listening on ${host}:${port} database=${database}`);
    return config;
  }

  if (!existsSync(path.join(binDir, 'pg_ctl.exe'))) {
    throw new Error('Embedded Postgres binaries are missing. Run npm install.');
  }

  mkdirSync(path.dirname(dataDir), { recursive: true });
  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    const pwfile = path.join(os.tmpdir(), `pg-password-${Date.now()}.txt`);
    writeFileSync(pwfile, `${password}\n`);
    try {
      await run('initdb.exe', [
        `--pgdata=${dataDir}`,
        '--auth=password',
        `--username=${ident(user)}`,
        `--pwfile=${pwfile}`,
        '--encoding=UTF8',
        '--locale=C',
        '--lc-messages=C',
      ]);
    } finally {
      try {
        unlinkSync(pwfile);
      } catch {
        // ignore
      }
    }
  }

  const confPath = path.join(dataDir, 'postgresql.conf');
  if (existsSync(confPath)) {
    const conf = readFileSync(confPath, 'utf8');
    if (!conf.includes('autovacuum = off')) {
      writeFileSync(confPath, `${conf.trimEnd()}\n\nautovacuum = off\njit = off\n`);
    }
  }

  const pidFile = path.join(dataDir, 'postmaster.pid');
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {
      // leftover pid from a previous crash; postgres.exe will recreate it
    }
  }

  // pg_ctl.exe crashes with 0xC0000005 here. Start postgres.exe detached so
  // closing agent terminals does not CTRL+C the postmaster.
  const postmaster = spawn('postgres.exe', ['-D', dataDir, '-p', String(port), '-h', host], {
    cwd: binDir,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  postmaster.unref();

  const deadline = Date.now() + 15000;
  while (!(await canConnect(config, 'postgres')) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const admin = new pg.Client({
    host,
    port,
    user,
    password,
    database: 'postgres',
    connectionTimeoutMillis: 4000,
  });
  await admin.connect();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(user)}`);
  }
  await admin.end();

  console.log(`PostgreSQL listening on ${host}:${port} database=${database} user=${user}`);
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensurePostgres();
}
