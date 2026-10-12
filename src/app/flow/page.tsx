'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { FlowAgingTable } from '@frontend/components/flow/FlowAgingTable';
import { FlowHistory } from '@frontend/components/flow/FlowHistory';
import { FlowIssueTimeline } from '@frontend/components/flow/FlowIssueTimeline';
import { FlowStageBar } from '@frontend/components/flow/FlowStageBar';
import { FlowStageTime } from '@frontend/components/flow/FlowStageTime';
import { FlowSummaryCards } from '@frontend/components/flow/FlowSummaryCards';
import { FlowThroughput } from '@frontend/components/flow/FlowThroughput';
import { RequireSetup } from '@frontend/components/Guards';
import { Callout, Card, ErrorNotice, LoadingCards, Modal, Segmented, SnapshotBar, Spinner } from '@frontend/components/ui';
import { apiDelete, apiGet, apiPut, errorMessage } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { effectiveExcludeQa } from '@frontend/lib/exclude-qa-title';
import { useFlow } from '@frontend/lib/use-flow';
import { useJiraStatuses } from '@frontend/lib/use-jira-statuses';
import { parseIssueKeys, type CyclePerson } from '@backend/metrics/cycle-overview';
import { filterFlowAging, oldestFromAging } from '@backend/metrics/flow-model';
import { DEFAULT_CYCLE_START_STATUS, ENGINEERING_DONE_STATUS } from '@backend/metrics/rules';
import type { FlowStageId, JiraStatusOption, Team } from '@shared/types';

const START_STORAGE = 'cycle-overview.startStatus';
const END_STORAGE = 'cycle-overview.endStatus';
const KEYS_STORAGE = 'cycle-overview.excludedKeys';
const PEOPLE_STORAGE = 'cycle-overview.assigneeIds';
const WORKING_STORAGE = 'cycle-overview.workingDays';
const AGING_REVIEW_STORAGE = 'flow.agingIncludesReview';
const THROUGHPUT_HORIZON_STORAGE = 'flow.throughputSprints.v3';
const HISTORY_HORIZON_STORAGE = 'flow.historySprints.v3';
const HORIZON_OPTIONS = [3, 6, 8, 12] as const;

type AgingFilter = FlowStageId | 'blocked' | 'oldest' | 'developmentWip' | 'qaWip';

export default function FlowPage() {
  return (
    <RequireSetup>
      <FlowScreen />
    </RequireSetup>
  );
}

function FlowScreen() {
  const { t } = useI18n();
  const { teams, rules } = useAppData();
  const [teamIds, setTeamIds] = useState<string[]>(() => (teams[0] ? [teams[0].id] : []));
  const [startStatus, setStartStatus] = useState(
    () => readStoredStatus(START_STORAGE) ?? DEFAULT_CYCLE_START_STATUS,
  );
  const [endStatus, setEndStatus] = useState(
    () => readStoredStatus(END_STORAGE) ?? ENGINEERING_DONE_STATUS,
  );
  const excludeQa = effectiveExcludeQa(rules);
  const [excludedKeys, setExcludedKeys] = useState<string[]>(() => readStoredKeys());
  const [excludeDraft, setExcludeDraft] = useState('');
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => readStoredIds(PEOPLE_STORAGE));
  const [workingDays, setWorkingDays] = useState(() => readStoredFlag(WORKING_STORAGE));
  const [agingIncludesReview, setAgingIncludesReview] = useState(() => readStoredFlag(AGING_REVIEW_STORAGE));
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDraft, setHolidayDraft] = useState('');
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [holidaysError, setHolidaysError] = useState<string | undefined>();
  const [stageFilter, setStageFilter] = useState<AgingFilter | undefined>();
  const [timelineKey, setTimelineKey] = useState<string | undefined>();
  const [throughputHorizon, setThroughputHorizon] = useState(() =>
    readStoredHorizon(THROUGHPUT_HORIZON_STORAGE),
  );
  const [historyHorizon, setHistoryHorizon] = useState(() => readStoredHorizon(HISTORY_HORIZON_STORAGE));

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

  const request = useMemo(
    () =>
      teamIds.length
        ? {
            teamIds,
            throughputHorizon,
            historyHorizon,
            cycleStartStatus: startStatus,
            cycleEndStatus: endStatus,
            excludeQaTitle: excludeQa,
            excludedKeys,
            assigneeIds,
            workingDays,
          }
        : undefined,
    [
      teamIds.join(','),
      throughputHorizon,
      historyHorizon,
      startStatus,
      endStatus,
      excludeQa,
      excludedKeys.join(','),
      assigneeIds.join(','),
      workingDays,
    ],
  );
  const { flow, loading, refreshing, error, refresh, reload } = useFlow(request);
  const people = flow?.people ?? [];
  useEffect(() => {
    if (people.length === 0) return;
    const allowed = new Set(people.map((person) => person.id));
    const next = assigneeIds.filter((id) => allowed.has(id)).slice(0, 1);
    if (next.join(',') === assigneeIds.join(',')) return;
    setAssigneeIds(next);
    writeStoredIds(PEOPLE_STORAGE, next);
  }, [people, assigneeIds.join(',')]);
  const viewFlow = useMemo(() => {
    if (!flow) return undefined;
    const aging = filterFlowAging(flow.aging, agingIncludesReview);
    return { ...flow, aging, oldest: oldestFromAging(aging) };
  }, [flow, agingIncludesReview]);

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

  async function addHolidayDate() {
    const day = holidayDraft.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    try {
      const payload = await apiPut<{ days: string[] }>('/api/holidays', { day });
      setHolidays(payload.days);
      setHolidayDraft('');
      setHolidaysError(undefined);
      reload();
    } catch (caught) {
      setHolidaysError(errorMessage(caught));
    }
  }

  async function removeHolidayDate(day: string) {
    try {
      const payload = await apiDelete<{ days: string[] }>(`/api/holidays?day=${encodeURIComponent(day)}`);
      setHolidays(payload.days);
      setHolidaysError(undefined);
      reload();
    } catch (caught) {
      setHolidaysError(errorMessage(caught));
    }
  }

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>{t('Flow', 'Поток')}</h1>
          <p className="caption">
            {t(
              'Current WIP and Aging use the active sprint. The Throughput and WIP-over-time range is set on those cards.',
              'Текущий WIP и Aging — активный спринт. Интервал Throughput и WIP в динамике задаётся на карточках.',
            )}
          </p>
        </div>
      </header>

      <div className="row">
        <CheckDropdown label={t('Teams', 'Команды')} summary={teamSummary(teams, teamIds, t)}>
          {teams.map((team) => (
            <label key={team.id}>
              <input
                type="radio"
                name="flow-team"
                checked={teamIds[0] === team.id}
                onChange={() => setTeamIds([team.id])}
              />
              <span>{team.name}</span>
            </label>
          ))}
        </CheckDropdown>
        <SnapshotBar
          queriedAt={flow?.queriedAt}
          fromCache={flow?.fromCache}
          refreshing={refreshing}
          onRefresh={refresh}
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
        <CheckDropdown label={t('People', 'Люди')} summary={personSummary(people, assigneeIds, t)} disabled={people.length === 0}>
          <label>
            <input
              type="radio"
              name="flow-people"
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
                name="flow-people"
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
            { value: 'calendar', label: t('Calendar', 'Календарные') },
            { value: 'working', label: t('Working', 'Рабочие') },
          ]}
          onChange={(value) => {
            const next = value === 'working';
            setWorkingDays(next);
            writeStoredFlag(WORKING_STORAGE, next);
          }}
        />
        <button type="button" className="cycle-toolbar-btn" onClick={() => setHolidaysOpen(true)}>
          {t('Holidays', 'Праздники')} ({holidays.length})
        </button>
        <button type="button" className="cycle-toolbar-btn" onClick={() => setExcludeOpen(true)}>
          {t('Exclusions', 'Исключения')} ({excludedKeys.length})
        </button>
      </div>

      {holidaysError && <ErrorNotice error={holidaysError} />}
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {flow?.errors.map((item) => (
        <Callout key={item} tone="danger">
          {item}
        </Callout>
      ))}
      {flow?.warnings
        .filter((item) => item.includes('truncated') || item.includes('обрезан'))
        .map((item) => (
          <p key={item} className="caption">
            {item}
          </p>
        ))}
      {assigneeIds.length > 0 && (
        <p className="caption">
          {t(
            'Showing issues for the selected assignees — a flow-load filter, not a ranking of people.',
            'Показаны задачи выбранных исполнителей — фильтр нагрузки потока, не рейтинг людей.',
          )}
        </p>
      )}

      {loading && !viewFlow && <LoadingCards count={2} />}

      {viewFlow && (
        <>
          <Card
            title={t('Current flow', 'Текущий поток')}
            caption={
              viewFlow.qaWipAvailable
                ? t(
                    'WIP is counted from the current statuses of issues in the active sprint. QA WIP ends on a transition into Review or Fix.',
                    'WIP считается по текущим статусам задач активного спринта. QA WIP заканчивается переходом в Проверку или Fix.',
                  )
                : viewFlow.qaUnavailableReason
            }
          >
            <FlowSummaryCards
              flow={viewFlow}
              onSelect={(filter) => setStageFilter((current) => (current === filter ? undefined : filter))}
            />
          </Card>
          <Card title={t('WIP by stage', 'WIP по стадиям')}>
            <FlowStageBar
              flow={viewFlow}
              selected={stageFilter}
              onSelect={(stage) => setStageFilter((current) => (current === stage ? undefined : stage))}
            />
          </Card>
          <Card
            title={t('Aging WIP', 'Aging WIP')}
            caption={agingSprintCaption(viewFlow.agingSprints, t)}
            actions={
              <Segmented<'until-review' | 'with-review'>
                value={agingIncludesReview ? 'with-review' : 'until-review'}
                options={[
                  { value: 'until-review', label: t('Until review', 'До проверки') },
                  { value: 'with-review', label: t('With review', 'С проверкой') },
                ]}
                onChange={(value) => {
                  const next = value === 'with-review';
                  setAgingIncludesReview(next);
                  writeStoredFlag(AGING_REVIEW_STORAGE, next);
                }}
              />
            }
          >
            <p className="caption">
              {agingIncludesReview
                ? t(
                    'For Review and Done, the episode shows execution time (episode minus the current status). Orange and red appear only when that is above Median/P85, not because of the review queue or a date override.',
                    'Для «Проверки» и «Готово» в эпизоде показывается время выполнения (эпизод минус текущий статус). Оранжевое/красное — только если оно больше Median/P85, а не из‑за очереди в проверке или override дат.',
                  )
                : t(
                    'The episode ends at the first review: issues in Review and Done are not in Aging.',
                    'Эпизод заканчивается первой Проверкой: задачи в «Проверке» и «Готово» не входят в Aging.',
                  )}
            </p>
            <FlowAgingTable
              flow={viewFlow}
              stageFilter={stageFilter}
              selectedKey={timelineKey}
              onClearStage={() => setStageFilter(undefined)}
              onOpenTimeline={(key) => {
                setTimelineKey(key);
                requestAnimationFrame(() => {
                  document.getElementById('flow-issue-timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
              }}
            />
          </Card>
          <div id="flow-issue-timeline">
          <Card
            title={t('Issue timeline', 'Таймлайн задачи')}
            caption={t(
              'A key from the selected teams’ projects, not only current WIP. Colors match the WIP stages. Segment width and durations follow calendar or working days, as in the filter above.',
              'Ключ из проектов выбранных команд, не только текущий WIP. Цвет как у стадий WIP. Ширина куска и длительности — календарные или рабочие дни, как в фильтре сверху.',
            )}
          >
            <FlowIssueTimeline
              issues={viewFlow.issueTimelines ?? []}
              workflow={viewFlow.workflow}
              selectedKey={timelineKey}
              onSelect={setTimelineKey}
              cycleStartStatus={startStatus}
              cycleEndStatus={endStatus}
              teamIds={teamIds}
              workingDays={workingDays}
              holidays={holidays}
            />
          </Card>
          </div>
          <Card title={t('Time by stage', 'Время по этапам')}>
            {refreshing && !viewFlow.stageTime ? (
              <Spinner label={t('Updating…', 'Обновляю…')} />
            ) : (
              <FlowStageTime model={viewFlow.stageTime} />
            )}
          </Card>
          <Card
            title={t('Throughput by sprint', 'Throughput по спринтам')}
            caption={horizonCaption(
              viewFlow.throughputHorizon,
              t('First transition into review inside the sprint window.', 'Первый переход в Проверку внутри окна спринта.'),
              t,
            )}
            actions={
              <HorizonSelect
                value={throughputHorizon}
                onChange={(next) => {
                  setThroughputHorizon(next);
                  writeStoredHorizon(THROUGHPUT_HORIZON_STORAGE, next);
                }}
              />
            }
          >
            {viewFlow.throughput ? (
              <FlowThroughput
                model={viewFlow.throughput}
                filterNote={
                  assigneeIds.length > 0 ? t('counted for the selected assignees', 'считается по выбранным исполнителям') : undefined
                }
              />
            ) : (
              <p className="caption">{t('No data.', 'Нет данных.')}</p>
            )}
          </Card>
          <Card
            title={t('WIP over time', 'WIP в динамике')}
            caption={horizonCaption(
              viewFlow.horizon,
              t(
                'The Y axis is how many issues in the horizon were in Development WIP at the end of the day. Not percents and not days.',
                'По оси Y — сколько задач горизонта было в Development WIP на конец дня. Не проценты и не дни.',
              ),
              t,
            )}
            actions={
              <HorizonSelect
                value={historyHorizon}
                onChange={(next) => {
                  setHistoryHorizon(next);
                  writeStoredHorizon(HISTORY_HORIZON_STORAGE, next);
                }}
              />
            }
          >
            <FlowHistory model={viewFlow.history} />
          </Card>
        </>
      )}

      <ExcludeDialog
        open={excludeOpen}
        keys={excludedKeys}
        draft={excludeDraft}
        onClose={() => setExcludeOpen(false)}
        onDraft={setExcludeDraft}
        onSubmit={() => {
          const keys = parseIssueKeys(excludeDraft);
          addExcluded(keys);
          setExcludeDraft(keys.length > 0 ? '' : excludeDraft);
        }}
        onRestore={removeExcluded}
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
  const { t } = useI18n();
  return (
    <Modal open={open} title={t('Exclusions', 'Исключения')} onClose={onClose}>
      <p className="caption">
        {t(
          'Left out of Flow: cards, stages, Aging, time by stage, and throughput.',
          'Не входят в Flow: карточки, стадии, Aging, время по этапам и throughput.',
        )}
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
          aria-label={t('Issue keys to exclude', 'Ключи задач для исключения')}
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="submit" className="cycle-exclude-add" disabled={!parseIssueKeys(draft).length}>
          {t('Add', 'Добавить')}
        </button>
      </form>
      {keys.length === 0 ? (
        <p className="caption">{t('Nothing yet.', 'Пока пусто.')}</p>
      ) : (
        <ul className="cycle-exclude-list">
          {keys.map((key) => (
            <li key={key}>
              <span className="cycle-chart-key">{key}</span>
              <button type="button" className="cycle-exclude-restore" onClick={() => onRestore(key)}>
                {t('restore', 'вернуть')}
              </button>
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
  const { t } = useI18n();
  return (
    <Modal open={open} title={t('Holidays', 'Праздники')} onClose={onClose}>
      <p className="caption">
        {t(
          'These dates are not counted in Working mode. Saturday and Sunday are already excluded. The list is shared with Overview.',
          'Эти даты не считаются в режиме «Рабочие». Суббота и воскресенье уже исключены. Список общий с Overview.',
        )}
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
          aria-label={t('Holiday date', 'Дата праздника')}
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="submit" className="cycle-exclude-add" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(draft)}>
          {t('Add', 'Добавить')}
        </button>
      </form>
      {days.length === 0 ? (
        <p className="caption">{t('Nothing yet.', 'Пока пусто.')}</p>
      ) : (
        <ul className="cycle-exclude-list">
          {days.map((day) => (
            <li key={day}>
              <span className="cycle-chart-key">{day}</span>
              <button type="button" className="cycle-exclude-restore" onClick={() => onRestore(day)}>
                {t('reset', 'сбросить')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type Tr = (en: string, ru: string) => string;

function ruSprintWord(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return 'спринт';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'спринта';
  return 'спринтов';
}

function sprintWord(count: number, t: Tr): string {
  return t(count === 1 ? 'sprint' : 'sprints', ruSprintWord(count));
}

function agingSprintCaption(sprints: { id: number; name: string }[] | undefined, t: Tr): string {
  if (!sprints || sprints.length === 0) {
    return t(
      'Only issues in the active sprint. There is no active sprint on the boards right now.',
      'Только задачи активного спринта. Сейчас активного спринта на досках нет.',
    );
  }
  if (sprints.length === 1) {
    return t(
      `Only the current sprint: ${sprints[0].name}. The WIP cards count the same set.`,
      `Только текущий спринт: ${sprints[0].name}. Карточки WIP считают тот же набор.`,
    );
  }
  const names = sprints.map((sprint) => sprint.name).join(', ');
  return t(
    `Only the active sprints: ${names}. The WIP cards count the same set.`,
    `Только активные спринты: ${names}. Карточки WIP считают тот же набор.`,
  );
}

function horizonCaption(
  horizon: { requested: number; used: number; from?: string; to?: string } | undefined,
  extra: string,
  t: Tr,
): string {
  if (!horizon || horizon.used === 0) return extra;
  const range = horizon.from && horizon.to ? ` ${horizon.from} → ${horizon.to}.` : '';
  const enWord = horizon.used === 1 ? 'sprint' : 'sprints';
  const used =
    horizon.used === horizon.requested
      ? t(`Last ${horizon.used} ${enWord}.`, `Последние ${horizon.used} ${ruSprintWord(horizon.used)}.`)
      : t(
          `Requested ${horizon.requested}, the boards have ${horizon.used}.`,
          `Запрошено ${horizon.requested}, на досках есть ${horizon.used}.`,
        );
  return `${used}${range} ${extra}`;
}

function HorizonSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n();
  return (
    <label className="cycle-filter">
      <span className="caption">{t('Range', 'Интервал')}</span>
      <select
        className="cycle-def-select"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {HORIZON_OPTIONS.map((count) => (
          <option key={count} value={count}>
            {count} {sprintWord(count, t)}
          </option>
        ))}
      </select>
    </label>
  );
}

function readStoredHorizon(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? Number(raw) : 3;
    return HORIZON_OPTIONS.some((option) => option === n) ? n : 3;
  } catch {
    return 3;
  }
}

function writeStoredHorizon(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* private mode */
  }
}

function teamSummary(teams: Team[], ids: string[], t: Tr): string {
  if (ids.length === 0) return t('Select teams', 'Выберите команды');
  if (ids.length === 1) return teams.find((team) => team.id === ids[0])?.name ?? t('1 team', '1 команда');
  return t(`${ids.length} teams`, `${ids.length} команд`);
}

function personSummary(people: CyclePerson[], ids: string[], t: Tr): string {
  if (ids.length === 0 || ids.length === people.length) return t('All', 'Все');
  if (ids.length === 1) return people.find((person) => person.id === ids[0])?.name ?? t('1 person', '1 чел.');
  return t(`${ids.length} people`, `${ids.length} чел.`);
}

function readStoredStatus(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key)?.trim() || undefined;
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
