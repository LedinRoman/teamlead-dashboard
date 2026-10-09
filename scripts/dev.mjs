/**
 * One-command local start: Postgres if needed, then Next.
 *   npm run dev
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

import { loadEnv } from './load-env.mjs';

loadEnv();
if ((process.env.DB_CLIENT ?? '').toLowerCase() === 'postgres' || process.env.DB_HOST === 'postgres') {
  const { ensurePostgres } = await import('./start-postgres.mjs');
  await ensurePostgres();
}

const port = process.env.APP_PORT ?? '3000';
const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, 'dev', '-H', 'localhost', '-p', port], {
  stdio: 'inherit',
  env: { ...process.env, PORT: port },
});

function stop() {
  if (!child.killed) child.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
