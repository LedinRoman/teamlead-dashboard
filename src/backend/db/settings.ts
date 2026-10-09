import { DEFAULT_METRIC_RULES, type FieldMapping, type MetricRules, type ScopedFieldMappings, type FlowWorkflow } from '@shared/types';
import { mergeFlowWorkflow } from '@backend/metrics/flow-workflow';
import { db, ownerFilter, parseJson } from './index';

interface SettingRow {
  key: string;
  value: string;
}

async function readSetting(key: string): Promise<string | undefined> {
  const owner = await ownerFilter();
  const row = (await (await db())
    .prepare(`SELECT value FROM app_settings WHERE ${owner.sql} AND key = ?`)
    .get(...owner.params, key)) as unknown as SettingRow | undefined;
  return row?.value;
}

async function writeSetting(key: string, value: string): Promise<void> {
  const owner = await ownerFilter();
  await (await db())
    .prepare(
      `INSERT INTO app_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(owner.id, key, value);
}

export async function getMetricRules(): Promise<MetricRules> {
  const stored = parseJson<Partial<MetricRules>>(await readSetting('rules'), {});
  return { ...DEFAULT_METRIC_RULES, ...stored };
}

export async function setMetricRules(patch: Partial<MetricRules>): Promise<MetricRules> {
  const merged = { ...(await getMetricRules()), ...patch };
  await writeSetting('rules', JSON.stringify(merged));
  return merged;
}

export async function getFlowWorkflow(): Promise<FlowWorkflow> {
  return mergeFlowWorkflow(parseJson<Partial<FlowWorkflow>>(await readSetting('flowWorkflow'), {}));
}

export async function setFlowWorkflow(partial: Partial<FlowWorkflow>): Promise<FlowWorkflow> {
  const merged = mergeFlowWorkflow({ ...(await getFlowWorkflow()), ...partial });
  await writeSetting('flowWorkflow', JSON.stringify(merged));
  return merged;
}

export async function getActiveConnectionId(): Promise<string | undefined> {
  return readSetting('activeConnectionId');
}

export async function setActiveConnectionId(id: string): Promise<void> {
  await writeSetting('activeConnectionId', id);
}

export async function clearActiveConnectionId(): Promise<void> {
  const owner = await ownerFilter();
  await (await db())
    .prepare(`DELETE FROM app_settings WHERE ${owner.sql} AND key = ?`)
    .run(...owner.params, 'activeConnectionId');
}

const EMPTY_MAPPINGS: ScopedFieldMappings = { defaults: {}, projects: {}, boards: {} };

export async function getFieldMappings(): Promise<ScopedFieldMappings> {
  const stored = parseJson<Partial<ScopedFieldMappings>>(await readSetting('fieldMappings'), {});
  return {
    defaults: stored.defaults ?? EMPTY_MAPPINGS.defaults,
    projects: stored.projects ?? EMPTY_MAPPINGS.projects,
    boards: stored.boards ?? EMPTY_MAPPINGS.boards,
  };
}

export async function setFieldMappings(next: ScopedFieldMappings): Promise<ScopedFieldMappings> {
  const cleaned: ScopedFieldMappings = {
    defaults: cleanMapping(next.defaults),
    projects: Object.fromEntries(
      Object.entries(next.projects)
        .map(([key, mapping]) => [key, cleanMapping(mapping)] as const)
        .filter(([, mapping]) => Object.keys(mapping).length > 0),
    ),
    boards: Object.fromEntries(
      Object.entries(next.boards)
        .map(([key, mapping]) => [key, cleanMapping(mapping)] as const)
        .filter(([, mapping]) => Object.keys(mapping).length > 0),
    ),
  };
  await writeSetting('fieldMappings', JSON.stringify(cleaned));
  return cleaned;
}

function cleanMapping(mapping: FieldMapping | undefined): FieldMapping {
  const next: FieldMapping = {};
  if (mapping?.storyPointsField) next.storyPointsField = mapping.storyPointsField;
  if (mapping?.sprintField) next.sprintField = mapping.sprintField;
  if (mapping?.epicLinkField) next.epicLinkField = mapping.epicLinkField;
  return next;
}

export function resolveFieldMapping(
  layers: Array<FieldMapping | undefined>,
): FieldMapping {
  const merged: FieldMapping = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.storyPointsField) merged.storyPointsField = layer.storyPointsField;
    if (layer.sprintField) merged.sprintField = layer.sprintField;
    if (layer.epicLinkField) merged.epicLinkField = layer.epicLinkField;
  }
  return merged;
}
