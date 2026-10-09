/** Shared domain model. Imported by both server routes and client components. */

export type Deployment = 'cloud' | 'server';
export type AuthKind = 'basic' | 'bearer';

export interface FieldMapping {
  storyPointsField?: string;
  sprintField?: string;
  epicLinkField?: string;
}

/** Defaults, then project, then board — more specific wins. Empty means inherit. */
export interface ScopedFieldMappings {
  defaults: FieldMapping;
  projects: Record<string, FieldMapping>;
  boards: Record<string, FieldMapping>;
}

export interface ConnectionPublic extends FieldMapping {
  id: string;
  name: string;
  baseUrl: string;
  deployment: Deployment;
  authKind: AuthKind;
  email?: string;
  accountId?: string;
  displayName?: string;
  secretHint: string;
  createdAt: string;
  updatedAt: string;
}

export interface JiraFieldOption {
  id: string;
  name: string;
  custom: boolean;
  schemaType?: string;
  /** Plugin identifier for the field type. Identical across sites and languages. */
  schemaCustom?: string;
}

export interface JiraStatusOption {
  id: string;
  name: string;
  /** The category Jira itself files this status under. */
  category: StatusCategory;
}

export interface JiraIssueTypeOption {
  id: string;
  name: string;
  subtask: boolean;
}

export interface JiraProjectOption {
  id: string;
  key: string;
  name: string;
}

export interface JiraBoardOption {
  id: number;
  name: string;
  type: string;
  projectKey?: string;
}

export interface JiraSprintOption {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future' | string;
  boardId?: number;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

export interface JiraUserOption {
  /** accountId on Cloud, username/key on Server/DC. */
  id: string;
  displayName: string;
  email?: string;
  active: boolean;
  avatarUrl?: string;
}

export interface TeamMember {
  id: string;
  displayName: string;
  active?: boolean;
}

export interface TeamBoard {
  id: number;
  name: string;
}

export interface Team {
  id: string;
  connectionId: string;
  name: string;
  members: TeamMember[];
  boards: TeamBoard[];
  projects: string[];
  extraJql?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Every knob that changes what a metric means. All status and label lists are
 * compared case-insensitively against Jira status names, so they survive a Jira
 * admin renaming things by capitalisation alone.
 */
export interface MetricRules {
  /**
   * Statuses counted as done even when Jira's own category is not Done. This is
   * how "In Review already counts as delivered" is expressed.
   */
  doneStatuses: string[];
  /**
   * Statuses never counted as done, even when Jira's category says Done. Applied
   * after `doneStatuses`, so it always wins.
   */
  notDoneStatuses: string[];
  /** Statuses counted as in progress even when Jira's category is To Do. */
  activeStatuses: string[];
  /**
   * Statuses whose first entry starts the cycle-time clock. Empty means the first
   * move into any in-progress status starts it.
   */
  workStartedStatuses: string[];
  /** Issue types dropped from every metric, for example Sub-task or Epic. */
  excludedTypes: string[];
  /** Days without an update before unfinished work counts as stale. */
  staleDays: number;
  /** Days without an update before unfinished work counts as very stale. */
  veryStaleDays: number;
  /** Days until a due date still counts as time-sensitive. */
  dueSoonDays: number;
  /** Statuses that mean "blocked" on this Jira site. */
  blockedStatuses: string[];
  /** Labels that mean "blocked". */
  blockedLabels: string[];
  /**
   * Link phrases that mean this work item is the one waiting. Jira localises these
   * phrases, so a site in another language needs its own list.
   */
  blockingLinkTypes: string[];
  /** Signals that put a work item into the "needs attention" count. */
  attentionSignals: IssueSignal[];
  /** Default lookback window in days for flow metrics. */
  defaultWindowDays: number;
  /** Snapshot time-to-live for shared Jira payloads and computed screens, in seconds. */
  cacheTtlSeconds: number;
  /** Drop issues with [QA] in the title on Overview, Flow, Predictability and Quality. */
  excludeQaTitle: boolean;
}

export const DEFAULT_METRIC_RULES: MetricRules = {
  doneStatuses: [],
  notDoneStatuses: [],
  activeStatuses: [],
  workStartedStatuses: [],
  excludedTypes: [],
  staleDays: 3,
  veryStaleDays: 10,
  dueSoonDays: 3,
  blockedStatuses: ['blocked', 'on hold', 'impediment', 'waiting'],
  blockedLabels: ['blocked', 'blocker', 'impediment'],
  blockingLinkTypes: ['is blocked by', 'depends on', 'is caused by'],
  attentionSignals: [
    'blocked',
    'blocked-inferred',
    'very-stale',
    'stale',
    'unowned',
    'inactive-owner',
    'overdue',
    'due-soon',
    'unresolved-dependency',
  ],
  defaultWindowDays: 60,
  cacheTtlSeconds: 900,
  excludeQaTitle: false,
};

/* ------------------------------------------------------------------ scope --- */

export type SprintSelector = 'active' | 'last-closed' | number;

export type ScopeSpec =
  | { kind: 'jql'; jql: string; label?: string }
  | { kind: 'sprint'; sprintId: number; label?: string }
  | { kind: 'board'; boardId: number; mode: 'active-sprint' | 'open' | 'recent'; label?: string }
  | { kind: 'team'; teamId: string; mode: 'active-sprint' | 'open' | 'recent'; label?: string }
  | { kind: 'person'; personId: string; teamId?: string; mode: 'open' | 'recent'; label?: string };

export interface ScopeRequest {
  scope: ScopeSpec;
  /** Lookback in days for `recent` modes and flow metrics. */
  windowDays?: number;
  /** Inclusive start of the window (`YYYY-MM-DD`). Empty means rolling from now. */
  windowFrom?: string;
  /** Pull changelogs so cycle time and status-transition metrics can be computed. */
  withChangelog?: boolean;
  /** Page the issue changelog API when search-expand is truncated. */
  fullChangelog?: boolean;
  /** Bypass the local cache for this request. */
  refresh?: boolean;
  /** Overview Cycle Time: first transition into this status starts the clock. */
  cycleStartStatus?: string;
  /** Overview Cycle Time: first transition into this status ends the clock. */
  cycleEndStatus?: string;
  /** Keep status transitions on normalized issues (Flow). */
  withTimeline?: boolean;
  /** Extra Jira field ids to fetch with the search (Quality diagnostic fields). */
  extraFields?: string[];
}

/* ------------------------------------------------------------- normalized --- */

export type StatusCategory = 'done' | 'indeterminate' | 'new' | 'unknown';

export type IssueSignal =
  | 'done'
  | 'active'
  | 'not-started'
  | 'stale'
  | 'very-stale'
  | 'blocked'
  | 'blocked-inferred'
  | 'unowned'
  | 'inactive-owner'
  | 'overdue'
  | 'due-soon'
  | 'carry-over'
  | 'no-estimate'
  | 'unresolved-dependency';

/**
 * The signals a lead can choose to count as "needs attention". Signals absent
 * from this list are still computed and still shown on a work item; they just do
 * not inflate the headline number.
 */
export const ATTENTION_SIGNAL_OPTIONS: Array<{
  signal: IssueSignal;
  label: string;
  description: string;
}> = [
  { signal: 'blocked', label: 'Blocked by status', description: 'Status is one of the blocked statuses.' },
  { signal: 'blocked-inferred', label: 'Blocked by label', description: 'Carries one of the blocked labels.' },
  { signal: 'very-stale', label: 'Very stale', description: 'No update for the very-stale threshold.' },
  { signal: 'stale', label: 'Stale', description: 'No update for the stale threshold.' },
  { signal: 'unowned', label: 'Unassigned', description: 'Unfinished work with no assignee.' },
  { signal: 'inactive-owner', label: 'Inactive owner', description: 'Assignee is deactivated in Jira.' },
  { signal: 'overdue', label: 'Overdue', description: 'Due date is in the past.' },
  { signal: 'due-soon', label: 'Due soon', description: 'Due inside the due-soon threshold.' },
  {
    signal: 'unresolved-dependency',
    label: 'Waiting on linked work',
    description: 'A linked work item is not done yet.',
  },
  { signal: 'carry-over', label: 'Carry-over', description: 'Present in more than one sprint.' },
  { signal: 'no-estimate', label: 'No estimate', description: 'Story points field is mapped but empty.' },
];

export interface NormalizedLink {
  key: string;
  type: string;
  direction: 'inward' | 'outward';
  status?: string;
  statusCategory?: StatusCategory;
}

export interface NormalizedIssue {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  /** The category Jira reports for this status. */
  statusCategory: StatusCategory;
  /** The category after the configured rules are applied. Metrics use this one. */
  effectiveCategory: StatusCategory;
  priority?: string;
  assigneeId?: string;
  assigneeName: string;
  assigneeActive?: boolean;
  reporterName?: string;
  created: string;
  updated: string;
  /** Jira's own resolution date. Absent for work that is done only by the rules. */
  resolved?: string;
  /**
   * When the work became done under the current rules. Equals `resolved` in the
   * common case; falls back to the changelog when a rule counts an unresolved
   * status as done.
   */
  doneAt?: string;
  doneAtSource: 'resolution' | 'changelog' | 'none';
  dueDate?: string;
  createdAgeDays: number;
  updatedAgeDays: number;
  resolvedAgeDays?: number;
  dueInDays?: number;
  storyPoints?: number;
  labels: string[];
  components: string[];
  fixVersions: string[];
  parentKey?: string;
  parentSummary?: string;
  sprintNames: string[];
  sprintIds: number[];
  links: NormalizedLink[];
  signals: IssueSignal[];
  /** Set when a changelog was fetched for this issue. */
  firstInProgress?: string;
  cycleTimeDays?: number;
  leadTimeDays?: number;
  /** Last status-changelog timestamp; time in the current Jira status. */
  statusEnteredAt?: string;
  /** Compact status changelog, only when normalize ran with `withTimeline`. */
  statusTransitions?: StatusTransition[];
}

export interface StatusTransition {
  at: string;
  from?: string;
  to: string;
}

/** Exclusive analytical stages plus overlay/neutral groups for Flow. */
export type FlowStageId =
  | 'notStarted'
  | 'development'
  | 'review'
  | 'rework'
  | 'qa'
  | 'readyForRelease'
  | 'inReview'
  | 'qaQueue'
  | 'done'
  | 'cancelled'
  | 'other';

/**
 * Maps Jira status names onto Flow stages. Exclusive lists must not overlap.
 * `blocked` is an overlay and may repeat names from exclusive groups.
 */
export interface FlowWorkflow {
  notStarted: string[];
  development: string[];
  review: string[];
  rework: string[];
  qa: string[];
  readyForRelease: string[];
  done: string[];
  cancelled: string[];
  blocked: string[];
  /** Neutral «В проверке» (development cycle-end). */
  inReview: string[];
  /** Ready to QA and similar. Counts as QA WIP until `qaEnd`. */
  qaQueue: string[];
  /** QA WIP ends on the first transition into one of these (Проверка or Fix). Overlay, not an exclusive stage. */
  qaEnd: string[];
  cycleStart: string;
  cycleEnd: string;
  /** Floor for a Flow issue-timeline slice, as percent of the bar. 0 = true duration. */
  timelineMinSegmentPct: number;
}

/* ---------------------------------------------------------------- metrics --- */

export interface StatValue {
  label: string;
  value: number;
  unit?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  hint?: string;
}

export interface CategoryCount {
  label: string;
  value: number;
  tone?: StatValue['tone'];
}

export interface SeriesPoint {
  label: string;
  value: number;
  hint?: string;
}

export interface OwnerLoadRow {
  id?: string;
  name: string;
  active: number;
  notStarted: number;
  done: number;
  stale: number;
  blocked: number;
  storyPoints: number;
  total: number;
  ownerStatus: 'active' | 'inactive' | 'unassigned' | 'unknown';
}

export interface AttentionItem {
  key: string;
  url: string;
  summary: string;
  owner: string;
  status: string;
  priority?: string;
  reasons: string[];
  evidence: string;
  ageDays: number;
  severity: 'high' | 'medium' | 'low';
}

export interface FlowMetrics {
  throughputByWeek: SeriesPoint[];
  leadTimeDays: DistributionSummary | null;
  cycleTimeDays: DistributionSummary | null;
  agingWip: SeriesPoint[];
}

export interface DistributionSummary {
  count: number;
  median: number;
  p85: number;
  average: number;
  max: number;
}

export interface SprintContext {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
  daysElapsed?: number;
  daysTotal?: number;
  daysRemaining?: number;
}

export interface MetricsModel {
  title: string;
  scopeLabel: string;
  jql: string;
  mode: 'sprint' | 'snapshot';
  windowDays?: number;
  windowFrom?: string;
  usedFields?: FieldMapping;
  queriedAt: string;
  fromCache: boolean;
  issueCount: number;
  truncated: boolean;
  caveats: string[];
  fieldCoverage: {
    storyPoints: boolean;
    sprint: boolean;
    dueDate: boolean;
    changelog: boolean;
  };
  sprint?: SprintContext;
  /**
   * Distinct link phrases present in this scope, most common first. Jira localises
   * them, so this is how a reader learns what to put in the blocking-link rule.
   */
  linkTypesSeen: Array<{ type: string; count: number }>;
  stats: StatValue[];
  attentionComposition: string[];
  statusDistribution: CategoryCount[];
  statusCategoryDistribution: CategoryCount[];
  typeDistribution: CategoryCount[];
  priorityDistribution: CategoryCount[];
  parentDistribution: CategoryCount[];
  ownerLoad: OwnerLoadRow[];
  attention: AttentionItem[];
  resolvedPerDay: SeriesPoint[];
  remainingOverTime: SeriesPoint[] | null;
  flow: FlowMetrics;
  issues: NormalizedIssue[];
}

/* --------------------------------------------------------------- widgets --- */

export type WidgetType =
  | 'stats'
  | 'status-distribution'
  | 'status-category'
  | 'owner-load'
  | 'attention'
  | 'issue-table'
  | 'throughput'
  | 'resolved-per-day'
  | 'remaining'
  | 'aging-wip'
  | 'type-distribution'
  | 'priority-distribution'
  | 'parent-distribution'
  | 'cycle-time'
  | 'lead-time'
  | 'sprint-context';

export type WidgetWidth = 'third' | 'half' | 'full';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title?: string;
  width: WidgetWidth;
  scope: ScopeSpec;
  windowDays?: number;
  /** Requests changelog-backed metrics for this widget's scope. */
  withChangelog?: boolean;
  limit?: number;
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: WidgetConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface WidgetCatalogEntry {
  type: WidgetType;
  label: string;
  description: string;
  defaultWidth: WidgetWidth;
  /** Requires a changelog fetch, which costs one extra Jira call per issue. */
  needsChangelog?: boolean;
  /** Only meaningful when the scope resolves to a single sprint. */
  sprintOnly?: boolean;
}

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { type: 'stats', label: 'Four-stat bar', description: 'Scope, done, in progress, needs attention.', defaultWidth: 'full' },
  { type: 'sprint-context', label: 'Sprint context', description: 'Sprint name, dates, days remaining, goal.', defaultWidth: 'half', sprintOnly: true },
  { type: 'status-distribution', label: 'Status distribution', description: 'Work item count per Jira status.', defaultWidth: 'half' },
  { type: 'status-category', label: 'Status category split', description: 'To do / in progress / done donut.', defaultWidth: 'third' },
  { type: 'owner-load', label: 'Owner load', description: 'Active, not started, stale, blocked and done per assignee.', defaultWidth: 'full' },
  { type: 'attention', label: 'Risk and attention', description: 'Blocked, stale, unassigned, overdue work with evidence.', defaultWidth: 'full' },
  { type: 'issue-table', label: 'Work item table', description: 'Highest-priority unfinished work items.', defaultWidth: 'full' },
  { type: 'throughput', label: 'Throughput by week', description: 'Resolved work items per calendar week.', defaultWidth: 'half' },
  { type: 'resolved-per-day', label: 'Resolved per day', description: 'Completed work items per day in the window.', defaultWidth: 'half' },
  { type: 'remaining', label: 'Remaining work', description: 'Unfinished work over the sprint, derived from resolution dates.', defaultWidth: 'half', sprintOnly: true },
  { type: 'aging-wip', label: 'Aging WIP', description: 'Unfinished work bucketed by days since last update.', defaultWidth: 'half' },
  { type: 'type-distribution', label: 'Work type split', description: 'Count per issue type.', defaultWidth: 'third' },
  { type: 'priority-distribution', label: 'Priority split', description: 'Count per priority.', defaultWidth: 'third' },
  { type: 'parent-distribution', label: 'Epic / parent split', description: 'Count per parent or epic.', defaultWidth: 'third' },
  { type: 'cycle-time', label: 'Cycle time', description: 'First In Progress to resolution. Needs changelog.', defaultWidth: 'third', needsChangelog: true },
  { type: 'lead-time', label: 'Lead time', description: 'Created to resolved, median and p85.', defaultWidth: 'third' },
];

/* ---------------------------------------------------------------- person --- */

export interface PersonSummary {
  id: string;
  name: string;
  active?: boolean;
  wip: number;
  notStarted: number;
  stale: number;
  blocked: number;
  doneInWindow: number;
  storyPointsDone: number;
  medianCycleTimeDays: number | null;
  medianLeadTimeDays: number | null;
  oldestWipDays: number | null;
}

export interface PeopleComparison {
  windowDays: number;
  teamMedianLeadTimeDays: number | null;
  teamMedianCycleTimeDays: number | null;
  people: PersonSummary[];
  caveats: string[];
  queriedAt: string;
  jql: string;
}
