import { requireContext } from '@backend/server/context';
import { loadMetrics } from '@backend/server/metrics-service';
import { withSnapshot } from '@backend/server/snapshot';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { ValidationError, parseScopeSpec, parseStatusName, parseWindowDays, parseWindowFrom } from '@backend/server/validate';
import type { MetricsModel } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BatchBody {
  requests?: Array<{
    id?: string;
    scope?: unknown;
    windowDays?: unknown;
    windowFrom?: unknown;
    withChangelog?: boolean;
    withTimeline?: boolean;
    title?: string;
    cycleStartStatus?: unknown;
    cycleEndStatus?: unknown;
  }>;
  refresh?: boolean;
}

export interface BatchResult {
  id: string;
  model?: MetricsModel;
  error?: string;
}

/**
 * Resolves several widget scopes in one round trip. Widgets that share a scope
 * share the cached Jira response, so a dashboard costs one query per distinct
 * scope rather than one per widget.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson<BatchBody>(request);
    const requests = body.requests;
    if (!Array.isArray(requests) || requests.length === 0) {
      return badRequest('At least one request is required.');
    }
    if (requests.length > 40) {
      return badRequest('A batch is limited to 40 requests.');
    }

    const context = await requireContext();
    const results: BatchResult[] = [];

    await withSnapshot(context, body.refresh === true, async () => {
      for (const [index, entry] of requests.entries()) {
        const id = entry.id ?? String(index);
        try {
          const model = await loadMetrics(
            {
              scope: parseScopeSpec(entry.scope),
              windowDays: parseWindowDays(entry.windowDays),
              windowFrom: parseWindowFrom(entry.windowFrom),
              withChangelog: entry.withChangelog === true,
              withTimeline: entry.withTimeline === true,
              refresh: body.refresh === true,
              cycleStartStatus: parseStatusName(entry.cycleStartStatus),
              cycleEndStatus: parseStatusName(entry.cycleEndStatus),
            },
            { title: entry.title, context },
          );
          results.push({ id, model });
        } catch (error) {
          // One broken widget must not blank the whole dashboard.
          results.push({ id, error: error instanceof Error ? error.message : 'Unknown error.' });
        }
      }
    });

    return ok({ results });
  } catch (error) {
    if (error instanceof ValidationError) return badRequest(error.message);
    return failure(error);
  }
}
