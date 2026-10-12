/**
 * Cycle Time overview block: cards, per-issue bars, tooltips, empty state,
 * duration formatting, and the Days/Weeks chart being gone from the page.
 *
 * Run after compiling:
 *   node node_modules/typescript/bin/tsc -p scripts/tsconfig.verify.json
 *   node scripts/verify-cycle-overview.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const {
  buildCycleOverview,
  cycleBarTooltip,
  cycleOverrideMaps,
  cycleStartOverrideMap,
  CYCLE_EMPTY_MESSAGE,
  formatCycleCompare,
  formatCycleDuration,
  formatStoryPoints,
  listCyclePeople,
  parseIssueKeys,
  cycleQaWipDays,
} = require('../.tmp-verify/src/backend/metrics/cycle-overview.js');
const { listOpenBugs, openBugsJql, sortBugsByAge, uniqueBugStatuses } = require('../.tmp-verify/src/backend/metrics/bug-list.js');
const { summarize } = require('../.tmp-verify/src/backend/metrics/aggregate.js');
const { daysBetween, workingDaysBetween, workingElapsedDays } = require('../.tmp-verify/src/backend/metrics/time.js');

const failures = [];
let checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label} = ${JSON.stringify(actual)}`);
}

function issue(partial) {
  return {
    key: 'X',
    url: 'https://acme.atlassian.net/browse/X',
    summary: 'Work',
    type: 'Story',
    status: 'В работе',
    statusCategory: 'indeterminate',
    effectiveCategory: 'indeterminate',
    assigneeName: 'Unassigned',
    created: '2026-09-07T09:00:00Z',
    updated: '2026-09-08T09:00:00Z',
    doneAtSource: 'none',
    createdAgeDays: 1,
    updatedAgeDays: 1,
    labels: [],
    components: [],
    fixVersions: [],
    sprintNames: [],
    sprintIds: [],
    links: [],
    signals: [],
    ...partial,
  };
}

const window = { from: '2026-09-07', to: '2026-09-14' };

const completed = [
  issue({
    key: 'CDR-2029',
    url: 'https://acme.atlassian.net/browse/CDR-2029',
    summary: 'Unlock MaxCPM Black',
    status: 'Проверка',
    statusCategory: 'indeterminate',
    effectiveCategory: 'done',
    assigneeName: 'Alice',
    firstInProgress: '2026-09-08T13:07:33.970Z',
    doneAt: '2026-09-09T11:32:40.124Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 0.9,
    storyPoints: 2,
    signals: ['done'],
  }),
  issue({
    key: 'CDR-2038',
    url: 'https://acme.atlassian.net/browse/CDR-2038',
    summary: 'Rotation domain pool',
    status: 'Проверка',
    effectiveCategory: 'done',
    assigneeName: 'Bob',
    firstInProgress: '2026-09-07T09:00:00.000Z',
    doneAt: '2026-09-11T12:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 4.8,
    storyPoints: 5,
    signals: ['done'],
  }),
  issue({
    key: 'CDR-2083',
    summary: 'Quick fix',
    status: 'Проверка',
    effectiveCategory: 'done',
    assigneeName: 'Carol',
    firstInProgress: '2026-09-09T09:47:43.113Z',
    doneAt: '2026-09-09T11:32:37.264Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 0.1,
    signals: ['done'],
  }),
];

const wip = issue({
  key: 'CDR-2100',
  summary: 'Still in progress',
  status: 'В работе',
  assigneeId: 'alice',
  assigneeName: 'Alice',
  firstInProgress: '2026-09-10T09:00:00.000Z',
  cycleTimeDays: undefined,
  signals: ['active'],
});

const notStarted = issue({
  key: 'CDR-2101',
  summary: 'Backlog',
  status: 'К выполнению',
  statusCategory: 'new',
  effectiveCategory: 'new',
  signals: ['not-started'],
});

const gotovoOnly = issue({
  key: 'CDR-2102',
  summary: 'Released without review',
  status: 'Готово',
  statusCategory: 'done',
  effectiveCategory: 'done',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  resolved: '2026-09-14T09:00:00.000Z',
  doneAt: undefined,
  doneAtSource: 'none',
  cycleTimeDays: undefined,
  signals: ['done'],
});

const outsideWindow = issue({
  key: 'CDR-1999',
  status: 'Проверка',
  effectiveCategory: 'done',
  firstInProgress: '2026-08-01T09:00:00.000Z',
  doneAt: '2026-08-20T09:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 3,
  signals: ['done'],
});

const epicDone = issue({
  key: 'CDR-EPIC',
  type: 'Epic',
  summary: 'Domain v2',
  status: 'Проверка',
  effectiveCategory: 'done',
  firstInProgress: '2026-09-07T09:00:00.000Z',
  doneAt: '2026-09-10T09:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 9,
  signals: ['done'],
});

const epicWip = issue({
  key: 'CDR-EPIC2',
  type: 'Эпик',
  summary: 'Still open epic',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  cycleTimeDays: undefined,
  signals: ['active'],
});

const qaQueue = issue({
  key: 'CDR-READY',
  summary: 'Waiting on QA',
  status: 'Ready to QA',
  assigneeId: 'bob',
  assigneeName: 'Bob',
  firstInProgress: '2026-09-10T10:00:00.000Z',
  cycleTimeDays: undefined,
  signals: ['active'],
});

const model = buildCycleOverview(
  [...completed, wip, qaQueue, notStarted, gotovoOnly, outsideWindow, epicDone, epicWip],
  window,
);
const expectedSummary = summarize(completed.map((item) => item.cycleTimeDays));

console.log('--- 1. summary cards ---');
check(
  'cards are Median CT, P85 CT, Done, WIP',
  model.cards.map((card) => card.label),
  ['Median CT', 'P85 CT', 'Done', 'WIP'],
);
check('Median uses summarize()', model.median, expectedSummary.median);
check('P85 uses summarize()', model.p85, expectedSummary.p85);
check('completed count', model.completedCount, 3);
check('WIP splits development and Ready to QA', model.wipCount, 2);
check('development WIP ignores todo, review, and done', model.devWipCount, 1);
check('QA WIP is Ready to QA', model.qaWipCount, 1);
check('Median card value is formatted, not raw', model.cards[0].value, formatCycleDuration(expectedSummary.median));
check('P85 card value is formatted', model.cards[1].value, formatCycleDuration(expectedSummary.p85));
check('Завершено card', model.cards[2].value, '3');
check('WIP card', model.cards[3].value, '2');
check('Median hint is the full cycle', model.cards[0].hint, 'Full cycle, including the QA queue');
check('P85 hint', model.cards[1].hint, '85% of issues finished faster');
check('Done hint splits review and released', model.cards[2].hint, '3 in review · 0 released');
check('WIP hint splits development, QA, and todo', model.cards[3].hint, '1 in development · 1 in QA · 1 to do');
check(
  'Median card nests without QA and QA',
  model.cards[0].splits.map((split) => split.label),
  ['without QA', 'QA'],
);
check(
  'P85 card nests without QA and QA',
  model.cards[1].splits.map((split) => split.label),
  ['without QA', 'QA'],
);
check('todo is counted beside WIP, not inside it', model.todoCount, 1);
const extraWip = buildCycleOverview(
  [
    wip,
    qaQueue,
    notStarted,
    gotovoOnly,
    issue({ key: 'CDR-BLK', status: 'BLOCKED' }),
    issue({ key: 'CDR-ARC', status: 'architecture' }),
  ],
  window,
);
check('BLOCKED is not development WIP', extraWip.devWipCount, 2);
check('todo, done, and BLOCKED stay out of WIP', extraWip.wipCount, 3);

console.log('--- 2. one bar per completed issue ---');
check(
  'bar keys match completed issues in the sprint window',
  model.bars.map((bar) => bar.key).sort(),
  ['CDR-2029', 'CDR-2038', 'CDR-2083'],
);

console.log('--- 3. longest cycle time first ---');
check(
  'bars sorted by cycle time descending',
  model.bars.map((bar) => bar.key),
  ['CDR-2038', 'CDR-2029', 'CDR-2083'],
);
check('first bar is the slowest', model.bars[0].cycleTimeDays, 4.8);
check('bar carries story points', model.bars[0].storyPoints, 5);
check('story points render as SP', formatStoryPoints(5), '5 SP');
check('fractional story points keep one decimal', formatStoryPoints(1.5), '1.5 SP');

console.log('--- 4. reference values match cards ---');
check('chart median equals card median', model.median, expectedSummary.median);
check('chart p85 equals card p85', model.p85, expectedSummary.p85);

console.log('--- 5. tooltip is one issue ---');
const tip = cycleBarTooltip(model.bars[0]);
check('tooltip includes the hovered key', tip.includes('CDR-2038'), true);
check('tooltip does not list other completed keys', tip.includes('CDR-2029') || tip.includes('CDR-2083'), false);
check('tooltip includes summary', tip.includes('Rotation domain pool'), true);
check('tooltip includes assignee', tip.includes('Bob'), true);
check('tooltip includes start', tip.includes('2026-09-07 09:00'), true);
check('tooltip includes Проверка timestamp', tip.includes('2026-09-11 12:00'), true);
check('tooltip includes cycle time', tip.includes(formatCycleDuration(4.8)), true);
check('tooltip includes developer time', tip.includes('Development:'), true);
check('tooltip includes QA WIP time', tip.includes('QA WIP:'), true);
check('tooltip includes story points', tip.includes('5 SP'), true);

console.log('--- 6. Готово is not a completion ---');
check(
  'Готово without Проверка is absent from bars',
  model.bars.some((bar) => bar.key === 'CDR-2102'),
  false,
);

console.log('--- 7. no Проверка means not completed ---');
check(
  'in-progress issue is absent from bars',
  model.bars.some((bar) => bar.key === 'CDR-2100'),
  false,
);
check(
  'backlog issue is absent from bars',
  model.bars.some((bar) => bar.key === 'CDR-2101'),
  false,
);

console.log('--- only Bug / Task / Story / Spike ---');
const typed = buildCycleOverview(
  [
    ...completed,
    epicDone,
    epicWip,
    issue({
      key: 'CDR-SUB',
      type: 'Sub-task',
      status: 'Проверка',
      effectiveCategory: 'done',
      firstInProgress: '2026-09-08T09:00:00.000Z',
      doneAt: '2026-09-09T09:00:00.000Z',
      doneAtSource: 'changelog',
      cycleTimeDays: 20,
      signals: ['done'],
    }),
    issue({
      key: 'CDR-SPIKE',
      type: 'Spike',
      status: 'Проверка',
      effectiveCategory: 'done',
      firstInProgress: '2026-09-08T09:00:00.000Z',
      doneAt: '2026-09-10T09:00:00.000Z',
      doneAtSource: 'changelog',
      cycleTimeDays: 1.5,
      signals: ['done'],
    }),
    issue({
      key: 'CDR-QA',
      type: 'QA',
      status: 'Проверка',
      effectiveCategory: 'done',
      firstInProgress: '2026-09-08T09:00:00.000Z',
      doneAt: '2026-09-09T09:00:00.000Z',
      doneAtSource: 'changelog',
      cycleTimeDays: 12,
      signals: ['done'],
    }),
  ],
  window,
);
check('completed epic is not a bar', model.bars.some((bar) => bar.key === 'CDR-EPIC'), false);
check('WIP epic is not counted', model.wipCount, 2);
check('epic 9d does not move the median', model.median, expectedSummary.median);
check('sub-task is not counted', typed.bars.some((bar) => bar.key === 'CDR-SUB'), false);
check('spike is counted', typed.bars.some((bar) => bar.key === 'CDR-SPIKE'), true);
check('unlisted type is not counted', typed.bars.some((bar) => bar.key === 'CDR-QA'), false);
check('unlisted 12d does not enter median', typed.median !== 12, true);

const released = issue({
  key: 'CDR-DONE',
  type: 'Story',
  status: 'Готово',
  effectiveCategory: 'done',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  doneAt: '2026-09-10T09:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 1,
  signals: ['done'],
});
const split = buildCycleOverview([...completed, released], window);
check('Завершено in Проверка', split.completedInReview, 3);
check('Завершено in Готово', split.completedReleased, 1);
check('Done hint names both statuses', split.cards[2].hint, '3 in review · 1 released');

console.log('--- 8. empty completed state ---');
const empty = buildCycleOverview([wip, notStarted], window);
check('empty median is null, not 0', empty.median, null);
check('empty p85 is null, not 0', empty.p85, null);
check('empty Median card', empty.cards[0].value, 'No data');
check('empty Median without QA nested', empty.cards[0].splits[0].value, 'No data');
check('empty Median QA nested', empty.cards[0].splits[1].value, 'No data');
check('empty P85 card', empty.cards[1].value, 'No data');
check('empty completed count is 0', empty.cards[2].value, '0');
check('empty Done split is zeros', empty.cards[2].hint, '0 in review · 0 released');
check('empty WIP still counted', empty.cards[3].value, '1');
check('empty WIP is development only', empty.cards[3].hint, '1 in development · 0 in QA · 1 to do');
check('empty message', empty.emptyMessage, CYCLE_EMPTY_MESSAGE);
check('empty has no bars', empty.bars.length, 0);
check('No data is not 0 days', empty.cards[0].value.includes('0') && empty.cards[0].label === 'Median CT', false);

console.log('--- 9. sub-day values render as hours ---');
check('0.25 days → 6 h', formatCycleDuration(0.25), '6 h');
check('0.1 days → 2.4 h', formatCycleDuration(0.1), '2.4 h');
check('20 minutes → 0.3 h', formatCycleDuration(20 / 60 / 24), '0.3 h');
check('37 minutes → 0.6 h', formatCycleDuration(37 / 60 / 24), '0.6 h');
check('true zero stays 0 h', formatCycleDuration(0), '0 h');
check('1 day → 1 day', formatCycleDuration(1), '1 day');
check('1.8 days → 1.8 days', formatCycleDuration(1.8), '1.8 days');
check('5 days → 5 days', formatCycleDuration(5), '5 days');

console.log('--- 10. Days / Weeks grouping is gone ---');
const overview = fs.readFileSync(path.join(__dirname, '../src/app/overview/page.tsx'), 'utf8');
check('overview has no Days/Weeks toggle', /Days\s*\/\s*Weeks|label: 'Days'|label: 'Weeks'|grain/.test(overview), false);
check('overview no longer builds a daily series', overview.includes('cycleSeries'), false);
check('overview does not label axes Day / Median days', /xLabel=\{grain|yLabel="Median days"/.test(overview), false);
check('overview uses per-issue bars', overview.includes('CycleTimeBarChart'), true);
check('overview loads status timeline for QA split', overview.includes('withTimeline: true'), true);
check('overview shows Median without QA', overview.includes('without QA') && overview.includes('medianWithoutQa'), true);
check('overview nests QA splits under Median CT and P85 CT', overview.includes('stat-splits') && overview.includes('Median CT') && overview.includes('P85 CT'), true);
check('overview has start/end status dropdowns', overview.includes('первый переход в') && overview.includes('StatusSelect'), true);
check('overview does not keep the old static caption', overview.includes('Готово не учитывается'), false);
check('overview loads issues from selected sprints', overview.includes('sprint in ('), true);
check('overview does not load a rolling recent team window', /mode: 'recent'/.test(overview), false);

console.log('--- past sprint window still counts its own completions ---');
const pastWindow = { from: '2026-08-24', to: '2026-08-31' };
const pastDone = issue({
  key: 'CDR-PAST',
  type: 'Story',
  status: 'Готово',
  effectiveCategory: 'done',
  assigneeName: 'Alice',
  firstInProgress: '2026-08-25T09:00:00.000Z',
  doneAt: '2026-08-28T12:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 3.1,
  signals: ['done'],
});
const pastModel = buildCycleOverview([...completed, pastDone], pastWindow);
check('past-sprint completion is a bar', pastModel.bars.some((bar) => bar.key === 'CDR-PAST'), true);
check('current-sprint completions stay out of the past window', pastModel.bars.some((bar) => bar.key === 'CDR-2029'), false);
check('past-sprint completed count', pastModel.completedCount, 1);

console.log('--- exclude [QA] titles and explicit keys ---');
const qaDone = issue({
  key: 'CDR-QA-TITLE',
  type: 'Story',
  summary: '[QA] Проверить CDR-2038',
  status: 'Проверка',
  effectiveCategory: 'done',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  doneAt: '2026-09-10T09:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 12,
  signals: ['done'],
});
const qaWip = issue({
  key: 'CDR-QA-WIP',
  type: 'Task',
  summary: 'fix [qa] checklist',
  firstInProgress: '2026-09-10T09:00:00.000Z',
  cycleTimeDays: undefined,
  signals: ['active'],
});
const qaQueueTitled = issue({
  key: 'CDR-QA-QUEUE',
  type: 'Task',
  summary: '[QA] Проверить очередь',
  status: 'Ready to QA',
  firstInProgress: '2026-09-10T10:00:00.000Z',
  cycleTimeDays: undefined,
  signals: ['active'],
});
const withQa = buildCycleOverview([...completed, qaDone, qaWip, qaQueueTitled, wip], window);
check('QA title is counted until the filter is on', withQa.bars.some((bar) => bar.key === 'CDR-QA-TITLE'), true);
check('QA title moves the median until excluded', withQa.median !== expectedSummary.median, true);
check('[QA] titles count in WIP until excluded', withQa.wipCount, 3);
check('[QA] Ready to QA counts as QA WIP until excluded', withQa.qaWipCount, 1);
const noQa = buildCycleOverview([...completed, qaDone, qaWip, qaQueueTitled, wip], window, { excludeQaTitle: true });
check('QA title is not a bar when excluded', noQa.bars.some((bar) => bar.key === 'CDR-QA-TITLE'), false);
check('QA title does not enter median when excluded', noQa.median, expectedSummary.median);
check('[QA] titles are dropped from WIP', noQa.wipCount, 1);
check('[QA] Ready to QA is dropped from QA WIP', noQa.qaWipCount, 0);
const compareQaWindow = { from: '2026-08-24', to: '2026-08-31' };
const compareSprintIssues = [
  issue({
    key: 'CDR-OLD',
    type: 'Story',
    summary: 'Regular work',
    status: 'Проверка',
    effectiveCategory: 'done',
    firstInProgress: '2026-08-25T09:00:00.000Z',
    doneAt: '2026-08-26T09:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 2,
    signals: ['done'],
  }),
  issue({
    key: 'CDR-OLD-QA',
    type: 'Story',
    summary: '[QA] Проверить CDR-OLD',
    status: 'Проверка',
    effectiveCategory: 'done',
    firstInProgress: '2026-08-25T09:00:00.000Z',
    doneAt: '2026-08-28T09:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 10,
    signals: ['done'],
  }),
];
const compareWithQa = buildCycleOverview(compareSprintIssues, compareQaWindow);
const compareNoQa = buildCycleOverview(compareSprintIssues, compareQaWindow, { excludeQaTitle: true });
check('compare sprint counts [QA] until the filter is on', compareWithQa.bars.some((bar) => bar.key === 'CDR-OLD-QA'), true);
check('compare sprint drops [QA] when the filter is on', compareNoQa.bars.some((bar) => bar.key === 'CDR-OLD-QA'), false);
check('compare median without [QA] is the non-QA item', compareNoQa.median, 2);
check('compare median with [QA] is pulled up', compareWithQa.median !== compareNoQa.median, true);
const droppedKey = buildCycleOverview([...completed, wip], window, { excludedKeys: ['cdr-2038'] });
check('excluded key is not a bar', droppedKey.bars.some((bar) => bar.key === 'CDR-2038'), false);
check('excluded key leaves completed count', droppedKey.completedCount, 2);
check('excluded key leaves WIP alone', droppedKey.wipCount, 1);
check('parse pasted keys', parseIssueKeys('cdr-12, CDR-13 and CDR-12'), ['CDR-12', 'CDR-13']);

console.log('--- compare median / p85 ---');
const faster = formatCycleCompare(0.9, 1.9, 'Спринт 21');
check('faster median is an improvement', faster.tone, 'success');
check('faster median names the other sprint', faster.text.includes('Спринт 21') && faster.text.includes('↓'), true);
const slower = formatCycleCompare(3, 1, 'Спринт 21');
check('slower p85 is a regression', slower.tone, 'danger');
check('missing compare data', formatCycleCompare(1, null, 'Спринт 18').text.includes('no data'), true);

const charts = fs.readFileSync(path.join(__dirname, '../src/frontend/components/charts.tsx'), 'utf8');
check('overview has no [QA] checkbox', overview.includes('Исключить [QA]'), false);
const settingsPage = fs.readFileSync(path.join(__dirname, '../src/app/settings/page.tsx'), 'utf8');
check('settings has no [QA] checkbox', settingsPage.includes('Исключить [QA]'), false);
check('overview has a people filter', overview.includes('Люди') && overview.includes('overview-people'), true);
check('overview has compare-sprint control', overview.includes('Сравнить с'), true);
check('compare uses a checkbox dropdown', overview.includes('compareSprintIds') && overview.includes('CheckDropdown'), true);
check('compare can include currently selected sprints', overview.includes(' · выбран') && overview.includes('toggle(current, sprint.id, false)'), true);
check('overview paints the current stat when compare is worse', overview.includes('tone-${compared.tone}'), true);
check('compare sprints use the [QA] filter', overview.includes('compareFilters') && overview.includes('excludeQaTitle: excludeQa'), true);
check('overview has an exclusions dialog', overview.includes('ExcludeDialog') && overview.includes('Исключения'), true);
check('cycle filters live in a toolbar', overview.includes('cycle-toolbar'), true);
check('chart can exclude a bar', charts.includes('cycle-chart-exclude') && charts.includes('onExclude'), true);
check('chart draws a Median reference line', charts.includes('cycle-ref-median'), true);
check('chart draws a P85 reference line', charts.includes('cycle-ref-p85'), true);
check('chart shows story points next to the key', charts.includes('cycle-chart-sp') && charts.includes('formatStoryPoints'), true);
check('chart stacks QA WIP in a different color', charts.includes('cycle-chart-seg-qa'), true);

console.log('--- QA WIP split ---');
check('no changelog means zero QA slice', model.bars[0].qaWipDays, 0);
check('no changelog keeps median without QA equal to median', model.medianWithoutQa, model.median);
const queued = issue({
  key: 'CDR-QA-1',
  status: 'Проверка',
  effectiveCategory: 'done',
  assigneeName: 'Alice',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  doneAt: '2026-09-11T09:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 3,
  statusTransitions: [
    { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-10T09:00:00.000Z', from: 'В работе', to: 'Ready to QA' },
    { at: '2026-09-11T09:00:00.000Z', from: 'Ready to QA', to: 'Проверка' },
  ],
});
const qaSplit = buildCycleOverview([queued], window);
check('full cycle stays 3 days', qaSplit.bars[0].cycleTimeDays, 3);
check('QA WIP is the last day', qaSplit.bars[0].qaWipDays, 1);
check('developer time is the rest', qaSplit.bars[0].devDays, 2);
check('median without QA is developer time', qaSplit.medianWithoutQa, 2);
check('median QA is the queue', qaSplit.medianQa, 1);
const mixedQa = buildCycleOverview(
  [
    queued,
    issue({
      key: 'CDR-QA-SKIP',
      status: 'Проверка',
      effectiveCategory: 'done',
      assigneeName: 'Alice',
      firstInProgress: '2026-09-08T09:00:00.000Z',
      doneAt: '2026-09-09T09:00:00.000Z',
      doneAtSource: 'changelog',
      cycleTimeDays: 1,
      statusTransitions: [
        { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
        { at: '2026-09-09T09:00:00.000Z', from: 'В работе', to: 'Проверка' },
      ],
    }),
    issue({
      key: 'CDR-QA-SKIP-2',
      status: 'Проверка',
      effectiveCategory: 'done',
      assigneeName: 'Alice',
      firstInProgress: '2026-09-08T09:00:00.000Z',
      doneAt: '2026-09-09T09:00:00.000Z',
      doneAtSource: 'changelog',
      cycleTimeDays: 1,
      statusTransitions: [
        { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
        { at: '2026-09-09T09:00:00.000Z', from: 'В работе', to: 'Проверка' },
      ],
    }),
  ],
  window,
);
check('Median QA ignores issues that skipped the queue', mixedQa.medianQa, 1);
check(
  'Median QA hint counts queued issues',
  mixedQa.cards[0].splits[1].hint,
  'Issues that waited in Ready to QA (1)',
);
check('P85 QA uses the queued distribution', mixedQa.p85Qa, 1);
check('chart legend names the two slices', charts.includes('cycle-chart-legend') && charts.includes('QA WIP'), true);
const bounced = issue({
  key: 'CDR-QA-2',
  status: 'Проверка',
  effectiveCategory: 'done',
  assigneeName: 'Alice',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  doneAt: '2026-09-12T09:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 4,
  statusTransitions: [
    { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-09T09:00:00.000Z', from: 'В работе', to: 'Ready to QA' },
    { at: '2026-09-10T09:00:00.000Z', from: 'Ready to QA', to: 'В работе' },
    { at: '2026-09-11T09:00:00.000Z', from: 'В работе', to: 'Ready to QA' },
    { at: '2026-09-12T09:00:00.000Z', from: 'Ready to QA', to: 'Проверка' },
  ],
});
const bouncedModel = buildCycleOverview([bounced], window);
check('repeat QA visits are summed', bouncedModel.bars[0].qaWipDays, 2);
check('developer time excludes both QA visits', bouncedModel.bars[0].devDays, 2);
const qaStarted = new Date(2026, 8, 11, 18, 0, 0);
const qaEnded = new Date(2026, 8, 14, 10, 0, 0);
check(
  'QA helper uses working days when asked',
  cycleQaWipDays(
    {
      status: 'Проверка',
      created: new Date(2026, 8, 11, 9, 0, 0).toISOString(),
      statusTransitions: [
        { at: qaStarted.toISOString(), from: 'В работе', to: 'Ready to QA' },
        { at: qaEnded.toISOString(), from: 'Ready to QA', to: 'Проверка' },
      ],
    },
    qaStarted,
    qaEnded,
    { workingDays: true },
  ),
  workingElapsedDays(qaStarted, qaEnded),
);

console.log('--- oldest WIP ---');
const now = new Date('2026-09-15T00:00:00.000Z');
const peopleIssues = [
  issue({
    key: 'A-1',
    assigneeId: 'alice',
    assigneeName: 'Alice',
    status: 'Проверка',
    effectiveCategory: 'done',
    firstInProgress: '2026-09-08T00:00:00.000Z',
    doneAt: '2026-09-10T00:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 2,
    signals: ['done'],
  }),
  issue({
    key: 'A-WIP',
    assigneeId: 'alice',
    assigneeName: 'Alice',
    status: 'В работе',
    firstInProgress: '2026-09-10T00:00:00.000Z',
    cycleTimeDays: undefined,
    signals: ['active'],
  }),
  issue({
    key: 'B-1',
    assigneeId: 'bob',
    assigneeName: 'Bob',
    status: 'Review',
    effectiveCategory: 'done',
    firstInProgress: '2026-09-07T00:00:00.000Z',
    doneAt: '2026-09-11T00:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 4,
    signals: ['done'],
  }),
  issue({
    key: 'B-2',
    assigneeId: 'bob',
    assigneeName: 'Bob',
    status: 'Проверка',
    effectiveCategory: 'done',
    firstInProgress: '2026-09-08T00:00:00.000Z',
    doneAt: '2026-09-12T00:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 6,
    signals: ['done'],
  }),
  issue({
    key: 'QA-1',
    assigneeId: 'alice',
    assigneeName: 'Alice',
    summary: '[QA] Проверить A-1',
    status: 'Проверка',
    effectiveCategory: 'done',
    firstInProgress: '2026-09-09T00:00:00.000Z',
    doneAt: '2026-09-10T00:00:00.000Z',
    doneAtSource: 'changelog',
    cycleTimeDays: 20,
    signals: ['done'],
  }),
];
const oldest = buildCycleOverview(peopleIssues, window, { now });
check('oldest WIP has one row per assignee with WIP', oldest.oldestWip.map((item) => item.assigneeName), ['Alice']);
check('oldest WIP is days since first in progress', oldest.oldestWip[0].ageDays, 5);
check('oldest WIP key is the hanging item', oldest.oldestWip[0].key, 'A-WIP');
const oldestWithTodo = buildCycleOverview(
  [
    ...peopleIssues,
    issue({
      key: 'IDLE-1',
      assigneeId: 'carol',
      assigneeName: 'Carol',
      status: 'К выполнению',
      statusCategory: 'new',
    }),
  ],
  window,
  { now },
);
check('todo assignees are omitted from oldest WIP', oldestWithTodo.oldestWip.some((item) => item.assigneeName === 'Carol'), false);
const oldestWithBlocked = buildCycleOverview(
  [
    ...peopleIssues,
    issue({
      key: 'BLK-1',
      assigneeId: 'dana',
      assigneeName: 'Dana',
      status: 'BLOCKED',
      firstInProgress: '2026-09-01T00:00:00.000Z',
    }),
  ],
  window,
  { now },
);
check('BLOCKED is omitted from oldest WIP', oldestWithBlocked.oldestWip.some((item) => item.key === 'BLK-1'), false);
check('overview has no developer table', overview.includes('По разработчикам') || overview.includes('Иной период'), false);
check('overview has Oldest WIP beside the chart', overview.includes('OldestWipPanel') && overview.includes('cycle-side'), true);
check('overview has a people filter', overview.includes('Люди') && overview.includes('overview-people'), true);

const aliceOnlyChart = buildCycleOverview(peopleIssues, window, { assigneeIds: ['alice'] });
check('people filter keeps Alice work on the chart', aliceOnlyChart.bars.every((bar) => bar.assigneeName === 'Alice'), true);
check('people filter drops other people from the chart', aliceOnlyChart.bars.some((bar) => bar.key === 'B-1'), false);
check(
  'people list ignores the people filter itself',
  listCyclePeople(peopleIssues, { assigneeIds: ['alice'] }).map((person) => person.name),
  ['Alice', 'Bob'],
);
const aliceOnlyOldest = buildCycleOverview(peopleIssues, window, { assigneeIds: ['alice'], now });
check('people filter keeps Alice oldest WIP', aliceOnlyOldest.oldestWip.map((item) => item.key), ['A-WIP']);

console.log('--- open bugs ---');
const bugs = [
  issue({
    key: 'CDR-9',
    type: 'Bug',
    summary: 'New crash',
    status: 'В работе',
    priority: 'High',
    storyPoints: 2,
    reporterName: 'Pat',
    assigneeName: 'Alice',
    created: '2026-09-10T12:00:00.000Z',
    createdAgeDays: 5,
  }),
  issue({
    key: 'CDR-1',
    type: 'Баг',
    summary: 'Old crash',
    status: 'Ready to QA',
    priority: 'Highest',
    reporterName: 'Sam',
    assigneeName: 'Unassigned',
    created: '2026-08-01T08:00:00.000Z',
    createdAgeDays: 45,
  }),
  issue({
    key: 'CDR-BACK',
    type: 'Bug',
    summary: 'Backlog leak',
    status: 'К выполнению',
    statusCategory: 'new',
    priority: 'Low',
    reporterName: 'Pat',
    created: '2026-07-01T08:00:00.000Z',
    createdAgeDays: 76,
  }),
  issue({
    key: 'CDR-DONE',
    type: 'Bug',
    summary: 'Shipped',
    status: 'Готово',
    created: '2026-01-01T08:00:00.000Z',
  }),
  issue({
    key: 'CDR-STORY',
    type: 'Story',
    summary: 'Not a bug',
    status: 'В работе',
    created: '2026-01-02T08:00:00.000Z',
  }),
];
const bugsNoBacklog = listOpenBugs(bugs);
check(
  'bugs without backlog are oldest first and skip todo/done/stories',
  bugsNoBacklog.map((item) => item.key),
  ['CDR-1', 'CDR-9'],
);
check('bug row keeps priority', bugsNoBacklog[0].priority, 'Highest');
check('bug row keeps reporter', bugsNoBacklog[0].reporterName, 'Sam');
check('bug row keeps age from created', bugsNoBacklog[0].ageDays, 45);
check(
  'bugs sort newest first by age',
  sortBugsByAge(bugsNoBacklog, 'newest').map((item) => item.key),
  ['CDR-9', 'CDR-1'],
);
const bugsWithBacklog = listOpenBugs(bugs, { includeBacklog: true });
check(
  'bugs with backlog include todo, still skip done',
  bugsWithBacklog.map((item) => item.key),
  ['CDR-BACK', 'CDR-1', 'CDR-9'],
);
check('bug JQL has no sprint window', /sprint/i.test(openBugsJql(['CDR'])), false);
check('bug JQL is oldest first', openBugsJql(['CDR']).includes('ORDER BY created ASC'), true);
check('overview has a bug list', overview.includes('BugListPanel') && overview.includes('С бэклогом'), true);
check('overview bugs ignore the sprint period', overview.includes('openBugsJql(projectKeys)'), true);
check('overview bugs have an age column and sort', overview.includes('Возраст') && overview.includes('sortBugsByAge'), true);
check(
  'overview bugs can exclude statuses with checkboxes',
  overview.includes('Исключить статусы') && overview.includes('excludeBugStatuses') && overview.includes('CheckDropdown'),
  true,
);
const bugsNoReady = listOpenBugs(bugs, { excludeStatuses: ['Ready to QA'] });
check(
  'bugs exclude selected statuses',
  bugsNoReady.map((item) => item.key),
  ['CDR-9'],
);
check(
  'bugs exclude statuses by alias',
  listOpenBugs(bugs, { excludeStatuses: ['In Progress'] }).map((item) => item.key),
  ['CDR-1'],
);
check('bug status options skip done and stories', uniqueBugStatuses(bugs), ['В работе', 'К выполнению', 'Ready to QA']);

console.log('--- start override ---');
check('bars are not overridden by default', model.bars.every((bar) => !bar.startOverridden && !bar.endOverridden), true);
const overridden = buildCycleOverview([...completed, wip], window, {
  startOverrides: {
    'CDR-2038': '2026-09-10T12:00:00.000Z',
    'CDR-2029': '2026-09-01T00:00:00.000Z',
  },
});
const slow = overridden.bars.find((bar) => bar.key === 'CDR-2038');
check('override recomputes cycle time from the new start', slow.cycleTimeDays, 1);
check('override is marked on the bar', slow.startOverridden, true);
check('override keeps the changelog start', slow.changelogStart, '2026-09-07T09:00:00.000Z');
check('override is the effective start', slow.firstInProgress, '2026-09-10T12:00:00.000Z');
check('override does not drop the bar', overridden.completedCount, 3);
check('override changes the median', overridden.median !== model.median, true);
check('override changes P85', overridden.p85 !== model.p85, true);
const afterDone = buildCycleOverview(completed, window, {
  startOverrides: { 'CDR-2038': '2026-09-12T00:00:00.000Z' },
});
check('override after done is zero cycle time', afterDone.bars.find((bar) => bar.key === 'CDR-2038').cycleTimeDays, 0);
const wipAge = buildCycleOverview([...completed, wip], window, {
  startOverrides: { 'CDR-2100': '2026-01-01T00:00:00.000Z' },
  now,
});
check(
  'override does not change oldest WIP',
  wipAge.oldestWip[0].ageDays,
  buildCycleOverview([...completed, wip], window, { now }).oldestWip[0].ageDays,
);
check(
  'override map uppercases keys',
  cycleStartOverrideMap([{ key: 'cdr-2038', startedAt: '2026-09-10T12:00:00.000Z' }]),
  { 'CDR-2038': '2026-09-10T12:00:00.000Z' },
);
const overrideTip = cycleBarTooltip(slow);
check('tooltip names the override', overrideTip.includes('Start override'), true);
check('tooltip keeps the original start', overrideTip.includes('Original start'), true);
check('overview has an override dialog', overview.includes('OverrideDialog') && overview.includes('Override дат'), true);
check('chart can prefill an override key', charts.includes('onOverrideStart'), true);
check('compare uses the same start overrides', overview.includes('startOverrides: overrideMaps.startOverrides'), true);
check('compare uses the same end overrides', overview.includes('endOverrides: overrideMaps.endOverrides'), true);

console.log('--- end override ---');
const endOnly = buildCycleOverview(completed, window, {
  endOverrides: { 'CDR-2038': '2026-09-08T09:00:00.000Z' },
});
const endBar = endOnly.bars.find((bar) => bar.key === 'CDR-2038');
check('end override recomputes cycle time', endBar.cycleTimeDays, 1);
check('end override is marked', endBar.endOverridden, true);
check('end override keeps the changelog done', endBar.changelogDone, '2026-09-11T12:00:00.000Z');
check('end override is the effective done', endBar.doneAt, '2026-09-08T09:00:00.000Z');
const outsideEnd = buildCycleOverview(completed, window, {
  endOverrides: { 'CDR-2038': '2026-08-01T00:00:00.000Z' },
});
check(
  'end override does not drop the bar from the sprint window',
  outsideEnd.bars.some((bar) => bar.key === 'CDR-2038'),
  true,
);
check(
  'end override before start is zero cycle time',
  outsideEnd.bars.find((bar) => bar.key === 'CDR-2038').cycleTimeDays,
  0,
);
const both = buildCycleOverview(completed, window, {
  startOverrides: { 'CDR-2038': '2026-09-09T12:00:00.000Z' },
  endOverrides: { 'CDR-2038': '2026-09-10T12:00:00.000Z' },
});
check('start and end overrides recompute together', both.bars.find((bar) => bar.key === 'CDR-2038').cycleTimeDays, 1);
check(
  'end override changes P85',
  endOnly.p85 !== model.p85,
  true,
);
const endTip = cycleBarTooltip(endBar);
check('tooltip names the end override', endTip.includes('End override'), true);
check('tooltip keeps the original end', endTip.includes('Original end'), true);
check(
  'override maps split start and end',
  cycleOverrideMaps([{ key: 'cdr-1', startedAt: 'a', endedAt: 'b' }]),
  { startOverrides: { 'CDR-1': 'a' }, endOverrides: { 'CDR-1': 'b' } },
);

console.log('--- working days ---');
function localStamp(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0);
}
const fri = localStamp(2026, 9, 11, 18);
const mon = localStamp(2026, 9, 14, 10);
const shortCycle = issue({
  key: 'CDR-2062',
  status: 'Проверка',
  effectiveCategory: 'done',
  firstInProgress: '2026-09-16T09:40:00.000Z',
  doneAt: '2026-09-16T10:17:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 0,
  signals: ['done'],
});
const shortModel = buildCycleOverview([shortCycle], { from: '2026-09-16', to: '2026-09-16' });
check('37-minute cycle is not stored as 0 days', shortModel.bars[0].cycleTimeDays > 0, true);
check('37-minute cycle formats as 0.6 h', formatCycleDuration(shortModel.bars[0].cycleTimeDays), '0.6 h');

check('calendar Fri 18:00 → Mon 10:00', daysBetween(fri, mon), 2.7);
check('working Fri 18:00 → Mon 10:00 skips weekend', workingDaysBetween(fri, mon), 0.7);
check('working holiday on Friday is excluded', workingDaysBetween(fri, mon, ['2026-09-11']), 0.4);
check('working holiday on Monday is excluded', workingDaysBetween(fri, mon, new Set(['2026-09-14'])), 0.3);
check('working to <= from is zero', workingDaysBetween(mon, fri), 0);

const weekendIssue = issue({
  key: 'CDR-WKND',
  status: 'Проверка',
  effectiveCategory: 'done',
  firstInProgress: fri.toISOString(),
  doneAt: mon.toISOString(),
  doneAtSource: 'changelog',
  cycleTimeDays: 2.7,
  signals: ['done'],
});
const weekendWindow = { from: '2026-09-01', to: '2026-09-30' };
check(
  'calendar mode keeps fixture cycle time',
  buildCycleOverview([weekendIssue], weekendWindow).bars[0].cycleTimeDays,
  2.7,
);
check(
  'holidays do not apply in calendar mode',
  buildCycleOverview([weekendIssue], weekendWindow, { holidays: ['2026-09-11'] }).bars[0].cycleTimeDays,
  2.7,
);
const workingWeekend = buildCycleOverview([weekendIssue], weekendWindow, { workingDays: true });
check('working mode shortens Fri→Mon bar', workingWeekend.bars[0].cycleTimeDays, workingElapsedDays(fri, mon));
check('working mode changes median', workingWeekend.median, summarize([workingElapsedDays(fri, mon)]).median);
check(
  'holiday date is excluded from working cycle time',
  buildCycleOverview([weekendIssue], weekendWindow, { workingDays: true, holidays: ['2026-09-11'] }).bars[0]
    .cycleTimeDays,
  workingElapsedDays(fri, mon, ['2026-09-11']),
);
const workingOldest = buildCycleOverview(peopleIssues, window, { now, workingDays: true });
check('oldest WIP in working mode skips weekends', workingOldest.oldestWip[0].ageDays, 3);
check('working mode does not change WIP count', workingOldest.wipCount, oldest.wipCount);
check(
  'override start/end use working formula',
  buildCycleOverview(completed, window, {
    workingDays: true,
    startOverrides: { 'CDR-2038': fri.toISOString() },
    endOverrides: { 'CDR-2038': mon.toISOString() },
  }).bars.find((bar) => bar.key === 'CDR-2038').cycleTimeDays,
  workingElapsedDays(fri, mon),
);
check('calendar fixtures still match summarize()', model.median, expectedSummary.median);
check(
  'overview has calendar/working switcher',
  overview.includes('Календарные') && overview.includes('Рабочие'),
  true,
);
check('overview has holidays dialog', overview.includes('HolidaysDialog') && overview.includes('Праздники'), true);
check('overview stores working-days flag', overview.includes('cycle-overview.workingDays'), true);
check(
  'compare uses workingDays and holidays',
  overview.includes('workingDays,') && overview.includes('holidays,'),
  true,
);

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} assertion(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(`All ${checks} assertions passed.`);
