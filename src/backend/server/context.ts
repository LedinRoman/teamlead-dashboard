import { getConnectionWithSecret, listConnections, type ConnectionWithSecret } from '@backend/db/connections';
import { listTeams } from '@backend/db/teams';
import { getActiveConnectionId, getMetricRules, setActiveConnectionId } from '@backend/db/settings';
import { JiraClient } from '@backend/jira/client';
import type { Team, MetricRules } from '@shared/types';

export class NotConnectedError extends Error {
  constructor() {
    super('No Jira URL and token yet. Add them in Settings.');
    this.name = 'NotConnectedError';
  }
}

export interface AppContext {
  connection: ConnectionWithSecret;
  client: JiraClient;
  teams: Team[];
  rules: MetricRules;
}

/** Falls back to the only stored connection so the tool works without extra setup. */
export async function activeConnection(): Promise<ConnectionWithSecret | undefined> {
  const activeId = await getActiveConnectionId();
  if (activeId) {
    const found = await getConnectionWithSecret(activeId);
    if (found) return found;
  }
  const all = await listConnections();
  for (const item of all) {
    const readable = await getConnectionWithSecret(item.id);
    if (!readable) continue;
    await setActiveConnectionId(readable.id);
    return readable;
  }
  return undefined;
}

export async function requireContext(): Promise<AppContext> {
  const connection = await activeConnection();
  if (!connection) throw new NotConnectedError();
  const client = new JiraClient(
    {
      baseUrl: connection.baseUrl,
      deployment: connection.deployment,
      authKind: connection.authKind,
      email: connection.email,
      secret: connection.secret,
    },
    {
      storyPointsField: connection.storyPointsField,
      sprintField: connection.sprintField,
      epicLinkField: connection.epicLinkField,
    },
  );
  return {
    connection,
    client,
    teams: await listTeams(),
    rules: await getMetricRules(),
  };
}
