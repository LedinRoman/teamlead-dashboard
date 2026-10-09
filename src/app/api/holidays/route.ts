import { addHoliday, listHolidays, removeHoliday } from '@backend/db/holidays';
import { parseDayKey } from '@backend/metrics/time';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PutBody {
  day?: unknown;
}

export async function GET() {
  try {
    return ok({ days: await listHolidays() });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await readJson<PutBody>(request);
    const day = parseDayKey(body.day);
    if (!day) return badRequest('Нужна дата праздника в формате YYYY-MM-DD.');
    return ok({ day: await addHoliday(day), days: await listHolidays() });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const day = parseDayKey(new URL(request.url).searchParams.get('day') ?? '');
    if (!day) return badRequest('Нужна дата праздника в формате YYYY-MM-DD.');
    await removeHoliday(day);
    return ok({ removed: day, days: await listHolidays() });
  } catch (error) {
    return failure(error);
  }
}
