'use client';

import { useEffect, useState } from 'react';

import { Field } from './ui';
import { apiGet, errorMessage } from '@frontend/lib/api';
import type { JiraBoardOption, JiraSprintOption, ScopeSpec, Team } from '@shared/types';

type ScopeKind = ScopeSpec['kind'];

const KIND_LABELS: Array<{ value: ScopeKind; label: string; hint: string }> = [
  { value: 'team', label: 'Team', hint: 'Every board and project attached to one of your teams.' },
  { value: 'board', label: 'Board', hint: 'One Jira board, expressed through its saved filter.' },
  { value: 'sprint', label: 'Sprint', hint: 'One specific sprint, including closed ones.' },
  { value: 'person', label: 'Person', hint: 'One assignee, optionally narrowed to a team.' },
  { value: 'jql', label: 'Custom JQL', hint: 'Anything you can express in JQL.' },
];

export function ScopeEditor({
  value,
  onChange,
  teams,
  boards,
}: {
  value: ScopeSpec;
  onChange: (scope: ScopeSpec) => void;
  teams: Team[];
  boards: JiraBoardOption[];
}) {
  const [sprintBoardId, setSprintBoardId] = useState<number | ''>(boards[0]?.id ?? '');
  const [sprints, setSprints] = useState<JiraSprintOption[]>([]);
  const [sprintNote, setSprintNote] = useState<string | undefined>();

  useEffect(() => {
    if (value.kind !== 'sprint' || sprintBoardId === '') return;
    void (async () => {
      try {
        const payload = await apiGet<{ sprints: JiraSprintOption[] }>(
          `/api/jira/boards/${sprintBoardId}/sprints?state=active,closed,future`,
        );
        setSprints(payload.sprints);
        setSprintNote(payload.sprints.length === 0 ? 'This board has no sprints.' : undefined);
      } catch (caught) {
        setSprints([]);
        setSprintNote(errorMessage(caught));
      }
    })();
  }, [value.kind, sprintBoardId]);

  const changeKind = (kind: ScopeKind) => {
    switch (kind) {
      case 'team':
        onChange({ kind: 'team', teamId: teams[0]?.id ?? '', mode: 'active-sprint' });
        break;
      case 'board':
        onChange({ kind: 'board', boardId: boards[0]?.id ?? 0, mode: 'active-sprint' });
        break;
      case 'sprint':
        onChange({ kind: 'sprint', sprintId: sprints[0]?.id ?? 0 });
        break;
      case 'person':
        onChange({
          kind: 'person',
          personId: teams[0]?.members[0]?.id ?? '',
          teamId: teams[0]?.id,
          mode: 'recent',
        });
        break;
      case 'jql':
        onChange({ kind: 'jql', jql: 'statusCategory != Done ORDER BY updated ASC' });
        break;
    }
  };

  const selectedTeam =
    value.kind === 'team'
      ? teams.find((team) => team.id === value.teamId)
      : value.kind === 'person'
        ? teams.find((team) => team.id === value.teamId)
        : undefined;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <Field label="Source" hint={KIND_LABELS.find((entry) => entry.value === value.kind)?.hint}>
        <select value={value.kind} onChange={(event) => changeKind(event.target.value as ScopeKind)}>
          {KIND_LABELS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      {value.kind === 'team' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Field label="Team">
            <select value={value.teamId} onChange={(event) => onChange({ ...value, teamId: event.target.value })}>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
          <ModeField value={value.mode} onChange={(mode) => onChange({ ...value, mode })} />
        </div>
      )}

      {value.kind === 'board' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Field label="Board">
            <select
              value={value.boardId}
              onChange={(event) => onChange({ ...value, boardId: Number(event.target.value) })}
            >
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </Field>
          <ModeField value={value.mode} onChange={(mode) => onChange({ ...value, mode })} />
        </div>
      )}

      {value.kind === 'sprint' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <Field label="Board" hint="Used only to list the sprints.">
            <select
              value={sprintBoardId}
              onChange={(event) => setSprintBoardId(Number(event.target.value))}
            >
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sprint" hint={sprintNote}>
            <select
              value={value.sprintId || ''}
              onChange={(event) => onChange({ kind: 'sprint', sprintId: Number(event.target.value) })}
            >
              <option value="">Select a sprint</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name} ({sprint.state})
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {value.kind === 'person' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <Field label="Team" hint="Narrows the person's work to this team's boards.">
            <select
              value={value.teamId ?? ''}
              onChange={(event) =>
                onChange({ ...value, teamId: event.target.value || undefined, personId: '' })
              }
            >
              <option value="">Across all projects</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Person" hint={selectedTeam ? undefined : 'Pick a team to list its members.'}>
            <select value={value.personId} onChange={(event) => onChange({ ...value, personId: event.target.value })}>
              <option value="">Select a person</option>
              {(selectedTeam?.members ?? teams.flatMap((team) => team.members)).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Framing">
            <select
              value={value.mode}
              onChange={(event) => onChange({ ...value, mode: event.target.value as 'open' | 'recent' })}
            >
              <option value="recent">Recent movement</option>
              <option value="open">All unfinished</option>
            </select>
          </Field>
        </div>
      )}

      {value.kind === 'jql' && (
        <Field
          label="JQL"
          hint="A trailing ORDER BY is respected. Sprint framing is not assumed for custom JQL."
        >
          <textarea value={value.jql} onChange={(event) => onChange({ ...value, jql: event.target.value })} />
        </Field>
      )}
    </div>
  );
}

function ModeField({
  value,
  onChange,
}: {
  value: 'active-sprint' | 'open' | 'recent';
  onChange: (mode: 'active-sprint' | 'open' | 'recent') => void;
}) {
  return (
    <Field label="Framing" hint="Active sprint falls back to a snapshot when no sprint is running.">
      <select value={value} onChange={(event) => onChange(event.target.value as typeof value)}>
        <option value="active-sprint">Active sprint</option>
        <option value="open">All unfinished</option>
        <option value="recent">Recent movement</option>
      </select>
    </Field>
  );
}

export function describeScope(scope: ScopeSpec, teams: Team[], boards: JiraBoardOption[]): string {
  switch (scope.kind) {
    case 'team': {
      const team = teams.find((candidate) => candidate.id === scope.teamId);
      return `${team?.name ?? 'unknown team'} · ${scope.mode}`;
    }
    case 'board': {
      const board = boards.find((candidate) => candidate.id === scope.boardId);
      return `${board?.name ?? `board ${scope.boardId}`} · ${scope.mode}`;
    }
    case 'sprint':
      return `sprint ${scope.sprintId}`;
    case 'person': {
      const team = teams.find((candidate) => candidate.id === scope.teamId);
      const member = team?.members.find((candidate) => candidate.id === scope.personId);
      return `${member?.displayName ?? scope.personId} · ${scope.mode}`;
    }
    case 'jql':
      return scope.jql.length > 60 ? `${scope.jql.slice(0, 60)}…` : scope.jql;
    default:
      return 'unknown scope';
  }
}
