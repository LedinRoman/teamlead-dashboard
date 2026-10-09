'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Callout, Card, EmptyState, Field, Pill, Spinner } from '@frontend/components/ui';
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import type { JiraBoardOption, JiraProjectOption, JiraUserOption, Team, TeamBoard, TeamMember } from '@shared/types';

interface MetaPayload {
  projects: JiraProjectOption[];
  boards: JiraBoardOption[];
}

export default function TeamsPage() {
  const { teams, connected, reload, loading } = useAppData();
  const [meta, setMeta] = useState<MetaPayload | null>(null);
  const [metaError, setMetaError] = useState<string | undefined>();
  const [editing, setEditing] = useState<Team | 'new' | null>(null);

  useEffect(() => {
    if (!connected) return;
    void (async () => {
      try {
        setMeta(await apiGet<MetaPayload>('/api/jira/meta'));
        setMetaError(undefined);
      } catch (caught) {
        setMetaError(errorMessage(caught));
      }
    })();
  }, [connected]);

  if (loading) return <Spinner label="Loading teams" />;

  if (!connected) {
    return (
      <EmptyState title="Connect Jira first">
        <span>Teams are built from real boards and people, so a connection is needed before this screen is useful.</span>
        <a href="/settings">Go to Settings</a>
      </EmptyState>
    );
  }

  const remove = async (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"? Dashboards pointing at it will show an error until repointed.`))
      return;
    await apiDelete(`/api/teams/${team.id}`);
    await reload();
  };

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>Teams</h1>
          <div className="page-header-sub">
            A team is your own grouping: the people you lead plus the boards or projects their work lives on.
          </div>
        </div>
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          New team
        </button>
      </header>

      {metaError && (
        <Callout tone="warning" title="Boards and projects could not be listed">
          {metaError}
        </Callout>
      )}

      {editing && meta && (
        <TeamEditor
          team={editing === 'new' ? null : editing}
          meta={meta}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}

      {teams.length === 0 && !editing && (
        <EmptyState title="No teams yet">
          <span>
            Create one team to start. You can add more later and compare them side by side on a dashboard.
          </span>
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            Create the first team
          </button>
        </EmptyState>
      )}

      {teams.map((team) => (
        <Card
          key={team.id}
          title={team.name}
          caption={`${team.members.length} people · ${team.boards.length} boards · ${team.projects.length} projects`}
          actions={
            <div className="row">
              <button type="button" onClick={() => setEditing(team)}>
                Edit
              </button>
              <button type="button" className="danger" onClick={() => remove(team)}>
                Delete
              </button>
            </div>
          }
        >
          <div className="stack" style={{ gap: 8 }}>
            {team.boards.length > 0 && (
              <div className="row" style={{ gap: 5 }}>
                {team.boards.map((board) => (
                  <Pill key={board.id} tone="info">
                    {board.name}
                  </Pill>
                ))}
              </div>
            )}
            {team.projects.length > 0 && (
              <div className="row" style={{ gap: 5 }}>
                {team.projects.map((project) => (
                  <Pill key={project} tone="neutral">
                    {project}
                  </Pill>
                ))}
              </div>
            )}
            {team.members.length > 0 && (
              <div className="caption">
                {team.members.map((member) => member.displayName).join(', ')}
              </div>
            )}
            {team.extraJql && (
              <div>
                <span className="caption">Extra JQL filter</span>
                <pre className="mono" style={{ margin: '3px 0 0' }}>
                  {team.extraJql}
                </pre>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function TeamEditor({
  team,
  meta,
  onCancel,
  onSaved,
}: {
  team: Team | null;
  meta: MetaPayload;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(team?.name ?? '');
  const [boards, setBoards] = useState<TeamBoard[]>(team?.boards ?? []);
  const [projects, setProjects] = useState<string[]>(team?.projects ?? []);
  const [members, setMembers] = useState<TeamMember[]>(team?.members ?? []);
  const [extraJql, setExtraJql] = useState(team?.extraJql ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<JiraUserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | undefined>();

  const boardIds = useMemo(() => new Set(boards.map((board) => board.id)), [boards]);
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);

  const toggleBoard = (board: JiraBoardOption) => {
    setBoards((current) =>
      current.some((entry) => entry.id === board.id)
        ? current.filter((entry) => entry.id !== board.id)
        : [...current, { id: board.id, name: board.name }],
    );
  };

  const toggleProject = (key: string) => {
    setProjects((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  };

  const toggleMember = (user: JiraUserOption) => {
    setMembers((current) =>
      current.some((entry) => entry.id === user.id)
        ? current.filter((entry) => entry.id !== user.id)
        : [...current, { id: user.id, displayName: user.displayName, active: user.active }],
    );
  };

  const searchUsers = useCallback(async () => {
    setSearching(true);
    setSearchNote(undefined);
    try {
      const payload = await apiGet<{ users: JiraUserOption[] }>(
        `/api/jira/users?query=${encodeURIComponent(query)}`,
      );
      setCandidates(payload.users);
      if (payload.users.length === 0) setSearchNote('Jira returned no users for that search.');
    } catch (caught) {
      setSearchNote(errorMessage(caught));
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const detectFromBoards = async () => {
    setSearching(true);
    setSearchNote(undefined);
    try {
      const found = new Map<string, JiraUserOption>();
      let truncated = false;
      for (const board of boards) {
        const payload = await apiGet<{ users: JiraUserOption[]; truncated?: boolean }>(
          `/api/jira/board-members/${board.id}?windowDays=90`,
        );
        for (const user of payload.users) found.set(user.id, user);
        if (payload.truncated) truncated = true;
      }
      const users = [...found.values()];
      setCandidates(users);
      setSearchNote(
        users.length === 0
          ? 'No assignees were found on the selected boards in the last 90 days.'
          : `${users.length} people have had work on the selected boards in the last 90 days.${
              truncated ? ' One of the boards has more work than a single scan covers, so this list may be short a few names.' : ''
            }`,
      );
    } catch (caught) {
      setSearchNote(errorMessage(caught));
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    const body = { name, boards, projects, members, extraJql: extraJql.trim() || undefined };
    try {
      if (team) await apiPut(`/api/teams/${team.id}`, body);
      else await apiPost('/api/teams', body);
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const hasScope = boards.length > 0 || projects.length > 0 || members.length > 0;

  return (
    <Card
      title={team ? `Edit ${team.name}` : 'New team'}
      caption="Boards give the most accurate scope. Projects are wider. Members alone means everything assigned to them."
    >
      <div className="stack">
        <Field label="Team name">
          <input
            type="text"
            value={name}
            placeholder="Platform"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <div>
          <span className="field-label" style={{ fontSize: 12 }}>
            Boards ({boards.length} selected)
          </span>
          <div className="checklist" style={{ marginTop: 4 }}>
            {meta.boards.map((board) => (
              <label key={board.id}>
                <input type="checkbox" checked={boardIds.has(board.id)} onChange={() => toggleBoard(board)} />
                <span title={`${board.name} · ${board.type}`}>{board.name}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className="field-label" style={{ fontSize: 12 }}>
            Projects ({projects.length} selected)
          </span>
          <div className="checklist" style={{ marginTop: 4 }}>
            {meta.projects.map((project) => (
              <label key={project.key}>
                <input
                  type="checkbox"
                  checked={projects.includes(project.key)}
                  onChange={() => toggleProject(project.key)}
                />
                <span title={project.name}>
                  {project.key} — {project.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="field-label" style={{ fontSize: 12 }}>
            People ({members.length} selected)
          </span>
          {members.length > 0 && (
            <div className="row" style={{ gap: 5 }}>
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="subtle"
                  onClick={() => setMembers(members.filter((entry) => entry.id !== member.id))}
                  title="Remove from team"
                >
                  <Pill tone={member.active === false ? 'danger' : 'neutral'}>{member.displayName} ×</Pill>
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <input
              type="text"
              value={query}
              placeholder="Search Jira users by name or email"
              style={{ maxWidth: 320 }}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void searchUsers();
                }
              }}
            />
            <button type="button" onClick={searchUsers} disabled={searching}>
              Search users
            </button>
            <button type="button" onClick={detectFromBoards} disabled={searching || boards.length === 0}>
              Detect from selected boards
            </button>
            {searching && <Spinner label="Asking Jira" />}
          </div>
          {searchNote && <span className="caption">{searchNote}</span>}
          {candidates.length > 0 && (
            <div className="checklist">
              {candidates.map((user) => (
                <label key={user.id}>
                  <input type="checkbox" checked={memberIds.has(user.id)} onChange={() => toggleMember(user)} />
                  <span title={user.email ?? user.id}>
                    {user.displayName}
                    {user.active ? '' : ' (inactive)'}
                  </span>
                </label>
              ))}
            </div>
          )}
          <span className="caption">
            User search needs browse-users permission on many sites. If it returns nothing, detect people from the
            boards instead.
          </span>
        </div>

        <Field
          label="Extra JQL filter (optional)"
          hint="ANDed onto every query for this team. Useful to exclude a component or issue type."
        >
          <textarea
            value={extraJql}
            placeholder='issuetype != Sub-task AND component != "Legacy"'
            onChange={(event) => setExtraJql(event.target.value)}
          />
        </Field>

        {!hasScope && (
          <Callout tone="warning">
            Add at least one board, project or person. Without a scope there is nothing to query.
          </Callout>
        )}

        {error && <Callout tone="danger">{error}</Callout>}

        <div className="row">
          <button type="button" className="primary" onClick={save} disabled={saving || !name.trim() || !hasScope}>
            {saving ? 'Saving…' : team ? 'Save team' : 'Create team'}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Card>
  );
}
