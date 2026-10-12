'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { QualityCards } from '@frontend/components/quality/QualityCards';
import { QualityDefectsPanel } from '@frontend/components/quality/QualityDefects';
import { QualityDistribution } from '@frontend/components/quality/QualityDistribution';
import { QualityHistory } from '@frontend/components/quality/QualityHistory';
import { QualityOpenCycles } from '@frontend/components/quality/QualityOpenCycles';
import { QualityTaskTable, type QualityTableFilter } from '@frontend/components/quality/QualityTaskTable';
import { RequireSetup } from '@frontend/components/Guards';
import { Callout, Card, ErrorNotice, LoadingCards, Modal, Segmented, SnapshotBar } from '@frontend/components/ui';
import { useAppData } from '@frontend/lib/app-data';
import { effectiveExcludeQa } from '@frontend/lib/exclude-qa-title';
import { useQuality } from '@frontend/lib/use-quality';
import { apiDelete, apiGet, apiPut, errorMessage } from '@frontend/lib/api';
import { parseIssueKeys, type CyclePerson } from '@backend/metrics/cycle-overview';
import type { QualitySnapshot } from '@backend/metrics/quality-model';
import type { JiraSprintOption, Team } from '@shared/types';

const KEYS_STORAGE = 'cycle-overview.excludedKeys';
const PEOPLE_STORAGE = 'quality.assigneeIds';
const SPRINT_STORAGE = 'quality.sprintId';
const WORKING_STORAGE = 'cycle-overview.workingDays';
const HISTORY_STORAGE = 'quality.historySprints';
const HISTORY_OPTIONS = [6, 8, 10] as const;

export default function QualityPage() {
  return (
    <RequireSetup>
      <QualityScreen />
    </RequireSetup>
  );
}

function QualityScreen() {
  const { t } = useI18n();
  const { teams, rules } = useAppData();
  const [teamIds, setTeamIds] = useState<string[]>(() => (teams[0] ? [teams[0].id] : []));
  const [sprints, setSprints] = useState<JiraSprintOption[]>([]);
  const [sprintId, setSprintId] = useState<number | undefined>(() => readStoredNumber(SPRINT_STORAGE));
  const [sprintsError, setSprintsError] = useState<string | undefined>();
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [sprintsTick, setSprintsTick] = useState(0);
  const sprintsForceRef = useRef(false);
  const excludeQa = effectiveExcludeQa(rules);
  const [excludedKeys, setExcludedKeys] = useState<string[]>(() => readStoredKeys());
  const [excludeDraft, setExcludeDraft] = useState('');
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => readStoredIds(PEOPLE_STORAGE));
  const [workingDays, setWorkingDays] = useState(() => readStoredFlag(WORKING_STORAGE));
  const [historySprints, setHistorySprints] = useState(() => readStoredHistory());
  const [holidays, setHolidays] = useState<string[]>([]);
  const [holidayDraft, setHolidayDraft] = useState('');
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [holidaysError, setHolidaysError] = useState<string | undefined>();
  const [filter, setFilter] = useState<QualityTableFilter>('returns');

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
            historySprints,
            excludeQaTitle: excludeQa,
            excludedKeys,
            workingDays,
          }
        : undefined,
    [teamIds.join(','), sprintId, historySprints, excludeQa, excludedKeys.join(','), workingDays],
  );
  const { snapshot, history, historyHorizon, people, asOf, queriedAt, fromCache, loading, refreshing, error, refresh, reload } =
    useQuality(request);

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

  const selectedSprint = sprints.find((sprint) => sprint.id === sprintId);

  return (
    <div className="stack">
      <header className="page-header">
        <div className="page-header-meta">
          <h1>{t('Quality', 'Качество')}</h1>
          <div className="page-header-sub">
            {t('QA Returns and Rework Loops for the First QA cohort.', 'QA Returns и Rework Loops по когорте First QA.')}
          </div>
        </div>
      </header>

      <div className="row">
        <CheckDropdown label={t('Teams', 'Команды')} summary={teamSummary(teams, teamIds, t)}>
          {teams.map((team) => (
            <label key={team.id}>
              <input
                type="radio"
                name="quality-team"
                checked={teamIds[0] === team.id}
                onChange={() => setTeamIds([team.id])}
              />
              <span>{team.name}</span>
            </label>
          ))}
        </CheckDropdown>
        <CheckDropdown label={t('Sprint', 'Спринт')} summary={selectedSprint?.name ?? t('Select a sprint', 'Выберите спринт')} disabled={sprintsLoading}>
          {sprints.map((sprint) => (
            <label key={sprint.id}>
              <input
                type="radio"
                name="quality-sprint"
                checked={sprintId === sprint.id}
                onChange={() => {
                  setSprintId(sprint.id);
                  writeStoredNumber(SPRINT_STORAGE, sprint.id);
                  setFilter('returns');
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
          {t('Exclusions', 'Исключения')}
          {excludedKeys.length ? ` (${excludedKeys.length})` : ''}
        </button>
        <CheckDropdown label={t('People', 'Люди')} summary={personSummary(people, assigneeIds, t)} disabled={people.length === 0}>
          <label>
            <input
              type="radio"
              name="quality-people"
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
                name="quality-people"
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
      </div>
      {assigneeIds.length > 0 && (
        <p className="caption">
          {t(
            'The People filter applies only to the issue table, not the team cards.',
            'Фильтр «Люди» действует только на таблицу задач, не на командные карточки.',
          )}
        </p>
      )}

      {holidaysError && <ErrorNotice error={holidaysError} />}
      {sprintsError && <ErrorNotice error={sprintsError} />}
      {error && <ErrorNotice error={error} onRetry={refresh} />}
      {loading && !snapshot && <LoadingCards count={4} />}

      {snapshot && (
        <>
          {snapshot.dataQuality !== 'exact' && <QualityContext snapshot={snapshot} asOf={asOf} />}
          <QualityCards snapshot={snapshot} filter={filter} onFilter={setFilter} />
          <Card title={t('Return distribution', 'Распределение возвратов')}>
            <QualityDistribution snapshot={snapshot} filter={filter} onFilter={setFilter} />
          </Card>
          <Card
            title={t('Open cycles', 'Открытые циклы')}
            caption={t(
              `Cohort rework WIP: ${snapshot.reworkWip}. Cycles interrupted by Done are not included.`,
              `Rework WIP когорты: ${snapshot.reworkWip}. Interrupted через Готово сюда не входят.`,
            )}
          >
            <QualityOpenCycles issues={snapshot.issues} onSelect={() => setFilter('open')} />
          </Card>
          <Card
            title={t('Production and incidents', 'Production и инциденты')}
            caption={t(
              `Created in the sprint window. Production ${snapshot.defects.production} · incidents ${snapshot.defects.incidents} · no signal ${snapshot.defects.unproven}.`,
              `Созданы в окне спринта. Production ${snapshot.defects.production} · инциденты ${snapshot.defects.incidents} · без признака ${snapshot.defects.unproven}.`,
            )}
          >
            <QualityDefectsPanel defects={snapshot.defects} />
          </Card>
          <Card
            title={t('Sprint history', 'История спринтов')}
            caption={t(
              'Each sprint’s Return Rate is calculated on its own First QA cohort. The active sprint is not final.',
              'Return Rate каждого спринта считается по своей когорте First QA. Активный не финальный.',
            )}
          >
            <QualityHistory
              rows={history}
              requested={historyHorizon?.requested}
              used={historyHorizon?.used}
              currentSprintId={snapshot.sprintId}
            />
          </Card>
          <Card
            title={t('Cohort issues', 'Задачи когорты')}
            caption={t(
              'The cohort is First QA inside the sprint window. Clicking a card filters the table. Expanding a row shows Fix → QA cycles, not the raw changelog.',
              'Когорта — First QA в окне спринта. Клик по карточке фильтрует таблицу. Раскрытие строки показывает циклы Fix → QA, не сырой changelog.',
            )}
            actions={
              <button type="button" className="text-button" onClick={() => setFilter('all')}>
                {t('Clear filter', 'Сбросить фильтр')}
              </button>
            }
          >
            <QualityTaskTable issues={snapshot.issues} filter={filter} assigneeIds={assigneeIds} />
          </Card>
        </>
      )}

      <Modal open={excludeOpen} title={t('Exclusions', 'Исключения')} onClose={() => setExcludeOpen(false)}>
        <p className="caption">
          {t(
            'The same keys as on Overview and Flow. They are left out of the cohort, the cards, and the table.',
            'Те же ключи, что на Overview и Flow. Не входят в когорту, карточки и таблицу.',
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
      <Modal open={holidaysOpen} title={t('Holidays', 'Праздники')} onClose={() => setHolidaysOpen(false)}>
        <p className="caption">
          {t(
            'These dates are not counted in Working mode. Saturday and Sunday are already excluded. The list is shared with Overview and Flow.',
            'Эти даты не считаются в режиме «Рабочие». Суббота и воскресенье уже исключены. Список общий с Overview и Flow.',
          )}
        </p>
        <form
          className="cycle-exclude-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addHolidayDate();
          }}
        >
          <input
            type="date"
            value={holidayDraft}
            aria-label={t('Holiday date', 'Дата праздника')}
            onChange={(event) => setHolidayDraft(event.target.value)}
          />
          <button type="submit" className="cycle-exclude-add" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(holidayDraft)}>
            {t('Add', 'Добавить')}
          </button>
        </form>
        {holidays.length === 0 ? (
          <p className="caption">{t('Nothing yet.', 'Пока пусто.')}</p>
        ) : (
          <ul className="cycle-exclude-list">
            {holidays.map((day) => (
              <li key={day}>
                <span className="cycle-chart-key">{day}</span>
                <button type="button" className="cycle-exclude-restore" onClick={() => void removeHolidayDate(day)}>
                  {t('reset', 'сбросить')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function QualityContext({ snapshot, asOf }: { snapshot: QualitySnapshot; asOf?: string }) {
  const { t, locale } = useI18n();
  const tone =
    snapshot.dataQuality === 'invalid_configuration' || snapshot.dataQuality === 'unavailable'
      ? 'danger'
      : snapshot.dataQuality === 'partial'
        ? 'warning'
        : 'neutral';
  const title =
    snapshot.dataQuality === 'exact'
      ? t('Exact snapshot', 'Точный snapshot')
      : snapshot.dataQuality === 'partial'
        ? t('Incomplete data', 'Неполные данные')
        : snapshot.dataQuality === 'invalid_configuration'
          ? t('QA group is not configured', 'Не настроена QA-группа')
          : t('No cohort', 'Нет когорты');
  const start = snapshot.window.start?.slice(0, 10) ?? '—';
  const end = snapshot.window.end?.slice(0, 10) ?? '—';
  return (
    <Callout tone={tone} title={title}>
      <div>
        {snapshot.sprintName}: First QA ∈ [{start}, {end}) · asOf {formatAsOf(asOf ?? snapshot.asOf, locale)} · N={snapshot.n}
        {snapshot.window.incomplete ? t(' · sprint still running', ' · спринт ещё идёт') : ''}
      </div>
      {snapshot.warnings.map((warning) => (
        <div key={warning}>{qualityWarning(warning, t)}</div>
      ))}
      {snapshot.dataQuality === 'exact' && snapshot.warnings.length === 0 && (
        <div>
          {t(
            'QA group = Ready to QA + Review. A return is only into Fix.',
            'QA-группа = Ready to QA + Проверка. Возврат только в Fix.',
          )}
        </div>
      )}
    </Callout>
  );
}

function qualityWarning(warning: string, t: (en: string, ru: string) => string): string {
  if (warning === 'Неполная история: точный Rate и FPY по всей когорте недоступны') {
    return t(
      'Incomplete history: an exact Rate and FPY for the whole cohort are unavailable',
      'Неполная история: точный Rate и FPY по всей когорте недоступны',
    );
  }
  if (warning === 'В выбранном спринте нет задач с известным First QA Entry') {
    return t(
      'The selected sprint has no issues with a known First QA entry',
      'В выбранном спринте нет задач с известным First QA Entry',
    );
  }
  if (warning === 'Не настроена QA-группа (Ready to QA / Проверка)') {
    return t('The QA group is not configured (Ready to QA / Review)', 'Не настроена QA-группа (Ready to QA / Проверка)');
  }
  return warning;
}

function formatAsOf(value: string, locale: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(locale === 'ru' ? 'ru-RU' : undefined);
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

function personSummary(people: CyclePerson[], ids: string[], t: (en: string, ru: string) => string): string {
  if (ids.length === 0 || ids.length === people.length) return t('All', 'Все');
  if (ids.length === 1) return people.find((person) => person.id === ids[0])?.name ?? t('1 person', '1 чел.');
  return t(`${ids.length} people`, `${ids.length} чел.`);
}

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readStoredKeys(): string[] {
  try {
    return parseIssueKeys(localStorage.getItem(KEYS_STORAGE) ?? '');
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
  if (value === 6 || value === 8 || value === 10) return value;
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
