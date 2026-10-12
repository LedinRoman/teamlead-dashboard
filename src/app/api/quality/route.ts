import { clampHistory, loadQuality } from '@backend/server/quality-service';
import { apiText, withLocale } from '@backend/server/locale';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { parseIssueKeys } from '@backend/metrics/cycle-overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface QualityBody {
  teamIds?: unknown;
  sprintId?: unknown;
  historySprints?: unknown;
  excludeQaTitle?: unknown;
  excludedKeys?: unknown;
  workingDays?: unknown;
  refresh?: unknown;
}

export function POST(request: Request) {
  return withLocale(request, () => postQuality(request));
}

async function postQuality(request: Request) {
  try {
    const body = await readJson<QualityBody>(request);
    const teamIds = stringList(body.teamIds);
    const sprintId = Number(body.sprintId);
    if (teamIds.length === 0) return badRequest(apiText(request, 'Pick at least one team.', 'Нужна хотя бы одна команда.'));
    if (!Number.isInteger(sprintId)) return badRequest(apiText(request, 'Pick a sprint.', 'Нужен спринт.'));
    const excludedKeys =
      typeof body.excludedKeys === 'string'
        ? parseIssueKeys(body.excludedKeys)
        : Array.isArray(body.excludedKeys)
          ? parseIssueKeys(body.excludedKeys.filter((item): item is string => typeof item === 'string').join(' '))
          : [];
    const payload = await loadQuality({
      teamIds,
      sprintId,
      historySprints: clampHistory(body.historySprints),
      excludeQaTitle: body.excludeQaTitle === true,
      excludedKeys,
      workingDays: body.workingDays === true,
      refresh: body.refresh === true,
    });
    return ok(payload);
  } catch (error) {
    return failure(error);
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}
