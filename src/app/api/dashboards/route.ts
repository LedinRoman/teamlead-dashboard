import { listDashboards, saveDashboard } from '@backend/db/dashboards';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { ValidationError, parseWidgets } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok({ dashboards: await listDashboards() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ name?: string; widgets?: unknown }>(request);
    if (!body.name?.trim()) return badRequest('Dashboard name is required.');
    const dashboard = await saveDashboard({
      name: body.name.trim(),
      widgets: body.widgets === undefined ? [] : parseWidgets(body.widgets),
    });
    return ok({ dashboard });
  } catch (error) {
    if (error instanceof ValidationError) return badRequest(error.message);
    return failure(error);
  }
}
