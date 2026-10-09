import type { FlowStageId, FlowWorkflow, NormalizedIssue } from '@shared/types';
import { isAllowedCycleType, isCycleExcluded, type CycleOverviewFilters } from './cycle-overview';
import { exclusiveStageOf, statusInList } from './flow-workflow';

export interface FlowClassification {
  stage: FlowStageId;
  blocked: boolean;
  rework: boolean;
  inDevelopmentWip: boolean;
  inReview: boolean;
  inQaQueue: boolean;
  inQaWip: boolean;
  inAging: boolean;
}

export function isFlowBlocked(issue: Pick<NormalizedIssue, 'status' | 'signals'>, workflow: FlowWorkflow): boolean {
  if (statusInList(issue.status, workflow.blocked)) return true;
  return issue.signals.includes('blocked') || issue.signals.includes('blocked-inferred');
}

export function isFlowRework(
  issue: Pick<NormalizedIssue, 'doneAt' | 'status'>,
  workflow: FlowWorkflow,
  stage = exclusiveStageOf(issue.status, workflow),
): boolean {
  if (!issue.doneAt) return false;
  return stage === 'development' || stage === 'review' || stage === 'rework';
}

/** Blocked overlay still counts as Development WIP when the task is not parked in backlog/review/done. */
export function isFlowDevelopmentWip(stage: FlowStageId, blocked: boolean): boolean {
  if (stage === 'development' || stage === 'review' || stage === 'rework') return true;
  if (!blocked) return false;
  return stage === 'other';
}

export function classifyFlowIssue(issue: NormalizedIssue, workflow: FlowWorkflow): FlowClassification {
  const stage = exclusiveStageOf(issue.status, workflow);
  const blocked = isFlowBlocked(issue, workflow);
  const rework = isFlowRework(issue, workflow, stage);
  const inDevelopmentWip = isFlowDevelopmentWip(stage, blocked);
  const inReview = stage === 'inReview';
  const inQaQueue = stage === 'qaQueue';
  const inQaWip = inQaQueue || stage === 'qa';
  const cancelled = stage === 'cancelled';
  const inAging =
    Boolean(issue.firstInProgress) &&
    !cancelled &&
    stage !== 'notStarted' &&
    (inDevelopmentWip ||
      inReview ||
      inQaQueue ||
      stage === 'readyForRelease' ||
      stage === 'qa' ||
      stage === 'done');
  return { stage, blocked, rework, inDevelopmentWip, inReview, inQaQueue, inQaWip, inAging };
}

export function isFlowScoped(issue: NormalizedIssue, filters?: CycleOverviewFilters): boolean {
  if (!isAllowedCycleType(issue.type)) return false;
  return !isCycleExcluded(issue, filters);
}
