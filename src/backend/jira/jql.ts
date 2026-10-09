/** Quotes a value for use inside JQL, escaping backslashes and double quotes. */
export function jqlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function jqlList(field: string, values: string[]): string {
  return `${field} in (${values.map(jqlValue).join(', ')})`;
}

export function andAll(parts: Array<string | undefined>): string {
  return combine(parts, 'AND');
}

export function orAll(parts: Array<string | undefined>): string {
  return combine(parts, 'OR');
}

/**
 * Parenthesising a clause that still carries its ORDER BY produces JQL that Jira
 * rejects outright, so any ordering is lifted out and re-appended at the end.
 */
function combine(parts: Array<string | undefined>, operator: 'AND' | 'OR'): string {
  let orderBy: string | undefined;
  const clauses: string[] = [];

  for (const part of parts) {
    if (!part || !part.trim()) continue;
    const split = splitOrderBy(part);
    orderBy ??= split.orderBy;
    if (split.where) clauses.push(needsParens(split.where) ? `(${split.where})` : split.where);
  }

  const where = clauses.join(` ${operator} `);
  return orderBy ? withOrderBy(where, orderBy) : where;
}

function needsParens(clause: string): boolean {
  return / (OR|AND) /i.test(clause) && !/^\(.*\)$/.test(clause.trim());
}

/**
 * Strips a trailing ORDER BY so a user-supplied JQL fragment can be combined
 * with other clauses. Returns the clause plus the ordering it carried.
 */
export function splitOrderBy(jql: string): { where: string; orderBy?: string } {
  const match = /\border\s+by\b/i.exec(jql);
  if (!match) return { where: jql.trim() };
  return {
    where: jql.slice(0, match.index).trim(),
    orderBy: jql.slice(match.index).trim(),
  };
}

export function withOrderBy(where: string, orderBy: string): string {
  const trimmed = where.trim();
  if (!trimmed) return orderBy;
  return `${trimmed} ${orderBy}`;
}

/**
 * Highest priority first, then longest idle. Used for every unfinished-work view
 * so the order on screen matches what the tables claim. Board rank is avoided
 * because `ORDER BY Rank` fails outright on Jira sites without that field.
 */
export const ORDER_ATTENTION = 'ORDER BY priority DESC, updated ASC';
export const ORDER_RECENT = 'ORDER BY updated DESC';
