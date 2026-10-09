import type { Team, TeamBoard, TeamMember } from '@shared/types';
import { db, newId, nowIso, ownerFilter, parseJson, text } from './index';

interface TeamRow {
  id: string;
  connection_id: string;
  name: string;
  members: string;
  boards: string;
  projects: string;
  extra_jql: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveTeamInput {
  connectionId: string;
  name: string;
  members: TeamMember[];
  boards: TeamBoard[];
  projects: string[];
  extraJql?: string;
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    connectionId: row.connection_id,
    name: row.name,
    members: parseJson<TeamMember[]>(row.members, []),
    boards: parseJson<TeamBoard[]>(row.boards, []),
    projects: parseJson<string[]>(row.projects, []),
    extraJql: text(row.extra_jql),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTeams(connectionId?: string): Promise<Team[]> {
  const store = await db();
  const owner = await ownerFilter();
  const rows = connectionId
    ? ((await store
        .prepare(`SELECT * FROM teams WHERE ${owner.sql} AND connection_id = ? ORDER BY lower(name) ASC`)
        .all(...owner.params, connectionId)) as unknown as TeamRow[])
    : ((await store
        .prepare(`SELECT * FROM teams WHERE ${owner.sql} ORDER BY lower(name) ASC`)
        .all(...owner.params)) as unknown as TeamRow[]);
  return rows.map(toTeam);
}

export async function getTeam(id: string): Promise<Team | undefined> {
  const owner = await ownerFilter();
  const row = (await (await db())
    .prepare(`SELECT * FROM teams WHERE id = ? AND ${owner.sql}`)
    .get(id, ...owner.params)) as unknown as TeamRow | undefined;
  return row ? toTeam(row) : undefined;
}

export async function saveTeam(input: SaveTeamInput, id?: string): Promise<Team> {
  const timestamp = nowIso();
  const teamId = id ?? newId('team');
  const members = JSON.stringify(input.members);
  const boards = JSON.stringify(input.boards);
  const projects = JSON.stringify(input.projects);
  const store = await db();
  const owner = await ownerFilter();

  if (id && (await getTeam(id))) {
    await store
      .prepare(
        `UPDATE teams SET connection_id = ?, name = ?, members = ?, boards = ?, projects = ?,
           extra_jql = ?, updated_at = ?, user_id = ? WHERE id = ? AND ${owner.sql}`,
      )
      .run(
        input.connectionId,
        input.name,
        members,
        boards,
        projects,
        input.extraJql ?? null,
        timestamp,
        owner.id,
        id,
        ...owner.params,
      );
  } else {
    await store
      .prepare(
        `INSERT INTO teams (id, user_id, connection_id, name, members, boards, projects, extra_jql, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        teamId,
        owner.id,
        input.connectionId,
        input.name,
        members,
        boards,
        projects,
        input.extraJql ?? null,
        timestamp,
        timestamp,
      );
  }

  const saved = await getTeam(id ?? teamId);
  if (!saved) throw new Error('Team could not be read back after saving.');
  return saved;
}

export async function deleteTeam(id: string): Promise<void> {
  const owner = await ownerFilter();
  await (await db()).prepare(`DELETE FROM teams WHERE id = ? AND ${owner.sql}`).run(id, ...owner.params);
}
