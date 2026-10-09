import { listTeams, saveTeam } from '@backend/db/teams';
import { activeConnection, NotConnectedError } from '@backend/server/context';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import type { TeamBoard, TeamMember } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const connection = await activeConnection();
    if (!connection) throw new NotConnectedError();
    return ok({ teams: await listTeams() });
  } catch (error) {
    return failure(error);
  }
}

interface TeamBody {
  name?: string;
  members?: TeamMember[];
  boards?: TeamBoard[];
  projects?: string[];
  extraJql?: string;
}

export async function POST(request: Request) {
  try {
    const connection = await activeConnection();
    if (!connection) throw new NotConnectedError();
    const body = await readJson<TeamBody>(request);
    if (!body.name?.trim()) return badRequest('Team name is required.');

    const team = await saveTeam({
      connectionId: connection.id,
      name: body.name.trim(),
      members: body.members ?? [],
      boards: body.boards ?? [],
      projects: body.projects ?? [],
      extraJql: body.extraJql?.trim() || undefined,
    });
    return ok({ team });
  } catch (error) {
    return failure(error);
  }
}
