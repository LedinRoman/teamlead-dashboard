import { requireContext } from '@backend/server/context';
import { withSnapshot } from '@backend/server/snapshot';
import { collectTeamSprints, sortSprintsNewestFirst } from '@backend/server/team-sprints';
import { badRequest, failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ctx = await requireContext();
    const url = new URL(request.url);
    const rawIds = url.searchParams.get('teamIds') ?? '';
    const teamIds = rawIds.split(',').map((id) => id.trim()).filter(Boolean);
    if (teamIds.length === 0) return badRequest('teamIds is required.');
    const refresh = url.searchParams.get('refresh') === '1';

    const selected = ctx.teams.filter((team) => teamIds.includes(team.id));
    if (selected.length === 0) return badRequest('None of those teams exist.');

    const sprints = await withSnapshot(ctx, refresh, async () =>
      sortSprintsNewestFirst(await collectTeamSprints(selected, ctx.client)),
    );

    return ok({ sprints });
  } catch (error) {
    return failure(error);
  }
}
