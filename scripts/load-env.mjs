import { readFileSync } from 'node:fs';
import path from 'node:path';

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq);
      if (process.env[key]) continue;
      process.env[key] = stripQuotes(trimmed.slice(eq + 1));
    }
  } catch {
    // .env is optional when the variables are already in the environment.
  }
}

export function pgConfig() {
  loadEnv();
  const host = process.env.DB_HOST?.trim();
  const user = process.env.DB_USERNAME?.trim();
  const database = process.env.DB_DATABASE?.trim();
  const password = process.env.DB_PASSWORD ?? '';
  const port = Number(process.env.DB_PORT ?? 5432);
  if (!host || !user || !database) {
    throw new Error('Set DB_HOST, DB_USERNAME and DB_DATABASE in .env');
  }
  return { host, port, user, password, database };
}
