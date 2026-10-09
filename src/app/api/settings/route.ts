import { countCache } from '@backend/db/cache';
import { listConnections, saveConnection, updateFieldMapping } from '@backend/db/connections';
import { getFieldMappings, getFlowWorkflow, getMetricRules, setActiveConnectionId, setFieldMappings, setFlowWorkflow, setMetricRules } from '@backend/db/settings';
import { attemptConnect } from '@backend/server/connect';
import { activeConnection } from '@backend/server/context';
import { badRequest, failure, ok, readJson } from '@backend/server/responses';
import type { AuthKind, Deployment, FlowWorkflow, MetricRules, ScopedFieldMappings } from '@shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  staleDays?: number;
  veryStaleDays?: number;
  dueSoonDays?: number;
  defaultWindowDays?: number;
  cacheTtlSeconds?: number;
  excludeQaTitle?: boolean;
  fieldMappings?: ScopedFieldMappings;
  flowWorkflow?: unknown;
  jiraUrl?: string;
  jiraEmail?: string;
  jiraSecret?: string;
  jiraDeployment?: Deployment;
  jiraAuthKind?: AuthKind;
}

export async function GET() {
  try {
    return ok({
      rules: await getMetricRules(),
      fieldMappings: await getFieldMappings(),
      flowWorkflow: await getFlowWorkflow(),
      cachedResponses: await countCache(),
      connection: (await listConnections())[0] ?? null,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson<PatchBody>(request);
    const patch: Partial<MetricRules> = {};

    if (typeof body.staleDays === 'number') patch.staleDays = clamp(body.staleDays, 0, 365);
    if (typeof body.veryStaleDays === 'number') patch.veryStaleDays = clamp(body.veryStaleDays, 0, 365);
    if (typeof body.dueSoonDays === 'number') patch.dueSoonDays = clamp(body.dueSoonDays, 0, 365);
    if (typeof body.defaultWindowDays === 'number') {
      patch.defaultWindowDays = clamp(body.defaultWindowDays, 1, 730);
    }
    if (typeof body.cacheTtlSeconds === 'number') {
      patch.cacheTtlSeconds = clamp(body.cacheTtlSeconds, 0, 86_400);
    }
    if (typeof body.excludeQaTitle === 'boolean') patch.excludeQaTitle = body.excludeQaTitle;

    const rules = Object.keys(patch).length > 0 ? await setMetricRules(patch) : await getMetricRules();
    let fieldMappings = await getFieldMappings();
    if (body.fieldMappings) {
      fieldMappings = await setFieldMappings(body.fieldMappings);
      const connection = await activeConnection();
      if (connection) await updateFieldMapping(connection.id, fieldMappings.defaults);
    }
    const flowWorkflow = body.flowWorkflow !== undefined ? await setFlowWorkflow(parseFlowWorkflow(body.flowWorkflow)) : await getFlowWorkflow();

    let connection = (await listConnections())[0] ?? null;
    if (body.jiraUrl?.trim() && body.jiraSecret?.trim()) {
      const attempt = await attemptConnect({
        baseUrl: body.jiraUrl,
        secret: body.jiraSecret,
        email: body.jiraEmail,
        deployment: body.jiraDeployment,
        authKind: body.jiraAuthKind,
      });
      connection = await saveConnection(
        {
          name: new URL(attempt.baseUrl).hostname,
          baseUrl: attempt.baseUrl,
          deployment: attempt.deployment,
          authKind: attempt.authKind,
          email: attempt.email,
          secret: body.jiraSecret.trim(),
          accountId: attempt.accountId,
          displayName: attempt.displayName,
          ...attempt.fieldMapping,
        },
        connection?.id,
      );
      await setActiveConnectionId(connection.id);
    } else if (body.jiraSecret?.trim() && !body.jiraUrl?.trim()) {
      return badRequest('Jira URL is required when saving a token.');
    }

    return ok({ rules, fieldMappings, flowWorkflow, connection });
  } catch (error) {
    return failure(error);
  }
}

function parseFlowWorkflow(value: unknown): Partial<FlowWorkflow> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const next: Partial<FlowWorkflow> = {};
  const keys: Array<Exclude<keyof FlowWorkflow, 'cycleStart' | 'cycleEnd' | 'timelineMinSegmentPct'>> = [
    'notStarted',
    'development',
    'review',
    'rework',
    'qa',
    'readyForRelease',
    'done',
    'cancelled',
    'blocked',
    'inReview',
    'qaQueue',
    'qaEnd',
  ];
  for (const key of keys) {
    if (!Array.isArray(raw[key])) continue;
    next[key] = raw[key].filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  }
  if (raw.timelineMinSegmentPct !== undefined) {
    next.timelineMinSegmentPct = clamp(Number(raw.timelineMinSegmentPct), 0, 10);
  }
  return next;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
