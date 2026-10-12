import { loadFlowIssue } from '@backend/server/flow-service';
import { apiText, withLocale } from '@backend/server/locale';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import { parseIssueKeys } from '@backend/metrics/cycle-overview';
import { parseStatusName } from '@backend/server/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FlowIssueBody {
  key?: unknown;
  teamIds?: unknown;
  cycleStartStatus?: unknown;
  cycleEndStatus?: unknown;
  refresh?: unknown;
}

export function POST(request: Request) {
  return withLocale(request, () => postFlowIssue(request));
}

async function postFlowIssue(request: Request) {
  try {
    const body = await readJson<FlowIssueBody>(request);
    const key = typeof body.key === 'string' ? parseIssueKeys(body.key)[0] : undefined;
    if (!key) return badRequest(apiText(request, 'Need one issue key, for example CDR-2029.', 'Нужен ключ задачи, например CDR-2029.'));
    const teamIds = stringList(body.teamIds);
    if (teamIds.length === 0) return badRequest(apiText(request, 'Pick at least one team.', 'Нужна хотя бы одна команда.'));
    const issue = await loadFlowIssue({
      key,
      teamIds,
      cycleStartStatus: parseStatusName(body.cycleStartStatus),
      cycleEndStatus: parseStatusName(body.cycleEndStatus),
      refresh: body.refresh === true,
    });
    return ok({ issue });
  } catch (error) {
    return failure(error);
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}
