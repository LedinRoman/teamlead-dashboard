import { attemptConnect } from '@backend/server/connect';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import type { AuthKind, Deployment } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TestBody {
  baseUrl?: string;
  email?: string;
  secret?: string;
  deployment?: Deployment;
  authKind?: AuthKind;
}

/** Verifies credentials without storing anything. */
export async function POST(request: Request) {
  try {
    const body = await readJson<TestBody>(request);
    if (!body.baseUrl?.trim()) return badRequest('Jira URL is required.');
    if (!body.secret?.trim()) return badRequest('API token or personal access token is required.');
    const attempt = await attemptConnect({
      baseUrl: body.baseUrl,
      secret: body.secret,
      email: body.email,
      deployment: body.deployment,
      authKind: body.authKind,
    });
    return ok(attempt);
  } catch (error) {
    return failure(error);
  }
}
