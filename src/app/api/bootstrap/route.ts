import { listConnections } from '@backend/db/connections';
import { listDashboards } from '@backend/db/dashboards';
import { getActiveConnectionId, getMetricRules } from '@backend/db/settings';
import { listTeams } from '@backend/db/teams';
import { activeConnection } from '@backend/server/context';
import { failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One call that tells the UI whether it can show dashboards or must ask to connect. */
export async function GET() {
  try {
    const connections = await listConnections();
    const connection = await activeConnection();
    return ok({
      connected: connections.length > 0,
      activeConnectionId: connection?.id ?? (await getActiveConnectionId()),
      connections,
      teams: await listTeams(),
      dashboards: await listDashboards(),
      rules: await getMetricRules(),
    });
  } catch (error) {
    return failure(error);
  }
}
