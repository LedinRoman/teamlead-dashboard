'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { StatusRule, type StatusGroup } from '@frontend/components/RulePickers';
import { Callout, Field } from '@frontend/components/ui';
import { apiGet } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import {
  DEFAULT_FLOW_WORKFLOW,
  TIMELINE_MIN_SEGMENT_PCT_MAX,
  validateFlowWorkflow,
  type FlowWorkflowValidation,
} from '@backend/metrics/flow-workflow';
import type { FlowWorkflow, JiraProjectOption, JiraStatusOption } from '@shared/types';

const STAGE_FIELDS: Array<{ key: WorkflowListKey; en: string; ru: string; hintEn: string; hintRu: string }> = [
  {
    key: 'notStarted',
    en: 'To do',
    ru: 'К выполнению',
    hintEn: 'Backlog. These issues are not in Development WIP or Aging.',
    hintRu: 'Бэклог. Эти задачи не входят в Development WIP и Aging.',
  },
  {
    key: 'development',
    en: 'Development',
    ru: 'Development',
    hintEn: 'In Progress. Rework is a return from review, not a status name.',
    hintRu: 'In Progress. Rework — это возврат из проверки, а не имя статуса.',
  },
  {
    key: 'review',
    en: 'Code Review',
    ru: 'Code Review',
    hintEn: 'Leave empty if the board has no separate code review — the Review block simply will not appear.',
    hintRu: 'Оставьте пустым, если на доске нет отдельного code review — блок Review просто не появится.',
  },
  {
    key: 'rework',
    en: 'Rework (statuses)',
    ru: 'Rework (статусы)',
    hintEn: 'Optional. Rework is usually inferred from a return, not from a status name.',
    hintRu: 'Необязательно. Обычно Rework ставится по истории возврата, а не по имени статуса.',
  },
  {
    key: 'qaQueue',
    en: 'QA WIP / QA queue',
    ru: 'QA WIP / очередь QA',
    hintEn: 'Ready to QA. An issue stays in QA WIP until it reaches an end-of-QA status.',
    hintRu: 'Ready to QA. Задача в QA WIP, пока не дойдёт до статуса конца QA.',
  },
  {
    key: 'qaEnd',
    en: 'End of QA WIP',
    ru: 'Конец QA WIP',
    hintEn: 'The first transition into In Review takes the issue out of QA WIP. An overlay; it may overlap other stages.',
    hintRu: 'Первый переход в In Review выводит задачу из QA WIP. Overlay, может пересекаться с другими стадиями.',
  },
  {
    key: 'inReview',
    en: 'In review',
    ru: 'В проверке',
    hintEn: 'In Review. A board status named Review or Проверка still matches.',
    hintRu: 'In Review. Статус Review или «Проверка» тоже подходит.',
  },
  {
    key: 'qa',
    en: 'QA (active testing)',
    ru: 'QA (активное тестирование)',
    hintEn: 'Extra statuses for active testing, if they appear. Otherwise Ready to QA plus the QA end is enough.',
    hintRu: 'Дополнительные статусы активного тестирования, если появятся. Иначе достаточно Ready to QA + конца QA.',
  },
  {
    key: 'readyForRelease',
    en: 'Awaiting release',
    ru: 'Ожидает релиза',
    hintEn: 'Ready to ship, but not done yet.',
    hintRu: 'Готово к выкладке, но ещё не done.',
  },
  {
    key: 'done',
    en: 'Done',
    ru: 'Готово',
    hintEn: 'Finished work.',
    hintRu: 'Завершённая работа.',
  },
  {
    key: 'cancelled',
    en: 'Cancelled',
    ru: 'Отменено',
    hintEn: 'Empty until another board has a cancelled status.',
    hintRu: 'Пусто, пока на других досках не появится отменённый статус.',
  },
  {
    key: 'blocked',
    en: 'Blocked (signal)',
    ru: 'Blocked (признак)',
    hintEn: 'Overlay: may overlap development. One issue in Dev WIP is counted once.',
    hintRu: 'Overlay: может пересекаться с development. Одна задача в Dev WIP считается один раз.',
  },
];

type WorkflowListKey = Exclude<keyof FlowWorkflow, 'cycleStart' | 'cycleEnd' | 'timelineMinSegmentPct'>;

export function FlowWorkflowSettings({
  value,
  onChange,
}: {
  value: FlowWorkflow;
  onChange: (next: FlowWorkflow) => void;
}) {
  const { t } = useI18n();
  const { teams } = useAppData();
  const [projects, setProjects] = useState<JiraProjectOption[]>([]);
  const [allStatuses, setAllStatuses] = useState<JiraStatusOption[]>([]);
  const [statusesByProject, setStatusesByProject] = useState<Record<string, JiraStatusOption[]>>({});
  const [loadingProject, setLoadingProject] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [custom, setCustom] = useState(() => !stageListsMatchDefaults(value));
  const customTouched = useRef(false);
  const validation = useMemo(() => validateFlowWorkflow(value, allStatuses), [value, allStatuses]);

  useEffect(() => {
    if (!customTouched.current) setCustom(!stageListsMatchDefaults(value));
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [meta, catalogue] = await Promise.all([
          apiGet<{ projects: JiraProjectOption[] }>('/api/jira/meta'),
          apiGet<{ statuses: JiraStatusOption[] }>('/api/jira/statuses'),
        ]);
        if (cancelled) return;
        setProjects(meta.projects);
        setAllStatuses(catalogue.statuses);
        setUnavailable(false);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo<StatusGroup[]>(() => {
    const used = new Set(teams.flatMap((team) => team.projects));
    const boardNames = new Map<string, string[]>();
    for (const team of teams) {
      for (const project of team.projects) {
        const names = boardNames.get(project) ?? [];
        for (const board of team.boards) {
          if (!names.includes(board.name)) names.push(board.name);
        }
        boardNames.set(project, names);
      }
    }
    const fromMeta = projects.map((project) => ({
      key: project.key,
      name: project.name,
      boardNames: boardNames.get(project.key) ?? [],
      inUse: used.has(project.key),
    }));
    const extra = [...used]
      .filter((key) => !projects.some((project) => project.key === key))
      .map((key) => ({
        key,
        name: key,
        boardNames: boardNames.get(key) ?? [],
        inUse: true,
      }));
    return [...fromMeta, ...extra];
  }, [projects, teams]);

  const expand = (projectKey: string) => {
    if (statusesByProject[projectKey] || loadingProject === projectKey) return;
    setLoadingProject(projectKey);
    void (async () => {
      try {
        const payload = await apiGet<{ statuses: JiraStatusOption[] }>(
          `/api/jira/statuses?project=${encodeURIComponent(projectKey)}`,
        );
        setStatusesByProject((current) => ({ ...current, [projectKey]: payload.statuses }));
      } catch {
        setStatusesByProject((current) => ({ ...current, [projectKey]: [] }));
      } finally {
        setLoadingProject(undefined);
      }
    })();
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="caption">
        {t(
          'To Do, In Progress, In Review, and Done. The QA queue is Ready to QA and ends at In Review. Blocked is Blocked. Cycle time points stay on Overview and Flow.',
          'To Do, In Progress, In Review и Done. Очередь QA — Ready to QA, конец — In Review. Blocked — Blocked. Точки Cycle Time остаются на Overview и Flow.',
        )}
      </p>
      <label className="caption" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={custom}
          onChange={(event) => {
            const next = event.target.checked;
            customTouched.current = true;
            setCustom(next);
            if (!next) onChange(withDefaultStages(value));
          }}
        />
        {t('Custom statuses', 'Свои статусы')}
      </label>
      {custom && (
        <p className="caption">
          {t(
            'Exclusive groups may not overlap. Blocked may.',
            'Пересечения exclusive-групп запрещены. Blocked может пересекаться.',
          )}
        </p>
      )}
      {custom && <ValidationNotes validation={validation} />}
      <Field
        label={t('Minimum timeline segment width (%)', 'Мин. ширина отрезка таймлайна (%)')}
        hint={t(
          'Short statuses such as Fix do not collapse into a line. 0 is strictly by time; 2–3 is usually enough.',
          'Короткие статусы вроде Fix не схлопываются в линию. 0 — строго по времени, 2–3 обычно достаточно.',
        )}
      >
        <input
          type="number"
          min={0}
          max={TIMELINE_MIN_SEGMENT_PCT_MAX}
          step={1}
          value={value.timelineMinSegmentPct}
          onChange={(event) =>
            onChange({ ...value, timelineMinSegmentPct: Number(event.target.value) })
          }
        />
      </Field>
      {custom &&
        STAGE_FIELDS.map((field) => (
          <StatusRule
            key={field.key}
            label={t(field.en, field.ru)}
            hint={t(field.hintEn, field.hintRu)}
            value={value[field.key]}
            onChange={(next) => onChange({ ...value, [field.key]: next })}
            groups={groups}
            statusesByProject={statusesByProject}
            onExpand={expand}
            loadingProject={loadingProject}
            allStatuses={allStatuses}
            unavailable={unavailable}
          />
        ))}
    </div>
  );
}

const STAGE_LIST_KEYS: WorkflowListKey[] = [
  'notStarted',
  'development',
  'review',
  'rework',
  'qa',
  'readyForRelease',
  'done',
  'cancelled',
  'blocked',
  'inReview',
  'qaQueue',
  'qaEnd',
];

function stageListsMatchDefaults(value: FlowWorkflow): boolean {
  return STAGE_LIST_KEYS.every((key) => {
    const left = value[key];
    const right = DEFAULT_FLOW_WORKFLOW[key];
    return left.length === right.length && left.every((name, index) => name === right[index]);
  });
}

function withDefaultStages(value: FlowWorkflow): FlowWorkflow {
  const next = { ...value };
  for (const key of STAGE_LIST_KEYS) next[key] = [...DEFAULT_FLOW_WORKFLOW[key]];
  return next;
}

function ValidationNotes({ validation }: { validation: FlowWorkflowValidation }) {
  return (
    <>
      {validation.errors.map((item) => (
        <Callout key={item} tone="danger">
          {item}
        </Callout>
      ))}
      {validation.warnings.map((item) => (
        <p key={item} className="caption">
          {item}
        </p>
      ))}
    </>
  );
}
