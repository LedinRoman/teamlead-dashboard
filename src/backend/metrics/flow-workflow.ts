import type { FlowStageId, FlowWorkflow, JiraStatusOption } from '@shared/types';
import { DEFAULT_CYCLE_START_STATUS, ENGINEERING_DONE_STATUS, matchesAny, statusEquals } from './rules';

export const EXCLUSIVE_FLOW_STAGES: Array<
  Exclude<FlowStageId, 'other'>
> = [
  'cancelled',
  'done',
  'readyForRelease',
  'qa',
  'inReview',
  'qaQueue',
  'rework',
  'review',
  'development',
  'notStarted',
];

export const DEFAULT_FLOW_WORKFLOW: FlowWorkflow = {
  notStarted: ['К выполнению'],
  development: ['В работе', 'architecture', 'Fix'],
  review: [],
  rework: [],
  qa: [],
  readyForRelease: [],
  done: ['Готово'],
  cancelled: [],
  blocked: ['BLOCKED', 'blocked', 'on hold', 'impediment', 'waiting'],
  inReview: ['Проверка'],
  qaQueue: ['Ready to QA'],
  qaEnd: ['Проверка', 'Fix'],
  cycleStart: DEFAULT_CYCLE_START_STATUS,
  cycleEnd: ENGINEERING_DONE_STATUS,
  timelineMinSegmentPct: 2,
};

export interface FlowWorkflowValidation {
  errors: string[];
  warnings: string[];
  qaWipAvailable: boolean;
  qaUnavailableReason?: string;
}

export function mergeFlowWorkflow(partial?: Partial<FlowWorkflow>): FlowWorkflow {
  const base = DEFAULT_FLOW_WORKFLOW;
  if (!partial) return { ...base, ...cloneLists(base) };
  return {
    notStarted: list(partial.notStarted, base.notStarted),
    development: list(partial.development, base.development),
    review: list(partial.review, base.review),
    rework: list(partial.rework, base.rework),
    qa: list(partial.qa, base.qa),
    readyForRelease: list(partial.readyForRelease, base.readyForRelease),
    done: list(partial.done, base.done),
    cancelled: list(partial.cancelled, base.cancelled),
    blocked: list(partial.blocked, base.blocked),
    inReview: list(partial.inReview, base.inReview),
    qaQueue: list(partial.qaQueue, base.qaQueue),
    qaEnd: list(partial.qaEnd, base.qaEnd),
    cycleStart: typeof partial.cycleStart === 'string' && partial.cycleStart.trim() ? partial.cycleStart.trim() : base.cycleStart,
    cycleEnd: typeof partial.cycleEnd === 'string' && partial.cycleEnd.trim() ? partial.cycleEnd.trim() : base.cycleEnd,
    timelineMinSegmentPct: clampTimelineMinSegmentPct(
      partial.timelineMinSegmentPct !== undefined ? partial.timelineMinSegmentPct : base.timelineMinSegmentPct,
    ),
  };
}

export const TIMELINE_MIN_SEGMENT_PCT_MAX = 10;

export function clampTimelineMinSegmentPct(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FLOW_WORKFLOW.timelineMinSegmentPct;
  return Math.min(TIMELINE_MIN_SEGMENT_PCT_MAX, Math.max(0, Math.round(n)));
}

export function statusInList(status: string | undefined, names: string[]): boolean {
  if (!status) return false;
  return names.some((name) => statusEquals(status, name) || matchesAny(status, [name]));
}

export function exclusiveStageOf(status: string | undefined, workflow: FlowWorkflow): FlowStageId {
  if (!status) return 'other';
  for (const stage of EXCLUSIVE_FLOW_STAGES) {
    if (statusInList(status, workflow[stage])) return stage;
  }
  return 'other';
}

export function validateFlowWorkflow(
  workflow: FlowWorkflow,
  catalog?: Array<Pick<JiraStatusOption, 'name'>>,
): FlowWorkflowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (workflow.development.length === 0) {
    errors.push('Нужна хотя бы одна development-стадия — иначе нельзя считать Development WIP.');
  }
  if (!workflow.cycleStart.trim()) {
    errors.push('Нет точки начала Development Cycle Time.');
  }
  if (!workflow.cycleEnd.trim() && workflow.inReview.length === 0) {
    errors.push('Нет точки завершения Development Cycle Time (первая проверка).');
  }

  const seen = new Map<string, FlowStageId>();
  for (const stage of EXCLUSIVE_FLOW_STAGES) {
    for (const name of workflow[stage]) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      const previous = seen.get(key);
      if (previous && previous !== stage) {
        errors.push(`Статус «${name}» входит и в «${previous}», и в «${stage}».`);
      } else {
        seen.set(key, stage);
      }
    }
  }

  const known = new Set((catalog ?? []).map((status) => status.name.trim().toLowerCase()));
  if (known.size > 0) {
    const missing = [...seen.keys()].filter((key) => !known.has(key));
    if (missing.length > 0) {
      warnings.push(`В Jira сейчас нет статусов: ${missing.join(', ')}. Возможно, их переименовали.`);
    }
  }

  const qaWipAvailable = workflow.qa.length + workflow.qaQueue.length > 0 && workflow.qaEnd.length > 0;
  const qaUnavailableReason = qaWipAvailable
    ? undefined
    : 'QA WIP недоступен: нет очереди QA и статусов конца (Проверка или Fix).';
  if (!qaWipAvailable) warnings.push(qaUnavailableReason!);
  if (workflow.review.length === 0) {
    warnings.push('Стадия Review пустая — на доске нет отдельного code review.');
  }

  return { errors, warnings, qaWipAvailable, qaUnavailableReason };
}

function list(value: string[] | undefined, fallback: string[]): string[] {
  if (!value) return [...fallback];
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function cloneLists(workflow: FlowWorkflow): Pick<
  FlowWorkflow,
  | 'notStarted'
  | 'development'
  | 'review'
  | 'rework'
  | 'qa'
  | 'readyForRelease'
  | 'done'
  | 'cancelled'
  | 'blocked'
  | 'inReview'
  | 'qaQueue'
  | 'qaEnd'
> {
  return {
    notStarted: [...workflow.notStarted],
    development: [...workflow.development],
    review: [...workflow.review],
    rework: [...workflow.rework],
    qa: [...workflow.qa],
    readyForRelease: [...workflow.readyForRelease],
    done: [...workflow.done],
    cancelled: [...workflow.cancelled],
    blocked: [...workflow.blocked],
    inReview: [...workflow.inReview],
    qaQueue: [...workflow.qaQueue],
    qaEnd: [...workflow.qaEnd],
  };
}
