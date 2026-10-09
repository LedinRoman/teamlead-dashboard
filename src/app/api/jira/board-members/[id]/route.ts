import { requireContext } from '@backend/server/context';
import { badRequest, failure, ok } from '@backend/server/responses';
import { resolveScope } from '@backend/jira/scope';
import type { JiraUserOption } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * User search needs elevated permissions on many sites, so team setup also offers
 * "who actually has work on this board" as a source of members.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const boardId = Number(id);
    if (!Number.isInteger(boardId)) return badRequest(`"${id}" is not a board id.`);

    const context = await requireContext();
    const windowDays = Number(new URL(request.url).searchParams.get('windowDays') ?? '90');
    const scope = await resolveScope(
      { kind: 'board', boardId, mode: 'recent' },
      Number.isFinite(windowDays) ? windowDays : 90,
      { client: context.client, teams: context.teams, rules: context.rules },
    );

    const result = await context.client.search({
      jql: scope.jql,
      fields: ['assignee'],
      maxPages: 20,
    });

    const seen = new Map<string, JiraUserOption>();
    for (const issue of result.issues) {
      const assignee = issue.fields?.assignee as
        | { accountId?: string; name?: string; key?: string; displayName?: string; active?: boolean }
        | null
        | undefined;
      if (!assignee) continue;
      const userId = assignee.accountId ?? assignee.name ?? assignee.key;
      if (!userId || seen.has(userId)) continue;
      seen.set(userId, {
        id: userId,
        displayName: assignee.displayName ?? userId,
        active: assignee.active !== false,
      });
    }

    return ok({
      users: [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      jql: scope.jql,
      truncated: result.truncated,
    });
  } catch (error) {
    return failure(error);
  }
}
