/**
 * Flow domain: WIP classification, rework, aging labels, stage time, throughput.
 *
 *   node node_modules/typescript/lib/tsc.js -p scripts/tsconfig.verify.json
 *   node scripts/verify-flow.cjs
 */
const {
  DEFAULT_FLOW_WORKFLOW,
  mergeFlowWorkflow,
  validateFlowWorkflow,
  exclusiveStageOf,
} = require('../.tmp-verify/src/backend/metrics/flow-workflow.js');
const { classifyFlowIssue, isFlowScoped } = require('../.tmp-verify/src/backend/metrics/flow-classify.js');
const { flowAgingAges, durationDays, durationDaysPrecise, agingAttention } = require('../.tmp-verify/src/backend/metrics/flow-aging.js');
const { buildFlowSnapshot, filterFlowAging } = require('../.tmp-verify/src/backend/metrics/flow-model.js');
const { buildFlowStageTime } = require('../.tmp-verify/src/backend/metrics/flow-stages.js');
const { buildFlowThroughput } = require('../.tmp-verify/src/backend/metrics/flow-throughput.js');
const { buildFlowHistory } = require('../.tmp-verify/src/backend/metrics/flow-history.js');
const { stageIntervalsUntilFirstReview } = require('../.tmp-verify/src/backend/metrics/flow-timeline.js');
const { buildIssueTimelineSegments, toFlowIssueTimeline, visibleIssueTimelineSegments, timelineSegmentWeights, issueTimelineStatusTotals, uniqueTimelineStatusNames } = require('../.tmp-verify/src/backend/metrics/flow-issue-timeline.js');
const { flowTimelineSegmentColor } = require('../.tmp-verify/src/backend/metrics/flow-stage-tone.js');
const { workingDaysBetween, daysBetween, workingElapsedDays, elapsedDays } = require('../.tmp-verify/src/backend/metrics/time.js');
const { isDevWip, formatCycleDuration } = require('../.tmp-verify/src/backend/metrics/cycle-overview.js');

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
    assigneeName: 'Alice',
    assigneeId: 'alice',
    created: '2026-09-07T09:00:00.000Z',
    updated: '2026-09-10T09:00:00.000Z',
    doneAtSource: 'none',
    createdAgeDays: 1,
    updatedAgeDays: 1,
    labels: [],
    components: [],
    fixVersions: [],
    sprintNames: [],
    sprintIds: [],
    links: [],
    signals: ['active'],
    firstInProgress: '2026-09-08T09:00:00.000Z',
    ...partial,
  };
}

const workflow = DEFAULT_FLOW_WORKFLOW;
const now = new Date('2026-09-15T12:00:00.000Z');

console.log('--- classify ---');
const dev = issue({ key: 'DEV-1', status: 'В работе' });
check('active development is Development WIP', classifyFlowIssue(dev, workflow).inDevelopmentWip, true);
check('active development is not rework', classifyFlowIssue(dev, workflow).rework, false);

const reviewWorkflow = mergeFlowWorkflow({ review: ['Code Review'] });
const inReviewStatus = issue({ key: 'REV-1', status: 'Code Review' });
check('configured review is Development WIP', classifyFlowIssue(inReviewStatus, reviewWorkflow).inDevelopmentWip, true);

const checking = issue({ key: 'QA-1', status: 'Проверка', firstInProgress: '2026-09-08T09:00:00.000Z' });
check('Проверка is not Development WIP', classifyFlowIssue(checking, workflow).inDevelopmentWip, false);
check('Проверка is the in-review group', classifyFlowIssue(checking, workflow).inReview, true);
check('Проверка is not QA WIP', classifyFlowIssue(checking, workflow).inQaWip, false);

const queued = issue({ key: 'Q-1', status: 'Ready to QA', firstInProgress: '2026-09-08T09:00:00.000Z' });
check('Ready to QA is QA WIP', classifyFlowIssue(queued, workflow).inQaWip, true);
check('Fix current status is development, not QA WIP', classifyFlowIssue(issue({ status: 'Fix' }), workflow).inQaWip, false);

const returned = issue({
  key: 'REW-1',
  status: 'В работе',
  doneAt: '2026-09-10T12:00:00.000Z',
  doneAtSource: 'changelog',
  cycleTimeDays: 2,
  firstInProgress: '2026-09-08T09:00:00.000Z',
  statusEnteredAt: '2026-09-12T09:00:00.000Z',
  statusTransitions: [
    { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-10T12:00:00.000Z', from: 'В работе', to: 'Проверка' },
    { at: '2026-09-12T09:00:00.000Z', from: 'Проверка', to: 'В работе' },
  ],
});
check('returned issue is Development WIP', classifyFlowIssue(returned, workflow).inDevelopmentWip, true);
check('returned issue is Rework', classifyFlowIssue(returned, workflow).rework, true);
check('rework keeps original cycle time', returned.cycleTimeDays, 2);

const blocked = issue({
  key: 'BLK-1',
  status: 'BLOCKED',
  signals: ['blocked', 'active'],
  firstInProgress: '2026-09-14T12:00:00.000Z',
});
check('blocked development-process task is WIP', classifyFlowIssue(blocked, workflow).inDevelopmentWip, true);
check('blocked is counted once in snapshot', buildFlowSnapshot([blocked], { workflow, now }).blocked, 1);
check(
  'two blocked issues stay two',
  buildFlowSnapshot(
    [blocked, issue({ key: 'BLK-2', status: 'BLOCKED', signals: ['blocked'] })],
    { workflow, now },
  ).blocked,
  2,
);

const epic = issue({ key: 'EPIC-1', type: 'Epic', status: 'В работе' });
check('epic is out of flow scope', isFlowScoped(epic), false);

const cancelledWorkflow = mergeFlowWorkflow({ cancelled: ['Отменено'] });
const cancelled = issue({ key: 'CAN-1', status: 'Отменено', firstInProgress: '2026-09-08T09:00:00.000Z' });
check('cancelled is not Development WIP', classifyFlowIssue(cancelled, cancelledWorkflow).inDevelopmentWip, false);
check('cancelled is not aging', classifyFlowIssue(cancelled, cancelledWorkflow).inAging, false);

const backlog = issue({ key: 'TODO-1', status: 'К выполнению', firstInProgress: undefined });
check('task without a start is not aging', classifyFlowIssue(backlog, workflow).inAging, false);

console.log('--- aging ---');
const ages = flowAgingAges(dev, workflow, now);
check('active episode label', ages.episodeLabel, 'В работе');
check('status age uses statusEnteredAt when present', flowAgingAges(issue({
  ...dev,
  statusEnteredAt: '2026-09-14T12:00:00.000Z',
}), workflow, now).statusDays, 1);
const reworkAges = flowAgingAges(returned, workflow, now);
check('returned episode label', reworkAges.episodeLabel, 'В работе');
check('returned episode starts after first review', reworkAges.episodeDays, 3.1);
check('original cycle time stays on the row', reworkAges.originalCycleTimeDays, 2);

const checkingAges = flowAgingAges(
  issue({
    ...checking,
    statusEnteredAt: '2026-09-12T12:00:00.000Z',
    doneAt: '2026-09-12T12:00:00.000Z',
  }),
  workflow,
  now,
);
check('Проверка execution is episode minus status', checkingAges.executionDays, 4.1);
check('Проверка episode still includes time in review', checkingAges.episodeDays, 7.1);
check(
  'Проверка below median is not highlighted',
  agingAttention({ blocked: false, stage: 'inReview', ages: checkingAges }, { median: 5, p85: 10 }),
  undefined,
);
check(
  'Проверка above p85 is red even if episode is longer',
  agingAttention(
    { blocked: false, stage: 'inReview', ages: { ...checkingAges, executionDays: 12, episodeDays: 20 } },
    { median: 5, p85: 10 },
  ),
  'p85',
);
const overrideReview = flowAgingAges(
  issue({
    ...checking,
    firstInProgress: '2026-09-08T09:00:00.000Z',
    statusEnteredAt: '2026-09-10T09:00:00.000Z',
    doneAt: '2026-09-09T09:00:00.000Z',
  }),
  workflow,
  now,
);
check('Проверка override uses doneAt as execution end', overrideReview.executionDays, 1);
check(
  'override below median is not highlighted',
  agingAttention({ blocked: false, stage: 'inReview', ages: overrideReview }, { median: 5, p85: 10 }),
  undefined,
);
check(
  'rework below median is not highlighted',
  agingAttention({ blocked: false, stage: 'rework', ages: reworkAges }, { median: 5, p85: 10 }),
  undefined,
);

const shipped = issue({
  key: 'DONE-1',
  status: 'Готово',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  statusEnteredAt: '2026-09-14T12:00:00.000Z',
  doneAt: '2026-09-12T12:00:00.000Z',
});
check('Готово stays in aging', classifyFlowIssue(shipped, workflow).inAging, true);
const shippedAges = flowAgingAges(shipped, workflow, now);
check('Готово execution is episode minus time in Готово', shippedAges.executionDays, 6.1);

console.log('--- overlapping workflow ---');
const overlap = validateFlowWorkflow(mergeFlowWorkflow({ development: ['В работе', 'Проверка'], inReview: ['Проверка'] }));
check('overlapping exclusive statuses are errors', overlap.errors.some((item) => item.includes('Проверка')), true);

console.log('--- unclassified ---');
check('unknown status is other, not a throw', exclusiveStageOf('mystery', workflow), 'other');
check('unknown still builds a snapshot', buildFlowSnapshot([issue({ key: 'M-1', status: 'mystery', firstInProgress: '2026-09-08T09:00:00.000Z' })], { workflow, now }).developmentWip >= 0, true);

console.log('--- stage time ---');
const visits = issue({
  key: 'ST-1',
  status: 'Проверка',
  doneAt: '2026-09-12T09:00:00.000Z',
  doneAtSource: 'changelog',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  cycleTimeDays: 4,
  statusTransitions: [
    { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-09T09:00:00.000Z', from: 'В работе', to: 'architecture' },
    { at: '2026-09-10T09:00:00.000Z', from: 'architecture', to: 'В работе' },
    { at: '2026-09-12T09:00:00.000Z', from: 'В работе', to: 'Проверка' },
    { at: '2026-09-14T09:00:00.000Z', from: 'Проверка', to: 'Готово' },
  ],
});
const intervals = stageIntervalsUntilFirstReview(visits.statusTransitions, workflow, visits.created, visits.doneAt);
const developmentMs = intervals.filter((row) => row.stage === 'development').reduce((sum, row) => sum + row.ms, 0);
check('repeat development visits are summed', developmentMs, 4 * 86_400_000);
check('time after first review is excluded', intervals.some((row) => row.to > Date.parse('2026-09-12T09:00:00.000Z')), false);
const stageModel = buildFlowStageTime([visits], workflow);
check('stage time n is 1', stageModel.sampleSize, 1);
check('stage time drops К выполнению', stageModel.rows.some((row) => row.stage === 'notStarted' || row.label === 'К выполнению'), false);
check('empty stage time has a message', buildFlowStageTime([], workflow).emptyMessage.includes('этапам'), true);

const blockedVisit = issue({
  key: 'ST-2',
  status: 'Проверка',
  doneAt: '2026-09-11T09:00:00.000Z',
  doneAtSource: 'changelog',
  firstInProgress: '2026-09-08T09:00:00.000Z',
  statusTransitions: [
    { at: '2026-09-08T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-09T09:00:00.000Z', from: 'В работе', to: 'BLOCKED' },
    { at: '2026-09-10T09:00:00.000Z', from: 'BLOCKED', to: 'В работе' },
    { at: '2026-09-11T09:00:00.000Z', from: 'В работе', to: 'Проверка' },
  ],
});
const split = buildFlowStageTime([blockedVisit], workflow);
check('other time is split by status name', split.rows.some((row) => row.label === 'BLOCKED'), true);
check('lumped Другое is gone when status is known', split.rows.some((row) => row.label === 'Другое'), false);

console.log('--- throughput ---');
const sprints = [
  { id: 21, name: 'Спринт 21', state: 'closed', startDate: '2026-08-24', endDate: '2026-09-07', completeDate: '2026-09-07' },
  { id: 22, name: 'Спринт 22', state: 'active', startDate: '2026-09-07', endDate: '2026-09-21' },
];
const thruIssues = [
  issue({ key: 'T-1', doneAt: '2026-09-08T10:00:00.000Z' }),
  issue({ key: 'T-1', doneAt: '2026-09-09T10:00:00.000Z' }),
  issue({ key: 'T-2', doneAt: '2026-09-01T10:00:00.000Z' }),
  issue({ key: 'T-3', status: 'Готово', doneAt: undefined, resolved: '2026-09-09T10:00:00.000Z' }),
];
const thru = buildFlowThroughput(thruIssues, sprints, now);
check('first review counts once', thru.points.find((row) => row.sprintId === 22).count, 1);
check('repeat key does not add throughput', thru.points.find((row) => row.sprintId === 22).count, 1);
check('Готово without doneAt is not throughput', thru.points.reduce((sum, row) => sum + row.count, 0), 2);
check('previous sprint got the earlier first review', thru.points.find((row) => row.sprintId === 21).count, 1);
check('active sprint is marked incomplete', thru.points.find((row) => row.sprintId === 22).incomplete, true);

console.log('--- history ---');
check(
  'history unavailable without timelines',
  buildFlowHistory([dev], workflow, '2026-09-07', '2026-09-15').available,
  false,
);
check(
  'history available with timelines',
  buildFlowHistory([returned], workflow, '2026-09-12', '2026-09-15').available,
  true,
);
check(
  'history does not invent a CFD',
  Object.keys(buildFlowHistory([returned], workflow, '2026-09-12', '2026-09-15')).includes('cfd'),
  false,
);
check(
  'snapshot history can use a separate issue set',
  buildFlowSnapshot([dev], {
    workflow,
    now,
    window: { from: '2026-09-12', to: '2026-09-15' },
    historyIssues: [returned],
    horizon: { requested: 6, used: 6 },
  }).history.available,
  true,
);
check(
  'snapshot keeps requested horizon',
  buildFlowSnapshot([dev], { workflow, now, horizon: { requested: 8, used: 6 } }).horizon,
  { requested: 8, used: 6 },
);

console.log('--- issue timeline ---');
const returnedTimeline = buildIssueTimelineSegments(toFlowIssueTimeline(returned), workflow, now);
check(
  'returned issue status order',
  returnedTimeline.map((row) => row.status),
  ['К выполнению', 'В работе', 'Проверка', 'В работе'],
);
check('returned last segment is development', returnedTimeline[returnedTimeline.length - 1].stage, 'development');
check('returned review segment is inReview', returnedTimeline.find((row) => row.status === 'Проверка').stage, 'inReview');
const blockedTimeline = buildIssueTimelineSegments(toFlowIssueTimeline(blockedVisit), workflow, now);
check('blocked status sits in the middle', blockedTimeline.some((row) => row.status === 'BLOCKED' && row.blocked), true);
check(
  'hide not-started drops backlog',
  visibleIssueTimelineSegments(returnedTimeline, ['К выполнению']).map((row) => row.status),
  ['В работе', 'Проверка', 'В работе'],
);
check(
  'english To Do alias hides К выполнению',
  visibleIssueTimelineSegments(returnedTimeline, ['To Do']).map((row) => row.status),
  ['В работе', 'Проверка', 'В работе'],
);
check(
  'status names collapse case and locale aliases',
  uniqueTimelineStatusNames(['To do', 'To Do', 'К выполнению', 'In progress', 'В работе']),
  ['In progress', 'To do'],
);
check(
  'keep not-started when nothing excluded',
  visibleIssueTimelineSegments(returnedTimeline, []).map((row) => row.status),
  ['К выполнению', 'В работе', 'Проверка', 'В работе'],
);
const workVisits = returnedTimeline.filter((row) => row.status === 'В работе');
check(
  'status totals sum repeat visits',
  issueTimelineStatusTotals(returnedTimeline).find((row) => row.status === 'В работе')?.visits,
  2,
);
check(
  'status totals add visit days',
  issueTimelineStatusTotals(returnedTimeline).find((row) => row.status === 'В работе')?.days,
  workVisits[0].days + workVisits[1].days,
);
check(
  'snapshot keeps throughput horizon',
  buildFlowSnapshot([dev], {
    workflow,
    now,
    horizon: { requested: 8, used: 6 },
    throughputHorizon: { requested: 3, used: 3 },
  }).throughputHorizon,
  { requested: 3, used: 3 },
);
const burst = issue({
  key: 'BURST-1',
  status: 'К выполнению',
  created: '2026-09-15T09:00:00.000Z',
  firstInProgress: '2026-09-15T09:00:00.000Z',
  statusTransitions: [
    { at: '2026-09-15T09:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-15T09:20:00.000Z', from: 'В работе', to: 'К выполнению' },
    { at: '2026-09-15T10:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-15T10:20:00.000Z', from: 'В работе', to: 'К выполнению' },
    { at: '2026-09-15T11:00:00.000Z', from: 'К выполнению', to: 'В работе' },
    { at: '2026-09-15T11:20:00.000Z', from: 'В работе', to: 'К выполнению' },
  ],
});
const burstNow = new Date('2026-09-15T12:00:00.000Z');
const burstTimeline = buildIssueTimelineSegments(toFlowIssueTimeline(burst), workflow, burstNow);
const burstWork = burstTimeline.filter((row) => row.status === 'В работе');
const burstTotal = issueTimelineStatusTotals(burstTimeline).find((row) => row.status === 'В работе');
check('three short in-progress visits', burstWork.length, 3);
check('short visit is not rounded to 0 days', burstWork.every((row) => row.days > 0), true);
check('short visit formats as 0.x hours', formatCycleDuration(burstWork[0].days), '0.3 ч');
check('short visit totals keep the hour', formatCycleDuration(burstTotal?.days ?? 0), '1 ч');
check('short visit totals count visits', burstTotal?.visits, 3);
check(
  'Fix color is not В работе color',
  flowTimelineSegmentColor({ status: 'Fix', stage: 'development' }) ===
    flowTimelineSegmentColor({ status: 'В работе', stage: 'development' }),
  false,
);
check(
  'QA color is not В работе color',
  flowTimelineSegmentColor({ status: 'Ready to QA', stage: 'qaQueue' }) ===
    flowTimelineSegmentColor({ status: 'В работе', stage: 'development' }),
  false,
);
check(
  'Fix color is not QA color',
  flowTimelineSegmentColor({ status: 'Fix', stage: 'development' }) ===
    flowTimelineSegmentColor({ status: 'Ready to QA', stage: 'qaQueue' }),
  false,
);
check(
  'min width boosts a tiny slice',
  timelineSegmentWeights([{ ms: 100 }, { ms: 9900 }], 2),
  [200, 9900],
);
check(
  'min width 0 keeps true duration',
  timelineSegmentWeights([{ ms: 100 }, { ms: 9900 }], 0),
  [100, 9900],
);
check('default min segment pct is 2', mergeFlowWorkflow().timelineMinSegmentPct, 2);
check('min segment pct clamps to 10', mergeFlowWorkflow({ timelineMinSegmentPct: 99 }).timelineMinSegmentPct, 10);

console.log('--- working days ---');
const fri = new Date(2026, 8, 11, 18, 0, 0);
const mon = new Date(2026, 8, 14, 10, 0, 0);
check('calendar duration still uses daysBetween', durationDays(fri, mon, false), 2.7);
check('working duration uses workingDaysBetween', durationDays(fri, mon, true), workingDaysBetween(fri, mon));
check('shared working-days helper is unchanged', workingDaysBetween(fri, mon) < daysBetween(fri, mon), true);
const weekendStay = buildIssueTimelineSegments(
  {
    created: fri.toISOString(),
    status: 'Готово',
    transitions: [{ at: fri.toISOString(), from: 'Проверка', to: 'Готово' }],
  },
  workflow,
  mon,
  { workingDays: true },
);
check(
  'timeline working days skip weekend',
  weekendStay[weekendStay.length - 1].days,
  workingElapsedDays(fri, mon),
);
check(
  'timeline working days match precise duration',
  weekendStay[weekendStay.length - 1].days,
  durationDaysPrecise(fri, mon, true),
);
const weekendCalendar = buildIssueTimelineSegments(
  {
    created: fri.toISOString(),
    status: 'Готово',
    transitions: [{ at: fri.toISOString(), from: 'Проверка', to: 'Готово' }],
  },
  workflow,
  mon,
);
check(
  'timeline calendar days keep weekend',
  weekendCalendar[weekendCalendar.length - 1].days,
  elapsedDays(fri, mon),
);

console.log('--- overview Dev WIP untouched ---');
check('overview still excludes BLOCKED from isDevWip', isDevWip(blocked), false);

console.log('--- snapshot cards ---');
const snap = buildFlowSnapshot([dev, checking, blocked, returned, epic, backlog, queued], { workflow, now });
check('development WIP includes active, returned, blocked', snap.developmentWip, 3);
check('in review card', snap.inReview, 1);
check('QA WIP is Ready to QA by default', snap.qaWipAvailable, true);
check('QA WIP count', snap.qaWip, 1);
check('oldest prefers longest episode', snap.oldest.key, 'DEV-1');
check(
  'aging can drop Проверка',
  filterFlowAging(snap.aging, false).some((row) => row.stage === 'inReview'),
  false,
);
check(
  'aging can keep Проверка',
  filterFlowAging(snap.aging, true).some((row) => row.stage === 'inReview'),
  true,
);
const withDone = buildFlowSnapshot([shipped], { workflow, now });
check('Готово appears in aging', withDone.aging.some((row) => row.stage === 'done'), true);
check(
  'aging can drop Готово',
  filterFlowAging(withDone.aging, false).some((row) => row.stage === 'done'),
  false,
);
const fs = require('node:fs');
const path = require('node:path');
const agingTable = fs.readFileSync(path.join(__dirname, '../src/frontend/components/flow/FlowAgingTable.tsx'), 'utf8');
check('aging shows execution time for review/done', agingTable.includes('время выполнения'), true);
check('aging colors by agingAttention, not rework', agingTable.includes('agingAttention(row, thresholds)'), true);
check('aging has no rework-only checkbox', agingTable.includes('Только Rework'), false);
check('aging has no Rework badge', agingTable.includes('Rework'), false);
check('aging has no blocked-only checkbox', agingTable.includes('Только Blocked'), false);
check('snapshot keeps timelines for scoped issues', snap.issueTimelines.some((row) => row.key === 'REW-1'), true);
check('epic stays out of timelines', snap.issueTimelines.some((row) => row.key === 'EPIC-1'), false);

const inSprint = issue({
  key: 'SPR-1',
  status: 'В работе',
  sprintIds: [4198],
  firstInProgress: '2026-09-08T09:00:00.000Z',
});
const outSprint = issue({
  key: 'OUT-1',
  status: 'В работе',
  sprintIds: [1],
  firstInProgress: '2026-09-01T09:00:00.000Z',
});
const sprintAging = buildFlowSnapshot([inSprint, outSprint], { workflow, now, agingSprintIds: [4198] });
check(
  'aging keeps only current sprint membership',
  sprintAging.aging.map((row) => row.key),
  ['SPR-1'],
);
check('development WIP card ignores work outside the sprint', sprintAging.developmentWip, 1);
check(
  'without a sprint filter the card still counts every development issue',
  buildFlowSnapshot([inSprint, outSprint], { workflow, now }).developmentWip,
  2,
);
check(
  'aging empty when there is no active sprint',
  buildFlowSnapshot([inSprint], { workflow, now, agingSprintIds: [] }).aging.length,
  0,
);
check(
  'WIP cards are empty when there is no active sprint',
  buildFlowSnapshot([inSprint], { workflow, now, agingSprintIds: [] }).developmentWip,
  0,
);
const flowPage = fs.readFileSync(path.join(__dirname, '../src/app/flow/page.tsx'), 'utf8');
check('WIP cards follow the active sprint', flowPage.includes('задач активного спринта'), true);
check('Aging caption no longer splits cards from the sprint', flowPage.includes('вся незакрытая работа команды'), false);
check('flow default chart horizon is 3 sprints', flowPage.includes('const n = raw ? Number(raw) : 3'), true);
check('flow does not show the snapshot note callout', flowPage.includes('snapshotNote'), false);

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} assertion(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(`All ${checks} assertions passed.`);
