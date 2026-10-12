'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { PredictabilityHistory } from '@frontend/components/predictability/PredictabilityHistory';
import { PredictabilityBreakdown } from '@frontend/components/predictability/PredictabilityBreakdown';
import { PredictabilityCards } from '@frontend/components/predictability/PredictabilityCards';
import { PredictabilityScopeChange } from '@frontend/components/predictability/PredictabilityScopeChange';
import { PredictabilityTaskTable } from '@frontend/components/predictability/PredictabilityTaskTable';
import { RequireSetup } from '@frontend/components/Guards';
import { Callout, Card, ErrorNotice, Hint, LoadingCards, Modal, Pill, Segmented, SnapshotBar } from '@frontend/components/ui';
import { useAppData } from '@frontend/lib/app-data';
import { effectiveExcludeQa } from '@frontend/lib/exclude-qa-title';
import { useJiraStatuses } from '@frontend/lib/use-jira-statuses';
import { usePredictability } from '@frontend/lib/use-predictability';
import { apiGet, errorMessage } from '@frontend/lib/api';
import { formatStoryPoints, parseIssueKeys, type CyclePerson } from '@backend/metrics/cycle-overview';
import { metricHints } from '@backend/metrics/predictability-copy';
import { DEFAULT_CYCLE_START_STATUS, ENGINEERING_DONE_STATUS } from '@backend/metrics/rules';
import type { PredictabilityCategory, PredictabilitySnapshot } from '@backend/metrics/predictability-model';
import type { JiraSprintOption, JiraStatusOption, Team } from '@shared/types';

const START_STORAGE = 'cycle-overview.startStatus';
const END_STORAGE = 'cycle-overview.endStatus';
const KEYS_STORAGE = 'cycle-overview.excludedKeys';
const PEOPLE_STORAGE = 'predictability.assigneeIds';
const SPRINT_STORAGE = 'predictability.sprintId';
const COMPARE_STORAGE = 'predictability.compareSprintId';
const HISTORY_STORAGE = 'predictability.historySprints';
const HISTORY_OPTIONS = [3, 6, 8, 12] as const;

export default function PredictabilityPage() {
  return (
    <RequireSetup>
      <PredictabilityScreen />
    </RequireSetup>
  );
}

function PredictabilityScreen() {
  const { t } = useI18n();
  const { teams, rules } = useAppData();
  const [teamIds, setTeamIds] = useState<string[]>(() => (teams[0] ? [teams[0].id] : []));
  const [sprints, setSprints] = useState<JiraSprintOption[]>([]);
  const [sprintId, setSprintId] = useState<number | undefined>(() => readStoredNumber(SPRINT_STORAGE));
  const [compareSprintId, setCompareSprintId] = useState<number | undefined>(() => readStoredNumber(COMPARE_STORAGE));
  const [historySprints, setHistorySprints] = useState(() => readStoredHistory());
  const [sprintsError, setSprintsError] = useState<string | undefined>();
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsTick, setSprintsTick] = useState(0);
  const sprintsForceRef = useRef(false);
  const [startStatus, setStartStatus] = useState(() => readStoredStatus(START_STORAGE) ?? DEFAULT_CYCLE_START_STATUS);
  const [endStatus, setEndStatus] = useState(() => readStoredStatus(END_STORAGE) ?? ENGINEERING_DONE_STATUS);
  const excludeQa = effectiveExcludeQa(rules);
  const [excludedKeys, setExcludedKeys] = useState<string[]>(() => readStoredKeys());
  const [excludeDraft, setExcludeDraft] = useState('');
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => readStoredIds(PEOPLE_STORAGE));
  const [unit, setUnit] = useState<'tasks' | 'sp'>('tasks');
  const [category, setCategory] = useState<PredictabilityCategory | undefined>();

  useEffect(() => {
    setTeamIds((current) => {
      const valid = current.filter((id) => teams.some((team) => team.id === id));
      if (valid.length === 0 && teams[0]) return [teams[0].id];
      if (valid.length > 1) return [valid[0]];
      return valid.length === current.length ? current : valid;
    });
  }, [teams]);

  const projectKeys = useMemo(
    () => [...new Set(teams.filter((team) => teamIds.includes(team.id)).flatMap((team) => team.projects))],
    [teams, teamIds.join(',')],
  );
  const { statuses, loading: statusesLoading } = useJiraStatuses(projectKeys);

  useEffect(() => {
    if (teamIds.length === 0) {
      setSprints([]);
      setSprintId(undefined);
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
        setSprintId((current) => {
          const allowed = new Set(payload.sprints.map((sprint) => sprint.id));
          if (current && allowed.has(current)) return current;
          const stored = readStoredNumber(SPRINT_STORAGE);
          if (stored && allowed.has(stored)) return stored;
          const active = payload.sprints.find((sprint) => sprint.state === 'active');
          const next = active?.id ?? payload.sprints[0]?.id;
          if (next) writeStoredNumber(SPRINT_STORAGE, next);
          return next;
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

  const request = useMemo(
    () =>
      teamIds.length && sprintId
        ? {
            teamIds,
            sprintId,
            compareSprintId,
            historySprints,
            cycleStartStatus: startStatus,
            cycleEndStatus: endStatus,
            excludeQaTitle: excludeQa,
            excludedKeys,
          }
        : undefined,
    [teamIds.join(','), sprintId, compareSprintId, historySprints, startStatus, endStatus, excludeQa, excludedKeys.join(',')],
  );
  const { snapshot, people, queriedAt, fromCache, loading, refreshing, error, refresh } = usePredictability(request);
  useEffect(() => {
    if (people.length === 0) return;
    const allowed = new Set(people.map((person) => person.id));
    const next = assigneeIds.filter((id) => allowed.has(id)).slice(0, 1);
    if (next.join(',') === assigneeIds.join(',')) return;
    setAssigneeIds(next);
    writeStoredIds(PEOPLE_STORAGE, next);
  }, [people, assigneeIds.join(',')]);

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

  const selectedSprint = sprints.find((sprint) => sprint.id === sprintId);

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>{t('Predictability', 'Предсказуемость')}</h1>
          <div className="page-header-sub">
            {t(
              'Initial commitment, scope change, completion, and carry-overs.',
              'Первоначальные обязательства, изменение scope, выполнение и переносы.',
            )}
          </div>
        </div>
      </header>

      <div className="row">
        <CheckDropdown label={t('Teams', 'Команды')} summary={teamSummary(teams, teamIds, t)}>
          {teams.map((team) => (
            <label key={team.id}>
              <input
                type="radio"
                name="predictability-team"
                checked={teamIds[0] === team.id}
                onChange={() => setTeamIds([team.id])}
              />
              <span>{team.name}</span>
            </label>
          ))}
        </CheckDropdown>
        <CheckDropdown
          label={t('Sprint', 'Спринт')}
          summary={selectedSprint?.name ?? t('Select a sprint', 'Выберите спринт')}
          disabled={sprintsLoading}
        >
          {sprints.map((sprint) => (
            <label key={sprint.id}>
              <input
                type="radio"
                name="predictability-sprint"
                checked={sprintId === sprint.id}
                onChange={() => {
                  setSprintId(sprint.id);
                  writeStoredNumber(SPRINT_STORAGE, sprint.id);
                  setCategory(undefined);
                }}
              />
              <span>
                {sprint.name}
                {sprint.state === 'active' ? t(' · active', ' · активный') : ''}
                {sprint.startDate ? ` · ${sprint.startDate.slice(0, 10)}` : ''}
              </span>
            </label>
          ))}
        </CheckDropdown>
        <CheckDropdown
          label={t('Compare with', 'Сравнить с')}
          summary={compareSummary(sprints, compareSprintId, t)}
          disabled={sprintsLoading || sprints.length === 0}
        >
          <label>
            <input
              type="radio"
              name="predictability-compare"
              checked={!compareSprintId}
              onChange={() => {
                setCompareSprintId(undefined);
                writeStoredNumber(COMPARE_STORAGE, undefined);
              }}
            />
            <span>{t('Do not compare', 'Не сравнивать')}</span>
          </label>
          {sprints
            .filter((sprint) => sprint.id !== sprintId)
            .map((sprint) => (
              <label key={sprint.id}>
                <input
                  type="radio"
                  name="predictability-compare"
                  checked={compareSprintId === sprint.id}
                  onChange={() => {
                    setCompareSprintId(sprint.id);
                    writeStoredNumber(COMPARE_STORAGE, sprint.id);
                  }}
                />
                <span>{sprint.name}</span>
              </label>
            ))}
        </CheckDropdown>
        <SnapshotBar
          queriedAt={queriedAt}
          fromCache={fromCache}
          refreshing={refreshing || sprintsLoading}
          onRefresh={() => {
            sprintsForceRef.current = true;
            setSprintsTick((value) => value + 1);
            refresh();
          }}
        />
      </div>

      <div className="cycle-toolbar">
        <label className="cycle-filter">
          <span className="caption">{t('Start', 'Старт')}</span>
          <StatusSelect
            statuses={statuses}
            value={startStatus}
            disabled={statusesLoading}
            onChange={(value) => {
              setStartStatus(value);
              writeStoredStatus(START_STORAGE, value);
            }}
            fallback={DEFAULT_CYCLE_START_STATUS}
          />
        </label>
        <label className="cycle-filter">
          <span className="caption">{t('Review', 'Проверка')}</span>
          <StatusSelect
            statuses={statuses}
            value={endStatus}
            disabled={statusesLoading}
            onChange={(value) => {
              setEndStatus(value);
              writeStoredStatus(END_STORAGE, value);
            }}
            fallback={ENGINEERING_DONE_STATUS}
          />
        </label>
        <button type="button" className="text-button" onClick={() => setExcludeOpen(true)}>
          {t('Exclusions', 'Исключения')}
          {excludedKeys.length ? ` (${excludedKeys.length})` : ''}
        </button>
      </div>

      {sprintsError && <ErrorNotice error={sprintsError} />}
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {loading && !snapshot && <LoadingCards count={4} />}

      {snapshot && (
        <>
          <QualityBanner snapshot={snapshot} />
          <PredictabilityCards snapshot={snapshot} />
          {snapshot.comparison && <ComparisonCard snapshot={snapshot} />}
          <Card
            title={t('Sprint history', 'История спринтов')}
            caption={t(
              'Throughput, scope added/drop, and done total for the latest board sprints. The selected sprint is highlighted.',
              'Throughput, scope added/drop и done total по последним спринтам досок. Текущий выбранный спринт выделен.',
            )}
            actions={
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <label className="cycle-filter">
                  <span className="caption">{t('History', 'История')}</span>
                  <select
                    className="cycle-def-select"
                    value={historySprints}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setHistorySprints(next);
                      writeStoredNumber(HISTORY_STORAGE, next);
                    }}
                  >
                    {HISTORY_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {t(`${count} sprints`, `${count} спринтов`)}
                      </option>
                    ))}
                  </select>
                </label>
                <Segmented
                  className="segmented-compact"
                  value={unit}
                  onChange={setUnit}
                  options={[
                    { value: 'tasks', label: t('Issues', 'Задачи') },
                    { value: 'sp', label: 'SP' },
                  ]}
                />
              </div>
            }
          >
            <PredictabilityHistory
              rows={snapshot.history ?? []}
              unit={unit}
              requested={snapshot.historyHorizon?.requested}
              used={snapshot.historyHorizon?.used}
            />
          </Card>
          <Card
            title={t('Sprint makeup and outcome', 'Состав и итог спринта')}
            caption={t(
              'Click a segment to filter the table. One issue is one category: at the start, added, or removed.',
              'Клик по сегменту фильтрует таблицу. Одна задача — одна категория: на старте, добавлена или снята.',
            )}
            actions={
              <Segmented
                className="segmented-compact"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'tasks', label: t('Issues', 'Задачи') },
                  { value: 'sp', label: 'SP' },
                ]}
              />
            }
          >
            {snapshot.summary.initial.tasks === 0 && snapshot.summary.added.tasks === 0 ? (
              <p className="caption">
                {t(
                  'This sprint had no initial commitment and no added scope.',
                  'В спринте не было первоначального commitment и added scope.',
                )}
              </p>
            ) : (
              <PredictabilityBreakdown
                snapshot={snapshot}
                unit={unit}
                selected={category}
                onSelect={setCategory}
              />
            )}
          </Card>
          <Card
            title={t('Scope change', 'Изменение scope')}
            caption={t(
              'At the start → added → removed → estimate → final scope. Hover a term to see the formula.',
              'На старте → добавлено → удалено → оценка → финальный scope. Наведите на термин, чтобы увидеть формулу.',
            )}
          >
            <PredictabilityScopeChange snapshot={snapshot} />
          </Card>
          <Card
            title={t('Issues', 'Задачи')}
            caption={t(
              'Only the sprint membership: in at the start, added, or removed. An old key is a carry-over that was counted in the sprint. Epics and issues finished before the start are hidden.',
              'Только состав спринта: были на старте, добавлены или сняты. Старый ключ — перенос (carry-over), он числился в спринте. Эпики и завершённые до старта скрыты.',
            )}
            actions={
              <CheckDropdown label={t('People', 'Люди')} summary={personSummary(people, assigneeIds, t)} disabled={people.length === 0}>
                <label>
                  <input
                    type="radio"
                    name="predictability-people"
                    checked={assigneeIds.length === 0}
                    onChange={() => {
                      setAssigneeIds([]);
                      writeStoredIds(PEOPLE_STORAGE, []);
                    }}
                  />
                  <span>{t('All', 'Все')}</span>
                </label>
                {people.map((person) => (
                  <label key={person.id}>
                    <input
                      type="radio"
                      name="predictability-people"
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
            }
          >
            {assigneeIds.length > 0 && (
              <p className="caption">
                {t(
                  'The People filter applies only to the issue table, not the team cards.',
                  'Фильтр «Люди» действует только на таблицу задач, не на командные карточки.',
                )}
              </p>
            )}
            <PredictabilityTaskTable tasks={snapshot.tasks} category={category} assigneeIds={assigneeIds} />
          </Card>
        </>
      )}

      <Modal open={excludeOpen} title={t('Exclusions', 'Исключения')} onClose={() => setExcludeOpen(false)}>
        <p className="caption">
          {t(
            'The same keys as on Overview and Flow. They are left out of commitment, added, spillover, and the charts.',
            'Те же ключи, что на Overview и Flow. Не входят в commitment, added, spillover и графики.',
          )}
        </p>
        <form
          className="cycle-exclude-form"
          onSubmit={(event) => {
            event.preventDefault();
            const keys = parseIssueKeys(excludeDraft);
            addExcluded(keys);
            setExcludeDraft(keys.length > 0 ? '' : excludeDraft);
          }}
        >
          <input
            type="text"
            value={excludeDraft}
            placeholder="CDR-2029, CDR-2038"
            onChange={(event) => setExcludeDraft(event.target.value)}
          />
          <button type="submit" className="cycle-exclude-add" disabled={!parseIssueKeys(excludeDraft).length}>
            {t('Add', 'Добавить')}
          </button>
        </form>
        {excludedKeys.length === 0 ? (
          <p className="caption">{t('Nothing yet.', 'Пока пусто.')}</p>
        ) : (
          <ul className="cycle-exclude-list">
            {excludedKeys.map((key) => (
              <li key={key}>
                <span className="cycle-chart-key">{key}</span>
                <button type="button" className="cycle-exclude-restore" onClick={() => removeExcluded(key)}>
                  {t('restore', 'вернуть')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function QualityBanner({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { t } = useI18n();
  const tone =
    snapshot.quality === 'unavailable' ? 'danger' : snapshot.quality === 'partial' ? 'warning' : 'neutral';
  const title =
    snapshot.quality === 'exact'
      ? t('Exact snapshot', 'Точный snapshot')
      : snapshot.quality === 'reconstructed'
        ? t('Rebuilt from the changelog', 'Восстановлено по changelog')
        : snapshot.quality === 'partial'
          ? t('The metric was calculated from incomplete data', 'Метрика рассчитана по неполным данным')
          : t('Data unavailable', 'Данные недоступны');
  if (snapshot.warnings.length === 0 && snapshot.quality === 'reconstructed') return null;
  return (
    <Callout tone={tone} title={title}>
      {snapshot.incomplete && snapshot.elapsedPct !== undefined && (
        <div>
          {t(
            `${Math.round(snapshot.elapsedPct)}% of the planned sprint has elapsed.`,
            `Прошло ${Math.round(snapshot.elapsedPct)}% запланированного спринта.`,
          )}
        </div>
      )}
      {snapshot.warnings.map((warning) => (
        <div key={warning}>{predictabilityWarning(warning, t)}</div>
      ))}
    </Callout>
  );
}

function predictabilityWarning(warning: string, t: (en: string, ru: string) => string): string {
  if (warning === 'Не настроена аналитическая точка завершения') {
    return t('The analytical completion point is not configured', 'Не настроена аналитическая точка завершения');
  }
  if (warning === 'Метрика рассчитана по неполным данным: changelog части задач обрезан') {
    return t(
      'The metric was calculated from incomplete data: part of the changelog is truncated',
      'Метрика рассчитана по неполным данным: changelog части задач обрезан',
    );
  }
  if (warning === 'Спринт ещё не завершён — показан текущий прогресс') {
    return t('The sprint is not finished yet — current progress is shown', 'Спринт ещё не завершён — показан текущий прогресс');
  }
  const unestimated = /^В спринте есть (\d+) .+ без оценки$/.exec(warning);
  if (unestimated) {
    return t(`This sprint has ${unestimated[1]} unestimated issues`, warning);
  }
  return warning;
}

function ComparisonCard({ snapshot }: { snapshot: PredictabilitySnapshot }) {
  const { t, locale } = useI18n();
  const hints = metricHints(locale);
  const cmp = snapshot.comparison;
  if (!cmp) return null;
  const issues = t('issues', 'задач');
  const rows = [
    {
      label: t('Reliability, issues', 'Reliability, задачи'),
      hint: hints.reliability,
      current: pct(snapshot.summary.reliability.taskPercent, t),
      previous: pct(cmp.summary.reliability.taskPercent, t),
      extra: `${snapshot.summary.reliability.completedTasks}/${snapshot.summary.reliability.committedTasks} vs ${cmp.summary.reliability.completedTasks}/${cmp.summary.reliability.committedTasks}`,
    },
    {
      label: t('Reliability, SP', 'Reliability, SP'),
      hint: hints.reliabilitySp,
      current: pct(snapshot.summary.reliability.spPercent, t),
      previous: pct(cmp.summary.reliability.spPercent, t),
      extra: `${formatStoryPoints(snapshot.summary.reliability.completedSp)} vs ${formatStoryPoints(cmp.summary.reliability.completedSp)}`,
    },
    {
      label: t('Initial commitment', 'Initial commitment'),
      hint: hints.initial,
      current: `${snapshot.summary.initial.tasks} · ${formatStoryPoints(snapshot.summary.initial.storyPoints)}`,
      previous: `${cmp.summary.initial.tasks} · ${formatStoryPoints(cmp.summary.initial.storyPoints)}`,
      extra: signed(cmp.deltas.initialTasks, issues),
    },
    {
      label: t('Scope added', 'Добавленный scope'),
      hint: hints.scopeAdded,
      current: `${snapshot.summary.added.tasks} · ${formatStoryPoints(snapshot.summary.added.storyPoints)}`,
      previous: `${cmp.summary.added.tasks} · ${formatStoryPoints(cmp.summary.added.storyPoints)}`,
      extra: signed(cmp.deltas.addedTasks, issues),
    },
    {
      label: t('Scope drop', 'Снятый scope'),
      hint: hints.scopeDrop,
      current: `${snapshot.summary.removed.tasks} · ${formatStoryPoints(snapshot.summary.removed.storyPoints)}`,
      previous: `${cmp.summary.removed.tasks} · ${formatStoryPoints(cmp.summary.removed.storyPoints)}`,
      extra: signed(cmp.deltas.removedTasks, issues),
    },
    {
      label: t('Spillover', 'Перенос'),
      hint: hints.spillover,
      current: `${snapshot.summary.spillover.tasks} · ${formatStoryPoints(snapshot.summary.spillover.storyPoints)}`,
      previous: `${cmp.summary.spillover.tasks} · ${formatStoryPoints(cmp.summary.spillover.storyPoints)}`,
      extra: signed(cmp.deltas.spilloverTasks, issues),
    },
    {
      label: t('Unplanned delivered', 'Вне плана, сдано'),
      hint: hints.unplanned,
      current: `${snapshot.summary.unplanned.tasks} · ${formatStoryPoints(snapshot.summary.unplanned.storyPoints)}`,
      previous: `${cmp.summary.unplanned.tasks} · ${formatStoryPoints(cmp.summary.unplanned.storyPoints)}`,
      extra: signed(cmp.deltas.unplannedTasks, issues),
    },
  ];
  return (
    <Card
      title={t(`Comparison with ${cmp.sprint.name}`, `Сравнение с ${cmp.sprint.name}`)}
      caption={t(
        'Read reliability together with the size of the commitment and the added scope. One number does not mean “better”.',
        'Смотрите reliability вместе с размером commitment и added scope. Один показатель не значит «лучше».',
      )}
    >
      {cmp.incomplete && <Pill tone="warning">{t('The compared sprint is not finished yet', 'Сравниваемый спринт ещё не завершён')}</Pill>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('Metric', 'Метрика')}</th>
              <th>{t('Current', 'Текущий')}</th>
              <th>{t('Comparison', 'Сравнение')}</th>
              <th>{t('Delta / absolutes', 'Дельта / абсолюты')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>
                  <Hint text={row.hint}>{row.label}</Hint>
                </td>
                <td>{row.current}</td>
                <td>{row.previous}</td>
                <td>{row.extra}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function pct(value: number | null, t: (en: string, ru: string) => string): string {
  return value === null ? t('No data', 'Нет данных') : `${Math.round(value)}%`;
}

function signed(value: number, unit: string): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value} ${unit}`;
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
        <summary className="check-drop-summary" aria-disabled={disabled}>
          {summary}
        </summary>
        <div className="check-drop-menu checklist">{children}</div>
      </details>
    </div>
  );
}

function teamSummary(teams: Team[], ids: string[], t: (en: string, ru: string) => string): string {
  if (ids.length === 0) return t('Select teams', 'Выберите команды');
  if (ids.length === 1) return teams.find((team) => team.id === ids[0])?.name ?? t('1 team', '1 команда');
  return t(`${ids.length} teams`, `${ids.length} команд`);
}

function compareSummary(sprints: JiraSprintOption[], id: number | undefined, t: (en: string, ru: string) => string): string {
  if (!id) return t('Do not compare', 'Не сравнивать');
  return sprints.find((sprint) => sprint.id === id)?.name ?? t('1 sprint', '1 спринт');
}

function personSummary(people: CyclePerson[], ids: string[], t: (en: string, ru: string) => string): string {
  if (ids.length === 0 || ids.length === people.length) return t('All', 'Все');
  if (ids.length === 1) return people.find((person) => person.id === ids[0])?.name ?? t('1 person', '1 чел.');
  return t(`${ids.length} people`, `${ids.length} чел.`);
}

function readStoredStatus(key: string): string | undefined {
  try {
    const value = localStorage.getItem(key);
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredStatus(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function readStoredKeys(): string[] {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    return raw ? parseIssueKeys(raw) : [];
  } catch {
    return [];
  }
}

function writeStoredKeys(keys: string[]) {
  try {
    localStorage.setItem(KEYS_STORAGE, keys.join(' '));
  } catch {
    /* ignore */
  }
}

function readStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function readStoredHistory(): number {
  const value = readStoredNumber(HISTORY_STORAGE);
  if (value === 3 || value === 6 || value === 8 || value === 12) return value;
  return 6;
}

function readStoredNumber(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(key);
    const value = Number(raw);
    return Number.isInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredNumber(key: string, value: number | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}
