import { requireContext } from '@backend/server/context';
import { failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { client } = await requireContext();
    const query = new URL(request.url).searchParams.get('query') ?? '';
    const users = await client.searchUsers(query);
    return ok({ users: users.sort((a, b) => a.displayName.localeCompare(b.displayName)) });
  } catch (error) {
    return failure(error);
  }
}
