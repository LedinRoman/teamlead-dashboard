'use client';

import { useEffect, useMemo, useState } from 'react';

import { BarChart, DonutChart, HBarList, LineChart, shortLabel } from '@frontend/components/charts';
import { RequireSetup } from '@frontend/components/Guards';
import {
  AttentionTable,
  Caveats,
  DistributionStat,
  IssueTable,
  OwnerLoadTable,
  ScopeMeta,
  SprintCard,
} from '@frontend/components/metric-blocks';
import { TeamPicker } from '@frontend/components/ScopeControls';
import { Callout, Card, ErrorNotice, LoadingCards, SourceAppendix, StatBar } from '@frontend/components/ui';
import { apiGet, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { useMetrics } from '@frontend/lib/use-metrics';
import type { JiraSprintOption, ScopeSpec } from '@shared/types';

export default function SprintPage() {
  return (
    <RequireSetup>
      <SprintView />
    </RequireSetup>
  );
}

interface SprintChoice extends JiraSprintOption {
  boardName: string;
}

function SprintView() {
  const { teams } = useAppData();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [sprintId, setSprintId] = useState<number | 'auto'>('auto');
  const [sprints, setSprints] = useState<SprintChoice[] | null>(null);
  const [sprintNote, setSprintNote] = useState<string | undefined>();

  const team = teams.find((candidate) => candidate.id === teamId);

  useEffect(() => {
    if (!teams.some((candidate) => candidate.id === teamId)) setTeamId(teams[0]?.id ?? '');
  }, [teams, teamId]);

  useEffect(() => {
    if (!team) return;
    setSprints(null);
    setSprintId('auto');
    setSprintNote(undefined);

    void (async () => {
      if (team.boards.length === 0) {
        setSprints([]);
        setSprintNote('This team has no board attached, so sprints cannot be listed. The view falls back to a snapshot.');
        return;
      }
      try {
        const collected: SprintChoice[] = [];
        for (const board of team.boards) {
          const payload = await apiGet<{ sprints: JiraSprintOption[] }>(
            `/api/jira/boards/${board.id}/sprints?state=active,closed,future`,
          );
          collected.push(...payload.sprints.map((sprint) => ({ ...sprint, boardName: board.name })));
        }
        setSprints(collected);
        if (collected.length === 0) {
          setSprintNote('None of this team\u2019s boards support sprints, so the view falls back to a snapshot.');
        }
      } catch (caught) {
        setSprints([]);
        setSprintNote(errorMessage(caught));
      }
    })();
  }, [team]);

  const scope: ScopeSpec | undefined = useMemo(() => {
    if (!teamId) return undefined;
    if (sprintId === 'auto') return { kind: 'team', teamId, mode: 'active-sprint' };
    return { kind: 'sprint', sprintId };
  }, [teamId, sprintId]);

  const { model, loading, error, refresh } = useMetrics(scope);
  const showStoryPoints = model?.fieldCoverage.storyPoints ?? false;
  const completed = model?.issues.filter((issue) => issue.effectiveCategory === 'done') ?? [];

  const grouped = useMemo(() => {
    if (!sprints) return { active: [], future: [], closed: [] };
    return {
      active: sprints.filter((sprint) => sprint.state === 'active'),
      future: sprints.filter((sprint) => sprint.state === 'future'),
      closed: sprints.filter((sprint) => sprint.state === 'closed'),
    };
  }, [sprints]);

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>Sprint</h1>
          {model ? (
            <ScopeMeta model={model} onRefresh={refresh} refreshing={loading} />
          ) : (
            <div className="page-header-sub">Pick a team to load its sprint.</div>
          )}
        </div>
        <div className="row" style={{ gap: 14 }}>
          <TeamPicker teams={teams} value={teamId} onChange={setTeamId} />
          <div className="row" style={{ gap: 8 }}>
            <span className="caption">Sprint</span>
            <select
              value={String(sprintId)}
              disabled={!sprints || sprints.length === 0}
              onChange={(event) =>
                setSprintId(event.target.value === 'auto' ? 'auto' : Number(event.target.value))
              }
              style={{ width: 260 }}
            >
              <option value="auto">Active sprint (auto)</option>
              {grouped.active.length > 0 && (
                <optgroup label="Active">
                  {grouped.active.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {grouped.closed.length > 0 && (
                <optgroup label="Closed">
                  {grouped.closed.slice(0, 20).map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {grouped.future.length > 0 && (
                <optgroup label="Future">
                  {grouped.future.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
      </header>

      {sprintNote && <Callout tone="info">{sprintNote}</Callout>}
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {loading && !model && <LoadingCards count={4} />}

      {model && (
        <>
          <StatBar stats={model.stats} />
          <Caveats caveats={model.caveats} />

          <div className="grid">
            {model.sprint && (
              <div className="col-half">
                <SprintCard sprint={model.sprint} />
              </div>
            )}
            {model.remainingOverTime && model.remainingOverTime.length > 1 && (
              <div className="col-half">
                <Card title="Remaining work" caption="Unfinished work items per day">
                  <LineChart
                    data={model.remainingOverTime}
                    xLabel="Day"
                    yLabel="Remaining (work items)"
                    formatX={shortLabel}
                    height={175}
                    caption="Reconstructed from resolution dates. Work added mid-sprint is not modelled."
                  />
                </Card>
              </div>
            )}
          </div>

          <div className="grid">
            <div className="col-third">
              <Card title="Status category" caption="Share of work items in this sprint">
                <DonutChart data={model.statusCategoryDistribution} />
              </Card>
            </div>
            <div className="col-third">
              <Card title="Status detail" caption="Work items per Jira status">
                <HBarList data={model.statusDistribution} limit={8} />
              </Card>
            </div>
            {model.resolvedPerDay.some((day) => day.value > 0) && (
              <div className="col-third">
                <Card title="Resolved per day" caption="From resolution dates">
                  <BarChart
                    data={model.resolvedPerDay}
                    xLabel="Day"
                    yLabel="Resolved"
                    tone="success"
                    formatX={shortLabel}
                    height={165}
                  />
                </Card>
              </div>
            )}
          </div>

          <Card title="Owner load" caption="Who is carrying what in this sprint">
            <OwnerLoadTable rows={model.ownerLoad} showStoryPoints={showStoryPoints} />
          </Card>

          <Card
            title="Risk and attention"
            caption="Ordered by severity, then by how long the work item has been idle"
          >
            <AttentionTable items={model.attention} limit={20} />
          </Card>

          <div className="grid">
            {model.flow.leadTimeDays && (
              <div className="col-half">
                <Card title="Lead time" caption="Created until resolved, for work completed in this scope">
                  <DistributionStat summary={model.flow.leadTimeDays} label="Created until resolved" />
                </Card>
              </div>
            )}
            {model.typeDistribution.length > 0 && (
              <div className="col-half">
                <Card title="Work type mix" caption="All work items in this sprint">
                  <HBarList data={model.typeDistribution} limit={8} />
                </Card>
              </div>
            )}
          </div>

          <Card title="Unfinished work" caption="Highest priority first, then longest idle">
            <IssueTable issues={model.issues} limit={25} showStoryPoints={showStoryPoints} />
          </Card>

          {completed.length > 0 && (
            <details className="appendix">
              <summary>Completed in this scope ({completed.length})</summary>
              <div style={{ marginTop: 8 }}>
                <IssueTable
                  issues={completed}
                  limit={40}
                  showStoryPoints={showStoryPoints}
                  unfinishedOnly={false}
                />
              </div>
            </details>
          )}

          <SourceAppendix
            jql={model.jql}
            queriedAt={model.queriedAt}
            fromCache={model.fromCache}
            issueCount={model.issueCount}
            coverage={model.fieldCoverage}
            linkTypes={model.linkTypesSeen}
            assumptions={model.attentionComposition}
          />
        </>
      )}
    </div>
  );
}
