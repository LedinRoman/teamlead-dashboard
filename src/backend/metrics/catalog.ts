import type { MetricRules } from '@shared/types';
import { describeDone } from './rules';

export interface FormulaEntry {
  name: string;
  /** The definition itself, in terms a reader can check against Jira by hand. */
  formula: string;
  /** Jira fields the number is read from. */
  reads: string;
  /** Settings that change this number, named as they appear on the Settings screen. */
  settings: string[];
  /** What the number cannot see. Omitted only when there is genuinely nothing. */
  blindSpot?: string;
}

export interface FormulaGroup {
  id: string;
  title: string;
  intro: string;
  entries: FormulaEntry[];
}

const list = (values: string[], empty: string): string =>
  values.length > 0 ? values.join(', ') : empty;

/**
 * The definition of every number this tool shows, rendered against the rules that
 * are actually in force. This is the single source for the Formulas screen, so a
 * metric whose meaning depends on a setting says so in the same place the setting
 * is described.
 */
export function metricFormulas(rules: MetricRules): FormulaGroup[] {
  const doneSentence = describeDone(rules);

  return [
    {
      id: 'basis',
      title: 'What every number is built on',
      intro:
        'One paginated Jira search per scope produces a set of work items. Every metric below is a count, a share or a duration over that one set, computed locally. Nothing is asked of Jira twice.',
      entries: [
        {
          name: 'Scope (the work item set)',
          formula:
            'The JQL for the selected scope is run with pagination, then work items whose type is excluded are dropped. Every other metric operates on what remains.',
          reads: 'The JQL shown in the appendix under each screen',
          settings: [`Excluded work types (currently ${list(rules.excludedTypes, 'none')})`],
          blindSpot:
            'Work you cannot see in Jira is not in the set. A scope larger than the page budget is cut off, and the screen says so when that happens.',
        },
        {
          name: 'Effective category',
          formula:
            'Each work item gets one of To do, In progress or Done. Jira reports a category for its status; the rules may override it. Precedence: never-done, then counts-as-done, then counts-as-in-progress, then Jira.',
          reads: 'fields.status.statusCategory.key, fields.status.name',
          settings: [
            `Counts as done (${list(rules.doneStatuses, 'none')})`,
            `Never counts as done (${list(rules.notDoneStatuses, 'none')})`,
            `Counts as in progress (${list(rules.activeStatuses, 'none')})`,
          ],
          blindSpot:
            'Only the current status is read. A work item that passed through a status and left it is not caught here, only in the changelog-based durations.',
        },
        {
          name: 'Completion time',
          formula:
            'Jira\u2019s resolution date when it exists. When a rule makes an unresolved status count as done, the time of the last transition into a done status is used instead, which requires a changelog. Otherwise the work item has no completion time.',
          reads: 'fields.resolutiondate, changelog status transitions',
          settings: ['Counts as done', 'Never counts as done'],
          blindSpot:
            'A work item that is done by rule with no changelog available counts in totals but is absent from throughput, lead time and cycle time. The number of such items is stated on screen.',
        },
      ],
    },
    {
      id: 'headline',
      title: 'The four headline numbers',
      intro: 'The bar at the top of Overview, Sprint and any dashboard using the four-stat widget.',
      entries: [
        {
          name: 'Scope',
          formula: 'Count of work items in the set. The hint below shows summed story points when the field is mapped and populated.',
          reads: 'Story points field from Connect',
          settings: ['Story points field (Connect screen)'],
        },
        {
          name: 'Done',
          formula: `Count where effective category is Done. ${doneSentence} The hint shows done story points out of total, or the share of scope when story points are unavailable.`,
          reads: 'fields.status, story points field',
          settings: ['Counts as done', 'Never counts as done'],
        },
        {
          name: 'In progress',
          formula: 'Count where effective category is In progress.',
          reads: 'fields.status',
          settings: ['Counts as in progress'],
        },
        {
          name: 'Needs attention',
          formula:
            'Count of unfinished work items carrying at least one selected attention signal. A work item with three problems is counted once here and listed once in the table, with all three reasons.',
          reads: 'Derived from the signals below',
          settings: [`Attention signals (${rules.attentionSignals.length} of 11 selected)`],
          blindSpot:
            'Only the selected signals are counted. Turning a signal off does not remove it from a work item\u2019s reasons, it removes it from this total.',
        },
      ],
    },
    {
      id: 'signals',
      title: 'Signals on a single work item',
      intro:
        'Signals are derived per work item and only for unfinished work, apart from Done itself. This is why a completed work item never appears as blocked or stale.',
      entries: [
        {
          name: 'Stale / Very stale',
          formula: `Days since fields.updated >= ${rules.staleDays} is stale; >= ${rules.veryStaleDays} is very stale. A work item is one or the other, never both.`,
          reads: 'fields.updated',
          settings: [`Stale after (${rules.staleDays}d)`, `Very stale after (${rules.veryStaleDays}d)`],
          blindSpot:
            'Any edit updates the timestamp, including a label change or a comment. Quiet real progress and a cosmetic edit look the same.',
        },
        {
          name: 'Blocked / Blocked by label',
          formula: `Status matches one of: ${list(rules.blockedStatuses, 'none')}. Otherwise, a label matching one of: ${list(rules.blockedLabels, 'none')} is reported as inferred.`,
          reads: 'fields.status.name, fields.labels',
          settings: ['Statuses that mean blocked', 'Labels that mean blocked'],
          blindSpot:
            'A blocker written only in a comment, a flag, or a custom field is not checked. The screen never claims there are no blockers, only that these two places were checked.',
        },
        {
          name: 'Unassigned / Inactive owner',
          formula: 'Unfinished with no assignee, or with an assignee Jira reports as inactive.',
          reads: 'fields.assignee.accountId, fields.assignee.active',
          settings: [],
          blindSpot:
            'Server and Data Center do not always return the active flag, in which case inactive owners cannot be detected.',
        },
        {
          name: 'Overdue / Due soon',
          formula: `Due date before today is overdue; due within ${rules.dueSoonDays} days is due soon.`,
          reads: 'fields.duedate',
          settings: [`Due soon within (${rules.dueSoonDays}d)`],
          blindSpot:
            'Only the Jira due date field. Sprint end dates and dates written in the description are not read.',
        },
        {
          name: 'Carry-over',
          formula:
            'The scope is one sprint and the work item belongs to more than one sprint, meaning it was present before this one.',
          reads: 'Sprint custom field from Connect',
          settings: ['Sprint field (Connect screen)'],
          blindSpot:
            'Only visible for single-sprint scopes. Work removed from a sprint entirely leaves no trace in this field.',
        },
        {
          name: 'Waiting on linked work',
          formula: `A link whose phrase is one of ${list(rules.blockingLinkTypes, 'none, so this signal never fires')} points at a work item that is not done. Phrases such as "blocks" are deliberately not counted, because they mean the other item is the one waiting.`,
          reads: 'fields.issuelinks with the linked status',
          settings: ['Link phrases that mean this work item is waiting', 'Counts as done'],
          blindSpot:
            'Jira localises link phrases, so a site in another language needs its own list. Each screen\u2019s appendix lists the phrases actually present so they can be copied across.',
        },
        {
          name: 'No estimate',
          formula: 'The story points field is mapped on Connect but empty on this work item.',
          reads: 'Story points field',
          settings: ['Story points field (Connect screen)'],
        },
        {
          name: 'Attention severity',
          formula:
            'High when any reason is blocked, overdue, very stale or inactive owner. Medium when there are two or more reasons. Low otherwise. Rows are ordered by severity, then by longest idle.',
          reads: 'Derived from the signals above',
          settings: [],
        },
      ],
    },
    {
      id: 'people',
      title: 'Load and per-person metrics',
      intro:
        'The People screen and the owner-load table group the same work item set by assignee. Team members with no work are still listed, because an idle person is information too.',
      entries: [
        {
          name: 'Owner load row',
          formula:
            'Per assignee: in progress, not started, done, stale and blocked counts, summed story points, and a total. Sorted by unfinished work descending.',
          reads: 'fields.assignee, fields.status, story points field',
          settings: ['Counts as done', 'Counts as in progress', 'Stale after'],
        },
        {
          name: 'WIP and oldest WIP',
          formula:
            'WIP is the count of that person\u2019s in-progress work. Oldest WIP is the largest number of days since update among those items.',
          reads: 'fields.assignee, fields.status, fields.updated',
          settings: ['Counts as in progress'],
          blindSpot:
            'Oldest WIP measures silence, not elapsed work time. For time actually spent in progress, read cycle time.',
        },
        {
          name: 'Done in window and story points done',
          formula:
            'Work items completed inside the selected window, counted and summed by story points, grouped by current assignee.',
          reads: 'Completion time, story points field',
          settings: ['Default window (days)', 'Counts as done'],
          blindSpot:
            'Credit goes to whoever is assigned now, not whoever did the work. Reassignment after completion moves the credit.',
        },
        {
          name: 'Person median vs team median',
          formula:
            'The person\u2019s median lead and cycle time next to the median over all completed work in the same scope and window.',
          reads: 'Completion time, changelog',
          settings: ['Work started statuses', 'Default window (days)'],
          blindSpot:
            'A median over a handful of work items is unstable. The count behind each median is shown so a median of two is not read as a trend.',
        },
      ],
    },
    {
      id: 'durations',
      title: 'Durations',
      intro:
        'All durations are in days with one decimal. Distributions report count, median, 85th percentile, mean and maximum. Percentiles interpolate linearly between the two neighbouring values.',
      entries: [
        {
          name: 'Lead time',
          formula: 'Completion time minus fields.created, over completed work items only.',
          reads: 'fields.created, completion time',
          settings: ['Counts as done'],
          blindSpot:
            'Includes all the waiting before anyone started. That is the point of lead time, but it means a long backlog stay inflates it.',
        },
        {
          name: 'Cycle time',
          formula: `Completion time minus the first transition into a work-started status. Work-started statuses: ${list(rules.workStartedStatuses, 'any in-progress status')}.`,
          reads: 'changelog status transitions, completion time',
          settings: ['Work started statuses', 'Counts as done'],
          blindSpot:
            'Needs a changelog, which is a heavier fetch, so widgets that use it say so. Work items created directly in an in-progress status have no transition to find and are absent from this metric.',
        },
        {
          name: 'Aging WIP',
          formula:
            'Unfinished work bucketed by days since update: 0-1, 2-3, 4-7, 8-14, 15-30, 30+. Buckets are counts, not durations.',
          reads: 'fields.updated',
          settings: [],
          blindSpot: 'Measures silence since the last edit, not age since work began.',
        },
      ],
    },
    {
      id: 'series',
      title: 'Trends over time',
      intro:
        'Time series are reconstructed from completion times on the current work item set. They are not snapshots recorded day by day, which has consequences worth knowing.',
      entries: [
        {
          name: 'Throughput by week',
          formula:
            'Completed work items grouped by ISO week of their completion time, restricted to the selected window.',
          reads: 'Completion time',
          settings: ['Default window (days)', 'Counts as done'],
          blindSpot:
            'The current week is partial and will look low until it ends.',
        },
        {
          name: 'Resolved per day',
          formula:
            'Completed work items per calendar day, from the sprint start or the start of the window, up to today or the sprint end.',
          reads: 'Completion time',
          settings: ['Default window (days)'],
        },
        {
          name: 'Remaining work',
          formula:
            'For a single sprint: for each day, the size of the work item set minus everything completed by the end of that day.',
          reads: 'Completion time, sprint start and end dates',
          settings: ['Counts as done'],
          blindSpot:
            'The set is today\u2019s set. Work added mid-sprint appears as if it was there from day one, and work removed from the sprint is invisible. A true burndown needs sprint change history, which this does not read.',
        },
        {
          name: 'Sprint days',
          formula:
            'Total is sprint end minus start. Elapsed is measured to the completion date for a closed sprint, otherwise to now. Remaining is end minus that same reference, never below zero.',
          reads: 'Agile sprint start, end and complete dates',
          settings: [],
          blindSpot: 'Calendar days, not working days. Weekends and holidays are included.',
        },
      ],
    },
    {
      id: 'distributions',
      title: 'Distributions',
      intro: 'Plain counts over the work item set, sorted by size then by name.',
      entries: [
        {
          name: 'Status, work type, priority, epic',
          formula:
            'Count per Jira status, per issue type, per priority, and per parent or epic key. Missing values are grouped as No priority or No parent rather than dropped.',
          reads: 'fields.status, fields.issuetype, fields.priority, fields.parent or the epic link field',
          settings: ['Excluded work types'],
        },
        {
          name: 'Status category split',
          formula:
            'To do, In progress and Done counts by effective category. Statuses Jira leaves uncategorised are shown separately rather than folded into To do.',
          reads: 'fields.status.statusCategory',
          settings: ['Counts as done', 'Never counts as done', 'Counts as in progress'],
        },
      ],
    },
  ];
}
