import { listConnections, saveConnection } from '@backend/db/connections';
import { getActiveConnectionId, setActiveConnectionId } from '@backend/db/settings';
import { attemptConnect } from '@backend/server/connect';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import type { AuthKind, Deployment } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return ok({ connections: await listConnections(), activeConnectionId: await getActiveConnectionId() });
  } catch (error) {
    return failure(error);
  }
}

interface CreateBody {
  id?: string;
  name?: string;
  baseUrl?: string;
  email?: string;
  secret?: string;
  deployment?: Deployment;
  authKind?: AuthKind;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<CreateBody>(request);
    if (!body.baseUrl?.trim()) return badRequest('Jira URL is required.');
    if (!body.secret?.trim()) return badRequest('API token or personal access token is required.');

    const attempt = await attemptConnect({
      baseUrl: body.baseUrl,
      secret: body.secret,
      email: body.email,
      deployment: body.deployment,
      authKind: body.authKind,
    });

    const connection = await saveConnection(
      {
        name: body.name?.trim() || new URL(attempt.baseUrl).hostname,
        baseUrl: attempt.baseUrl,
        deployment: attempt.deployment,
        authKind: attempt.authKind,
        email: attempt.email,
        secret: body.secret.trim(),
        accountId: attempt.accountId,
        displayName: attempt.displayName,
        ...attempt.fieldMapping,
      },
      body.id,
    );
    await setActiveConnectionId(connection.id);

    return ok({ connection, warnings: attempt.warnings });
  } catch (error) {
    return failure(error);
  }
}
