import type { JiraSprintOption, Team } from '@shared/types';
import type { JiraClient } from '@backend/jira/client';

export async function collectTeamSprints(teams: Team[], client: JiraClient): Promise<JiraSprintOption[]> {
  const byId = new Map<number, JiraSprintOption>();
  for (const team of teams) {
    for (const board of team.boards) {
      for (const sprint of await client.sprints(board.id, 'active,closed')) {
        if (!byId.has(sprint.id)) byId.set(sprint.id, sprint);
      }
    }
  }
  return [...byId.values()];
}

export function sortSprintsNewestFirst(sprints: JiraSprintOption[]): JiraSprintOption[] {
  return [...sprints].sort((left, right) => sprintDateKey(right).localeCompare(sprintDateKey(left)));
}

export function sortSprintsOldestFirst(sprints: JiraSprintOption[]): JiraSprintOption[] {
  return [...sprints].sort((left, right) => sprintDateKey(left).localeCompare(sprintDateKey(right)));
}

function sprintDateKey(sprint: JiraSprintOption): string {
  return sprint.startDate ?? sprint.endDate ?? '';
}
