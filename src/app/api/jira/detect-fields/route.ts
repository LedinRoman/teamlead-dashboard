import { requireContext } from '@backend/server/context';
import { failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-runs custom field detection against the connected site without saving
 * anything, so a mapping that was guessed wrong can be reviewed before replacing
 * the stored one.
 */
export async function GET() {
  try {
    const { client } = await requireContext();
    return ok({ fieldMapping: await client.detectFieldMapping() });
  } catch (error) {
    return failure(error);
  }
}
