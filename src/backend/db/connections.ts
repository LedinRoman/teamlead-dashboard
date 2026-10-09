import type { AuthKind, ConnectionPublic, Deployment, FieldMapping } from '@shared/types';
import { decryptSecret, encryptSecret, maskSecret } from '@backend/server/secrets';
import { db, newId, nowIso, ownerFilter, text } from './index';

interface ConnectionRow {
  id: string;
  name: string;
  base_url: string;
  deployment: string;
  auth_kind: string;
  email: string | null;
  secret_enc: string;
  account_id: string | null;
  display_name: string | null;
  story_points_field: string | null;
  sprint_field: string | null;
  epic_link_field: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionWithSecret extends ConnectionPublic {
  secret: string;
}

export interface SaveConnectionInput extends FieldMapping {
  name: string;
  baseUrl: string;
  deployment: Deployment;
  authKind: AuthKind;
  email?: string;
  secret: string;
  accountId?: string;
  displayName?: string;
}

function toPublic(row: ConnectionRow): ConnectionPublic {
  let secretHint = '****';
  try {
    secretHint = maskSecret(decryptSecret(row.secret_enc));
  } catch {
    secretHint = 'unreadable (encryption key changed)';
  }
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    deployment: row.deployment === 'cloud' ? 'cloud' : 'server',
    authKind: row.auth_kind === 'bearer' ? 'bearer' : 'basic',
    email: text(row.email),
    accountId: text(row.account_id),
    displayName: text(row.display_name),
    storyPointsField: text(row.story_points_field),
    sprintField: text(row.sprint_field),
    epicLinkField: text(row.epic_link_field),
    secretHint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ownerWhere(): Promise<{ sql: string; params: string[] }> {
  return ownerFilter();
}

export async function listConnections(): Promise<ConnectionPublic[]> {
  const owner = await ownerWhere();
  const rows = (await (await db())
    .prepare(`SELECT * FROM connections WHERE ${owner.sql} ORDER BY created_at ASC`)
    .all(...owner.params)) as unknown as ConnectionRow[];
  return rows.map(toPublic);
}

export async function getConnection(id: string): Promise<ConnectionPublic | undefined> {
  const owner = await ownerWhere();
  const row = (await (await db())
    .prepare(`SELECT * FROM connections WHERE id = ? AND ${owner.sql}`)
    .get(id, ...owner.params)) as unknown as ConnectionRow | undefined;
  return row ? toPublic(row) : undefined;
}

export async function getConnectionWithSecret(id: string): Promise<ConnectionWithSecret | undefined> {
  const owner = await ownerWhere();
  const row = (await (await db())
    .prepare(`SELECT * FROM connections WHERE id = ? AND ${owner.sql}`)
    .get(id, ...owner.params)) as unknown as ConnectionRow | undefined;
  if (!row) return undefined;
  try {
    return { ...toPublic(row), secret: decryptSecret(row.secret_enc) };
  } catch {
    return undefined;
  }
}

export async function saveConnection(input: SaveConnectionInput, id?: string): Promise<ConnectionPublic> {
  const timestamp = nowIso();
  const existing = (await listConnections())[0];
  const connectionId = id ?? existing?.id ?? newId('con');
  const store = await db();
  const encrypted = encryptSecret(input.secret);
  const userId = (await ownerFilter()).id;

  if (await getConnection(connectionId)) {
    await store
      .prepare(
        `UPDATE connections SET
           name = ?, base_url = ?, deployment = ?, auth_kind = ?, email = ?, secret_enc = ?,
           account_id = ?, display_name = ?, story_points_field = ?, sprint_field = ?,
           epic_link_field = ?, updated_at = ?, user_id = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.baseUrl,
        input.deployment,
        input.authKind,
        input.email ?? null,
        encrypted,
        input.accountId ?? null,
        input.displayName ?? null,
        input.storyPointsField ?? null,
        input.sprintField ?? null,
        input.epicLinkField ?? null,
        timestamp,
        userId,
        connectionId,
      );
  } else {
    await store
      .prepare(
        `INSERT INTO connections (
           id, user_id, name, base_url, deployment, auth_kind, email, secret_enc, account_id, display_name,
           story_points_field, sprint_field, epic_link_field, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connectionId,
        userId,
        input.name,
        input.baseUrl,
        input.deployment,
        input.authKind,
        input.email ?? null,
        encrypted,
        input.accountId ?? null,
        input.displayName ?? null,
        input.storyPointsField ?? null,
        input.sprintField ?? null,
        input.epicLinkField ?? null,
        timestamp,
        timestamp,
      );
  }

  const saved = await getConnection(connectionId);
  if (!saved) throw new Error('Connection could not be read back after saving.');
  return saved;
}

export async function updateFieldMapping(id: string, mapping: FieldMapping): Promise<ConnectionPublic | undefined> {
  const owner = await ownerWhere();
  await (await db())
    .prepare(
      `UPDATE connections SET story_points_field = ?, sprint_field = ?, epic_link_field = ?, updated_at = ?
       WHERE id = ? AND ${owner.sql}`,
    )
    .run(
      mapping.storyPointsField ?? null,
      mapping.sprintField ?? null,
      mapping.epicLinkField ?? null,
      nowIso(),
      id,
      ...owner.params,
    );
  return getConnection(id);
}

export async function deleteConnection(id: string): Promise<void> {
  const store = await db();
  const owner = await ownerWhere();
  await store.prepare(`DELETE FROM connections WHERE id = ? AND ${owner.sql}`).run(id, ...owner.params);
  await store.prepare(`DELETE FROM teams WHERE connection_id = ? AND ${owner.sql}`).run(id, ...owner.params);
}
