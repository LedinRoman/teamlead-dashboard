import { requireContext } from '@backend/server/context';
import { withSnapshot } from '@backend/server/snapshot';
import { failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Statuses and issue types for the Settings screen. Rules match on names, and a
 * typed name that matches nothing would silently do nothing, so the UI picks from
 * this list instead of asking the user to spell them.
 *
 * With `?project=KEY` only that project's workflow statuses are returned, which is
 * how the rule editor avoids showing every status on the site at once.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireContext();
    const url = new URL(request.url);
    const project = url.searchParams.get('project');
    const refresh = url.searchParams.get('refresh') === '1';

    return await withSnapshot(ctx, refresh, async () => {
      if (project) {
        return ok({ project, statuses: await ctx.client.projectStatuses(project) });
      }
      const [statuses, issueTypes] = await Promise.all([ctx.client.statuses(), ctx.client.issueTypes()]);
      return ok({ statuses, issueTypes });
    });
  } catch (error) {
    return failure(error);
  }
}
