/**
 * Quality domain: First QA, QA Returns, rework cycles, excludeQaTitle.
 *
 *   node node_modules/typescript/lib/tsc.js -p scripts/tsconfig.verify.json
 *   node scripts/verify-quality.cjs
 */
const { DEFAULT_FLOW_WORKFLOW, mergeFlowWorkflow } = require('../.tmp-verify/src/backend/metrics/flow-workflow.js');
const { QUALITY_SPEC, QUALITY_FORMULAS, QUALITY_FIX_STATUS } = require('../.tmp-verify/src/backend/metrics/quality-copy.js');
const {
  isQualityQaStatus,
  isQualityFixStatus,
  replayIssueQuality,
  classifyReturnReason,
} = require('../.tmp-verify/src/backend/metrics/quality-classify.js');
const { buildQualitySnapshot, assignQualitySprint, qualityCohortWindow, applyQualitySearchLimits, qualityHistoryRow, previousClosedQuality, buildFieldDiagnostic } = require('../.tmp-verify/src/backend/metrics/quality-model.js');
const { qualityJql, toQualityIssueInput, qualityHorizonJql, qualityDefectsJql } = require('../.tmp-verify/src/backend/metrics/quality-source.js');
const { classifyQualityDefects, findBugsAfterTestField } = require('../.tmp-verify/src/backend/metrics/quality-defects.js');
const { QA_TITLE_MARKER } = require('../.tmp-verify/src/backend/metrics/cycle-overview.js');

const failures = [];
let checks = 0;
function check(label, actual, expected) {
  checks += 1;
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  console.log(`${same ? 'ok  ' : 'FAIL'} ${label} = ${JSON.stringify(actual)}`);
}

function t(at, from, to) {
  return { at, from, to };
}

function issue(partial) {
  return {
    key: 'X',
    url: 'https://acme.atlassian.net/browse/X',
    summary: 'Work',
    type: 'Story',
    status: 'Проверка',
    created: '2026-09-07T09:00:00.000Z',
    changelogComplete: true,
    statusTransitions: [],
    ...partial,
  };
}

const workflow = DEFAULT_FLOW_WORKFLOW;
const asOf = new Date('2026-09-17T12:00:00.000Z');
const sprint = {
  id: 10,
  name: 'Sprint 10',
  state: 'closed',
  startDate: '2026-09-07T00:00:00.000Z',
  endDate: '2026-09-21T00:00:00.000Z',
  completeDate: '2026-09-21T00:00:00.000Z',
};

function replay(partial, replayAsOf = asOf) {
  return replayIssueQuality(issue(partial), { asOf: replayAsOf, workflow });
}

function snapshot(issues, extra) {
  return buildQualitySnapshot({ issues, sprint, asOf, workflow, ...extra });
}

const firstQaPath = [
  t('2026-09-07T10:00:00.000Z', 'К выполнению', 'В работе'),
  t('2026-09-08T10:00:00.000Z', 'В работе', 'Ready to QA'),
  t('2026-09-08T12:00:00.000Z', 'Ready to QA', 'Проверка'),
];

function withReturns(count) {
  const events = [...firstQaPath];
  let from = 'Проверка';
  for (let i = 0; i < count; i += 1) {
    const day = 9 + i * 2;
    const dd = String(day).padStart(2, '0');
    const next = String(day + 1).padStart(2, '0');
    events.push(t(`2026-09-${dd}T10:00:00.000Z`, from, 'Fix'));
    events.push(t(`2026-09-${dd}T11:00:00.000Z`, 'Fix', 'В работе'));
    events.push(t(`2026-09-${next}T10:00:00.000Z`, 'В работе', 'Ready to QA'));
    from = 'Ready to QA';
  }
  if (count > 0) events.push(t('2026-09-16T10:00:00.000Z', 'Ready to QA', 'Проверка'));
  return events;
}

console.log('--- spec ---');
check('QA group names Ready to QA and Проверка', QUALITY_SPEC.qaGroup.slice(), ['Ready to QA', 'Проверка']);
check('Fix is only Fix', QUALITY_FIX_STATUS, 'Fix');
check('spec records direct Проверка entry', QUALITY_SPEC.firstQa.includes('Прямой вход в Проверку'), true);
check('spec records internal QA moves', QUALITY_SPEC.internalQa.includes('не создают новый вход'), true);
check('spec records Готово interrupt', QUALITY_SPEC.doneInterrupts.includes('interrupted'), true);
check('spec reuses excludeQaTitle', QUALITY_SPEC.excludeQaTitle.includes('excludeQaTitle'), true);
check('spec keeps Flow completion unchanged', QUALITY_SPEC.completionUnchanged, true);
check('spec does not require bugs after test', QUALITY_SPEC.bugsAfterTestNotRequired, true);
check('spec takes events from changelog', QUALITY_SPEC.eventsFrom, 'changelog');
check('Rate formula is R/N', QUALITY_FORMULAS.rate.includes('R / N'), true);

console.log('--- predicates ---');
check('Ready to QA is QA-group', isQualityQaStatus('Ready to QA', workflow), true);
check('Проверка is QA-group', isQualityQaStatus('Проверка', workflow), true);
check('Fix is not QA-group', isQualityQaStatus('Fix', workflow), false);
check('В работе is not QA-group', isQualityQaStatus('В работе', workflow), false);
check('workflow.qa Testing is not QA-group', isQualityQaStatus('Testing', mergeFlowWorkflow({ qa: ['Testing'] })), false);
check('Fix matches only Fix', isQualityFixStatus('Fix'), true);
check('In Progress is not Fix', isQualityFixStatus('In Progress'), false);
check('В работе is not Fix', isQualityFixStatus('В работе'), false);

console.log('--- direct entry into Проверка ---');
const direct = replay({
  key: 'DIR-1',
  statusTransitions: [t('2026-09-08T10:00:00.000Z', 'К выполнению', 'Проверка')],
});
check('direct Проверка is First QA', direct.firstQaAt, '2026-09-08T10:00:00.000Z');
check('direct Проверка records the entered status', direct.firstQaTo, 'Проверка');
check('direct Проверка has no return', direct.returns.length, 0);

console.log('--- internal QA moves ---');
const internal = replay({
  key: 'INT-1',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Ready to QA'),
    t('2026-09-08T12:00:00.000Z', 'Ready to QA', 'Проверка'),
    t('2026-09-09T09:00:00.000Z', 'Проверка', 'Ready to QA'),
    t('2026-09-09T15:00:00.000Z', 'Ready to QA', 'Проверка'),
  ],
});
check('internal QA keeps a single First QA', internal.firstQaAt, '2026-09-08T10:00:00.000Z');
check('internal QA creates no returns', internal.returns.length, 0);
check('internal QA creates no cycles', internal.cycles.length, 0);

console.log('--- returns and cycles ---');
const notReturn = replay({
  key: 'IP-1',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'В работе'),
  ],
});
check('QA → In Progress is not a return', notReturn.returns.length, 0);

const oneLoop = replay({
  key: 'LOOP-1',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-09T11:00:00.000Z', 'Fix', 'В работе'),
    t('2026-09-10T10:00:00.000Z', 'В работе', 'Ready to QA'),
  ],
});
check('QA → Fix → IP → QA is one return', oneLoop.returns.length, 1);
check('QA → Fix → IP → QA is one completed cycle', oneLoop.cycles.map((c) => c.kind), ['completed']);
check('rework time ends at QA re-entry', oneLoop.cycles[0].durationDays, 1);
check('rework time ignores later QA wait', replay({
  key: 'LOOP-WAIT',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-11T10:00:00.000Z', 'Fix', 'Ready to QA'),
    t('2026-09-14T10:00:00.000Z', 'Ready to QA', 'Проверка'),
  ],
}).cycles[0].durationDays, 2);

console.log('--- Готово interrupt ---');
const interrupted = replay({
  key: 'DONE-1',
  status: 'Готово',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-10T10:00:00.000Z', 'Fix', 'Готово'),
  ],
});
check('Готово interrupts the open cycle', interrupted.cycles.map((c) => c.kind), ['interrupted']);
check('interrupt reason is done', interrupted.cycles[0].interruptReason, 'done');
check('interrupt timestamp is Готово', interrupted.cycles[0].endedAt, '2026-09-10T10:00:00.000Z');
check('interrupt does not undo the QA Return', interrupted.returns.length, 1);

const reopened = replay({
  key: 'DONE-2',
  status: 'Проверка',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-10T10:00:00.000Z', 'Fix', 'Готово'),
    t('2026-09-11T10:00:00.000Z', 'Готово', 'В работе'),
    t('2026-09-12T10:00:00.000Z', 'В работе', 'Проверка'),
  ],
});
check('reopen does not resume interrupted cycle', reopened.cycles.map((c) => c.kind), ['interrupted']);
check('reopen into QA is not a new completed cycle', reopened.cycles.filter((c) => c.kind === 'completed').length, 0);

const afterInterruptReturn = replay({
  key: 'DONE-3',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-10T10:00:00.000Z', 'Fix', 'Готово'),
    t('2026-09-11T10:00:00.000Z', 'Готово', 'В работе'),
    t('2026-09-12T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-13T10:00:00.000Z', 'Проверка', 'Fix'),
  ],
});
check('new Fix after interrupt is a new return', afterInterruptReturn.returns.length, 2);
check('new Fix after interrupt opens a new cycle', afterInterruptReturn.cycles.map((c) => c.kind), ['interrupted', 'open']);

const interruptSnap = snapshot([
  issue({
    key: 'DONE-1',
    status: 'Готово',
    statusTransitions: [
      t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
      t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
      t('2026-09-10T10:00:00.000Z', 'Fix', 'Готово'),
    ],
  }),
]);
check('interrupted cycle is out of Rework WIP', interruptSnap.reworkWip, 0);
check('interrupted cycle is out of completed loops', interruptSnap.loops, 0);
check('interrupted cycle is out of median sample', interruptSnap.reworkSummary, null);
check('interrupted cycle stays in detail', interruptSnap.issues[0].interruptedCycles.length, 1);
check('interrupted issue still counts as a QA Return', interruptSnap.r, 1);

console.log('--- excludeQaTitle ---');
const qaTitled = issue({
  key: 'QA-1',
  summary: `${QA_TITLE_MARKER} regression pack`,
  statusTransitions: firstQaPath,
});
const kept = issue({ key: 'DEV-1', statusTransitions: firstQaPath });
const withQa = snapshot([qaTitled, kept], { filters: { excludeQaTitle: true } });
const withoutFilter = snapshot([qaTitled, kept], { filters: { excludeQaTitle: false } });
check('excludeQaTitle drops [QA] from N', withQa.n, 1);
check('excludeQaTitle drops [QA] from issues', withQa.issues.map((row) => row.key), ['DEV-1']);
check('excludeQaTitle increments excludedCount', withQa.excludedCount, 1);
check('excludeQaTitle off keeps [QA] in N', withoutFilter.n, 2);

console.log('--- cohort window ---');
const afterClose = new Date('2026-09-22T00:00:00.000Z');
const lateFirst = buildQualitySnapshot({
  issues: [
    issue({
      key: 'LATE-1',
      status: 'Проверка',
      statusTransitions: [t('2026-09-21T00:00:00.000Z', 'В работе', 'Проверка')],
    }),
  ],
  sprint,
  asOf: afterClose,
  workflow,
});
const insideClose = buildQualitySnapshot({
  issues: [
    issue({
      key: 'IN-1',
      statusTransitions: [t('2026-09-20T23:59:59.000Z', 'В работе', 'Проверка')],
    }),
  ],
  sprint,
  asOf: afterClose,
  workflow,
});
check('First QA on completeDate is outside the half-open window', lateFirst.n, 0);
check('First QA just before completeDate is inside', insideClose.n, 1);
const previousSprint = snapshot([
  issue({
    key: 'PREV-1',
    created: '2026-08-01T09:00:00.000Z',
    statusTransitions: [
      t('2026-08-10T10:00:00.000Z', 'В работе', 'Проверка'),
      t('2026-09-10T10:00:00.000Z', 'Проверка', 'Fix'),
    ],
  }),
]);
check('return in this sprint does not move an earlier First QA', previousSprint.n, 0);

const overlapA = { id: 1, name: 'A', state: 'closed', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-14T00:00:00.000Z', completeDate: '2026-09-14T00:00:00.000Z' };
const overlapB = { id: 2, name: 'B', state: 'closed', startDate: '2026-09-07T00:00:00.000Z', endDate: '2026-09-21T00:00:00.000Z', completeDate: '2026-09-21T00:00:00.000Z' };
const overlapIssue = issue({ key: 'OVL-1', statusTransitions: [t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка')] });
check(
  'overlapping windows prefer earlier startDate',
  assignQualitySprint(new Date('2026-09-08T10:00:00.000Z'), [overlapB, overlapA], asOf)?.id,
  1,
);
const inA = buildQualitySnapshot({ issues: [overlapIssue], sprint: overlapA, allSprints: [overlapA, overlapB], asOf, workflow });
const inB = buildQualitySnapshot({ issues: [overlapIssue], sprint: overlapB, allSprints: [overlapA, overlapB], asOf, workflow });
check('overlap assigns to earlier sprint', inA.n, 1);
check('overlap does not double-count', inB.n, 0);

console.log('--- unknown history ---');
const unknown = snapshot([
  issue({ key: 'OK-1', statusTransitions: firstQaPath }),
  issue({
    key: 'UNK-1',
    changelogComplete: false,
    statusTransitions: [t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка')],
  }),
]);
check('unknown history is not in N', unknown.n, 1);
check('unknown history is not in the zero-return bucket', unknown.distribution.zero, 1);
check('unknown history has its own bucket', unknown.distribution.unknown, 1);
check('unknown history makes Rate unavailable', unknown.rate, null);
check('unavailable without events is not placed', snapshot([
  issue({ key: 'NONE-1', changelogComplete: false, statusTransitions: undefined, status: 'В работе' }),
]).nUnknown, 0);

console.log('--- empty / types / created-in-QA ---');
check('N=0 Rate is unavailable not 0', snapshot([]).rate, null);
check('sub-task is outside the cohort', snapshot([issue({ key: 'SUB-1', type: 'Sub-task', statusTransitions: firstQaPath })]).n, 0);
const createdInQa = replay({
  key: 'CR-1',
  created: '2026-09-08T09:00:00.000Z',
  statusTransitions: [t('2026-09-09T10:00:00.000Z', 'Проверка', 'Ready to QA')],
});
check('created in Проверка uses created as First QA', createdInQa.firstQaAt, '2026-09-08T09:00:00.000Z');
const missingCreated = replay({
  key: 'CR-2',
  created: undefined,
  statusTransitions: [t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix')],
});
check('missing created for in-QA start is unavailable', missingCreated.historyQuality, 'unavailable');
const duped = replay({
  key: 'DUP-1',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-10T10:00:00.000Z', 'Fix', 'Ready to QA'),
  ],
});
check('duplicate changelog rows do not double a return', duped.returns.length, 1);

console.log('--- control sample 25 ---');
const sample = [];
for (let i = 1; i <= 19; i += 1) sample.push(issue({ key: `Z-${i}`, statusTransitions: withReturns(0) }));
for (let i = 1; i <= 4; i += 1) sample.push(issue({ key: `R1-${i}`, statusTransitions: withReturns(1) }));
sample.push(issue({ key: 'R2-1', statusTransitions: withReturns(2) }));
sample.push(issue({ key: 'R3-1', statusTransitions: withReturns(3) }));
const control = snapshot(sample);
check('control N', control.n, 25);
check('control R', control.r, 6);
check('control R2', control.r2, 2);
check('control L', control.loops, 9);
check('control Rate', control.rate, 0.24);
check('control dataQuality is exact', control.dataQuality, 'exact');
check('control asOf is the analysis instant', control.asOf, asOf.toISOString());
check('control distribution 0/1/2/3+', [control.distribution.zero, control.distribution.one, control.distribution.two, control.distribution.threePlus], [19, 4, 1, 1]);

const window = qualityCohortWindow(sprint, asOf);
check('closed sprint window starts at startDate', window.start?.toISOString(), '2026-09-07T00:00:00.000Z');
check('closed sprint window ends at completeDate', window.end?.toISOString(), '2026-09-21T00:00:00.000Z');
check('closed sprint is not incomplete', window.incomplete, false);

console.log('--- data source ---');
const jql = qualityJql(sprint, [{ id: 't1', projects: ['CDR'], extraJql: 'labels = team' }]);
check('JQL keeps sprint membership', jql.includes('sprint = 10'), true);
check('JQL adds the cohort window', jql.includes('updated >='), true);
check('JQL does not invent a bugs-after-test field', /bugs after test/i.test(jql), false);
const completeInput = toQualityIssueInput(
  { key: 'A-1', url: '', summary: 'Work', type: 'Story', status: 'Проверка', created: '2026-09-07T09:00:00.000Z', statusTransitions: firstQaPath },
  { histories: [{ created: '2026-09-08T10:00:00.000Z', items: [] }], total: 1 },
);
check('complete changelog is marked complete', completeInput.changelogComplete, true);
const truncatedChangelog = toQualityIssueInput(
  { key: 'A-2', url: '', summary: 'Work', type: 'Story', status: 'Проверка', created: '2026-09-07T09:00:00.000Z', statusTransitions: firstQaPath },
  { histories: Array.from({ length: 40 }, () => ({ created: '2026-09-08T10:00:00.000Z' })), total: 80 },
);
check('paged changelog is not claimed complete', truncatedChangelog.changelogComplete, false);
const limited = applyQualitySearchLimits(control, true);
check('truncated search does not zero N', limited.n, 25);
check('truncated search does not zero R', limited.r, 6);
check('truncated search does not zero loops', limited.loops, 9);
check('truncated search hides exact Rate', limited.rate, null);
check('truncated search is partial', limited.dataQuality, 'partial');
check('empty snapshot is unavailable, not 0%', snapshot([]).dataQuality, 'unavailable');

console.log('--- history / late return ---');
const sprintA = {
  id: 1,
  name: 'Sprint A',
  state: 'closed',
  startDate: '2026-09-01T00:00:00.000Z',
  endDate: '2026-09-14T00:00:00.000Z',
  completeDate: '2026-09-14T00:00:00.000Z',
};
const sprintB = {
  id: 2,
  name: 'Sprint B',
  state: 'closed',
  startDate: '2026-09-14T00:00:00.000Z',
  endDate: '2026-09-28T00:00:00.000Z',
  completeDate: '2026-09-28T00:00:00.000Z',
};
const asOfLate = new Date('2026-09-22T12:00:00.000Z');
const lateReturnIssue = issue({
  key: 'LATE-RET',
  created: '2026-09-02T09:00:00.000Z',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-20T10:00:00.000Z', 'Проверка', 'Fix'),
  ],
});
const snapA = buildQualitySnapshot({
  issues: [lateReturnIssue],
  sprint: sprintA,
  allSprints: [sprintA, sprintB],
  asOf: asOfLate,
  workflow,
});
const snapB = buildQualitySnapshot({
  issues: [lateReturnIssue],
  sprint: sprintB,
  allSprints: [sprintA, sprintB],
  asOf: asOfLate,
  workflow,
});
check('late return stays in the original First QA cohort', snapA.r, 1);
check('late return does not create a row in the next sprint', snapB.n, 0);
check('history rows share asOf', qualityHistoryRow(snapA, 1).asOf, qualityHistoryRow(snapB, 1).asOf);
check('each sprint has its own Return Rate', qualityHistoryRow(snapA, 1).rate, 1);
const hist = [
  qualityHistoryRow(snapA, 2),
  {
    ...qualityHistoryRow(snapA, 2),
    sprintId: 2,
    name: 'Sprint B',
    current: true,
    incomplete: true,
    rate: 0.3,
  },
];
check('previous closed skips the active sprint', previousClosedQuality(hist, 2)?.sprintId, 1);
const horizon = qualityHorizonJql([sprint, { ...sprint, id: 11 }], [{ id: 't1', projects: ['CDR'] }]);
check('horizon JQL lists sprint ids', horizon.includes('sprint in (10, 11)') || horizon.includes('sprint in (11, 10)'), true);

console.log('--- FPY / reasons / defects ---');
check('FPY formula is Passed/(Passed+Failed)', QUALITY_FORMULAS.fpy.includes('Passed / (Passed + Failed)'), true);
check('bugs after test stays diagnostic only', QUALITY_SPEC.bugsAfterTestNotRequired, true);
const passedIssue = issue({
  key: 'PASS',
  status: 'Готово',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Готово'),
  ],
});
const pendingIssue = issue({
  key: 'PEND',
  status: 'Проверка',
  statusTransitions: [t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка')],
});
const failedIssue = issue({
  key: 'FAIL',
  status: 'Готово',
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
    t('2026-09-10T10:00:00.000Z', 'Fix', 'Готово'),
  ],
});
const fpySnap = snapshot([passedIssue, pendingIssue, failedIssue]);
check('Готово without a return is first-pass passed', fpySnap.issues.find((row) => row.key === 'PASS')?.firstPass, 'passed');
check('still in QA without a return is pending, not passed', fpySnap.issues.find((row) => row.key === 'PEND')?.firstPass, 'pending');
check('QA→Fix then Готово is first-pass failed', fpySnap.issues.find((row) => row.key === 'FAIL')?.firstPass, 'failed');
check('FPY excludes pending from the denominator', fpySnap.firstPass, { passed: 1, failed: 1, pending: 1, fpy: 0.5 });
check('FPY is not the 0-return bucket', fpySnap.firstPass.fpy === fpySnap.distribution.zero / fpySnap.n, false);
const reasoned = replay({
  statusTransitions: [
    t('2026-09-08T10:00:00.000Z', 'В работе', 'Проверка'),
    t('2026-09-09T10:00:00.000Z', 'Проверка', 'Fix'),
  ],
  histories: [
    {
      created: '2026-09-09T10:00:00.000Z',
      items: [
        { field: 'status', fromString: 'Проверка', toString: 'Fix' },
        { field: 'comment', toString: 'не сходится с макетом' },
      ],
    },
  ],
});
check('comment beside QA→Fix is a recorded reason', reasoned.returns[0]?.reasonKind, 'comment');
check('status-only return is «Не записана», not a guessed defect', classifyReturnReason([{ field: 'status', toString: 'Fix' }]).kind, 'none');
const defects = classifyQualityDefects({
  bugs: [
    { key: 'QA-BUG', url: '', summary: 'found in QA', type: 'Bug', status: 'Fix', created: '2026-09-10T00:00:00.000Z', labels: [], linkedKeys: [] },
    { key: 'PROD-1', url: '', summary: 'prod', type: 'Bug', status: 'К выполнению', created: '2026-09-10T00:00:00.000Z', labels: ['production'], linkedKeys: [] },
    { key: 'ESC-1', url: '', summary: 'escaped', type: 'Bug', status: 'К выполнению', created: '2026-09-11T00:00:00.000Z', labels: [], parentKey: 'PASS', linkedKeys: [] },
    { key: 'INC-1', url: '', summary: 'outage', type: 'Incident', status: 'Готово', created: '2026-09-12T00:00:00.000Z', labels: [], linkedKeys: [] },
    { key: 'MAYBE', url: '', summary: 'maybe', type: 'Bug', status: 'К выполнению', created: '2026-09-12T00:00:00.000Z', labels: [], linkedKeys: [] },
  ],
  sprints: [sprint],
  assignSprint: () => sprint,
  doneAtByKey: new Map([['PASS', '2026-09-09T10:00:00.000Z']]),
  cohortKeysBySprint: new Map([[10, new Set(['QA-BUG'])]]),
});
const pack = defects.get(10);
check('QA-found bug is not counted as production', pack.items.some((item) => item.key === 'QA-BUG'), false);
check('production label is a proven production defect', pack.items.find((item) => item.key === 'PROD-1')?.kind, 'production');
check('bug after linked Готово is escaped production', pack.items.find((item) => item.key === 'ESC-1')?.kind, 'production');
check('Incident type is an incident', pack.items.find((item) => item.key === 'INC-1')?.kind, 'incident');
check('bug without a signal stays unproven', pack.items.find((item) => item.key === 'MAYBE')?.kind, 'unproven');
check('unproven is not named production', pack.production, 2);
check('defects JQL is bugs created in the window', /issuetype in \("Bug"/.test(qualityDefectsJql([sprint], [{ id: 't1', projects: ['CDR'] }])) && /created >=/.test(qualityDefectsJql([sprint], [{ id: 't1', projects: ['CDR'] }])), true);
check('bugs after test field is detected by name', findBugsAfterTestField([{ id: 'customfield_9', name: 'Bugs after test', custom: true }])?.id, 'customfield_9');
const diag = buildFieldDiagnostic(
  [
    { ...fpySnap.issues.find((row) => row.key === 'FAIL'), bugsAfterTest: 1, returnCount: 1, historyQuality: 'exact' },
    { ...fpySnap.issues.find((row) => row.key === 'PASS'), bugsAfterTest: 1, returnCount: 0, historyQuality: 'exact' },
  ],
  { id: 'customfield_9', name: 'Bugs after test' },
);
check('diagnostic match when field equals changelog returns', diag.match, 1);
check('diagnostic field-only when field > 0 and no return', diag.fieldOnly, 1);

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
