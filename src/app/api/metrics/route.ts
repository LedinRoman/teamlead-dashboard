import { loadMetrics } from '@backend/server/metrics-service';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { ValidationError, parseScopeSpec, parseStatusName, parseWindowDays, parseWindowFrom } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MetricsBody {
  scope?: unknown;
  windowDays?: unknown;
  windowFrom?: unknown;
  withChangelog?: boolean;
  refresh?: boolean;
  title?: string;
  cycleStartStatus?: unknown;
  cycleEndStatus?: unknown;
  /** Drops the per-issue rows when only aggregates are needed. */
  slim?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<MetricsBody>(request);
    const scope = parseScopeSpec(body.scope);
    const model = await loadMetrics(
      {
        scope,
        windowDays: parseWindowDays(body.windowDays),
        windowFrom: parseWindowFrom(body.windowFrom),
        withChangelog: body.withChangelog === true,
        refresh: body.refresh === true,
        cycleStartStatus: parseStatusName(body.cycleStartStatus),
        cycleEndStatus: parseStatusName(body.cycleEndStatus),
      },
      { title: typeof body.title === 'string' ? body.title : undefined },
    );
    return ok(body.slim ? { ...model, issues: [] } : model);
  } catch (error) {
    if (error instanceof ValidationError) return badRequest(error.message);
    return failure(error);
  }
}
