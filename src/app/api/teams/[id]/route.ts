import { deleteTeam, getTeam, saveTeam } from '@backend/db/teams';
import { activeConnection, NotConnectedError } from '@backend/server/context';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import type { TeamBoard, TeamMember } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

interface TeamBody {
  name?: string;
  members?: TeamMember[];
  boards?: TeamBoard[];
  projects?: string[];
  extraJql?: string;
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const existing = await getTeam(id);
    if (!existing) return badRequest(`Team ${id} does not exist.`);
    const connection = await activeConnection();
    if (!connection) throw new NotConnectedError();

    const body = await readJson<TeamBody>(request);
    const team = await saveTeam(
      {
        connectionId: existing.connectionId || connection.id,
        name: body.name?.trim() || existing.name,
        members: body.members ?? existing.members,
        boards: body.boards ?? existing.boards,
        projects: body.projects ?? existing.projects,
        extraJql: body.extraJql?.trim() || undefined,
      },
      id,
    );
    return ok({ team });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteTeam(id);
    return ok({ deleted: id });
  } catch (error) {
    return failure(error);
  }
}
