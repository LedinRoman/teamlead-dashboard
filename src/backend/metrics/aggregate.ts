import type { ResolvedScope } from '@backend/jira/scope';
import type {
  AttentionItem,
  CategoryCount,
  DistributionSummary,
  FieldMapping,
  FlowMetrics,
  IssueSignal,
  MetricsModel,
  NormalizedIssue,
  OwnerLoadRow,
  SeriesPoint,
  SprintContext,
  StatValue,
  StatusCategory,
  MetricRules,
} from '@shared/types';
import type { NormalizeResult } from './normalize';
import { describeDone } from './rules';
import { dayKey, daysBetween, eachDay, isoWeekKey, parseDate, round1 } from './time';

export interface BuildModelOptions {
  scope: ResolvedScope;
  normalized: NormalizeResult;
  rules: MetricRules;
  title: string;
  fromCache: boolean;
  truncated: boolean;
  queriedAt: string;
  windowDays: number;
  windowFrom?: string;
  usedFields?: FieldMapping;
  now?: Date;
}

export function buildMetricsModel(options: BuildModelOptions): MetricsModel {
  const now = options.now ?? new Date();
  const { issues, coverage, excludedCount, overriddenStatuses } = options.normalized;
  const { scope, rules } = options;

  const unfinished = issues.filter((issue) => issue.effectiveCategory !== 'done');
  const done = issues.filter((issue) => issue.effectiveCategory === 'done');
  const active = issues.filter((issue) => issue.effectiveCategory === 'indeterminate');
  const attention = buildAttention(unfinished, rules);

  const caveats = [...scope.caveats];
  if (options.truncated) {
    caveats.push('The result was larger than the page budget, so counts cover only the pages that were fetched.');
  }
  if (!coverage.storyPoints) {
    caveats.push('Story points are unavailable in this scope, so sizing metrics use work item counts.');
  }
  if (overriddenStatuses.length > 0) {
    caveats.push(
      `${describeDone(rules)} In this scope that reclassifies ${overriddenStatuses.join(', ')}, so these numbers differ from Jira's own board and reports.`,
    );
  }
  if (excludedCount > 0) {
    caveats.push(
      `${excludedCount} work ${excludedCount === 1 ? 'item was' : 'items were'} dropped by the excluded-types rule (${rules.excludedTypes.join(', ')}).`,
    );
  }
  if (scope.mode === 'sprint' && !coverage.sprint) {
    caveats.push(
      'The scope is a sprint, but no sprint field came back with the work items, so carry-over cannot be detected. Pick the sprint field on the Connect screen to fix this.',
    );
  }
  const blockingPhrases = countLinkTypes(issues).filter((entry) =>
    rules.blockingLinkTypes.some(
      (candidate) => candidate.trim().toLowerCase() === entry.type.trim().toLowerCase(),
    ),
  );
  if (issues.some((issue) => issue.links.length > 0) && blockingPhrases.length === 0) {
    caveats.push(
      `Work items here have links, but none use a phrase from your blocking-link rule (${rules.blockingLinkTypes.join(', ')}), so nothing is reported as waiting on linked work. Jira localises these phrases; the ones present here are listed in the appendix.`,
    );
  }
  const undatedDone = done.filter((issue) => !issue.doneAt).length;
  if (undatedDone > 0) {
    caveats.push(
      `${undatedDone} of ${done.length} completed work items have no completion timestamp, because a rule counts their status as done while Jira records no resolution date and no changelog was available. They count in totals but not in throughput, lead time or cycle time.`,
    );
  }

  const sprint = scope.sprint ? buildSprintContext(scope.sprint, now) : undefined;

  return {
    title: options.title,
    scopeLabel: scope.label,
    jql: scope.jql,
    mode: scope.mode,
    windowDays: scope.windowDays,
    windowFrom: options.windowFrom ?? scope.windowFrom,
    usedFields: options.usedFields,
    queriedAt: options.queriedAt,
    fromCache: options.fromCache,
    issueCount: issues.length,
    truncated: options.truncated,
    caveats,
    fieldCoverage: coverage,
    sprint,
    linkTypesSeen: countLinkTypes(issues),
    stats: buildStats(issues, done, active, attention, coverage.storyPoints),
    attentionComposition: describeAttention(attention, rules),
    statusDistribution: countBy(issues, (issue) => issue.status, statusTone),
    statusCategoryDistribution: buildStatusCategorySplit(issues),
    typeDistribution: countBy(issues, (issue) => issue.type),
    priorityDistribution: countBy(issues, (issue) => issue.priority ?? 'No priority'),
    parentDistribution: countBy(issues, (issue) => issue.parentKey ?? 'No parent'),
    ownerLoad: buildOwnerLoad(issues, scope.members),
    attention,
    resolvedPerDay: buildResolvedPerDay(done, options.windowDays, sprint, now),
    remainingOverTime: sprint ? buildRemainingOverTime(issues, sprint, now) : null,
    flow: buildFlow(issues, unfinished, done, options.windowDays, now, options.windowFrom),
    issues,
  };
}

/* ------------------------------------------------------------------ stats --- */

function buildStats(
  all: NormalizedIssue[],
  done: NormalizedIssue[],
  active: NormalizedIssue[],
  attention: AttentionItem[],
  hasStoryPoints: boolean,
): StatValue[] {
  const totalPoints = sumPoints(all);
  const donePoints = sumPoints(done);
  return [
    {
      label: 'Scope',
      value: all.length,
      unit: 'work items',
      tone: 'neutral',
      hint: hasStoryPoints ? `${round1(totalPoints)} story points` : undefined,
    },
    {
      label: 'Done',
      value: done.length,
      unit: 'work items',
      tone: 'success',
      hint: hasStoryPoints
        ? `${round1(donePoints)} of ${round1(totalPoints)} story points`
        : all.length > 0
          ? `${Math.round((done.length / all.length) * 100)}% of scope`
          : undefined,
    },
    {
      label: 'In progress',
      value: active.length,
      unit: 'work items',
      tone: 'info',
    },
    {
      label: 'Needs attention',
      value: attention.length,
      unit: 'work items',
      tone: attention.length > 0 ? 'warning' : 'success',
    },
  ];
}

function describeAttention(attention: AttentionItem[], rules: MetricRules): string[] {
  const reasons = new Map<string, number>();
  for (const item of attention) {
    for (const reason of item.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const lines = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason}: ${count}`);
  lines.push(
    `Thresholds: stale after ${rules.staleDays}d without an update, very stale after ${rules.veryStaleDays}d, due soon within ${rules.dueSoonDays}d.`,
  );
  lines.push(
    `Blocked was checked against statuses (${rules.blockedStatuses.join(', ')}) and labels (${rules.blockedLabels.join(', ')}) only. Blockers recorded only in comments were not checked.`,
  );
  return lines;
}

/* ------------------------------------------------------------- categories --- */

function countBy(
  issues: NormalizedIssue[],
  pick: (issue: NormalizedIssue) => string,
  tone?: (label: string, issues: NormalizedIssue[]) => CategoryCount['tone'],
): CategoryCount[] {
  const grouped = new Map<string, NormalizedIssue[]>();
  for (const issue of issues) {
    const label = pick(issue) || 'Unknown';
    const bucket = grouped.get(label);
    if (bucket) bucket.push(issue);
    else grouped.set(label, [issue]);
  }
  return [...grouped.entries()]
    .map(([label, bucket]) => ({
      label,
      value: bucket.length,
      tone: tone?.(label, bucket),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function countLinkTypes(issues: NormalizedIssue[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    for (const link of issue.links) counts.set(link.type, (counts.get(link.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function statusTone(_label: string, issues: NormalizedIssue[]): CategoryCount['tone'] {
  return categoryTone(issues[0]?.effectiveCategory ?? 'unknown');
}

function categoryTone(category: StatusCategory): CategoryCount['tone'] {
  if (category === 'done') return 'success';
  if (category === 'indeterminate') return 'info';
  return 'neutral';
}

function buildStatusCategorySplit(issues: NormalizedIssue[]): CategoryCount[] {
  const labels: Array<{ label: string; category: StatusCategory; tone: CategoryCount['tone'] }> = [
    { label: 'To do', category: 'new', tone: 'neutral' },
    { label: 'In progress', category: 'indeterminate', tone: 'info' },
    { label: 'Done', category: 'done', tone: 'success' },
  ];
  const rows = labels.map(({ label, category, tone }) => ({
    label,
    value: issues.filter((issue) => issue.effectiveCategory === category).length,
    tone,
  }));
  const unknown = issues.filter((issue) => issue.effectiveCategory === 'unknown').length;
  if (unknown > 0) rows.push({ label: 'Uncategorised', value: unknown, tone: 'warning' });
  return rows.filter((row) => row.value > 0);
}

/* ------------------------------------------------------------ owner load --- */

function buildOwnerLoad(
  issues: NormalizedIssue[],
  members: Array<{ id: string; displayName: string; active?: boolean }> | undefined,
): OwnerLoadRow[] {
  const rows = new Map<string, OwnerLoadRow>();

  const ensure = (id: string | undefined, name: string, active?: boolean): OwnerLoadRow => {
    const rowKey = id ?? `name:${name}`;
    const existing = rows.get(rowKey);
    if (existing) return existing;
    const row: OwnerLoadRow = {
      id,
      name,
      active: 0,
      notStarted: 0,
      done: 0,
      stale: 0,
      blocked: 0,
      storyPoints: 0,
      total: 0,
      ownerStatus: id === undefined ? 'unassigned' : active === false ? 'inactive' : active === true ? 'active' : 'unknown',
    };
    rows.set(rowKey, row);
    return row;
  };

  // Team members with no work still matter to a lead, so seed them first.
  for (const member of members ?? []) ensure(member.id, member.displayName, member.active);

  for (const issue of issues) {
    const row = ensure(issue.assigneeId, issue.assigneeName, issue.assigneeActive);
    row.total += 1;
    row.storyPoints = round1(row.storyPoints + (issue.storyPoints ?? 0));
    if (issue.effectiveCategory === 'done') row.done += 1;
    else if (issue.effectiveCategory === 'indeterminate') row.active += 1;
    else row.notStarted += 1;
    if (issue.signals.includes('stale') || issue.signals.includes('very-stale')) row.stale += 1;
    if (issue.signals.includes('blocked') || issue.signals.includes('blocked-inferred')) row.blocked += 1;
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.active + b.notStarted - (a.active + a.notStarted) ||
      b.total - a.total ||
      a.name.localeCompare(b.name),
  );
}

/* -------------------------------------------------------------- attention --- */

const SIGNAL_REASONS: Partial<Record<IssueSignal, string>> = {
  blocked: 'Blocked by status',
  'blocked-inferred': 'Blocked by label (inferred)',
  'very-stale': 'Very stale',
  stale: 'Stale',
  unowned: 'Unassigned',
  'inactive-owner': 'Owner is inactive in Jira',
  overdue: 'Overdue',
  'due-soon': 'Due soon',
  'unresolved-dependency': 'Waiting on linked work',
};

const HIGH_SIGNALS = new Set<IssueSignal>(['blocked', 'overdue', 'very-stale', 'inactive-owner']);

function buildAttention(unfinished: NormalizedIssue[], rules: MetricRules): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const issue of unfinished) {
    const matched = issue.signals.filter((signal) => rules.attentionSignals.includes(signal));
    if (matched.length === 0) continue;
    const reasons = matched.map((signal) => SIGNAL_REASONS[signal] ?? signal);
    items.push({
      key: issue.key,
      url: issue.url,
      summary: issue.summary,
      owner: issue.assigneeName,
      status: issue.status,
      priority: issue.priority,
      reasons,
      evidence: buildEvidence(issue, matched, rules),
      ageDays: issue.updatedAgeDays,
      severity: matched.some((signal) => HIGH_SIGNALS.has(signal))
        ? 'high'
        : matched.length > 1
          ? 'medium'
          : 'low',
    });
  }
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return items.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.ageDays - a.ageDays,
  );
}

function buildEvidence(issue: NormalizedIssue, signals: IssueSignal[], rules: MetricRules): string {
  const parts: string[] = [`status ${issue.status}`, `updated ${formatDays(issue.updatedAgeDays)} ago`];
  if (signals.includes('overdue') && issue.dueInDays !== undefined) {
    parts.push(`due ${formatDays(Math.abs(issue.dueInDays))} ago`);
  } else if (signals.includes('due-soon') && issue.dueInDays !== undefined) {
    parts.push(`due in ${formatDays(issue.dueInDays)}`);
  }
  if (signals.includes('blocked-inferred')) {
    const label = issue.labels.find((candidate) =>
      rules.blockedLabels.some((blocked) => candidate.toLowerCase() === blocked.toLowerCase()),
    );
    if (label) parts.push(`label ${label}`);
  }
  if (signals.includes('unresolved-dependency')) {
    const blocking = issue.links.find(
      (link) =>
        rules.blockingLinkTypes.some(
          (candidate) => candidate.trim().toLowerCase() === link.type.trim().toLowerCase(),
        ) &&
        link.statusCategory !== undefined &&
        link.statusCategory !== 'done',
    );
    if (blocking) parts.push(`${blocking.type} ${blocking.key} (${blocking.status ?? 'unknown'})`);
  }
  return parts.join(', ');
}

function formatDays(days: number): string {
  if (days < 1) return `${Math.max(0, Math.round(days * 24))}h`;
  return `${Math.round(days)}d`;
}

/* ------------------------------------------------------------------ time --- */

function buildSprintContext(
  sprint: NonNullable<ResolvedScope['sprint']>,
  now: Date,
): SprintContext {
  const start = parseDate(sprint.startDate);
  const end = parseDate(sprint.endDate);
  const context: SprintContext = {
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    completeDate: sprint.completeDate,
    goal: sprint.goal,
  };
  if (start && end) {
    context.daysTotal = Math.max(1, Math.round(daysBetween(start, end)));
    const reference = parseDate(sprint.completeDate) ?? now;
    context.daysElapsed = Math.max(0, Math.round(daysBetween(start, reference)));
    context.daysRemaining = Math.max(0, Math.round(daysBetween(reference, end)));
  }
  return context;
}

function buildResolvedPerDay(
  done: NormalizedIssue[],
  windowDays: number,
  sprint: SprintContext | undefined,
  now: Date,
): SeriesPoint[] {
  const start =
    parseDate(sprint?.startDate) ?? new Date(now.getTime() - windowDays * 86_400_000);
  const end = parseDate(sprint?.completeDate) ?? parseDate(sprint?.endDate) ?? now;
  const upperBound = end.getTime() > now.getTime() ? now : end;
  const counts = new Map<string, number>();
  for (const day of eachDay(start, upperBound)) counts.set(dayKey(day), 0);
  for (const issue of done) {
    const finished = parseDate(issue.doneAt);
    if (!finished) continue;
    const key = dayKey(finished);
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

/**
 * Remaining unfinished work per day, reconstructed from completion times. It does
 * not model scope added mid-sprint, which needs sprint-change history.
 */
function buildRemainingOverTime(
  issues: NormalizedIssue[],
  sprint: SprintContext,
  now: Date,
): SeriesPoint[] | null {
  const start = parseDate(sprint.startDate);
  const end = parseDate(sprint.endDate);
  if (!start || !end || issues.length === 0) return null;
  const upperBound = end.getTime() > now.getTime() ? now : end;
  const doneTimes = issues
    .map((issue) => parseDate(issue.doneAt)?.getTime())
    .filter((time): time is number => time !== undefined);

  return eachDay(start, upperBound).map((day) => {
    const endOfDay = day.getTime() + 86_400_000 - 1;
    const doneByThen = doneTimes.filter((time) => time <= endOfDay).length;
    return { label: dayKey(day), value: issues.length - doneByThen };
  });
}

/* ------------------------------------------------------------------ flow --- */

function windowStart(windowDays: number, now: Date, windowFrom?: string): Date {
  if (windowFrom) {
    const parsed = parseDate(`${windowFrom}T00:00:00`);
    if (parsed) return parsed;
  }
  return new Date(now.getTime() - windowDays * 86_400_000);
}

function buildFlow(
  all: NormalizedIssue[],
  unfinished: NormalizedIssue[],
  done: NormalizedIssue[],
  windowDays: number,
  now: Date,
  windowFrom?: string,
): FlowMetrics {
  const start = windowStart(windowDays, now, windowFrom);
  const inWindow = done.filter((issue) => {
    const finished = parseDate(issue.doneAt);
    return Boolean(finished && finished.getTime() >= start.getTime() && finished.getTime() <= now.getTime());
  });
  return {
    throughputByWeek: buildThroughputByWeek(inWindow, start, now),
    leadTimeDays: summarize(inWindow.map((issue) => issue.leadTimeDays)),
    cycleTimeDays: summarize(inWindow.map((issue) => issue.cycleTimeDays)),
    agingWip: buildAgingBuckets(unfinished),
  };
}

function buildThroughputByWeek(done: NormalizedIssue[], start: Date, now: Date): SeriesPoint[] {
  const cutoff = start.getTime();
  const counts = new Map<string, number>();
  for (const issue of done) {
    const finished = parseDate(issue.doneAt);
    if (!finished || finished.getTime() < cutoff || finished.getTime() > now.getTime()) continue;
    const key = isoWeekKey(finished);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }));
}

const AGING_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '0-1d', max: 2 },
  { label: '2-3d', max: 4 },
  { label: '4-7d', max: 8 },
  { label: '8-14d', max: 15 },
  { label: '15-30d', max: 31 },
  { label: '30d+', max: Number.POSITIVE_INFINITY },
];

function buildAgingBuckets(unfinished: NormalizedIssue[]): SeriesPoint[] {
  const counts = AGING_BUCKETS.map((bucket) => ({ label: bucket.label, value: 0 }));
  for (const issue of unfinished) {
    const index = AGING_BUCKETS.findIndex((bucket) => issue.updatedAgeDays < bucket.max);
    const target = counts[index === -1 ? counts.length - 1 : index];
    if (target) target.value += 1;
  }
  return counts;
}

export function summarize(values: Array<number | undefined>): DistributionSummary | null {
  const clean = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: percentile(sorted, 0.5),
    p85: percentile(sorted, 0.85),
    average: round1(sorted.reduce((total, value) => total + value, 0) / sorted.length),
    max: round1(sorted[sorted.length - 1] ?? 0),
  };
}

export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round1(sorted[lower] ?? 0);
  const weight = index - lower;
  return round1((sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight);
}

function sumPoints(issues: NormalizedIssue[]): number {
  return issues.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0);
}
