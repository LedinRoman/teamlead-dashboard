'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { CycleTimeBarChart } from '@frontend/components/charts';
import { RequireSetup } from '@frontend/components/Guards';
import { Card, ErrorNotice, LoadingCards, Modal, Segmented, SnapshotBar } from '@frontend/components/ui';
import { apiDelete, apiGet, apiPut, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { effectiveExcludeQa } from '@frontend/lib/exclude-qa-title';
import { useJiraStatuses } from '@frontend/lib/use-jira-statuses';
import { useBatchMetrics, type BatchRequest } from '@frontend/lib/use-metrics';
import {
  formatBugCreated,
  formatBugPoints,
  listOpenBugs,
  openBugsJql,
  sortBugsByAge,
  uniqueBugStatuses,
  type BugAgeSort,
  type BugListItem,
} from '@backend/metrics/bug-list';
import {
  buildCycleOverview,
  CYCLE_EMPTY_MESSAGE,
  cycleOverrideMaps,
  formatCycleCompare,
  formatCycleDuration,
  listCyclePeople,
  parseIssueKeys,
  type CyclePerson,
  type OldestWipItem,
} from '@backend/metrics/cycle-overview';
import { DEFAULT_CYCLE_START_STATUS, ENGINEERING_DONE_STATUS } from '@backend/metrics/rules';
import { localDayKey } from '@backend/metrics/time';
import type { JiraSprintOption, JiraStatusOption, NormalizedIssue, Team } from '@shared/types';

const START_STORAGE = 'cycle-overview.startStatus';
const END_STORAGE = 'cycle-overview.endStatus';
const KEYS_STORAGE = 'cycle-overview.excludedKeys';
const COMPARE_STORAGE = 'cycle-overview.compareSprintIds';
const COMPARE_STORAGE_LEGACY = 'cycle-overview.compareSprintId';
const PEOPLE_STORAGE = 'cycle-overview.assigneeIds';
const BUG_BACKLOG_STORAGE = 'cycle-overview.includeBugBacklog';
const BUG_STATUSES_STORAGE = 'cycle-overview.excludeBugStatuses';
const WORKING_STORAGE = 'cycle-overview.workingDays';

interface CycleOverrideRow {
  key: string;
  startedAt?: string;
  endedAt?: string;
}

export default function OverviewPage() {
  return (
    <RequireSetup>
      <TeamOverview />
    </RequireSetup>
  );
}

function TeamOverview() {
  const { teams, rules } = useAppData();
  const [teamIds, setTeamIds] = useState<string[]>(() => (teams[0] ? [teams[0].id] : []));
  const [sprints, setSprints] = useState<JiraSprintOption[]>([]);
  const [sprintIds, setSprintIds] = useState<number[]>([]);
  const [sprintsError, setSprintsError] = useState<string | undefined>();
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsTick, setSprintsTick] = useState(0);
  const sprintsForceRef = useRef(false);
  const [startStatus, setStartStatus] = useState(
    () => readStoredStatus(START_STORAGE) ?? DEFAULT_CYCLE_START_STATUS,
  );
  const [endStatus, setEndStatus] = useState(
    () => readStoredStatus(END_STORAGE) ?? ENGINEERING_DONE_STATUS,
  );
  const excludeQa = effectiveExcludeQa(rules);
  const [excludedKeys, setExcludedKeys] = useState<string[]>(() => readStoredKeys());
  const [compareSprintIds, setCompareSprintIds] = useState<number[]>(() => readStoredCompareIds());
  const [excludeDraft, setExcludeDraft] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => readStoredIds(PEOPLE_STORAGE));
  const [includeBugBacklog, setIncludeBugBacklog] = useState(() => readStoredFlag(BUG_BACKLOG_STORAGE));
  const [excludeBugStatuses, setExcludeBugStatuses] = useState<string[]>(() => readStoredIds(BUG_STATUSES_STORAGE));
  const [overrides, setOverrides] = useState<CycleOverrideRow[]>([]);
  const [overrideKeyDraft, setOverrideKeyDraft] = useState('');
  const [overrideStartDraft, setOverrideStartDraft] = useState('');
  const [overrideEndDraft, setOverrideEndDraft] = useState('');
  const [overrideError, setOverrideError] = useState<string | undefined>();
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [workingDays, setWorkingDays] = useState(() => readStoredFlag(WORKING_STORAGE));
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDraft, setHolidayDraft] = useState('');
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [holidaysError, setHolidaysError] = useState<string | undefined>();

  useEffect(() => {
    setTeamIds((current) => {
      const valid = current.filter((id) => teams.some((team) => team.id === id));
      if (valid.length === 0 && teams[0]) return [teams[0].id];
      if (valid.length > 1) return [valid[0]];
      return valid.length === current.length ? current : valid;
    });
  }, [teams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await apiGet<{ overrides: CycleOverrideRow[] }>('/api/cycle-overrides');
        if (!cancelled) {
          setOverrides(payload.overrides);
          setOverrideError(undefined);
        }
      } catch (caught) {
        if (!cancelled) setOverrideError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await apiGet<{ days: string[] }>('/api/holidays');
        if (!cancelled) {
          setHolidays(payload.days);
          setHolidaysError(undefined);
        }
      } catch (caught) {
        if (!cancelled) setHolidaysError(errorMessage(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const projectKeys = useMemo(
    () => [...new Set(teams.filter((team) => teamIds.includes(team.id)).flatMap((team) => team.projects))],
    [teams, teamIds.join(',')],
  );
  const { statuses, loading: statusesLoading } = useJiraStatuses(projectKeys);

  useEffect(() => {
    if (teamIds.length === 0) {
      setSprints([]);
      setSprintIds([]);
      return;
    }
    let cancelled = false;
    const force = sprintsForceRef.current;
    sprintsForceRef.current = false;
    setSprintsLoading(!force);
    void (async () => {
      try {
        const query = teamIds.map(encodeURIComponent).join(',');
        const payload = await apiGet<{ sprints: JiraSprintOption[] }>(
          `/api/jira/sprints?teamIds=${query}${force ? '&refresh=1' : ''}`,
        );
        if (cancelled) return;
        setSprints(payload.sprints);
        setSprintsError(undefined);
        setSprintIds((current) => {
          const allowed = new Set(payload.sprints.map((sprint) => sprint.id));
          const kept = current.filter((id) => allowed.has(id));
          if (kept.length > 0) return kept;
          const active = payload.sprints.filter((sprint) => sprint.state === 'active').map((sprint) => sprint.id);
          return active.length > 0 ? active : payload.sprints[0] ? [payload.sprints[0].id] : [];
        });
      } catch (caught) {
        if (cancelled) return;
        setSprintsError(errorMessage(caught));
        setSprints([]);
      } finally {
        if (!cancelled) setSprintsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamIds.join(','), sprintsTick]);

  useEffect(() => {
    setCompareSprintIds((current) => {
      if (current.length === 0) return current;
      const allowed = new Set(sprints.map((sprint) => sprint.id));
      const kept = current.filter((id) => allowed.has(id));
      if (kept.length === current.length) return current;
      writeStoredCompareIds(kept);
      return kept;
    });
  }, [sprints]);

  const selectedSprints = sprints.filter((sprint) => sprintIds.includes(sprint.id));
  const window = sprintWindow(selectedSprints);
  const compareSprints = sprints.filter((sprint) => compareSprintIds.includes(sprint.id));
  const compareWindow = sprintWindow(compareSprints);
  const compareCoveredByCurrent =
    compareSprintIds.length > 0 && compareSprintIds.every((id) => sprintIds.includes(id));

  const requests: BatchRequest[] = useMemo(() => {
    if (sprintIds.length === 0 || teamIds.length === 0) return [];
    const names = sprints
      .filter((sprint) => sprintIds.includes(sprint.id))
      .map((sprint) => sprint.name);
    const batch: BatchRequest[] = [
      {
        id: 'overview-sprints',
        scope: {
          kind: 'jql' as const,
          jql: `sprint in (${sprintIds.join(', ')})`,
          label: names.join(', '),
        },
        withChangelog: true,
        withTimeline: true,
        cycleStartStatus: startStatus,
        cycleEndStatus: endStatus,
      },
    ];
    if (compareSprintIds.length > 0 && !compareCoveredByCurrent) {
      batch.push({
        id: 'overview-compare',
        scope: {
          kind: 'jql' as const,
          jql: `sprint in (${compareSprintIds.join(', ')})`,
          label: compareSprints.map((sprint) => sprint.name).join(', ') || 'Compare',
        },
        withChangelog: true,
        withTimeline: true,
        cycleStartStatus: startStatus,
        cycleEndStatus: endStatus,
      });
    }
    return batch;
  }, [
    sprintIds.join(','),
    teamIds.join(','),
    sprints,
    startStatus,
    endStatus,
    compareSprintIds.join(','),
    compareCoveredByCurrent,
    compareSprints.map((sprint) => sprint.name).join(','),
  ]);

  const { byId, loading, refreshing, error, refresh } = useBatchMetrics(requests);
  const bugRequests: BatchRequest[] = useMemo(() => {
    if (teamIds.length === 0 || projectKeys.length === 0) return [];
    return [
      {
        id: 'overview-bugs',
        scope: { kind: 'jql' as const, jql: openBugsJql(projectKeys), label: 'Open bugs' },
      },
    ];
  }, [teamIds.join(','), projectKeys.join(',')]);
  const {
    byId: bugById,
    loading: bugsLoading,
    refreshing: bugsRefreshing,
    error: bugsError,
    refresh: refreshBugs,
  } = useBatchMetrics(bugRequests);
  const issues = useMemo(() => issuesFrom(byId['overview-sprints']), [byId]);
  const bugIssues = useMemo(() => issuesFrom(bugById['overview-bugs']), [bugById]);
  const bugs = useMemo(
    () =>
      listOpenBugs(bugIssues, {
        includeBacklog: includeBugBacklog,
        excludeStatuses: excludeBugStatuses,
      }),
    [bugIssues, includeBugBacklog, excludeBugStatuses.join('|')],
  );
  const bugStatusOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const status of statuses) names.set(status.name.toLowerCase(), status.name);
    for (const name of uniqueBugStatuses(bugIssues)) names.set(name.toLowerCase(), name);
    for (const name of excludeBugStatuses) names.set(name.toLowerCase(), name);
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [statuses, bugIssues, excludeBugStatuses.join('|')]);
  const bugsTruncated = Boolean(bugById['overview-bugs']?.model?.truncated);
  const compareEntry = byId['overview-compare'];
  const compareIssues = useMemo(() => {
    if (compareSprintIds.length === 0) return [];
    if (compareCoveredByCurrent) return issuesInSprints(issues, compareSprintIds);
    return issuesFrom(compareEntry);
  }, [compareSprintIds.join(','), compareCoveredByCurrent, issues, compareEntry]);
  const compareLoading =
    compareSprintIds.length > 0 &&
    (compareCoveredByCurrent ? loading && issues.length === 0 : !compareEntry);

  const people = useMemo(
    () => listCyclePeople(issues, { excludeQaTitle: excludeQa, excludedKeys }),
    [issues, excludeQa, excludedKeys.join(',')],
  );

  useEffect(() => {
    if (people.length === 0) return;
    setAssigneeIds((current) => {
      if (current.length === 0) return current;
      const allowed = new Set(people.map((person) => person.id));
      const kept = current.filter((id) => allowed.has(id));
      if (kept.length === 0 || kept.length === people.length) {
        if (current.length > 0) writeStoredIds(PEOPLE_STORAGE, []);
        return [];
      }
      if (kept.length === current.length) return current;
      writeStoredIds(PEOPLE_STORAGE, kept);
      return kept;
    });
  }, [people.map((person) => person.id).join(',')]);

  const overrideMaps = useMemo(() => cycleOverrideMaps(overrides), [overrides]);

  const cycleFilters = useMemo(
    () => ({
      endStatus,
      excludeQaTitle: excludeQa,
      excludedKeys,
      assigneeIds,
      startOverrides: overrideMaps.startOverrides,
      endOverrides: overrideMaps.endOverrides,
      workingDays,
      holidays,
    }),
    [endStatus, excludeQa, excludedKeys.join(','), assigneeIds.join(','), overrideMaps, workingDays, holidays.join(',')],
  );
  const compareFilters = useMemo(
    () => ({
      endStatus,
      excludeQaTitle: excludeQa,
      assigneeIds,
      startOverrides: overrideMaps.startOverrides,
      endOverrides: overrideMaps.endOverrides,
      workingDays,
      holidays,
    }),
    [endStatus, excludeQa, assigneeIds.join(','), overrideMaps, workingDays, holidays.join(',')],
  );

  const cycle = useMemo(
    () => buildCycleOverview(issues, window ? { from: window.from, to: window.to } : undefined, cycleFilters),
    [issues, window?.from, window?.to, cycleFilters],
  );
  const compareCycle = useMemo(
    () =>
      compareWindow
        ? buildCycleOverview(compareIssues, { from: compareWindow.from, to: compareWindow.to }, compareFilters)
        : undefined,
    [compareIssues, compareWindow?.from, compareWindow?.to, compareFilters],
  );

  const busy = loading || sprintsLoading;

  function addExcluded(keys: string[]) {
    if (keys.length === 0) return;
    setExcludedKeys((current) => {
      const next = [...current];
      for (const key of keys) {
        if (!next.some((item) => item.toUpperCase() === key)) next.push(key);
      }
      writeStoredKeys(next);
      return next;
    });
  }

  function removeExcluded(key: string) {
    setExcludedKeys((current) => {
      const next = current.filter((item) => item.toUpperCase() !== key.toUpperCase());
      writeStoredKeys(next);
      return next;
    });
  }

  function submitExcludedDraft() {
    const keys = parseIssueKeys(excludeDraft);
    addExcluded(keys);
    setExcludeDraft(keys.length > 0 ? '' : excludeDraft);
  }

  function rememberOverride(row: CycleOverrideRow | undefined, key: string) {
    setOverrides((current) => {
      const next = current.filter((item) => item.key !== key);
      if (row && (row.startedAt || row.endedAt)) next.push({ key: row.key, startedAt: row.startedAt, endedAt: row.endedAt });
      return next.sort((left, right) => left.key.localeCompare(right.key));
    });
  }

  async function saveOverride() {
    const keys = parseIssueKeys(overrideKeyDraft);
    if (keys.length !== 1) return;
    const body: { key: string; startedAt?: string; endedAt?: string } = { key: keys[0] };
    if (overrideStartDraft) body.startedAt = overrideStartDraft;
    if (overrideEndDraft) body.endedAt = overrideEndDraft;
    if (!body.startedAt && !body.endedAt) return;
    try {
      const payload = await apiPut<{ override: CycleOverrideRow }>('/api/cycle-overrides', body);
      rememberOverride(payload.override, payload.override.key);
      setOverrideKeyDraft('');
      setOverrideStartDraft('');
      setOverrideEndDraft('');
      setOverrideError(undefined);
    } catch (caught) {
      setOverrideError(errorMessage(caught));
    }
  }

  async function removeOverride(key: string, field?: 'start' | 'end') {
    try {
      const query = field
        ? `/api/cycle-overrides?key=${encodeURIComponent(key)}&field=${field}`
        : `/api/cycle-overrides?key=${encodeURIComponent(key)}`;
      const payload = await apiDelete<{ removed: string; override?: CycleOverrideRow }>(query);
      rememberOverride(payload.override, payload.removed);
      setOverrideError(undefined);
    } catch (caught) {
      setOverrideError(errorMessage(caught));
    }
  }

  function prefillOverride(key: string) {
    setOverrideKeyDraft(key);
    const existing = overrides.find((row) => row.key.toUpperCase() === key.trim().toUpperCase());
    setOverrideStartDraft(existing?.startedAt ? isoToDatetimeLocal(existing.startedAt) : '');
    setOverrideEndDraft(existing?.endedAt ? isoToDatetimeLocal(existing.endedAt) : '');
    setOverrideOpen(true);
  }

  async function addHolidayDate() {
    const day = holidayDraft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    try {
      const payload = await apiPut<{ days: string[] }>('/api/holidays', { day });
      setHolidays(payload.days);
      setHolidayDraft('');
      setHolidaysError(undefined);
    } catch (caught) {
      setHolidaysError(errorMessage(caught));
    }
  }

  async function removeHolidayDate(day: string) {
    try {
      const payload = await apiDelete<{ days: string[] }>(`/api/holidays?day=${encodeURIComponent(day)}`);
      setHolidays(payload.days);
      setHolidaysError(undefined);
    } catch (caught) {
      setHolidaysError(errorMessage(caught));
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>Team Overview</h1>
          <div className="page-header-sub">
            Cycle time по выбранным статусам. Считаются только Bug, Task, Story и Spike.
          </div>
        </div>
      </header>

      <div className="row">
        <CheckDropdown
          label="Teams"
          summary={teamSummary(teams, teamIds)}
          disabled={busy && teamIds.length === 0}
        >
          {teams.map((team) => (
            <label key={team.id}>
              <input
                type="radio"
                name="overview-team"
                checked={teamIds[0] === team.id}
                onChange={() => setTeamIds([team.id])}
              />
              <span>{team.name}</span>
            </label>
          ))}
        </CheckDropdown>

        <CheckDropdown
          label="Sprints"
          summary={sprintSummary(sprints, sprintIds)}
          disabled={sprintsLoading}
        >
          {sprints.length === 0 && <span className="caption">No sprints on the selected boards.</span>}
          {sprints.map((sprint) => (
            <label key={sprint.id}>
              <input
                type="checkbox"
                checked={sprintIds.includes(sprint.id)}
                onChange={() =>
                  setSprintIds((current) =>
                    toggle(current, sprint.id, current.length === 1 && current[0] === sprint.id),
                  )
                }
              />
              <span>
                {sprint.name}
                {sprint.startDate ? ` · ${sprint.startDate.slice(0, 10)}` : ''}
                {sprint.endDate ? `–${sprint.endDate.slice(0, 10)}` : ''}
              </span>
            </label>
          ))}
        </CheckDropdown>

        {window && (
          <span className="caption">
            {window.from} → {window.to}
          </span>
        )}
        <SnapshotBar
          queriedAt={byId['overview-sprints']?.model?.queriedAt}
          fromCache={byId['overview-sprints']?.model?.fromCache}
          refreshing={refreshing || bugsRefreshing || sprintsLoading}
          onRefresh={() => {
            sprintsForceRef.current = true;
            setSprintsTick((value) => value + 1);
            refresh();
            refreshBugs();
          }}
        />
      </div>

      {sprintsError && <ErrorNotice error={sprintsError} />}
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {bugsError && <ErrorNotice error={bugsError} onRetry={refreshBugs} />}
      {overrideError && <ErrorNotice error={overrideError} />}
      {holidaysError && <ErrorNotice error={holidaysError} />}
      {busy && issues.length === 0 && <LoadingCards count={1} />}

      {(!busy || issues.length > 0) && (
        <Card title="Cycle time">
          <div className="cycle-toolbar">
            <CycleDefinition
              statuses={statuses}
              loading={statusesLoading}
              startStatus={startStatus}
              endStatus={endStatus}
              onStart={(value) => {
                setStartStatus(value);
                writeStoredStatus(START_STORAGE, value);
              }}
              onEnd={(value) => {
                setEndStatus(value);
                writeStoredStatus(END_STORAGE, value);
              }}
            />
            <CheckDropdown
              label="Сравнить с"
              summary={compareSummary(sprints, compareSprintIds)}
              disabled={sprintsLoading || sprints.length === 0}
            >
              {sprints.length === 0 && <span className="caption">No sprints on the selected boards.</span>}
              {sprints.map((sprint) => (
                <label key={sprint.id}>
                  <input
                    type="checkbox"
                    checked={compareSprintIds.includes(sprint.id)}
                    onChange={() =>
                      setCompareSprintIds((current) => {
                        const next = toggle(current, sprint.id, false);
                        writeStoredCompareIds(next);
                        return next;
                      })
                    }
                  />
                  <span>
                    {sprint.name}
                    {sprint.startDate ? ` · ${sprint.startDate.slice(0, 10)}` : ''}
                    {sprint.endDate ? `–${sprint.endDate.slice(0, 10)}` : ''}
                    {sprintIds.includes(sprint.id) ? ' · выбран' : ''}
                  </span>
                </label>
              ))}
            </CheckDropdown>
            <CheckDropdown
              label="Люди"
              summary={personSummary(people, assigneeIds)}
              disabled={people.length === 0}
            >
              <label>
                <input
                  type="radio"
                  name="overview-people"
                  checked={assigneeIds.length === 0}
                  onChange={() => {
                    setAssigneeIds([]);
                    writeStoredIds(PEOPLE_STORAGE, []);
                  }}
                />
                <span>Все</span>
              </label>
              {people.map((person) => (
                <label key={person.id}>
                  <input
                    type="radio"
                    name="overview-people"
                    checked={assigneeIds.length === 1 && assigneeIds[0] === person.id}
                    onChange={() => {
                      setAssigneeIds([person.id]);
                      writeStoredIds(PEOPLE_STORAGE, [person.id]);
                    }}
                  />
                  <span>{person.name}</span>
                </label>
              ))}
            </CheckDropdown>
            <Segmented<'calendar' | 'working'>
              value={workingDays ? 'working' : 'calendar'}
              options={[
                { value: 'calendar', label: 'Календарные' },
                { value: 'working', label: 'Рабочие' },
              ]}
              onChange={(value) => {
                const next = value === 'working';
                setWorkingDays(next);
                writeStoredFlag(WORKING_STORAGE, next);
              }}
            />
            <button type="button" className="cycle-toolbar-btn" onClick={() => setHolidaysOpen(true)}>
              Праздники ({holidays.length})
            </button>
            <button type="button" className="cycle-toolbar-btn" onClick={() => setExcludeOpen(true)}>
              Исключения ({excludedKeys.length})
            </button>
            <button type="button" className="cycle-toolbar-btn" onClick={() => setOverrideOpen(true)}>
              Override ({overrides.length})
            </button>
          </div>
          {!window ? (
            <span className="caption">Pick at least one sprint.</span>
          ) : (
            <CycleTimeSection
              cycle={cycle}
              endStatus={endStatus}
              compareLabel={compareSprintIds.length > 0 ? compareSummary(sprints, compareSprintIds) : undefined}
              compare={compareCycle}
              compareLoading={compareLoading}
              onExclude={addExcluded}
              onPrefillOverride={prefillOverride}
            />
          )}
          <ExcludeDialog
            open={excludeOpen}
            keys={excludedKeys}
            draft={excludeDraft}
            onClose={() => setExcludeOpen(false)}
            onDraft={setExcludeDraft}
            onSubmit={submitExcludedDraft}
            onRestore={removeExcluded}
          />
          <OverrideDialog
            open={overrideOpen}
            rows={overrides}
            keyDraft={overrideKeyDraft}
            startDraft={overrideStartDraft}
            endDraft={overrideEndDraft}
            onClose={() => setOverrideOpen(false)}
            onKeyDraft={setOverrideKeyDraft}
            onStartDraft={setOverrideStartDraft}
            onEndDraft={setOverrideEndDraft}
            onSave={saveOverride}
            onRemove={removeOverride}
          />
          <HolidaysDialog
            open={holidaysOpen}
            days={holidays}
            draft={holidayDraft}
            onClose={() => setHolidaysOpen(false)}
            onDraft={setHolidayDraft}
            onSubmit={addHolidayDate}
            onRestore={removeHolidayDate}
          />
        </Card>
      )}

      {(!bugsLoading || bugIssues.length > 0) && (
        <Card
          title="Баги"
          caption="Открытые баги выбранной команды, без спринта."
          actions={
            <div className="bug-list-actions">
              <CheckDropdown
                label="Исключить статусы"
                summary={excludeStatusSummary(excludeBugStatuses)}
                disabled={statusesLoading && bugStatusOptions.length === 0}
              >
                {bugStatusOptions.length === 0 && <span className="caption">Нет статусов.</span>}
                {bugStatusOptions.map((status) => (
                  <label key={status}>
                    <input
                      type="checkbox"
                      checked={excludeBugStatuses.includes(status)}
                      onChange={() =>
                        setExcludeBugStatuses((current) => {
                          const next = toggle(current, status, false);
                          writeStoredIds(BUG_STATUSES_STORAGE, next);
                          return next;
                        })
                      }
                    />
                    <span>{status}</span>
                  </label>
                ))}
              </CheckDropdown>
              <label className="cycle-qa-filter">
                <input
                  type="checkbox"
                  checked={includeBugBacklog}
                  onChange={(event) => {
                    setIncludeBugBacklog(event.target.checked);
                    writeStoredFlag(BUG_BACKLOG_STORAGE, event.target.checked);
                  }}
                />
                <span>С бэклогом</span>
              </label>
            </div>
          }
        >
          <BugListPanel
            items={bugs}
            truncated={bugsTruncated}
            includeBacklog={includeBugBacklog}
            excludingStatuses={excludeBugStatuses.length > 0}
          />
        </Card>
      )}
    </div>
  );
}

function CycleDefinition({
  statuses,
  loading,
  startStatus,
  endStatus,
  onStart,
  onEnd,
}: {
  statuses: JiraStatusOption[];
  loading: boolean;
  startStatus: string;
  endStatus: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
}) {
  return (
    <div className="cycle-def">
      <span>первый переход в</span>
      <StatusSelect
        statuses={statuses}
        value={startStatus}
        disabled={loading}
        onChange={onStart}
        fallback={DEFAULT_CYCLE_START_STATUS}
      />
      <span>→ первый переход в</span>
      <StatusSelect
        statuses={statuses}
        value={endStatus}
        disabled={loading}
        onChange={onEnd}
        fallback={ENGINEERING_DONE_STATUS}
      />
    </div>
  );
}

function StatusSelect({
  statuses,
  value,
  disabled,
  onChange,
  fallback,
}: {
  statuses: JiraStatusOption[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  fallback: string;
}) {
  const options = statuses.some((status) => status.name === value)
    ? statuses
    : value
      ? [{ id: `extra-${value}`, name: value, category: 'unknown' as const }, ...statuses]
      : statuses;
  return (
    <select
      className="cycle-def-select"
      value={value || fallback}
      disabled={disabled || options.length === 0}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((status) => (
        <option key={status.id} value={status.name}>
          {status.name}
        </option>
      ))}
    </select>
  );
}

function CycleTimeSection({
  cycle,
  endStatus,
  compareLabel,
  compare,
  compareLoading,
  onExclude,
  onPrefillOverride,
}: {
  cycle: ReturnType<typeof buildCycleOverview>;
  endStatus: string;
  compareLabel?: string;
  compare?: ReturnType<typeof buildCycleOverview>;
  compareLoading?: boolean;
  onExclude: (keys: string[]) => void;
  onPrefillOverride: (key: string) => void;
}) {
  const medianCompare = compareLabel
    ? compareLoading
      ? { text: 'загрузка…', short: 'загрузка…', tone: 'neutral' as const }
      : formatCycleCompare(cycle.median, compare?.median ?? null, compareLabel)
    : undefined;
  const medianDevCompare = compareLabel
    ? compareLoading
      ? { text: 'загрузка…', short: 'загрузка…', tone: 'neutral' as const }
      : formatCycleCompare(cycle.medianWithoutQa, compare?.medianWithoutQa ?? null, compareLabel)
    : undefined;
  const medianQaCompare = compareLabel
    ? compareLoading
      ? { text: 'загрузка…', short: 'загрузка…', tone: 'neutral' as const }
      : formatCycleCompare(cycle.medianQa, compare?.medianQa ?? null, compareLabel)
    : undefined;
  const p85Compare = compareLabel
    ? compareLoading
      ? { text: 'загрузка…', short: 'загрузка…', tone: 'neutral' as const }
      : formatCycleCompare(cycle.p85, compare?.p85 ?? null, compareLabel)
    : undefined;
  const p85DevCompare = compareLabel
    ? compareLoading
      ? { text: 'загрузка…', short: 'загрузка…', tone: 'neutral' as const }
      : formatCycleCompare(cycle.p85WithoutQa, compare?.p85WithoutQa ?? null, compareLabel)
    : undefined;
  const p85QaCompare = compareLabel
    ? compareLoading
      ? { text: 'загрузка…', short: 'загрузка…', tone: 'neutral' as const }
      : formatCycleCompare(cycle.p85Qa, compare?.p85Qa ?? null, compareLabel)
    : undefined;

  return (
    <div className="cycle-split">
      <div className="stack cycle-main" style={{ gap: 12 }}>
        <div className="stat-bar cycle-stats">
          {cycle.cards.map((card) => {
            const compared =
              card.label === 'Median CT'
                ? medianCompare
                : card.label === 'P85 CT'
                  ? p85Compare
                  : undefined;
            return (
              <div
                key={card.label}
                className={`stat${compared?.tone && compared.tone !== 'neutral' ? ` tone-${compared.tone}` : ''}`}
              >
                <span className="stat-label">{card.label}</span>
                <span className="stat-value">{card.value}</span>
                {compared && (
                  <span className={`stat-compare tone-${compared.tone}`}>{compared.text}</span>
                )}
                {card.splits && card.splits.length > 0 ? (
                  <span className="stat-splits">
                    {card.splits.map((split) => {
                      const splitCompared =
                        card.label === 'Median CT'
                          ? split.label === 'without QA'
                            ? medianDevCompare
                            : medianQaCompare
                          : card.label === 'P85 CT'
                            ? split.label === 'without QA'
                              ? p85DevCompare
                              : p85QaCompare
                            : undefined;
                      return (
                        <span
                          key={split.label}
                          className={`stat-split${split.label === 'QA' ? ' stat-split-qa' : ' stat-split-dev'}`}
                          title={split.hint}
                        >
                          <span className="stat-split-label">{split.label}</span>
                          <span className="stat-split-value">{split.value}</span>
                          {splitCompared && (
                            <span className={`stat-split-compare tone-${splitCompared.tone}`}>
                              {splitCompared.short}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span className="stat-hint">{card.hint}</span>
                )}
              </div>
            );
          })}
        </div>
        {cycle.bars.length > 0 ? (
          <CycleTimeBarChart
            bars={cycle.bars}
            median={cycle.median}
            p85={cycle.p85}
            endStatus={endStatus}
            onExclude={(key) => onExclude([key])}
            onOverrideStart={onPrefillOverride}
          />
        ) : (
          <div className="empty">{cycle.emptyMessage ?? CYCLE_EMPTY_MESSAGE}</div>
        )}
      </div>
      <div className="cycle-side">
        <OldestWipPanel items={cycle.oldestWip} />
      </div>
    </div>
  );
}

function ExcludeDialog({
  open,
  keys,
  draft,
  onClose,
  onDraft,
  onSubmit,
  onRestore,
}: {
  open: boolean;
  keys: string[];
  draft: string;
  onClose: () => void;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onRestore: (key: string) => void;
}) {
  return (
    <Modal open={open} title="Исключения" onClose={onClose}>
      <p className="caption">
        Не входят в Median CT, P85 CT, Завершено, WIP, график и Oldest WIP. × на полосе тоже убирает задачу.
      </p>
      <form
        className="cycle-exclude-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          type="text"
          value={draft}
          placeholder="CDR-2029, CDR-2038"
          aria-label="Ключи задач для исключения"
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="submit" className="cycle-exclude-add" disabled={!parseIssueKeys(draft).length}>
          Добавить
        </button>
      </form>
      {keys.length === 0 ? (
        <p className="caption">Пока пусто.</p>
      ) : (
        <ul className="cycle-exclude-list">
          {keys.map((key) => (
            <li key={key}>
              <span className="cycle-chart-key">{key}</span>
              <button type="button" className="cycle-exclude-restore" onClick={() => onRestore(key)}>
                вернуть
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function OverrideDialog({
  open,
  rows,
  keyDraft,
  startDraft,
  endDraft,
  onClose,
  onKeyDraft,
  onStartDraft,
  onEndDraft,
  onSave,
  onRemove,
}: {
  open: boolean;
  rows: CycleOverrideRow[];
  keyDraft: string;
  startDraft: string;
  endDraft: string;
  onClose: () => void;
  onKeyDraft: (value: string) => void;
  onStartDraft: (value: string) => void;
  onEndDraft: (value: string) => void;
  onSave: () => void;
  onRemove: (key: string, field?: 'start' | 'end') => void;
}) {
  const canSave = parseIssueKeys(keyDraft).length === 1 && Boolean(startDraft || endDraft);
  return (
    <Modal open={open} title="Override дат" onClose={onClose}>
      <p className="caption">
        Подменяет старт и/или конец для Median CT, P85 CT и графика. Окно спринта, Oldest WIP и WIP не меняются.
        Пустое поле при сохранении не затирает вторую дату.
      </p>
      <form
        className="cycle-override-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <input
          type="text"
          value={keyDraft}
          placeholder="CDR-2029"
          aria-label="Ключ задачи для override дат"
          onChange={(event) => onKeyDraft(event.target.value)}
        />
        <label className="cycle-override-field">
          <span className="caption">Старт</span>
          <input
            type="datetime-local"
            value={startDraft}
            aria-label="Новый старт cycle time"
            onChange={(event) => onStartDraft(event.target.value)}
          />
        </label>
        <label className="cycle-override-field">
          <span className="caption">Конец</span>
          <input
            type="datetime-local"
            value={endDraft}
            aria-label="Новый конец cycle time"
            onChange={(event) => onEndDraft(event.target.value)}
          />
        </label>
        <button type="submit" className="cycle-exclude-add" disabled={!canSave}>
          Сохранить
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="caption">Пока пусто.</p>
      ) : (
        <ul className="cycle-exclude-list">
          {rows.map((row) => (
            <li key={row.key}>
              <span>
                <span className="cycle-chart-key">{row.key}</span>
                <span className="oldest-wip-meta">
                  {' '}
                  {row.startedAt ? `старт ${formatOverrideStamp(row.startedAt)}` : 'старт —'}
                  {' · '}
                  {row.endedAt ? `конец ${formatOverrideStamp(row.endedAt)}` : 'конец —'}
                </span>
              </span>
              <span className="cycle-override-actions">
                {row.startedAt && (
                  <button type="button" className="cycle-exclude-restore" onClick={() => onRemove(row.key, 'start')}>
                    старт
                  </button>
                )}
                {row.endedAt && (
                  <button type="button" className="cycle-exclude-restore" onClick={() => onRemove(row.key, 'end')}>
                    конец
                  </button>
                )}
                <button type="button" className="cycle-exclude-restore" onClick={() => onRemove(row.key)}>
                  сбросить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function HolidaysDialog({
  open,
  days,
  draft,
  onClose,
  onDraft,
  onSubmit,
  onRestore,
}: {
  open: boolean;
  days: string[];
  draft: string;
  onClose: () => void;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onRestore: (day: string) => void;
}) {
  return (
    <Modal open={open} title="Праздники" onClose={onClose}>
      <p className="caption">
        Эти даты не считаются в режиме «Рабочие». Суббота и воскресенье уже исключены. Список не копируется на другие
        годы.
      </p>
      <form
        className="cycle-exclude-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          type="date"
          value={draft}
          aria-label="Дата праздника"
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="submit" className="cycle-exclude-add" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(draft)}>
          Добавить
        </button>
      </form>
      {days.length === 0 ? (
        <p className="caption">Пока пусто.</p>
      ) : (
        <ul className="cycle-exclude-list">
          {days.map((day) => (
            <li key={day}>
              <span className="cycle-chart-key">{day}</span>
              <button type="button" className="cycle-exclude-restore" onClick={() => onRestore(day)}>
                сбросить
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function OldestWipPanel({ items }: { items: OldestWipItem[] }) {
  return (
    <aside className="cycle-exclude">
      <div className="cycle-exclude-title">Oldest WIP</div>
      {items.length === 0 ? (
        <p className="caption">Нет задач в разработке или Ready to QA.</p>
      ) : (
        <ul className="oldest-wip-list">
          {items.map((item) => (
            <li key={item.key}>
              <div className="oldest-wip-head">
                <a className="cycle-chart-key" href={item.url} target="_blank" rel="noreferrer">
                  {item.key}
                </a>
                <span className="oldest-wip-age">{formatCycleDuration(item.ageDays)}</span>
              </div>
              <div className="oldest-wip-meta">
                {item.assigneeName}
                {item.status ? ` · ${item.status}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function BugListPanel({
  items,
  truncated,
  includeBacklog,
  excludingStatuses,
}: {
  items: BugListItem[];
  truncated: boolean;
  includeBacklog: boolean;
  excludingStatuses: boolean;
}) {
  const [ageSort, setAgeSort] = useState<BugAgeSort>('oldest');
  const rows = useMemo(() => sortBugsByAge(items, ageSort), [items, ageSort]);
  if (items.length === 0) {
    return (
      <p className="caption">
        {excludingStatuses
          ? 'Нет открытых багов с выбранными фильтрами.'
          : includeBacklog
            ? 'Нет открытых багов.'
            : 'Нет открытых багов вне бэклога.'}
      </p>
    );
  }
  const newestFirst = ageSort === 'newest';
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap bug-list-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ключ</th>
              <th>Название</th>
              <th>Приоритет</th>
              <th className="num">SP</th>
              <th>Статус</th>
              <th>Автор</th>
              <th>Исполнитель</th>
              <th>Создан</th>
              <th className="num" aria-sort={newestFirst ? 'ascending' : 'descending'}>
                <button
                  type="button"
                  className="bug-sort"
                  onClick={() => setAgeSort(newestFirst ? 'oldest' : 'newest')}
                >
                  Возраст {newestFirst ? '↑' : '↓'}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key}>
                <td className="tight">
                  <a className="issue-key" href={item.url} target="_blank" rel="noreferrer">
                    {item.key}
                  </a>
                </td>
                <td>
                  <span className="truncate" title={item.summary}>
                    {item.summary}
                  </span>
                </td>
                <td className="tight">{item.priority ?? '—'}</td>
                <td className="num">{formatBugPoints(item.storyPoints)}</td>
                <td className="tight">{item.status}</td>
                <td className="tight">{item.reporterName || '—'}</td>
                <td className="tight">{item.assigneeName || '—'}</td>
                <td className="tight">{formatBugCreated(item.created)}</td>
                <td className="num">{formatCycleDuration(item.ageDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && <p className="caption">Список обрезан лимитом ответа Jira.</p>}
    </div>
  );
}

function CheckDropdown({
  label,
  summary,
  disabled,
  children,
}: {
  label: string;
  summary: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="cycle-filter">
      <span className="caption">{label}</span>
      <details className="check-drop">
        <summary className="check-drop-summary">{summary}</summary>
        <div className="check-drop-menu checklist">{children}</div>
      </details>
    </div>
  );
}

function toggle<T>(current: T[], value: T, locked: boolean): T[] {
  if (current.includes(value)) return locked ? current : current.filter((item) => item !== value);
  return [...current, value];
}

function teamSummary(teams: Team[], ids: string[]): string {
  if (ids.length === 0) return 'Select teams';
  if (ids.length === 1) return teams.find((team) => team.id === ids[0])?.name ?? '1 team';
  return `${ids.length} teams`;
}

function sprintSummary(sprints: JiraSprintOption[], ids: number[]): string {
  if (ids.length === 0) return 'Select sprints';
  if (ids.length === 1) return sprints.find((sprint) => sprint.id === ids[0])?.name ?? '1 sprint';
  return `${ids.length} sprints`;
}

function excludeStatusSummary(names: string[]): string {
  if (names.length === 0) return 'Не исключать';
  if (names.length === 1) return names[0];
  const n10 = names.length % 10;
  const n100 = names.length % 100;
  if (n10 === 1 && n100 !== 11) return `${names.length} статус`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${names.length} статуса`;
  return `${names.length} статусов`;
}

function compareSummary(sprints: JiraSprintOption[], ids: number[]): string {
  if (ids.length === 0) return 'Не сравнивать';
  if (ids.length === 1) return sprints.find((sprint) => sprint.id === ids[0])?.name ?? '1 спринт';
  const n10 = ids.length % 10;
  const n100 = ids.length % 100;
  if (n10 === 1 && n100 !== 11) return `${ids.length} спринт`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${ids.length} спринта`;
  return `${ids.length} спринтов`;
}

function personSummary(people: CyclePerson[], ids: string[]): string {
  if (ids.length === 0 || ids.length === people.length) return 'Все';
  if (ids.length === 1) return people.find((person) => person.id === ids[0])?.name ?? '1 чел.';
  return `${ids.length} чел.`;
}

function sprintWindow(sprints: JiraSprintOption[]): { from: string; to: string; days: number } | undefined {
  if (sprints.length === 0) return undefined;
  const starts = sprints.map((sprint) => sprint.startDate?.slice(0, 10)).filter(Boolean) as string[];
  const ends = sprints
    .map((sprint) => sprintEndDay(sprint))
    .filter(Boolean) as string[];
  if (starts.length === 0) return undefined;
  const from = starts.reduce((min, day) => (day < min ? day : min));
  const today = localDayKey(new Date());
  const rawTo = ends.length > 0 ? ends.reduce((max, day) => (day > max ? day : max)) : today;
  const to = rawTo > today ? today : rawTo;
  const days = Math.max(1, diffDays(from, to) + 1);
  return { from, to, days };
}

function sprintEndDay(sprint: JiraSprintOption): string | undefined {
  const days = [sprint.endDate, sprint.completeDate]
    .map((value) => value?.slice(0, 10))
    .filter(Boolean) as string[];
  if (days.length === 0) return undefined;
  return days.reduce((max, day) => (day > max ? day : max));
}

function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function readStoredStatus(key: string): string | undefined {
  try {
    const value = window.localStorage.getItem(key)?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredStatus(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function readStoredFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode */
  }
}

function readStoredKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(KEYS_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parseIssueKeys(parsed.filter((item): item is string => typeof item === 'string').join(' '));
  } catch {
    return [];
  }
}

function writeStoredKeys(keys: string[]): void {
  try {
    window.localStorage.setItem(KEYS_STORAGE, JSON.stringify(keys.slice(0, 200)));
  } catch {
    /* private mode */
  }
}

function readStoredIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))].slice(
      0,
      200,
    );
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, ids: string[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(ids.slice(0, 200)));
  } catch {
    /* private mode */
  }
}

function readStoredCompareIds(): number[] {
  try {
    const raw = window.localStorage.getItem(COMPARE_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is number => typeof item === 'number' && Number.isInteger(item));
      }
    }
    const legacy = window.localStorage.getItem(COMPARE_STORAGE_LEGACY);
    if (!legacy) return [];
    const parsed = Number(legacy);
    return Number.isInteger(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

function writeStoredCompareIds(ids: number[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(COMPARE_STORAGE);
    else window.localStorage.setItem(COMPARE_STORAGE, JSON.stringify(ids.slice(0, 50)));
    window.localStorage.removeItem(COMPARE_STORAGE_LEGACY);
  } catch {
    /* private mode */
  }
}

function issuesFrom(entry: { model?: { issues?: NormalizedIssue[] } } | undefined): NormalizedIssue[] {
  return entry?.model?.issues ?? [];
}

function issuesInSprints(issues: NormalizedIssue[], ids: number[]): NormalizedIssue[] {
  const allowed = new Set(ids);
  return issues.filter((issue) => issue.sprintIds.some((id) => allowed.has(id)));
}

function isoToDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatOverrideStamp(iso: string): string {
  const local = isoToDatetimeLocal(iso);
  return local ? local.replace('T', ' ') : iso.slice(0, 16).replace('T', ' ');
}
