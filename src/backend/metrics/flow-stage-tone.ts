import type { FlowStageId } from '@shared/types';

export type FlowTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const FLOW_STAGE_TONE: Record<string, FlowTone> = {
  development: 'info',
  review: 'info',
  rework: 'warning',
  qa: 'info',
  qaQueue: 'neutral',
  inReview: 'success',
  readyForRelease: 'success',
  done: 'success',
  cancelled: 'neutral',
  notStarted: 'neutral',
  other: 'warning',
};

export function flowStatusTone(stage: FlowStageId, blocked?: boolean): FlowTone {
  if (blocked) return 'danger';
  return FLOW_STAGE_TONE[stage] ?? 'neutral';
}

const TIMELINE_STATUS_COLOR: Record<string, string> = {
  'к выполнению': 'var(--flow-tl-todo)',
  'в работе': 'var(--flow-tl-dev)',
  architecture: 'var(--flow-tl-arch)',
  fix: 'var(--flow-tl-fix)',
  'ready to qa': 'var(--flow-tl-qa)',
  проверка: 'var(--flow-tl-review)',
  blocked: 'var(--flow-tl-blocked)',
  готово: 'var(--flow-tl-done)',
};

const TIMELINE_STAGE_COLOR: Record<string, string> = {
  notStarted: 'var(--flow-tl-todo)',
  cancelled: 'var(--flow-tl-todo)',
  development: 'var(--flow-tl-dev)',
  review: 'var(--flow-tl-arch)',
  rework: 'var(--flow-tl-fix)',
  qaQueue: 'var(--flow-tl-qa)',
  qa: 'var(--flow-tl-qa)',
  inReview: 'var(--flow-tl-review)',
  readyForRelease: 'var(--flow-tl-done)',
  done: 'var(--flow-tl-done)',
  other: 'var(--flow-tl-other)',
};

/** Distinct colors per Jira status so Fix / В работе / Ready to QA do not collapse. */
export function flowTimelineSegmentColor(segment: {
  status: string;
  stage: FlowStageId;
  blocked?: boolean;
}): string {
  if (segment.blocked) return 'var(--flow-tl-blocked)';
  const named = TIMELINE_STATUS_COLOR[segment.status.trim().toLowerCase()];
  if (named) return named;
  return TIMELINE_STAGE_COLOR[segment.stage] ?? 'var(--flow-tl-other)';
}
