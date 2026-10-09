import { deleteConnection, getConnection, updateFieldMapping } from '@backend/db/connections';
import { clearActiveConnectionId, setActiveConnectionId } from '@backend/db/settings';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import type { FieldMapping } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

interface PatchBody extends FieldMapping {
  makeActive?: boolean;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!(await getConnection(id))) return badRequest(`Connection ${id} does not exist.`);
    const body = await readJson<PatchBody>(request);

    if (body.makeActive) await setActiveConnectionId(id);

    const hasMapping =
      'storyPointsField' in body || 'sprintField' in body || 'epicLinkField' in body;
    const connection = hasMapping
      ? await updateFieldMapping(id, {
          storyPointsField: body.storyPointsField || undefined,
          sprintField: body.sprintField || undefined,
          epicLinkField: body.epicLinkField || undefined,
        })
      : await getConnection(id);

    return ok({ connection });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteConnection(id);
    await clearActiveConnectionId();
    return ok({ deleted: id });
  } catch (error) {
    return failure(error);
  }
}
