import { listCycleOverrides, removeCycleOverride, upsertCycleOverride } from '@backend/db/cycle-overrides';
import { parseIssueKeys } from '@backend/metrics/cycle-overview';
import { parseDate } from '@backend/metrics/time';
import { apiText } from '@backend/server/locale';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PutBody {
  key?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
}

function parseStamp(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = parseDate(value);
  if (!parsed) throw new Error(label);
  return parsed.toISOString();
}

export async function GET() {
  try {
    return ok({ overrides: await listCycleOverrides() });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await readJson<PutBody>(request);
    const keys = typeof body.key === 'string' ? parseIssueKeys(body.key) : [];
    if (keys.length !== 1) {
      return badRequest(apiText(request, 'Need one issue key, for example CDR-2029.', 'Нужен один ключ задачи, например CDR-2029.'));
    }
    let startedAt: string | undefined;
    let endedAt: string | undefined;
    try {
      startedAt = parseStamp(body.startedAt, 'start');
      endedAt = parseStamp(body.endedAt, 'end');
    } catch (caught) {
      return badRequest(
        caught instanceof Error && caught.message === 'end'
          ? apiText(request, 'Could not read the end date.', 'Не получилось прочитать дату конца.')
          : apiText(request, 'Could not read the start date.', 'Не получилось прочитать дату старта.'),
      );
    }
    if (startedAt === undefined && endedAt === undefined) {
      return badRequest(apiText(request, 'Need a start date or an end date.', 'Нужна дата старта или конца.'));
    }
    return ok({ override: await upsertCycleOverride(keys[0], { startedAt, endedAt }) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const keys = parseIssueKeys(params.get('key') ?? '');
    if (keys.length !== 1) {
      return badRequest(apiText(request, 'Need one issue key, for example CDR-2029.', 'Нужен один ключ задачи, например CDR-2029.'));
    }
    const fieldRaw = params.get('field');
    const field = fieldRaw === 'start' || fieldRaw === 'end' ? fieldRaw : undefined;
    const override = await removeCycleOverride(keys[0], field);
    return ok({ removed: keys[0], field: field ?? 'all', override });
  } catch (error) {
    return failure(error);
  }
}
