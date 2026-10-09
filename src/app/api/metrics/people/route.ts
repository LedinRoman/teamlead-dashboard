import { loadPeopleComparison } from '@backend/server/metrics-service';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { parseWindowDays } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PeopleBody {
  teamId?: string;
  windowDays?: unknown;
  refresh?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<PeopleBody>(request);
    if (!body.teamId) return badRequest('A teamId is required to compare people.');
    const comparison = await loadPeopleComparison(body.teamId, {
      windowDays: parseWindowDays(body.windowDays),
      refresh: body.refresh === true,
    });
    return ok(comparison);
  } catch (error) {
    return failure(error);
  }
}
