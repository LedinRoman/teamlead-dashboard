import { deleteDashboard, getDashboard, saveDashboard } from '@backend/db/dashboards';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { ValidationError, parseWidgets } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const dashboard = await getDashboard(id);
    if (!dashboard) return badRequest(`Dashboard ${id} does not exist.`);
    return ok({ dashboard });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const existing = await getDashboard(id);
    if (!existing) return badRequest(`Dashboard ${id} does not exist.`);
    const body = await readJson<{ name?: string; widgets?: unknown }>(request);
    const dashboard = await saveDashboard(
      {
        name: body.name?.trim() || existing.name,
        widgets: body.widgets === undefined ? existing.widgets : parseWidgets(body.widgets),
      },
      id,
    );
    return ok({ dashboard });
  } catch (error) {
    if (error instanceof ValidationError) return badRequest(error.message);
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteDashboard(id);
    return ok({ deleted: id });
  } catch (error) {
    return failure(error);
  }
}
