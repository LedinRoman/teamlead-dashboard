import { clampHorizon, loadFlow } from '@backend/server/flow-service';
import { apiText, withLocale } from '@backend/server/locale';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { parseIssueKeys } from '@backend/metrics/cycle-overview';
import { parseStatusName } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FlowBody {
  teamIds?: unknown;
  throughputHorizon?: unknown;
  historyHorizon?: unknown;
  horizonSprints?: unknown;
  cycleStartStatus?: unknown;
  cycleEndStatus?: unknown;
  excludeQaTitle?: unknown;
  excludedKeys?: unknown;
  assigneeIds?: unknown;
  workingDays?: unknown;
  refresh?: unknown;
}

export function POST(request: Request) {
  return withLocale(request, () => postFlow(request));
}

async function postFlow(request: Request) {
  try {
    const body = await readJson<FlowBody>(request);
    const teamIds = stringList(body.teamIds);
    if (teamIds.length === 0) return badRequest(apiText(request, 'Pick at least one team.', 'Нужна хотя бы одна команда.'));
    const excludedKeys =
      typeof body.excludedKeys === 'string'
        ? parseIssueKeys(body.excludedKeys)
        : Array.isArray(body.excludedKeys)
          ? parseIssueKeys(body.excludedKeys.filter((item): item is string => typeof item === 'string').join(' '))
          : [];
    const snapshot = await loadFlow({
      teamIds,
      throughputHorizon: clampHorizon(body.throughputHorizon ?? body.horizonSprints),
      historyHorizon: clampHorizon(body.historyHorizon ?? body.horizonSprints),
      cycleStartStatus: parseStatusName(body.cycleStartStatus),
      cycleEndStatus: parseStatusName(body.cycleEndStatus),
      excludeQaTitle: body.excludeQaTitle === true,
      excludedKeys,
      assigneeIds: stringList(body.assigneeIds),
      workingDays: body.workingDays === true,
      refresh: body.refresh === true,
    });
    return ok({ flow: snapshot });
  } catch (error) {
    return failure(error);
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}
