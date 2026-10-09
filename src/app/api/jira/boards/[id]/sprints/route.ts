import { requireContext } from '@backend/server/context';
import { badRequest, failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const boardId = Number(id);
    if (!Number.isInteger(boardId)) return badRequest(`"${id}" is not a board id.`);
    const { client } = await requireContext();
    const states = new URL(request.url).searchParams.get('state') ?? 'active,closed,future';
    // Boards without sprint support return [] rather than failing.
    const sprints = await client.sprints(boardId, states);
    return ok({ sprints, supportsSprints: sprints.length > 0 });
  } catch (error) {
    return failure(error);
  }
}
