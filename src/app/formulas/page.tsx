'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Callout, Card, Pill } from '@frontend/components/ui';
import { useAppData } from '@frontend/lib/app-data';
import { metricFormulas } from '@backend/metrics/catalog';
import { describeDone, hasStatusOverrides, ruleWarnings } from '@backend/metrics/rules';

const SCREENS: Array<{ href: string; name: string; question: string; scope: string }> = [
  {
    href: '/overview',
    name: 'Overview',
    question: 'Is anything on fire across everything I own?',
    scope:
      'One team or several side by side. Defaults to each team\u2019s active sprint, and falls back to unfinished work when a team has no sprint.',
  },
  {
    href: '/sprint',
    name: 'Sprint',
    question: 'How is this specific sprint actually going?',
    scope:
      'Exactly one sprint of one team, chosen by you. Adds the metrics that only mean something inside a sprint: days remaining, carry-over, remaining work over time.',
  },
  {
    href: '/people',
    name: 'People',
    question: 'Who is overloaded, who is stuck, and how does one person compare?',
    scope:
      'One team over a window of days rather than a sprint, because a person\u2019s pattern needs more than two weeks to read. Click a name for the same metrics narrowed to them.',
  },
  {
    href: '/dashboards',
    name: 'Dashboards',
    question: 'The specific set of numbers I look at every week.',
    scope:
      'Whatever you assemble. Each widget carries its own scope, so one screen can hold two teams, a single person and a raw JQL query at once.',
  },
  {
    href: '/teams',
    name: 'Teams',
    question: 'Who and which boards is a team made of?',
    scope: 'Your own grouping of people, boards and projects. Every other screen is built on it.',
  },
];

export default function FormulasPage() {
  const { rules } = useAppData();
  const groups = useMemo(() => metricFormulas(rules), [rules]);
  const [openGroup, setOpenGroup] = useState<string>('basis');
  const warnings = ruleWarnings(rules);

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <header className="page-header">
        <div className="page-header-meta">
          <h1>Formulas</h1>
          <div className="page-header-sub">
            <span>Every number this tool shows, and exactly how it is computed from your current rules.</span>
            <Link href="/settings">Change the rules</Link>
          </div>
        </div>
      </header>

      <Callout tone={hasStatusOverrides(rules) ? 'warning' : 'info'} title={describeDone(rules)}>
        {hasStatusOverrides(rules)
          ? 'Your rules reclassify statuses, so these numbers will not match Jira\u2019s own board and reports. That is intended, but worth knowing before quoting a number to someone reading Jira directly.'
          : 'No status overrides are configured, so done means what Jira means by done.'}
      </Callout>

      {warnings.length > 0 && (
        <Callout tone="warning" title="Current rules contain something worth checking">
          <ul className="plain">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Card
        title="Which screen answers which question"
        caption="The screens differ in scope and time frame, not in how a metric is computed."
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Screen</th>
                <th>The question it answers</th>
                <th>What it looks at</th>
              </tr>
            </thead>
            <tbody>
              {SCREENS.map((screen) => (
                <tr key={screen.href}>
                  <td>
                    <Link href={screen.href}>{screen.name}</Link>
                  </td>
                  <td>{screen.question}</td>
                  <td className="caption">{screen.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {groups.map((group) => {
        const open = openGroup === group.id;
        return (
          <Card
            key={group.id}
            title={group.title}
            caption={group.intro}
            actions={
              <button type="button" className="subtle" onClick={() => setOpenGroup(open ? '' : group.id)}>
                {open ? 'Collapse' : `Show ${group.entries.length}`}
              </button>
            }
          >
            {open && (
              <div className="stack">
                {group.entries.map((entry) => (
                  <div key={entry.name} className="formula">
                    <div className="formula-name">{entry.name}</div>
                    <p className="formula-body">{entry.formula}</p>
                    <div className="formula-meta">
                      <span className="caption">
                        Reads <code>{entry.reads}</code>
                      </span>
                      {entry.settings.length > 0 && (
                        <div className="row" style={{ gap: 5 }}>
                          <span className="caption">Changed by</span>
                          {entry.settings.map((setting) => (
                            <Pill key={setting} tone="info">
                              {setting}
                            </Pill>
                          ))}
                        </div>
                      )}
                    </div>
                    {entry.blindSpot && (
                      <p className="formula-blind">
                        <strong>Cannot see:</strong> {entry.blindSpot}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      <Card title="Two rules that apply everywhere" caption="They explain most surprises in the numbers.">
        <ul className="plain">
          <li>
            <strong>One query per scope.</strong> A screen runs a single paginated Jira search and computes every
            widget from that one result locally. Two widgets with the same scope share the fetch, which is why
            changing a threshold is instant while changing a scope is not.
          </li>
          <li>
            <strong>Absent data is named, not assumed.</strong> No story points means counts are used and the screen
            says so. No changelog means cycle time is missing rather than estimated. Blocked is only ever claimed
            from the places actually checked, listed under each screen.
          </li>
        </ul>
      </Card>
    </div>
  );
}
