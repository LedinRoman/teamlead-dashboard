import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Local files that are not the database (encryption key) live in one
 * gitignored directory so they are easy to inspect, back up, or wipe.
 */
export function dataDir(): string {
  const configured = process.env.METRICS_DASHBOARD_DATA_DIR?.trim();
  const dir = configured ? path.resolve(configured) : path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataFile(name: string): string {
  return path.join(dataDir(), name);
}
