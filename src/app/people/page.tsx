'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { BarChart, DonutChart, shortLabel } from '@frontend/components/charts';
import { RequireSetup } from '@frontend/components/Guards';
import { AttentionTable, Caveats, IssueTable, ScopeMeta } from '@frontend/components/metric-blocks';
import { TeamPicker, WindowPicker } from '@frontend/components/ScopeControls';
import {
  Callout,
  Card,
  EmptyState,
  ErrorNotice,
  Pill,
  SourceAppendix,
  Spinner,
  StatBar,
  formatDays,
} from '@frontend/components/ui';
import { apiPost, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { useMetrics } from '@frontend/lib/use-metrics';
import type { PeopleComparison, PersonSummary, ScopeSpec } from '@shared/types';

export default function PeoplePage() {
  return (
    <RequireSetup>
      <PeopleView />
    </RequireSetup>
  );
}

function PeopleView() {
  const { teams, rules } = useAppData();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [windowDays, setWindowDays] = useState(rules.defaultWindowDays);
  const [personId, setPersonId] = useState<string | null>(null);

  const [comparison, setComparison] = useState<PeopleComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!teams.some((team) => team.id === teamId)) setTeamId(teams[0]?.id ?? '');
  }, [teams, teamId]);

  const load = useCallback(
    async (refresh = false) => {
      if (!teamId) return;
      setLoading(true);
      try {
        setComparison(await apiPost<PeopleComparison>('/api/metrics/people', { teamId, windowDays, refresh }));
        setError(undefined);
      } catch (caught) {
        setError(errorMessage(caught));
        setComparison(null);
      } finally {
        setLoading(false);
      }
    },
    [teamId, windowDays],
  );

  useEffect(() => {
    setPersonId(null);
    void load();
  }, [load]);

  const selectedPerson = comparison?.people.find((person) => person.id === personId);

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>People</h1>
          <div className="page-header-sub">
            <span>Personal load and flow over the last {windowDays} days</span>
            {comparison && (
              <>
                <span>
                  team median lead time {formatDays(comparison.teamMedianLeadTimeDays)}
                </span>
                {comparison.teamMedianCycleTimeDays !== null && (
                  <span>cycle time {formatDays(comparison.teamMedianCycleTimeDays)}</span>
                )}
                <button type="button" className="subtle" onClick={() => void load(true)} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <TeamPicker teams={teams} value={teamId} onChange={setTeamId} />
          <WindowPicker value={windowDays} onChange={setWindowDays} />
        </div>
      </header>

      {error && <ErrorNotice error={error} onRetry={() => void load(true)} />}
      {loading && !comparison && <Spinner label="Building per-person metrics (this fetch includes changelogs)" />}

      {comparison && (
        <>
          <Caveats caveats={comparison.caveats} />

          <Card
            title="Team members"
            caption="Click a person to open their card. Unfinished load is in-progress plus to-do work."
          >
            {comparison.people.length === 0 ? (
              <EmptyState title="Nobody in this team has work in the window." />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="num">In progress</th>
                      <th className="num">To do</th>
                      <th className="num">Stale</th>
                      <th className="num">Blocked</th>
                      <th className="num">Done</th>
                      <th className="num">Points done</th>
                      <th className="num">Median cycle</th>
                      <th className="num">Median lead</th>
                      <th className="num">Oldest WIP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.people.map((person) => (
                      <tr key={person.id}>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="subtle"
                              onClick={() => setPersonId(person.id === personId ? null : person.id)}
                              style={{ fontWeight: person.id === personId ? 600 : 400 }}
                            >
                              {person.name}
                            </button>
                            {person.active === false && <Pill tone="danger">inactive</Pill>}
                          </div>
                        </td>
                        <NumCell value={person.wip} />
                        <NumCell value={person.notStarted} />
                        <NumCell value={person.stale} tone="warning" />
                        <NumCell value={person.blocked} tone="danger" />
                        <NumCell value={person.doneInWindow} />
                        <NumCell value={person.storyPointsDone} />
                        <td className="num">
                          <Delta value={person.medianCycleTimeDays} baseline={comparison.teamMedianCycleTimeDays} />
                        </td>
                        <td className="num">
                          <Delta value={person.medianLeadTimeDays} baseline={comparison.teamMedianLeadTimeDays} />
                        </td>
                        <td className="num">{formatDays(person.oldestWipDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Callout tone="info">
            These are workload and flow signals, not productivity scores. Counts depend on how the team splits work,
            so read them next to the team median rather than against each other.
          </Callout>

          {personId && selectedPerson && (
            <PersonCard
              key={personId}
              personId={personId}
              teamId={teamId}
              windowDays={windowDays}
              summary={selectedPerson}
              comparison={comparison}
              onClose={() => setPersonId(null)}
            />
          )}

          <SourceAppendix
            jql={comparison.jql}
            queriedAt={comparison.queriedAt}
            fromCache={false}
            issueCount={comparison.people.reduce((total, person) => total + person.doneInWindow, 0)}
            coverage={{ changelog: comparison.teamMedianCycleTimeDays !== null }}
            assumptions={[
              `Scope is unfinished work plus anything resolved in the last ${comparison.windowDays} days.`,
              'Cycle time counts from the first transition into an in-progress status, which requires changelog access.',
              'People with no work in the window still appear if they are team members.',
            ]}
          />
        </>
      )}
    </div>
  );
}

function PersonCard({
  personId,
  teamId,
  windowDays,
  summary,
  comparison,
  onClose,
}: {
  personId: string;
  teamId: string;
  windowDays: number;
  summary: PersonSummary;
  comparison: PeopleComparison;
  onClose: () => void;
}) {
  const scope: ScopeSpec = useMemo(
    () => ({ kind: 'person', personId, teamId, mode: 'recent', label: summary.name }),
    [personId, teamId, summary.name],
  );
  const { model, loading, error, refresh } = useMetrics(scope, { windowDays, withChangelog: true });

  return (
    <Card
      title={summary.name}
      caption={`Personal card · last ${windowDays} days`}
      actions={
        <div className="row">
          {model && <ScopeMeta model={model} onRefresh={refresh} refreshing={loading} />}
          <button type="button" className="subtle" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {loading && !model && <Spinner label="Loading personal metrics" />}

      {model && (
        <div className="stack">
          <StatBar stats={model.stats} />

          <div className="grid">
            <div className="col-third">
              <Card title="Flow versus team" caption="Median days, this person against the team median">
                <div className="stack" style={{ gap: 10 }}>
                  <FlowRow
                    label="Cycle time"
                    value={summary.medianCycleTimeDays}
                    baseline={comparison.teamMedianCycleTimeDays}
                  />
                  <FlowRow
                    label="Lead time"
                    value={summary.medianLeadTimeDays}
                    baseline={comparison.teamMedianLeadTimeDays}
                  />
                  <span className="caption">
                    Based on {summary.doneInWindow} completed work items in the window.
                  </span>
                </div>
              </Card>
            </div>
            {model.flow.agingWip.some((bucket) => bucket.value > 0) && (
              <div className="col-third">
                <Card title="Aging unfinished work" caption="Days since the last Jira update">
                  <BarChart
                    data={model.flow.agingWip}
                    xLabel="Days since last update"
                    yLabel="Work items"
                    tone="warning"
                    height={160}
                  />
                </Card>
              </div>
            )}
            {model.flow.throughputByWeek.length > 0 && (
              <div className="col-third">
                <Card title="Throughput" caption="Resolved work items per ISO week">
                  <BarChart
                    data={model.flow.throughputByWeek}
                    xLabel="ISO week"
                    yLabel="Resolved"
                    tone="success"
                    formatX={shortLabel}
                    height={160}
                  />
                </Card>
              </div>
            )}
          </div>

          {model.statusCategoryDistribution.length > 0 && (
            <div className="grid">
              <div className="col-third">
                <Card title="Status category" caption="This person's work in the window">
                  <DonutChart data={model.statusCategoryDistribution} />
                </Card>
              </div>
              <div className="col-half">
                <Card title="Needs attention" caption="Only this person's work items">
                  <AttentionTable items={model.attention} limit={8} />
                </Card>
              </div>
            </div>
          )}

          <Card title="Unfinished work" caption="What this person is currently holding">
            <IssueTable
              issues={model.issues}
              limit={20}
              showStoryPoints={model.fieldCoverage.storyPoints}
            />
          </Card>

          <SourceAppendix
            jql={model.jql}
            queriedAt={model.queriedAt}
            fromCache={model.fromCache}
            issueCount={model.issueCount}
            coverage={model.fieldCoverage}
            linkTypes={model.linkTypesSeen}
            assumptions={model.attentionComposition}
          />
        </div>
      )}
    </Card>
  );
}

function FlowRow({
  label,
  value,
  baseline,
}: {
  label: string;
  value: number | null;
  baseline: number | null;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="caption">{label}</span>
      <span className="row" style={{ gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {formatDays(value)}
        </span>
        {value !== null && baseline !== null && baseline > 0 && (
          <Pill tone={value <= baseline ? 'success' : value <= baseline * 1.5 ? 'neutral' : 'warning'}>
            team {formatDays(baseline)}
          </Pill>
        )}
      </span>
    </div>
  );
}

function Delta({ value, baseline }: { value: number | null; baseline: number | null }) {
  if (value === null) return <span className="zero">—</span>;
  const tone =
    baseline === null || baseline === 0
      ? undefined
      : value <= baseline
        ? 'var(--success)'
        : value <= baseline * 1.5
          ? undefined
          : 'var(--warning)';
  return <span style={tone ? { color: tone } : undefined}>{formatDays(value)}</span>;
}

function NumCell({ value, tone }: { value: number; tone?: 'warning' | 'danger' }) {
  if (value === 0) return <td className="num"><span className="zero">0</span></td>;
  return (
    <td className="num">
      <span style={tone ? { color: `var(--${tone})` } : undefined}>
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </span>
    </td>
  );
}
