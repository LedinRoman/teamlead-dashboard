import { clearCache, countCache, pruneCache } from '@backend/db/cache';
import { failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await pruneCache();
    return ok({ cachedResponses: await countCache() });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE() {
  try {
    return ok({ cleared: await clearCache() });
  } catch (error) {
    return failure(error);
  }
}
