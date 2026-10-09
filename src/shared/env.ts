function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function fromEnv(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const value = stripQuotes(raw);
  return value.length > 0 ? value : undefined;
}

export function appName(): string {
  return fromEnv(process.env.APP_NAME) ?? 'teamlead-dashboard';
}

export function appPort(): number {
  const parsed = Number(fromEnv(process.env.APP_PORT) ?? '3000');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

export function isAppProduction(): boolean {
  return (fromEnv(process.env.APP_IS_PRODUCTION) ?? 'false').toLowerCase() === 'true';
}

export function usesPostgres(): boolean {
  const client = fromEnv(process.env.DB_CLIENT)?.toLowerCase();
  const inContainer =
    fromEnv(process.env.HOSTNAME) === '0.0.0.0' || fromEnv(process.env.PORT) === '80';
  if (client === 'sqlite') {
    if (inContainer) {
      throw new Error(
        'This image cannot use SQLite. Set DB_CLIENT=postgres. A sqlite file inside the pod is deleted on every restart.',
      );
    }
    return false;
  }
  return true;
}

export function pgPoolConfig() {
  const url = fromEnv(process.env.DATABASE_URL) ?? fromEnv(process.env.DB_URL);
  if (url) return { connectionString: url, max: 8 };
  const host = fromEnv(process.env.DB_HOST);
  const user = fromEnv(process.env.DB_USERNAME);
  const database = fromEnv(process.env.DB_DATABASE);
  const password = fromEnv(process.env.DB_PASSWORD) ?? '';
  const port = Number(fromEnv(process.env.DB_PORT) ?? '5432');
  if (!host || !user || !database) {
    throw new Error('Set DATABASE_URL or DB_HOST, DB_USERNAME and DB_DATABASE.');
  }
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    user,
    password,
    database,
    max: 8,
  };
}
