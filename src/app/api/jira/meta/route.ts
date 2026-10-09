import { requireContext } from '@backend/server/context';
import { failure, ok } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the Connect and Teams screens need to offer real choices. */
export async function GET() {
  try {
    const { client, connection } = await requireContext();
    const [fields, projects, boards] = await Promise.all([
      client.fieldOptions(),
      client.projects(),
      client.boards(),
    ]);
    return ok({
      connection,
      fields: fields.sort((a, b) => a.name.localeCompare(b.name)),
      projects: projects.sort((a, b) => a.key.localeCompare(b.key)),
      boards: boards.sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    return failure(error);
  }
}
