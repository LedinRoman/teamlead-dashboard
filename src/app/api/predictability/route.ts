import { clampHistory, loadPredictability } from '@backend/server/predictability-service';
import { apiText, withLocale } from '@backend/server/locale';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { parseIssueKeys } from '@backend/metrics/cycle-overview';
import { parseStatusName } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PredictabilityBody {
  teamIds?: unknown;
  sprintId?: unknown;
  compareSprintId?: unknown;
  historySprints?: unknown;
  cycleStartStatus?: unknown;
  cycleEndStatus?: unknown;
  excludeQaTitle?: unknown;
  excludedKeys?: unknown;
  refresh?: unknown;
}

export function POST(request: Request) {
  return withLocale(request, () => postPredictability(request));
}

async function postPredictability(request: Request) {
  try {
    const body = await readJson<PredictabilityBody>(request);
    const teamIds = stringList(body.teamIds);
    const sprintId = Number(body.sprintId);
    if (teamIds.length === 0) return badRequest(apiText(request, 'Pick at least one team.', 'Нужна хотя бы одна команда.'));
    if (!Number.isInteger(sprintId)) return badRequest(apiText(request, 'Pick a sprint.', 'Нужен спринт.'));
    const compareRaw = Number(body.compareSprintId);
    const excludedKeys =
      typeof body.excludedKeys === 'string'
        ? parseIssueKeys(body.excludedKeys)
        : Array.isArray(body.excludedKeys)
          ? parseIssueKeys(body.excludedKeys.filter((item): item is string => typeof item === 'string').join(' '))
          : [];
    const payload = await loadPredictability({
      teamIds,
      sprintId,
      compareSprintId: Number.isInteger(compareRaw) ? compareRaw : undefined,
      historySprints: clampHistory(body.historySprints),
      cycleStartStatus: parseStatusName(body.cycleStartStatus),
      cycleEndStatus: parseStatusName(body.cycleEndStatus),
      excludeQaTitle: body.excludeQaTitle === true,
      excludedKeys,
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
