/**
 * Predictability domain: commitment, added/removed scope, spillover, reliability.
 *
 *   node node_modules/typescript/lib/tsc.js -p scripts/tsconfig.verify.json
 *   node scripts/verify-predictability.cjs
 */
const { DEFAULT_FLOW_WORKFLOW, mergeFlowWorkflow } = require('../.tmp-verify/src/backend/metrics/flow-workflow.js');
const { buildPredictability, comparePredictability, predictabilityHistoryRow } = require('../.tmp-verify/src/backend/metrics/predictability-model.js');
const { extractSprintChanges, extractEstimateChanges, changelogIsComplete } = require('../.tmp-verify/src/backend/metrics/predictability-changelog.js');
const { countConsecutiveSpillovers } = require('../.tmp-verify/src/backend/metrics/predictability-membership.js');
const { PREDICTABILITY_TABLE_CATEGORIES } = require('../.tmp-verify/src/backend/metrics/predictability-copy.js');

const failures = [];
let checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label} = ${JSON.stringify(actual)}`);
}

const sprint = {
  id: 10,
  name: 'Sprint 10',
  state: 'closed',
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: '2026-09-14T17:00:00.000Z',
  completeDate: '2026-09-14T17:00:00.000Z',
};

const nextSprint = {
  id: 11,
  name: 'Sprint 11',
  state: 'closed',
  startDate: '2026-09-15T09:00:00.000Z',
  endDate: '2026-09-28T17:00:00.000Z',
  completeDate: '2026-09-28T17:00:00.000Z',
};

const thirdSprint = {
  id: 12,
  name: 'Sprint 12',
  state: 'closed',
  startDate: '2026-09-29T09:00:00.000Z',
  endDate: '2026-10-12T17:00:00.000Z',
  completeDate: '2026-10-12T17:00:00.000Z',
};

function issue(partial) {
  return {
    key: 'CDR-1',
    url: 'https://acme.atlassian.net/browse/CDR-1',
    summary: 'Work',
    type: 'Story',
    status: 'Проверка',
    created: '2026-08-20T09:00:00.000Z',
    changelogComplete: true,
    sprintChanges: [],
    estimateChanges: [],
    ...partial,
  };
}

function committed(at = '2026-08-31T12:00:00.000Z') {
  return [{ at, fromIds: [], toIds: [10] }];
}

function build(issues, extra = {}) {
  return buildPredictability({
    sprint,
    issues,
    orderedSprints: extra.orderedSprints ?? [sprint, nextSprint, thirdSprint],
    workflow: extra.workflow ?? DEFAULT_FLOW_WORKFLOW,
    now: extra.now ?? new Date('2026-09-20T12:00:00.000Z'),
    excludeQaTitle: extra.excludeQaTitle,
    excludedKeys: extra.excludedKeys,
    excludedTypes: extra.excludedTypes,
    sourceQuality: extra.sourceQuality,
  });
}

function cat(snapshot, key) {
  return snapshot.tasks.find((row) => row.key === key)?.category;
}

console.log('--- 1–3 membership ---');
const initial = build([
  issue({
    key: 'C-1',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 3 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('1. in sprint at start is committed', cat(initial, 'C-1'), 'committed-completed');

const addedOnly = build([
  issue({
    key: 'A-1',
    sprintChanges: [{ at: '2026-09-03T12:00:00.000Z', fromIds: [], toIds: [10] }],
    estimateChanges: [{ at: '2026-09-03T12:00:00.000Z', to: 2 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('2. added after start is added', cat(addedOnly, 'A-1'), 'added-completed');

const mix = build([
  issue({
    key: 'C-1',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 5 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
  issue({
    key: 'A-1',
    sprintChanges: [{ at: '2026-09-03T12:00:00.000Z', fromIds: [], toIds: [10] }],
    estimateChanges: [{ at: '2026-09-03T12:00:00.000Z', to: 8 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('3. added is not in reliability numerator', mix.summary.reliability.completedTasks, 1);
check('3. added is not in reliability denominator', mix.summary.reliability.committedTasks, 1);

console.log('--- 4–7 completion ---');
check('4. committed reaching review is completed', cat(initial, 'C-1'), 'committed-completed');

const doneStatus = build([
  issue({
    key: 'G-1',
    status: 'Готово',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 1 }],
  }),
]);
check('5. Готово without doneAt is not completed', cat(doneStatus, 'G-1'), 'spillover');

const firstReview = build([
  issue({
    key: 'R-1',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 1 }],
    doneAt: '2026-09-08T10:00:00.000Z',
    statusTransitions: [
      { at: '2026-09-08T10:00:00.000Z', from: 'В работе', to: 'Проверка' },
      { at: '2026-09-09T10:00:00.000Z', from: 'Проверка', to: 'В работе' },
      { at: '2026-09-11T10:00:00.000Z', from: 'В работе', to: 'Проверка' },
    ],
  }),
]);
check('6–7. first review kept after return and repeat', firstReview.tasks[0].doneAt, '2026-09-08T10:00:00.000Z');
check('6–7. still committed completed', cat(firstReview, 'R-1'), 'committed-completed');

console.log('--- 8–12 removed / cancelled / re-add ---');
const removed = build([
  issue({
    key: 'RM-1',
    status: 'В работе',
    sprintChanges: [
      { at: '2026-08-31T12:00:00.000Z', fromIds: [], toIds: [10] },
      { at: '2026-09-10T12:00:00.000Z', fromIds: [10], toIds: [] },
    ],
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 4 }],
  }),
]);
check('8. removed stays committed category', cat(removed, 'RM-1'), 'removed');
check('9. removed stays in reliability denominator', removed.summary.reliability.committedTasks, 1);
check('9. removed is not completed', removed.summary.reliability.completedTasks, 0);
check('19. removed is not spillover', removed.summary.spillover.tasks, 0);

const cancelledWf = mergeFlowWorkflow({ cancelled: ['Отменено'] });
const cancelled = build(
  [
    issue({
      key: 'X-1',
      status: 'Отменено',
      sprintChanges: committed(),
      estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
      statusTransitions: [{ at: '2026-09-05T12:00:00.000Z', from: 'В работе', to: 'Отменено' }],
    }),
  ],
  { workflow: cancelledWf },
);
check('10. cancelled committed is separate', cat(cancelled, 'X-1'), 'cancelled');

const addedReadd = build([
  issue({
    key: 'AR-1',
    status: 'В работе',
    sprintChanges: [
      { at: '2026-09-03T12:00:00.000Z', fromIds: [], toIds: [10] },
      { at: '2026-09-05T12:00:00.000Z', fromIds: [10], toIds: [] },
      { at: '2026-09-07T12:00:00.000Z', fromIds: [], toIds: [10] },
    ],
    estimateChanges: [{ at: '2026-09-03T12:00:00.000Z', to: 1 }],
  }),
]);
check('11. added remove/re-add is one added task', addedReadd.tasks.filter((row) => row.key === 'AR-1').length, 1);
check('11. still added not committed', cat(addedReadd, 'AR-1'), 'added-unfinished');

const committedReturn = build([
  issue({
    key: 'CR-1',
    status: 'В работе',
    sprintChanges: [
      { at: '2026-08-31T12:00:00.000Z', fromIds: [], toIds: [10] },
      { at: '2026-09-05T12:00:00.000Z', fromIds: [10], toIds: [] },
      { at: '2026-09-07T12:00:00.000Z', fromIds: [], toIds: [10] },
    ],
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
  }),
]);
check('12. committed remove/return stays committed', cat(committedReturn, 'CR-1'), 'spillover');
check('12. not reclassified as added', committedReturn.summary.added.tasks, 0);

console.log('--- 13–17 story points ---');
const spStart = build([
  issue({
    key: 'SP-1',
    sprintChanges: committed(),
    estimateChanges: [
      { at: '2026-08-20T12:00:00.000Z', to: 3 },
      { at: '2026-09-06T12:00:00.000Z', from: 3, to: 8 },
    ],
    doneAt: '2026-09-10T12:00:00.000Z',
    currentStoryPoints: 8,
  }),
]);
check('13. initial SP is value at start', spStart.tasks[0].baselineStoryPoints, 3);
check('15. estimate change is not added scope', spStart.summary.added.tasks, 0);
check('15. estimate change recorded', spStart.summary.estimate.increase, 5);

const addedSp = build([
  issue({
    key: 'ASP-1',
    sprintChanges: [{ at: '2026-09-04T12:00:00.000Z', fromIds: [], toIds: [10] }],
    estimateChanges: [
      { at: '2026-08-20T12:00:00.000Z', to: 1 },
      { at: '2026-09-04T12:00:00.000Z', from: 1, to: 5 },
    ],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('14. added SP is value at add', addedSp.tasks[0].baselineStoryPoints, 5);

const noSp = build([
  issue({
    key: 'NS-1',
    sprintChanges: committed(),
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
  issue({
    key: 'NS-2',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 4 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('16. unestimated still in task reliability', noSp.summary.reliability.committedTasks, 2);
check('16. unestimated still in completed tasks', noSp.summary.reliability.completedTasks, 2);
check('17. unestimated is not 0 SP in denominator', noSp.summary.reliability.committedSp, 4);
check('17. task marked unestimated', noSp.tasks.find((row) => row.key === 'NS-1').unestimated, true);
check('26. task reliability percent', noSp.summary.reliability.taskPercent, 100);
check('26. SP reliability uses estimated only', noSp.summary.reliability.spPercent, 100);

console.log('--- 18–20 spillover ---');
const spill = build([
  issue({
    key: 'S-1',
    status: 'В работе',
    sprintChanges: [
      { at: '2026-08-31T12:00:00.000Z', fromIds: [], toIds: [10] },
      { at: '2026-09-15T09:00:00.000Z', fromIds: [10], toIds: [10, 11] },
      { at: '2026-09-29T09:00:00.000Z', fromIds: [10, 11], toIds: [10, 11, 12] },
    ],
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 3 }],
  }),
]);
check('18. unfinished committed is spillover', cat(spill, 'S-1'), 'spillover');
check('20. consecutive spillover count', spill.tasks[0].spilloverCount, 2);

const oneTransfer = countConsecutiveSpillovers(
  [
    { at: '2026-08-31T12:00:00.000Z', fromIds: [], toIds: [10] },
    { at: '2026-09-15T09:00:00.000Z', fromIds: [10], toIds: [11] },
  ],
  [
    { id: 10, start: new Date('2026-09-01T09:00:00.000Z'), end: new Date('2026-09-14T17:00:00.000Z') },
    { id: 11, start: new Date('2026-09-15T09:00:00.000Z'), end: new Date('2026-09-28T17:00:00.000Z') },
  ],
  10,
);
check('20. one transfer counted once', oneTransfer, 1);

console.log('--- 21–27 exclusions, empty, active, quality, exclusive ---');
const withEpic = build([
  issue({
    key: 'EPIC-1',
    type: 'Epic',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 20 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
  issue({
    key: 'OK-1',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('21. epic not in reliability', withEpic.summary.reliability.committedTasks, 1);
check('21. epic listed as excluded', cat(withEpic, 'EPIC-1'), 'excluded');

const earlyDone = build([
  issue({
    key: 'OLD-1',
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
    doneAt: '2026-08-30T12:00:00.000Z',
  }),
]);
check('22. completed before start is not this sprint completion', earlyDone.summary.reliability.completedTasks, 0);
check('22. not in commitment denominator', earlyDone.summary.reliability.committedTasks, 0);

const empty = build([]);
check('23. empty commitment has no percent', empty.summary.reliability.taskPercent, null);
check('23. empty does not show 0%', empty.summary.reliability.spPercent, null);

const activeSprint = {
  ...sprint,
  state: 'active',
  completeDate: undefined,
};
const active = buildPredictability({
  sprint: activeSprint,
  issues: [
    issue({
      key: 'ACT-1',
      status: 'В работе',
      sprintChanges: committed(),
      estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
    }),
  ],
  workflow: DEFAULT_FLOW_WORKFLOW,
  now: new Date('2026-09-07T12:00:00.000Z'),
});
check('24. active sprint is incomplete', active.incomplete, true);
check('24. unfinished is not final spillover', cat(active, 'ACT-1'), 'still-unfinished');

const partial = build([
  issue({
    key: 'P-1',
    changelogComplete: false,
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('25. incomplete changelog is partial', partial.quality, 'partial');

check('27. mix committed category exclusive', mix.tasks.filter((row) => row.key === 'C-1').length, 1);
check('27. mix added category exclusive', mix.tasks.filter((row) => row.key === 'A-1').length, 1);
const mixCats = mix.tasks.map((row) => row.category).sort();
check('27. categories are exclusive', mixCats, ['added-completed', 'committed-completed']);

const completedThenRemoved = build([
  issue({
    key: 'CD-1',
    sprintChanges: [
      { at: '2026-08-31T12:00:00.000Z', fromIds: [], toIds: [10] },
      { at: '2026-09-12T12:00:00.000Z', fromIds: [10], toIds: [] },
    ],
    estimateChanges: [{ at: '2026-08-31T12:00:00.000Z', to: 2 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('completed then removed stays completed', cat(completedThenRemoved, 'CD-1'), 'committed-completed');

console.log('--- changelog helpers ---');
const histories = [
  {
    created: '2026-09-03T14:33:53.224+0300',
    items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '', to: '4198' }],
  },
  {
    created: '2026-09-07T11:40:32.658+0300',
    items: [{ field: 'Story point estimate', fieldId: 'customfield_10016', fromString: null, toString: '0.5' }],
  },
];
check('parse sprint add', extractSprintChanges(histories)[0].toIds, [4198]);
check('parse story point estimate', extractEstimateChanges(histories)[0].to, 0.5);
check('truncated changelog is incomplete', changelogIsComplete({ histories: new Array(40).fill({ created: 'x', items: [] }), total: 81, maxResults: 40 }), false);
check('full changelog is complete', changelogIsComplete({ histories: [{ created: 'x', items: [] }], total: 1, maxResults: 1 }), true);

const compared = comparePredictability(mix, addedOnly);
check('compare keeps previous added tasks', compared.summary.added.tasks, 1);

const implicit = build([
  issue({
    key: 'IMP-1',
    changelogComplete: true,
    currentSprintIds: [10],
    created: '2026-08-20T09:00:00.000Z',
    sprintChanges: [],
    estimateChanges: [{ at: '2026-08-20T12:00:00.000Z', to: 2 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
]);
check('stable sprint field without changelog is committed', cat(implicit, 'IMP-1'), 'committed-completed');
check('created date is kept on task', implicit.tasks[0].created, '2026-08-20T09:00:00.000Z');
check('table hides excluded', PREDICTABILITY_TABLE_CATEGORIES.includes('excluded'), false);
check('table hides already-done', PREDICTABILITY_TABLE_CATEGORIES.includes('already-done'), false);
check('table keeps carry-over unfinished', PREDICTABILITY_TABLE_CATEGORIES.includes('still-unfinished'), true);

const dropped = build([
  issue({
    key: 'DROP-1',
    changelogComplete: true,
    sprintChanges: [
      { at: '2026-08-31T12:00:00.000Z', fromIds: [], toIds: [10] },
      { at: '2026-09-05T12:00:00.000Z', fromIds: [10], toIds: [] },
    ],
    estimateChanges: [{ at: '2026-08-20T12:00:00.000Z', to: 3 }],
  }),
]);
check('removed task is scope drop', cat(dropped, 'DROP-1'), 'removed');
check('scope drop percent of commitment SP', dropped.summary.removed.percentOfCommitment, 100);

const historyNow = new Date('2026-09-20T12:00:00.000Z');
const historyRow = predictabilityHistoryRow(dropped, 10, historyNow);
check('history marks current sprint', historyRow.current, true);
check('history drop tasks', historyRow.dropTasks, 1);
check('history throughput ignores unfinished drop', historyRow.throughputTasks, 0);
check('history done total ignores drop', historyRow.doneTasks, 0);

const delivered = build([
  issue({
    key: 'DONE-1',
    changelogComplete: true,
    sprintChanges: committed(),
    estimateChanges: [{ at: '2026-08-20T12:00:00.000Z', to: 2 }],
    doneAt: '2026-09-10T12:00:00.000Z',
  }),
  issue({
    key: 'ADD-1',
    changelogComplete: true,
    sprintChanges: [{ at: '2026-09-04T12:00:00.000Z', fromIds: [], toIds: [10] }],
    estimateChanges: [{ at: '2026-09-04T12:00:00.000Z', to: 5 }],
    doneAt: '2026-09-11T12:00:00.000Z',
  }),
]);
const deliveredRow = predictabilityHistoryRow(delivered, 10, historyNow);
check('history throughput counts first review in window', deliveredRow.throughputTasks, 2);
check('history added tasks', deliveredRow.addedTasks, 1);
check('history done total is committed completed plus added completed', deliveredRow.doneTasks, 2);

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} failed / ${checks} checks`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`All ${checks} passed`);
