'use client';

import { useEffect, useMemo, useState } from 'react';

import { StatusRule, type StatusGroup } from '@frontend/components/RulePickers';
import { Callout, Field } from '@frontend/components/ui';
import { apiGet } from '@frontend/lib/api';
import { useAppData } from '@frontend/lib/app-data';
import { TIMELINE_MIN_SEGMENT_PCT_MAX, validateFlowWorkflow, type FlowWorkflowValidation } from '@backend/metrics/flow-workflow';
import type { FlowWorkflow, JiraProjectOption, JiraStatusOption } from '@shared/types';

const STAGE_FIELDS: Array<{ key: WorkflowListKey; label: string; hint: string }> = [
  {
    key: 'notStarted',
    label: 'К выполнению',
    hint: 'Бэклог. Эти задачи не входят в Development WIP и Aging.',
  },
  {
    key: 'development',
    label: 'Development',
    hint: 'По умолчанию «В работе», architecture, Fix. Rework — это возврат из проверки, а не статус Fix.',
  },
  {
    key: 'review',
    label: 'Code Review',
    hint: 'Оставьте пустым, если на доске нет отдельного code review — блок Review просто не появится.',
  },
  {
    key: 'rework',
    label: 'Rework (статусы)',
    hint: 'Необязательно. Обычно Rework ставится по истории возврата, а не по имени статуса.',
  },
  {
    key: 'qaQueue',
    label: 'QA WIP / очередь QA',
    hint: 'Ready to QA. Задача в QA WIP, пока не перейдёт в один из статусов конца QA.',
  },
  {
    key: 'qaEnd',
    label: 'Конец QA WIP',
    hint: 'Первый переход в Проверку или Fix выводит задачу из QA WIP. Overlay, может пересекаться с другими стадиями.',
  },
  {
    key: 'inReview',
    label: 'В проверке',
    hint: 'Нейтральная группа текущего статуса «Проверка». Не QA WIP.',
  },
  {
    key: 'qa',
    label: 'QA (активное тестирование)',
    hint: 'Дополнительные статусы активного тестирования, если появятся. Иначе достаточно Ready to QA + конца QA.',
  },
  {
    key: 'readyForRelease',
    label: 'Ожидает релиза',
    hint: 'Готово к выкладке, но ещё не done.',
  },
  {
    key: 'done',
    label: 'Готово',
    hint: 'Завершённая работа.',
  },
  {
    key: 'cancelled',
    label: 'Отменено',
    hint: 'Пусто, пока на других досках не появится отменённый статус.',
  },
  {
    key: 'blocked',
    label: 'Blocked (признак)',
    hint: 'Overlay: может пересекаться с development. Одна задача в Dev WIP считается один раз.',
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
  const { teams } = useAppData();
  const [projects, setProjects] = useState<JiraProjectOption[]>([]);
  const [allStatuses, setAllStatuses] = useState<JiraStatusOption[]>([]);
  const [statusesByProject, setStatusesByProject] = useState<Record<string, JiraStatusOption[]>>({});
  const [loadingProject, setLoadingProject] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const validation = useMemo(() => validateFlowWorkflow(value, allStatuses), [value, allStatuses]);

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
        Стадии вкладки Flow. Точки Cycle Time (первый старт → первая проверка) задаются на Overview и Flow, не здесь.
        Пересечения exclusive-групп запрещены; Blocked может пересекаться.
      </p>
      <ValidationNotes validation={validation} />
      <Field
        label="Мин. ширина отрезка таймлайна (%)"
        hint="Короткие статусы вроде Fix не схлопываются в линию. 0 — строго по времени, 2–3 обычно достаточно."
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
      {STAGE_FIELDS.map((field) => (
        <StatusRule
          key={field.key}
          label={field.label}
          hint={field.hint}
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
