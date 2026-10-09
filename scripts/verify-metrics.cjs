/**
 * Smoke test for the metrics engine. Feeds a synthetic Jira search response
 * through normalization and aggregation and asserts the derived numbers.
 *
 * Compile first, then run:
 *   node node_modules/typescript/bin/tsc -p scripts/tsconfig.verify.json
 *   node scripts/verify-metrics.cjs
 */
const { normalizeIssues } = require('../.tmp-verify/src/backend/metrics/normalize.js');
const { buildMetricsModel } = require('../.tmp-verify/src/backend/metrics/aggregate.js');
const { DEFAULT_METRIC_RULES } = require('../.tmp-verify/src/shared/types.js');
const { andAll } = require('../.tmp-verify/src/backend/jira/jql.js');
const { formatSnapshotAge } = require('../.tmp-verify/src/backend/metrics/time.js');

const NOW = new Date('2026-03-20T12:00:00Z');
const SPRINT_ID = 42;
const POINTS_FIELD = 'customfield_10016';
const SPRINT_FIELD = 'customfield_10020';

const failures = [];
let checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label} = ${JSON.stringify(actual)}`);
}

function user(id, name, active = true) {
  return { accountId: id, displayName: name, active };
}

function status(name, category) {
  return { name, statusCategory: { key: category } };
}

const raw = [
  {
    id: '1',
    key: 'DEV-1',
    fields: {
      summary: 'Ship the export endpoint',
      status: status('Done', 'done'),
      issuetype: { name: 'Story' },
      priority: { name: 'High' },
      assignee: user('alice', 'Alice'),
      created: '2026-03-10T09:00:00Z',
      updated: '2026-03-18T09:00:00Z',
      resolutiondate: '2026-03-18T09:00:00Z',
      labels: [],
      [POINTS_FIELD]: 5,
      // Cloud shape: sprint is an array of objects.
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
    changelog: {
      histories: [
        { created: '2026-03-12T09:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] },
        { created: '2026-03-18T09:00:00Z', items: [{ field: 'status', toString: 'Проверка' }] },
      ],
    },
  },
  {
    id: '2',
    key: 'DEV-2',
    fields: {
      summary: 'Rework the ingestion retry',
      status: status('In Progress', 'indeterminate'),
      issuetype: { name: 'Story' },
      priority: { name: 'Medium' },
      assignee: user('bob', 'Bob'),
      created: '2026-03-01T09:00:00Z',
      updated: '2026-03-05T09:00:00Z',
      labels: [],
      [POINTS_FIELD]: 3,
      // Server/DC shape: sprint is an array of GreenHopper strings.
      [SPRINT_FIELD]: [
        'com.atlassian.greenhopper.service.sprint.Sprint@1[id=41,rapidViewId=7,state=CLOSED,name=Sprint 11]',
        `com.atlassian.greenhopper.service.sprint.Sprint@2[id=${SPRINT_ID},rapidViewId=7,state=ACTIVE,name=Sprint 12]`,
      ],
    },
  },
  {
    id: '3',
    key: 'DEV-3',
    fields: {
      summary: 'Add rate limit metrics',
      status: status('To Do', 'new'),
      issuetype: { name: 'Task' },
      assignee: null,
      created: '2026-03-19T09:00:00Z',
      updated: '2026-03-19T09:00:00Z',
      labels: [],
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
  },
  {
    id: '4',
    key: 'DEV-4',
    fields: {
      summary: 'Migrate the billing job',
      status: status('Blocked', 'indeterminate'),
      issuetype: { name: 'Story' },
      priority: { name: 'Highest' },
      assignee: user('carol', 'Carol'),
      created: '2026-03-08T09:00:00Z',
      updated: '2026-03-19T09:00:00Z',
      duedate: '2026-03-15',
      labels: [],
      [POINTS_FIELD]: 8,
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
  },
  {
    id: '5',
    key: 'DEV-5',
    fields: {
      summary: 'Fix the pagination token',
      status: status('Done', 'done'),
      issuetype: { name: 'Bug' },
      priority: { name: 'High' },
      assignee: user('alice', 'Alice'),
      created: '2026-03-15T09:00:00Z',
      updated: '2026-03-19T09:00:00Z',
      resolutiondate: '2026-03-19T09:00:00Z',
      labels: [],
      [POINTS_FIELD]: 2,
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
  },
  {
    id: '6',
    key: 'DEV-6',
    fields: {
      summary: 'Split the deploy pipeline',
      status: status('In Progress', 'indeterminate'),
      issuetype: { name: 'Task' },
      priority: { name: 'Medium' },
      assignee: user('dave', 'Dave', false),
      created: '2026-03-02T09:00:00Z',
      updated: '2026-03-17T09:00:00Z',
      labels: ['blocker'],
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
  },
];

const normalized = normalizeIssues(raw, {
  fields: { storyPointsField: POINTS_FIELD, sprintField: SPRINT_FIELD },
  rules: DEFAULT_METRIC_RULES,
  issueUrl: (key) => `https://acme.atlassian.net/browse/${key}`,
  now: NOW,
  sprintId: SPRINT_ID,
});

const model = buildMetricsModel({
  scope: {
    jql: `sprint = ${SPRINT_ID} ORDER BY Rank ASC`,
    label: 'Platform — Sprint 12',
    mode: 'sprint',
    sprint: {
      id: SPRINT_ID,
      name: 'Sprint 12',
      state: 'active',
      startDate: '2026-03-09T09:00:00Z',
      endDate: '2026-03-23T09:00:00Z',
    },
    caveats: [],
    members: [
      { id: 'alice', displayName: 'Alice', active: true },
      { id: 'bob', displayName: 'Bob', active: true },
      { id: 'carol', displayName: 'Carol', active: true },
      { id: 'dave', displayName: 'Dave', active: false },
      { id: 'erin', displayName: 'Erin', active: true },
    ],
  },
  normalized,
  rules: DEFAULT_METRIC_RULES,
  title: 'Platform',
  fromCache: false,
  truncated: false,
  queriedAt: NOW.toISOString(),
  windowDays: 60,
  now: NOW,
});

const byKey = Object.fromEntries(normalized.issues.map((issue) => [issue.key, issue]));
const signals = (key) => byKey[key].signals;
const stat = (label) => model.stats.find((entry) => entry.label === label).value;
const owner = (name) => model.ownerLoad.find((row) => row.name === name);

console.log('--- field coverage ---');
check('coverage.storyPoints', normalized.coverage.storyPoints, true);
check('coverage.sprint', normalized.coverage.sprint, true);
check('coverage.dueDate', normalized.coverage.dueDate, true);
check('coverage.changelog', normalized.coverage.changelog, true);

console.log('--- sprint field parsing (Cloud objects and Server strings) ---');
check('DEV-1 sprint names', byKey['DEV-1'].sprintNames, ['Sprint 12']);
check('DEV-2 sprint names', byKey['DEV-2'].sprintNames, ['Sprint 11', 'Sprint 12']);
check('DEV-2 sprint ids', byKey['DEV-2'].sprintIds, [41, 42]);

console.log('--- signals ---');
check('DEV-1 done', signals('DEV-1'), ['done']);
check('DEV-2 very stale plus carry-over', signals('DEV-2'), ['active', 'very-stale', 'carry-over']);
check('DEV-3 unowned and unestimated', signals('DEV-3'), ['not-started', 'unowned', 'no-estimate']);
check('DEV-4 blocked and overdue', signals('DEV-4'), ['active', 'blocked', 'overdue']);
check('DEV-6 stale, label-blocked, inactive owner', signals('DEV-6'), [
  'active',
  'stale',
  'blocked-inferred',
  'inactive-owner',
  'no-estimate',
]);

console.log('--- flow times ---');
check('DEV-1 lead time days', byKey['DEV-1'].leadTimeDays, 8);
check('DEV-1 cycle time days', byKey['DEV-1'].cycleTimeDays, 6);
check('DEV-5 has no cycle time without changelog', byKey['DEV-5'].cycleTimeDays, undefined);
check('median lead time', model.flow.leadTimeDays.median, 8);
check('median cycle time', model.flow.cycleTimeDays.median, 6);
check('cycle time sample size', model.flow.cycleTimeDays.count, 1);

console.log('--- four stats ---');
check('Scope', stat('Scope'), 6);
check('Done', stat('Done'), 2);
check('In progress', stat('In progress'), 3);
check('Needs attention', stat('Needs attention'), 4);
check('Scope hint uses story points', model.stats[0].hint, '18 story points');

console.log('--- distributions ---');
check('status categories', model.statusCategoryDistribution, [
  { label: 'To do', value: 1, tone: 'neutral' },
  { label: 'In progress', value: 3, tone: 'info' },
  { label: 'Done', value: 2, tone: 'success' },
]);
check('type mix', model.typeDistribution.map((row) => `${row.label}:${row.value}`), [
  'Story:3',
  'Task:2',
  'Bug:1',
]);

console.log('--- owner load ---');
check('rows include a member with no work', model.ownerLoad.length, 6);
check('Alice done', owner('Alice').done, 2);
check('Alice story points', owner('Alice').storyPoints, 7);
check('Bob stale', owner('Bob').stale, 1);
check('Carol blocked', owner('Carol').blocked, 1);
check('Dave owner status', owner('Dave').ownerStatus, 'inactive');
check('Erin has nothing assigned', owner('Erin').total, 0);
check('Unassigned bucket exists', owner('Unassigned').notStarted, 1);

console.log('--- attention ---');
check('attention count', model.attention.length, 4);
check(
  'high severity first',
  model.attention.map((item) => `${item.key}:${item.severity}`),
  ['DEV-2:high', 'DEV-6:high', 'DEV-4:high', 'DEV-3:low'],
);
check('DEV-4 reasons', model.attention.find((item) => item.key === 'DEV-4').reasons, [
  'Blocked by status',
  'Overdue',
]);
check(
  'DEV-4 evidence names the due date',
  model.attention.find((item) => item.key === 'DEV-4').evidence,
  'status Blocked, updated 1d ago, due 6d ago',
);

console.log('--- time series ---');
check('remaining series covers sprint start to today', model.remainingOverTime.length, 12);
check('remaining starts at full scope', model.remainingOverTime[0].value, 6);
check('remaining ends after completions with Проверка', model.remainingOverTime.at(-1).value, 5);
check('resolved per day counts only Проверка completions', model.resolvedPerDay.reduce((sum, day) => sum + day.value, 0), 1);
check('aging buckets sum to unfinished count', model.flow.agingWip.reduce((sum, b) => sum + b.value, 0), 4);
check('sprint days remaining', model.sprint.daysRemaining, 3);

console.log('--- honesty of the appendix ---');
check(
  'blocked check is described as status and label only',
  model.attentionComposition.some((line) => line.includes('Blocked was checked against statuses')),
  true,
);
check(
  'story points caveat absent when points exist',
  model.caveats.some((line) => line.includes('Story points are unavailable')),
  false,
);

/* ------------------------------------------------- configurable rule set --- */

/**
 * The second scenario covers the rules that change what a metric means. It reuses
 * the same work items plus three that only matter here: one parked in review, one
 * closed, and one sub-task.
 */
const extraRaw = [
  {
    id: '7',
    key: 'DEV-7',
    fields: {
      summary: 'Tighten the retry backoff',
      status: status('In Review', 'indeterminate'),
      issuetype: { name: 'Story' },
      priority: { name: 'Medium' },
      assignee: user('alice', 'Alice'),
      created: '2026-03-11T09:00:00Z',
      updated: '2026-03-17T09:00:00Z',
      labels: [],
      [POINTS_FIELD]: 4,
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
    changelog: {
      histories: [
        { created: '2026-03-13T09:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] },
        { created: '2026-03-17T09:00:00Z', items: [{ field: 'status', toString: 'In Review' }] },
      ],
    },
  },
  {
    id: '8',
    key: 'DEV-8',
    fields: {
      summary: 'Drop the legacy webhook',
      status: status('Closed', 'done'),
      issuetype: { name: 'Task' },
      priority: { name: 'Low' },
      assignee: user('bob', 'Bob'),
      created: '2026-03-04T09:00:00Z',
      updated: '2026-03-06T09:00:00Z',
      resolutiondate: '2026-03-06T09:00:00Z',
      labels: [],
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
  },
  {
    id: '9',
    key: 'DEV-9',
    fields: {
      summary: 'Update the runbook',
      status: status('To Do', 'new'),
      issuetype: { name: 'Sub-task' },
      assignee: user('carol', 'Carol'),
      created: '2026-03-18T09:00:00Z',
      updated: '2026-03-18T09:00:00Z',
      labels: [],
      [SPRINT_FIELD]: [{ id: SPRINT_ID, name: 'Sprint 12' }],
    },
  },
];

function buildWith(ruleOverrides, issues = [...raw, ...extraRaw]) {
  const rules = { ...DEFAULT_METRIC_RULES, ...ruleOverrides };
  const result = normalizeIssues(issues, {
    fields: { storyPointsField: POINTS_FIELD, sprintField: SPRINT_FIELD },
    rules,
    issueUrl: (key) => `https://acme.atlassian.net/browse/${key}`,
    now: NOW,
    sprintId: SPRINT_ID,
  });
  return {
    normalized: result,
    byKey: Object.fromEntries(result.issues.map((issue) => [issue.key, issue])),
    model: buildMetricsModel({
      scope: { jql: 'sprint = 42', label: 'Platform', mode: 'sprint', caveats: [] },
      normalized: result,
      rules,
      title: 'Platform',
      fromCache: false,
      truncated: false,
      queriedAt: NOW.toISOString(),
      windowDays: 60,
      now: NOW,
    }),
  };
}

console.log('--- baseline for the rule scenarios ---');
const base = buildWith({});
check('In Review is unfinished by default', base.byKey['DEV-7'].effectiveCategory, 'indeterminate');
check('Closed is done by default', base.byKey['DEV-8'].effectiveCategory, 'done');
check('default done count', base.model.stats.find((s) => s.label === 'Done').value, 3);

console.log('--- "In Review counts as done" ---');
const review = buildWith({ doneStatuses: ['In Review'] });
check('DEV-7 becomes done', review.byKey['DEV-7'].effectiveCategory, 'done');
check('Jira category is preserved for display', review.byKey['DEV-7'].statusCategory, 'indeterminate');
check('done count rises', review.model.stats.find((s) => s.label === 'Done').value, 4);
check('in progress count falls', review.model.stats.find((s) => s.label === 'In progress').value, 3);
check(
  'In Review is not Проверка, so cycle time stays empty',
  [review.byKey['DEV-7'].doneAt, review.byKey['DEV-7'].doneAtSource],
  [undefined, 'none'],
);
check('lead time stays empty without Проверка', review.byKey['DEV-7'].leadTimeDays, undefined);
check('cycle time stays empty without Проверка', review.byKey['DEV-7'].cycleTimeDays, undefined);
check(
  'the reclassification is disclosed',
  review.model.caveats.some(
    (line) => line.includes('In Review') && line.includes("differ from Jira's own"),
  ),
  true,
);
check(
  'a done work item no longer carries unfinished signals',
  review.byKey['DEV-7'].signals,
  ['done'],
);

console.log('--- done by rule with no changelog ---');
const noHistory = buildWith({ doneStatuses: ['Blocked'] });
check('DEV-4 counts as done', noHistory.byKey['DEV-4'].effectiveCategory, 'done');
check('but has no completion time', noHistory.byKey['DEV-4'].doneAtSource, 'none');
check(
  'and the gap is disclosed rather than guessed',
  noHistory.model.caveats.some((line) => line.includes('no completion timestamp')),
  true,
);
check(
  'so it is absent from throughput',
  noHistory.model.flow.throughputByWeek.reduce((sum, week) => sum + week.value, 0),
  1,
);

console.log('--- "Closed does not count as done" ---');
const notDone = buildWith({ notDoneStatuses: ['Closed'] });
check('DEV-8 becomes unfinished', notDone.byKey['DEV-8'].effectiveCategory, 'indeterminate');
check('done count falls', notDone.model.stats.find((s) => s.label === 'Done').value, 2);
check('it can now raise signals', notDone.byKey['DEV-8'].signals.includes('very-stale'), true);
check(
  'never-done wins over counts-as-done',
  buildWith({ doneStatuses: ['Closed'], notDoneStatuses: ['Closed'] }).byKey['DEV-8'].effectiveCategory,
  'indeterminate',
);

console.log('--- excluded work types ---');
const noSubtasks = buildWith({ excludedTypes: ['Sub-task'] });
check('sub-task is gone', noSubtasks.byKey['DEV-9'], undefined);
check('scope shrinks', noSubtasks.model.issueCount, 8);
check('the drop is counted', noSubtasks.normalized.excludedCount, 1);
check(
  'and disclosed with the rule that caused it',
  noSubtasks.model.caveats.some((line) => line.includes('excluded-types rule (Sub-task)')),
  true,
);

console.log('--- work started statuses ---');
const startsAtReview = buildWith({ doneStatuses: [], workStartedStatuses: ['In Review'] });
check(
  'the clock starts at the configured status, not the first in-progress one',
  startsAtReview.byKey['DEV-7'].firstInProgress,
  '2026-03-17T09:00:00.000Z',
);
check(
  'without a matching start status the start falls back to created',
  startsAtReview.byKey['DEV-1'].cycleTimeDays,
  8,
);

console.log('--- attention signal selection ---');
check(
  'default attention count',
  base.model.stats.find((s) => s.label === 'Needs attention').value,
  5,
);
check(
  'narrowing to blocked-by-status only',
  buildWith({ attentionSignals: ['blocked'] }).model.stats.find((s) => s.label === 'Needs attention').value,
  1,
);
check(
  'an unselected signal is still listed as a reason on the work item',
  buildWith({ attentionSignals: ['overdue'] }).byKey['DEV-4'].signals.includes('blocked'),
  true,
);

console.log('--- blocking links ---');
const linked = [
  {
    id: '10',
    key: 'DEV-10',
    fields: {
      summary: 'Waits on someone else',
      status: status('In Progress', 'indeterminate'),
      issuetype: { name: 'Story' },
      assignee: user('alice', 'Alice'),
      created: '2026-03-18T09:00:00Z',
      updated: '2026-03-20T09:00:00Z',
      labels: [],
      issuelinks: [
        {
          type: { inward: 'is blocked by', outward: 'blocks', name: 'Blocks' },
          inwardIssue: { key: 'DEV-99', fields: { status: status('To Do', 'new') } },
        },
      ],
    },
  },
  {
    id: '11',
    key: 'DEV-11',
    fields: {
      summary: 'Blocks someone else, but is not itself waiting',
      status: status('In Progress', 'indeterminate'),
      issuetype: { name: 'Story' },
      assignee: user('bob', 'Bob'),
      created: '2026-03-18T09:00:00Z',
      updated: '2026-03-20T09:00:00Z',
      labels: [],
      issuelinks: [
        {
          type: { inward: 'is blocked by', outward: 'blocks', name: 'Blocks' },
          outwardIssue: { key: 'DEV-98', fields: { status: status('To Do', 'new') } },
        },
      ],
    },
  },
  {
    id: '12',
    key: 'DEV-12',
    fields: {
      summary: 'Merely related to something open',
      status: status('In Progress', 'indeterminate'),
      issuetype: { name: 'Story' },
      assignee: user('carol', 'Carol'),
      created: '2026-03-18T09:00:00Z',
      updated: '2026-03-20T09:00:00Z',
      labels: [],
      issuelinks: [
        {
          type: { inward: 'relates to', outward: 'relates to', name: 'Relates' },
          outwardIssue: { key: 'DEV-97', fields: { status: status('To Do', 'new') } },
        },
      ],
    },
  },
];

const links = buildWith({}, linked);
check('an inward "is blocked by" is waiting', links.byKey['DEV-10'].signals.includes('unresolved-dependency'), true);
check('an outward "blocks" is not waiting', links.byKey['DEV-11'].signals.includes('unresolved-dependency'), false);
check('"relates to" is not waiting', links.byKey['DEV-12'].signals.includes('unresolved-dependency'), false);
check(
  'the phrases present are reported so a localised site can be configured',
  links.model.linkTypesSeen,
  [
    { type: 'blocks', count: 1 },
    { type: 'is blocked by', count: 1 },
    { type: 'relates to', count: 1 },
  ],
);
check(
  'a rule matching no phrase in the data is disclosed',
  buildWith({ blockingLinkTypes: ['зависит от'] }, linked).model.caveats.some((line) =>
    line.includes('none use a phrase from your blocking-link rule'),
  ),
  true,
);
check(
  'a localised phrase can be configured',
  buildWith({ blockingLinkTypes: ['relates to'] }, linked).byKey['DEV-12'].signals.includes(
    'unresolved-dependency',
  ),
  true,
);

console.log('--- engineering done: Проверка, ignore Готово ---');
const engineering = normalizeIssues(
  [
    {
      id: 'e1',
      key: 'CDR-1',
      fields: {
        summary: 'Reached review then release',
        status: status('Готово', 'done'),
        issuetype: { name: 'Story' },
        assignee: user('alice', 'Alice'),
        created: '2026-09-07T09:00:00Z',
        updated: '2026-09-14T09:00:00Z',
        resolutiondate: '2026-09-14T09:00:00Z',
        labels: [],
      },
      changelog: {
        histories: [
          { created: '2026-09-08T09:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] },
          { created: '2026-09-10T09:00:00Z', items: [{ field: 'status', toString: 'Проверка' }] },
          { created: '2026-09-14T09:00:00Z', items: [{ field: 'status', toString: 'Готово' }] },
        ],
      },
    },
    {
      id: 'e2',
      key: 'CDR-2',
      fields: {
        summary: 'Released without review',
        status: status('Готово', 'done'),
        issuetype: { name: 'Story' },
        assignee: user('bob', 'Bob'),
        created: '2026-09-07T09:00:00Z',
        updated: '2026-09-14T09:00:00Z',
        resolutiondate: '2026-09-14T09:00:00Z',
        labels: [],
      },
      changelog: {
        histories: [
          { created: '2026-09-08T09:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] },
          { created: '2026-09-14T09:00:00Z', items: [{ field: 'status', toString: 'Готово' }] },
        ],
      },
    },
    {
      id: 'e3',
      key: 'CDR-3',
      fields: {
        summary: 'Returned from review; first Проверка kept',
        status: status('Проверка', 'indeterminate'),
        issuetype: { name: 'Story' },
        assignee: user('carol', 'Carol'),
        created: '2026-09-07T09:00:00Z',
        updated: '2026-09-12T09:00:00Z',
        labels: [],
      },
      changelog: {
        histories: [
          { created: '2026-09-12T09:00:00Z', items: [{ field: 'status', toString: 'Проверка' }] },
          { created: '2026-09-11T09:00:00Z', items: [{ field: 'status', toString: 'Fix' }] },
          { created: '2026-09-10T09:00:00Z', items: [{ field: 'status', toString: 'Проверка' }] },
          { created: '2026-09-08T09:00:00Z', items: [{ field: 'status', toString: 'In Progress' }] },
        ],
      },
    },
  ],
  {
    fields: { storyPointsField: POINTS_FIELD, sprintField: SPRINT_FIELD },
    rules: DEFAULT_METRIC_RULES,
    issueUrl: (key) => `https://acme.atlassian.net/browse/${key}`,
    now: NOW,
  },
);
const eng = Object.fromEntries(engineering.issues.map((issue) => [issue.key, issue]));
check('Готово after Проверка does not move doneAt', eng['CDR-1'].doneAt, '2026-09-10T09:00:00.000Z');
check('cycle time stops at first Проверка, not Готово', eng['CDR-1'].cycleTimeDays, 2);
check('Готово without Проверка has no cycle time', eng['CDR-2'].cycleTimeDays, undefined);
check('Готово without Проверка has no doneAt', eng['CDR-2'].doneAt, undefined);
check('repeat Проверка keeps the earliest timestamp', eng['CDR-3'].doneAt, '2026-09-10T09:00:00.000Z');
check('repeat Проверка does not restart cycle time', eng['CDR-3'].cycleTimeDays, 2);

console.log('--- JQL assembly ---');
check(
  'combining a clause that carries ORDER BY keeps the ordering outside the parentheses',
  andAll(['filter = 123 AND (resolutiondate >= -90d OR statusCategory != Done) ORDER BY updated DESC']),
  '(filter = 123 AND (resolutiondate >= -90d OR statusCategory != Done)) ORDER BY updated DESC',
);
check(
  'an OR clause is parenthesised so AND cannot capture one side of it',
  andAll(['filter = 123', 'resolutiondate >= -60d OR statusCategory != Done']),
  'filter = 123 AND (resolutiondate >= -60d OR statusCategory != Done)',
);
check('empty parts are dropped', andAll(['project = ABC', undefined, '  ']), 'project = ABC');

console.log('--- snapshot age ---');
const now = Date.parse('2026-09-15T12:00:00.000Z');
check('fresh snapshot is только что', formatSnapshotAge('2026-09-15T11:59:50.000Z', now), 'только что');
check('minute-old snapshot', formatSnapshotAge('2026-09-15T11:57:00.000Z', now), '3 мин назад');
check('hour-old snapshot', formatSnapshotAge('2026-09-15T10:00:00.000Z', now), '2 ч назад');

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} assertion(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(`All ${checks} assertions passed.`);
