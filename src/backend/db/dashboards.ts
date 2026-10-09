import type { Dashboard, WidgetConfig } from '@shared/types';
import { db, newId, nowIso, ownerFilter, parseJson } from './index';

interface DashboardRow {
  id: string;
  name: string;
  widgets: string;
  created_at: string;
  updated_at: string;
}

function toDashboard(row: DashboardRow): Dashboard {
  return {
    id: row.id,
    name: row.name,
    widgets: parseJson<WidgetConfig[]>(row.widgets, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDashboards(): Promise<Dashboard[]> {
  const owner = await ownerFilter();
  const rows = (await (await db())
    .prepare(`SELECT * FROM dashboards WHERE ${owner.sql} ORDER BY created_at ASC`)
    .all(...owner.params)) as unknown as DashboardRow[];
  return rows.map(toDashboard);
}

export async function getDashboard(id: string): Promise<Dashboard | undefined> {
  const owner = await ownerFilter();
  const row = (await (await db())
    .prepare(`SELECT * FROM dashboards WHERE id = ? AND ${owner.sql}`)
    .get(id, ...owner.params)) as unknown as DashboardRow | undefined;
  return row ? toDashboard(row) : undefined;
}

export async function saveDashboard(
  input: { name: string; widgets: WidgetConfig[] },
  id?: string,
): Promise<Dashboard> {
  const timestamp = nowIso();
  const dashboardId = id ?? newId('dash');
  const widgets = JSON.stringify(input.widgets);
  const store = await db();
  const owner = await ownerFilter();

  if (id && (await getDashboard(id))) {
    await store
      .prepare(`UPDATE dashboards SET name = ?, widgets = ?, updated_at = ?, user_id = ? WHERE id = ? AND ${owner.sql}`)
      .run(input.name, widgets, timestamp, owner.id, id, ...owner.params);
  } else {
    await store
      .prepare(
        'INSERT INTO dashboards (id, user_id, name, widgets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(dashboardId, owner.id, input.name, widgets, timestamp, timestamp);
  }

  const saved = await getDashboard(id ?? dashboardId);
  if (!saved) throw new Error('Dashboard could not be read back after saving.');
  return saved;
}

export async function deleteDashboard(id: string): Promise<void> {
  const owner = await ownerFilter();
  await (await db()).prepare(`DELETE FROM dashboards WHERE id = ? AND ${owner.sql}`).run(id, ...owner.params);
}
