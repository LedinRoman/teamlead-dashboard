/**
 * Exercises the API against a running dev server, including the failure paths a
 * first-time user is most likely to hit. Each case declares the status it expects,
 * so a correct upstream failure (502) is not confused with a bug (500).
 *
 *   npm run dev
 *   node scripts/smoke-api.mjs [baseUrl]
 */
import { loadEnv } from './load-env.mjs';

loadEnv();
const base = process.argv[2] ?? `http://127.0.0.1:${process.env.APP_PORT ?? '3000'}`;

/** Mirrors DEFAULT_METRIC_RULES so this script can undo what its cases change. */
const SHIPPED_DEFAULTS = {
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

// Routes that need Jira answer 409 until a connection exists, so the expected
// status depends on the state of the machine this runs on.
const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
const connected = bootstrap.connected === true;
console.log(
  connected
    ? `Jira is connected (${bootstrap.connections.length} connection(s)), so Jira-backed routes are expected to succeed.\n`
    : 'No Jira connection, so Jira-backed routes are expected to answer 409.\n',
);

const cases = [
  { label: 'bootstrap', method: 'GET', path: '/api/bootstrap', expect: 200 },
  { label: 'settings', method: 'GET', path: '/api/settings', expect: 200 },
  { label: 'cache stats', method: 'GET', path: '/api/cache', expect: 200 },
  { label: 'dashboards list', method: 'GET', path: '/api/dashboards', expect: 200 },
  { label: 'teams', method: 'GET', path: '/api/teams', expect: connected ? 200 : 409 },
  { label: 'jira metadata', method: 'GET', path: '/api/jira/meta', expect: connected ? 200 : 409 },
  { label: 'status catalogue', method: 'GET', path: '/api/jira/statuses', expect: connected ? 200 : 409 },
  {
    label: 'statuses of a project that does not exist',
    method: 'GET',
    path: '/api/jira/statuses?project=NOSUCHPROJECT',
    expect: connected ? 404 : 409,
  },
  {
    // With a connection this is a scope error (422); without one the connection
    // check fails first (409).
    label: 'metrics for a team that does not exist',
    method: 'POST',
    path: '/api/metrics',
    body: { scope: { kind: 'team', teamId: 'missing', mode: 'active-sprint' } },
    expect: connected ? 422 : 409,
  },
  {
    label: 'metrics with an unknown scope kind',
    method: 'POST',
    path: '/api/metrics',
    body: { scope: { kind: 'banana' } },
    expect: 400,
  },
  {
    label: 'metrics with empty JQL',
    method: 'POST',
    path: '/api/metrics',
    body: { scope: { kind: 'jql', jql: '   ' } },
    expect: 400,
  },
  { label: 'people without a teamId', method: 'POST', path: '/api/metrics/people', body: {}, expect: 400 },
  { label: 'batch with no requests', method: 'POST', path: '/api/metrics/batch', body: { requests: [] }, expect: 400 },
  { label: 'connection test with no URL', method: 'POST', path: '/api/connections/test', body: { secret: 'x' }, expect: 400 },
  {
    label: 'connection test with a garbage URL',
    method: 'POST',
    path: '/api/connections/test',
    body: { baseUrl: 'not a url at all', secret: 'dummy', email: 'a@b.com' },
    expect: 400,
  },
  {
    label: 'cloud connection test with no email',
    method: 'POST',
    path: '/api/connections/test',
    body: { baseUrl: 'https://acme.atlassian.net', secret: 'dummy' },
    expect: 400,
  },
  {
    label: 'connection test against an unreachable host',
    method: 'POST',
    path: '/api/connections/test',
    body: { baseUrl: 'https://nonexistent-jira-host-xyz.invalid', email: 'a@b.com', secret: 'dummy' },
    expect: 502,
  },
  {
    label: 'settings patch clamps out-of-range values',
    method: 'PATCH',
    path: '/api/settings',
    body: { staleDays: 99999 },
    expect: 200,
  },
  {
    label: 'settings patch accepts the status rules',
    method: 'PATCH',
    path: '/api/settings',
    body: { doneStatuses: ['In Review', '  '], excludedTypes: ['Sub-task'] },
    expect: 200,
  },
  {
    label: 'settings patch drops an unknown attention signal',
    method: 'PATCH',
    path: '/api/settings',
    body: { attentionSignals: ['blocked', 'not-a-signal'] },
    expect: 200,
  },
  {
    label: 'dashboard with a bad widget type',
    method: 'POST',
    path: '/api/dashboards',
    body: { name: 'x', widgets: [{ type: 'nope' }] },
    expect: 400,
  },
  { label: 'unknown board id', method: 'GET', path: '/api/jira/boards/abc/sprints', expect: 400 },
  {
    label: 'flow without teams',
    method: 'POST',
    path: '/api/flow',
    body: { teamIds: [] },
    expect: 400,
  },
  {
    label: 'flow issue without key',
    method: 'POST',
    path: '/api/flow/issue',
    body: {},
    expect: 400,
  },
  {
    label: 'flow issue without teams',
    method: 'POST',
    path: '/api/flow/issue',
    body: { key: 'CDR-1' },
    expect: 400,
  },
];

let failures = 0;

for (const testCase of cases) {
  try {
    const response = await fetch(`${base}${testCase.path}`, {
      method: testCase.method,
      headers: testCase.body ? { 'Content-Type': 'application/json' } : undefined,
      body: testCase.body ? JSON.stringify(testCase.body) : undefined,
    });
    const text = await response.text();
    const compact = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    const pass = response.status === testCase.expect;
    if (!pass) failures += 1;
    console.log(
      `${pass ? 'ok  ' : 'FAIL'} [${response.status}${pass ? '' : ` want ${testCase.expect}`}] ${testCase.label}\n       ${compact}`,
    );
  } catch (error) {
    failures += 1;
    console.log(`FAIL [threw] ${testCase.label}\n       ${error.message}`);
  }
}

console.log('');
// Several cases mutated the saved rules; restore the shipped defaults.
const restored = await fetch(`${base}/api/settings`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(SHIPPED_DEFAULTS),
});
const { rules } = await restored.json();
const clean =
  rules.staleDays === 3 && rules.doneStatuses.length === 0 && rules.attentionSignals.length === 9;
if (!clean) {
  failures += 1;
  console.log(`FAIL rules were not restored to defaults: ${JSON.stringify(rules)}`);
}

console.log(failures === 0 ? `All ${cases.length} API cases behaved as expected.` : `${failures} case(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
