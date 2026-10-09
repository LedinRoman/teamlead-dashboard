import { snapshotRead, snapshotWrite } from '@backend/server/snapshot';
import type {
  AuthKind,
  Deployment,
  FieldMapping,
  JiraBoardOption,
  JiraFieldOption,
  JiraIssueTypeOption,
  JiraProjectOption,
  JiraSprintOption,
  JiraStatusOption,
  JiraUserOption,
} from '@shared/types';

export interface JiraCredentials {
  baseUrl: string;
  deployment: Deployment;
  authKind: AuthKind;
  email?: string;
  secret: string;
}

export class JiraError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    this.detail = detail;
  }
}

export interface RawChangelog {
  startAt?: number;
  maxResults?: number;
  total?: number;
  histories?: RawChangelogEntry[];
}

export interface RawIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  changelog?: RawChangelog;
}

export interface RawChangelogEntry {
  created: string;
  items?: Array<{
    field?: string;
    fieldId?: string;
    from?: string | null;
    to?: string | null;
    fromString?: string | null;
    toString?: string | null;
  }>;
}

export interface SearchResult {
  issues: RawIssue[];
  /** True when pagination stopped because the page budget ran out. */
  truncated: boolean;
  /** Total reported by Jira, when the endpoint provides one. */
  total?: number;
}

const REQUEST_TIMEOUT_MS = 45_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 25;

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Jira URL is required.');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  // A pasted browser URL often carries /jira/software/... — keep only the origin
  // plus any context path Jira Server is mounted under.
  const contextPath = url.pathname
    .replace(/\/(browse|jira|secure|projects|issues)(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `${url.origin}${contextPath}`;
}

export function guessDeployment(baseUrl: string): Deployment {
  return /\.atlassian\.(net|com)$/i.test(new URL(baseUrl).hostname) ? 'cloud' : 'server';
}

export class JiraClient {
  private readonly credentials: JiraCredentials;
  private readonly fields: FieldMapping;
  /** Cloud removed the legacy /search endpoint; remember which one this site answers. */
  private searchStyle: 'jql' | 'legacy' | null = null;
  private detectedFields?: FieldMapping;
  private fieldCache?: JiraFieldOption[];
  private statusCache?: JiraStatusOption[];

  constructor(credentials: JiraCredentials, fields: FieldMapping = {}) {
    this.credentials = { ...credentials, baseUrl: normalizeBaseUrl(credentials.baseUrl) };
    this.fields = fields;
  }

  get baseUrl(): string {
    return this.credentials.baseUrl;
  }

  get apiVersion(): '2' | '3' {
    return this.credentials.deployment === 'cloud' ? '3' : '2';
  }

  issueUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  private authHeader(): string {
    const { authKind, email, secret } = this.credentials;
    if (authKind === 'bearer') return `Bearer ${secret}`;
    const user = email ?? '';
    return `Basic ${Buffer.from(`${user}:${secret}`, 'utf8').toString('base64')}`;
  }

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const snapshotParts = [options.method ?? 'GET', path, options.query ?? null, options.body ?? null];
    const cached = await snapshotRead<T>(snapshotParts);
    if (cached) return cached.payload;

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            Authorization: this.authHeader(),
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
          cache: 'no-store',
        });

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after') ?? '2');
          await sleep(Math.min(10_000, (Number.isFinite(retryAfter) ? retryAfter : 2) * 1000));
          continue;
        }

        if (!response.ok) {
          const detail = await readErrorDetail(response);
          if (response.status >= 500 && attempt < 2) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          throw new JiraError(describeStatus(response.status, path), response.status, detail);
        }

        if (response.status === 204) return undefined as T;
        const payload = (await response.json()) as T;
        await snapshotWrite(snapshotParts, payload);
        return payload;
      } catch (error) {
        if (error instanceof JiraError) throw error;
        lastError = error;
        const isAbort = error instanceof Error && error.name === 'AbortError';
        if (attempt < 2 && !isAbort) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        if (isAbort) {
          throw new JiraError(`Jira did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${path}).`, 504);
        }
        throw new JiraError(
          `Could not reach Jira at ${this.baseUrl}. Check the URL and your network.`,
          0,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        clearTimeout(timer);
      }
    }
    throw new JiraError(
      `Jira request failed after retries (${path}).`,
      0,
      lastError instanceof Error ? lastError.message : undefined,
    );
  }

  /* ------------------------------------------------------------- identity --- */

  async myself(): Promise<{ accountId?: string; displayName: string; emailAddress?: string }> {
    const raw = await this.request<{
      accountId?: string;
      key?: string;
      name?: string;
      displayName?: string;
      emailAddress?: string;
    }>(`/rest/api/${this.apiVersion}/myself`);
    return {
      accountId: raw.accountId ?? raw.name ?? raw.key,
      displayName: raw.displayName ?? raw.name ?? 'Unknown',
      emailAddress: raw.emailAddress,
    };
  }

  async serverInfo(): Promise<{ deploymentType?: string; version?: string }> {
    return this.request(`/rest/api/${this.apiVersion}/serverInfo`);
  }

  /* --------------------------------------------------------------- fields --- */

  async fieldOptions(): Promise<JiraFieldOption[]> {
    if (this.fieldCache) return this.fieldCache;
    const raw = await this.request<
      Array<{
        id: string;
        name?: string;
        custom?: boolean;
        schema?: { type?: string; custom?: string };
      }>
    >(`/rest/api/${this.apiVersion}/field`);
    this.fieldCache = raw.map((field) => ({
      id: field.id,
      name: field.name ?? field.id,
      custom: Boolean(field.custom),
      schemaType: field.schema?.type,
      schemaCustom: field.schema?.custom,
    }));
    return this.fieldCache;
  }

  /**
   * Every status on the site, so the Settings screen can offer real choices for
   * the done and in-progress rules instead of asking for typed status names.
   */
  async statuses(): Promise<JiraStatusOption[]> {
    if (this.statusCache) return this.statusCache;
    const raw = await this.request<
      Array<{ id?: string | number; name?: string; statusCategory?: { key?: string } }>
    >(`/rest/api/${this.apiVersion}/status`);

    const seen = new Map<string, JiraStatusOption>();
    for (const status of raw) {
      const name = status.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      // The same status name can be defined per project; one entry per name is
      // enough because every rule matches on the name.
      if (seen.has(key)) continue;
      const category = status.statusCategory?.key;
      seen.set(key, {
        id: String(status.id ?? name),
        name,
        category:
          category === 'done' || category === 'indeterminate' || category === 'new' ? category : 'unknown',
      });
    }
    this.statusCache = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    return this.statusCache;
  }

  /**
   * Statuses used by one project's workflows. A site can carry dozens of statuses
   * in total while a single project uses a handful, so this is what a rule editor
   * should offer.
   */
  async projectStatuses(projectKeyOrId: string): Promise<JiraStatusOption[]> {
    const raw = await this.request<
      Array<{
        statuses?: Array<{ id?: string | number; name?: string; statusCategory?: { key?: string } }>;
      }>
    >(`/rest/api/${this.apiVersion}/project/${encodeURIComponent(projectKeyOrId)}/statuses`);

    const seen = new Map<string, JiraStatusOption>();
    // The response is grouped by issue type, and the same status appears under
    // several of them.
    for (const group of raw) {
      for (const status of group.statuses ?? []) {
        const name = status.name?.trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        const category = status.statusCategory?.key;
        seen.set(name.toLowerCase(), {
          id: String(status.id ?? name),
          name,
          category:
            category === 'done' || category === 'indeterminate' || category === 'new'
              ? category
              : 'unknown',
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async issueTypes(): Promise<JiraIssueTypeOption[]> {
    const raw = await this.request<
      Array<{ id?: string | number; name?: string; subtask?: boolean }>
    >(`/rest/api/${this.apiVersion}/issuetype`);

    const seen = new Map<string, JiraIssueTypeOption>();
    for (const type of raw) {
      const name = type.name?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.set(name.toLowerCase(), {
        id: String(type.id ?? name),
        name,
        subtask: Boolean(type.subtask),
      });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Story points and sprint are custom fields whose ids differ per site, so they
   * have to be discovered before any metric can use them.
   *
   * The schema type is tried first because it is a plugin identifier and therefore
   * the same on every site, including one whose field names are not in English.
   * Names are only a fallback.
   */
  async detectFieldMapping(): Promise<FieldMapping> {
    const fields = await this.fieldOptions();

    const bySchema = (candidates: string[]): string | undefined => {
      for (const candidate of candidates) {
        const match = fields.find((field) => field.schemaCustom === candidate);
        if (match) return match.id;
      }
      return undefined;
    };

    const byName = (candidates: string[]): string | undefined => {
      for (const candidate of candidates) {
        const match = fields.find((field) => field.name.toLowerCase() === candidate);
        if (match) return match.id;
      }
      for (const candidate of candidates) {
        const match = fields.find((field) => field.name.toLowerCase().includes(candidate));
        if (match) return match.id;
      }
      return undefined;
    };

    return {
      // Only the dedicated story-points schema is safe to match; the generic
      // number schema would pick whichever numeric field happens to come first.
      storyPointsField:
        bySchema(['com.pyxis.greenhopper.jira:jsw-story-points']) ??
        byName([
          'story point estimate',
          'story points',
          'story point',
          'оценка story point',
          'сторипоинт',
          'story point estimate',
        ]),
      sprintField:
        bySchema(['com.pyxis.greenhopper.jira:gh-sprint']) ?? byName(['sprint', 'спринт']),
      epicLinkField:
        bySchema([
          'com.pyxis.greenhopper.jira:gh-epic-link',
          'com.atlassian.jpo:jpo-custom-field-parent',
        ]) ?? byName(['epic link', 'parent link']),
    };
  }

  /* ------------------------------------------------------------- projects --- */

  async projects(): Promise<JiraProjectOption[]> {
    if (this.credentials.deployment === 'cloud') {
      const collected: JiraProjectOption[] = [];
      let startAt = 0;
      for (let page = 0; page < 20; page += 1) {
        const raw = await this.request<{
          values?: Array<{ id: string; key: string; name: string }>;
          isLast?: boolean;
        }>('/rest/api/3/project/search', { query: { startAt, maxResults: 50 } });
        const values = raw.values ?? [];
        collected.push(...values.map((p) => ({ id: p.id, key: p.key, name: p.name })));
        if (raw.isLast !== false || values.length === 0) break;
        startAt += values.length;
      }
      return collected;
    }
    const raw = await this.request<Array<{ id: string; key: string; name: string }>>('/rest/api/2/project');
    return raw.map((p) => ({ id: p.id, key: p.key, name: p.name }));
  }

  /* --------------------------------------------------------------- boards --- */

  async boards(projectKeyOrId?: string): Promise<JiraBoardOption[]> {
    const collected: JiraBoardOption[] = [];
    let startAt = 0;
    for (let page = 0; page < 20; page += 1) {
      const raw = await this.request<{
        values?: Array<{
          id: number;
          name: string;
          type?: string;
          location?: { projectKey?: string };
        }>;
        isLast?: boolean;
      }>('/rest/agile/1.0/board', {
        query: { startAt, maxResults: 50, projectKeyOrId },
      });
      const values = raw.values ?? [];
      collected.push(
        ...values.map((board) => ({
          id: board.id,
          name: board.name,
          type: board.type ?? 'unknown',
          projectKey: board.location?.projectKey,
        })),
      );
      if (raw.isLast !== false || values.length === 0) break;
      startAt += values.length;
    }
    return collected;
  }

  /** Returns [] for boards that have no sprint support rather than throwing. */
  async sprints(boardId: number, states = 'active,closed,future'): Promise<JiraSprintOption[]> {
    const collected: JiraSprintOption[] = [];
    let startAt = 0;
    try {
      for (let page = 0; page < 20; page += 1) {
        const raw = await this.request<{
          values?: Array<{
            id: number;
            name: string;
            state?: string;
            originBoardId?: number;
            startDate?: string;
            endDate?: string;
            completeDate?: string;
            goal?: string;
          }>;
          isLast?: boolean;
        }>(`/rest/agile/1.0/board/${boardId}/sprint`, {
          query: { startAt, maxResults: 50, state: states },
        });
        const values = raw.values ?? [];
        collected.push(
          ...values.map((sprint) => ({
            id: sprint.id,
            name: sprint.name,
            state: sprint.state ?? 'unknown',
            boardId: sprint.originBoardId ?? boardId,
            startDate: sprint.startDate,
            endDate: sprint.endDate,
            completeDate: sprint.completeDate,
            goal: sprint.goal,
          })),
        );
        if (raw.isLast !== false || values.length === 0) break;
        startAt += values.length;
      }
    } catch (error) {
      // Team-managed boards of type `simple` have no sprints at all: the lookup
      // fails with "The board does not support sprints". That is a signal to use
      // snapshot mode, not an error worth surfacing.
      if (error instanceof JiraError && (error.status === 400 || error.status === 404)) return [];
      throw error;
    }
    return collected.sort((a, b) => sprintSortKey(b) - sprintSortKey(a));
  }

  /**
   * A board's saved filter is the honest way to express "everything on this
   * board" as JQL, which keeps the source appendix reproducible.
   */
  async boardFilterId(boardId: number): Promise<string | undefined> {
    try {
      const raw = await this.request<{ filter?: { id?: string } }>(
        `/rest/agile/1.0/board/${boardId}/configuration`,
      );
      return raw.filter?.id;
    } catch (error) {
      if (error instanceof JiraError && [400, 403, 404].includes(error.status)) return undefined;
      throw error;
    }
  }

  async board(boardId: number): Promise<JiraBoardOption> {
    const raw = await this.request<{
      id: number;
      name: string;
      type?: string;
      location?: { projectKey?: string };
    }>(`/rest/agile/1.0/board/${boardId}`);
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type ?? 'unknown',
      projectKey: raw.location?.projectKey,
    };
  }

  async sprint(sprintId: number): Promise<JiraSprintOption> {
    const raw = await this.request<{
      id: number;
      name: string;
      state?: string;
      originBoardId?: number;
      startDate?: string;
      endDate?: string;
      completeDate?: string;
      goal?: string;
    }>(`/rest/agile/1.0/sprint/${sprintId}`);
    return {
      id: raw.id,
      name: raw.name,
      state: raw.state ?? 'unknown',
      boardId: raw.originBoardId,
      startDate: raw.startDate,
      endDate: raw.endDate,
      completeDate: raw.completeDate,
      goal: raw.goal,
    };
  }

  /* ---------------------------------------------------------------- users --- */

  async searchUsers(query: string): Promise<JiraUserOption[]> {
    if (this.credentials.deployment === 'cloud') {
      const raw = await this.request<
        Array<{
          accountId: string;
          displayName?: string;
          emailAddress?: string;
          active?: boolean;
          accountType?: string;
          avatarUrls?: Record<string, string>;
        }>
      >('/rest/api/3/user/search', { query: { query: query || '', maxResults: 100 } });
      return raw
        .filter((user) => user.accountType !== 'app')
        .map((user) => ({
          id: user.accountId,
          displayName: user.displayName ?? user.accountId,
          email: user.emailAddress,
          active: user.active !== false,
          avatarUrl: user.avatarUrls?.['48x48'],
        }));
    }
    const raw = await this.request<
      Array<{
        name?: string;
        key?: string;
        displayName?: string;
        emailAddress?: string;
        active?: boolean;
        avatarUrls?: Record<string, string>;
      }>
    >('/rest/api/2/user/search', { query: { username: query || '.', maxResults: 100 } });
    return raw.map((user) => ({
      id: user.name ?? user.key ?? user.displayName ?? 'unknown',
      displayName: user.displayName ?? user.name ?? 'Unknown',
      email: user.emailAddress,
      active: user.active !== false,
      avatarUrl: user.avatarUrls?.['48x48'],
    }));
  }

  /* --------------------------------------------------------------- search --- */

  /**
   * Stored mapping can be a leftover wrong id. Schema detection wins, then the
   * saved field, so story points and sprints still resolve without rewriting Connect.
   */
  async resolvedFieldMapping(): Promise<FieldMapping> {
    if (!this.detectedFields) this.detectedFields = await this.detectFieldMapping();
    return {
      storyPointsField: this.detectedFields.storyPointsField ?? this.fields.storyPointsField,
      sprintField: this.detectedFields.sprintField ?? this.fields.sprintField,
      epicLinkField: this.detectedFields.epicLinkField ?? this.fields.epicLinkField,
    };
  }

  /** Every field id that might hold story points on this site. */
  async storyPointFieldIds(): Promise<string[]> {
    const mapping = await this.resolvedFieldMapping();
    const ids = new Set<string>();
    if (mapping.storyPointsField) ids.add(mapping.storyPointsField);
    if (this.fields.storyPointsField) ids.add(this.fields.storyPointsField);
    ids.add('customfield_10016');
    for (const field of await this.fieldOptions()) {
      const name = field.name.toLowerCase();
      if (/story\s*point|стори.?поинт|оценка сложности/.test(name)) ids.add(field.id);
    }
    return [...ids];
  }

  /** The field list every metric depends on, including this site's custom ids. */
  scopeFields(mapping: FieldMapping = this.fields, extra: string[] = []): string[] {
    const base = [
      'summary',
      'status',
      'issuetype',
      'priority',
      'assignee',
      'reporter',
      'created',
      'updated',
      'resolutiondate',
      'duedate',
      'labels',
      'components',
      'fixVersions',
      'parent',
      'issuelinks',
      'timeoriginalestimate',
    ];
    const extras = [
      mapping.storyPointsField,
      this.fields.storyPointsField,
      mapping.sprintField,
      this.fields.sprintField,
      mapping.epicLinkField,
      this.fields.epicLinkField,
    ];
    for (const id of [...extras, ...extra]) {
      if (id && !base.includes(id)) base.push(id);
    }
    return base;
  }

  async attachChangelogs(issues: RawIssue[]): Promise<RawIssue[]> {
    const missing = issues.filter((issue) => !Array.isArray(issue.changelog?.histories));
    if (missing.length === 0) return issues;
    const byKey = new Map(issues.map((issue) => [issue.key, issue]));
    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      try {
        const raw = await this.request<{ issues?: RawIssue[] }>(`/rest/api/${this.apiVersion}/issue/bulkfetch`, {
          method: 'POST',
          body: {
            issueIdsOrKeys: batch.map((issue) => issue.key),
            fields: ['status'],
            expand: ['changelog'],
          },
        });
        for (const issue of raw.issues ?? []) {
          const target = byKey.get(issue.key);
          if (target && issue.changelog) target.changelog = issue.changelog;
        }
      } catch {
        for (const issue of batch) {
          try {
            const one = await this.request<RawIssue>(`/rest/api/${this.apiVersion}/issue/${encodeURIComponent(issue.key)}`, {
              query: { expand: 'changelog', fields: 'status' },
            });
            const target = byKey.get(issue.key);
            if (target && one.changelog) target.changelog = one.changelog;
          } catch {
            // leave without a changelog; cycle time stays empty for this item
          }
        }
      }
    }
    return issues;
  }

  /**
   * Search `expand=changelog` stops at ~40 histories on this site. Page the
   * issue changelog API so Sprint/SP reconstruction sees the full timeline.
   */
  async expandChangelogs(issues: RawIssue[]): Promise<RawIssue[]> {
    const need = issues.filter((issue) => changelogNeedsPaging(issue.changelog));
    const limit = 5;
    for (let index = 0; index < need.length; index += limit) {
      const batch = need.slice(index, index + limit);
      await Promise.all(
        batch.map(async (issue) => {
          try {
            const histories = await this.fetchFullChangelog(issue.id || issue.key);
            if (histories.length === 0) return;
            const previous = issue.changelog?.histories?.length ?? 0;
            if (histories.length < previous) return;
            issue.changelog = {
              histories,
              total: histories.length,
              maxResults: histories.length,
            };
          } catch {
            // keep the truncated expand; callers mark those issues partial
          }
        }),
      );
    }
    return issues;
  }

  private async fetchFullChangelog(issueIdOrKey: string): Promise<RawChangelogEntry[]> {
    const collected: RawChangelogEntry[] = [];
    let startAt = 0;
    try {
      for (let page = 0; page < 20; page += 1) {
        const raw = await this.request<{
          values?: Array<{ created?: string; items?: RawChangelogEntry['items'] }>;
          total?: number;
          isLast?: boolean;
          maxResults?: number;
        }>(`/rest/api/${this.apiVersion}/issue/${encodeURIComponent(issueIdOrKey)}/changelog`, {
          query: { startAt, maxResults: 100 },
        });
        const values = raw.values ?? [];
        for (const entry of values) {
          if (!entry.created) continue;
          collected.push({ created: entry.created, items: entry.items });
        }
        startAt += values.length;
        if (raw.isLast === true || values.length === 0) break;
        if (typeof raw.total === 'number' && collected.length >= raw.total) break;
      }
      return collected;
    } catch (error) {
      if (!(error instanceof JiraError) || ![404, 405].includes(error.status)) throw error;
      const one = await this.request<RawIssue>(
        `/rest/api/${this.apiVersion}/issue/${encodeURIComponent(issueIdOrKey)}`,
        { query: { expand: 'changelog', fields: 'status' } },
      );
      return one.changelog?.histories ?? [];
    }
  }

  async search(options: {
    jql: string;
    fields?: string[];
    withChangelog?: boolean;
    maxPages?: number;
  }): Promise<SearchResult> {
    const fields = options.fields ?? this.scopeFields();
    const maxPages = options.maxPages ?? MAX_PAGES;
    const expand = options.withChangelog ? 'changelog' : undefined;

    if (this.credentials.deployment === 'cloud' && this.searchStyle !== 'legacy') {
      try {
        const result = await this.searchCloudJql(options.jql, fields, expand, maxPages);
        this.searchStyle = 'jql';
        return result;
      } catch (error) {
        // Older Cloud sites and every Server/DC site only expose the legacy
        // endpoint; newer Cloud sites only expose /search/jql.
        if (!(error instanceof JiraError) || ![404, 410].includes(error.status)) throw error;
        this.searchStyle = 'legacy';
      }
    }
    return this.searchLegacy(options.jql, fields, expand, maxPages);
  }

  private async searchCloudJql(
    jql: string,
    fields: string[],
    expand: string | undefined,
    maxPages: number,
  ): Promise<SearchResult> {
    const issues: RawIssue[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const raw = await this.request<{
        issues?: RawIssue[];
        nextPageToken?: string;
        isLast?: boolean;
      }>('/rest/api/3/search/jql', {
        method: 'POST',
        body: { jql, fields, maxResults: PAGE_SIZE, expand, nextPageToken },
      });
      issues.push(...(raw.issues ?? []));
      nextPageToken = raw.nextPageToken;
      if (!nextPageToken || raw.isLast === true || (raw.issues ?? []).length === 0) {
        return { issues, truncated: false };
      }
    }
    return { issues, truncated: true };
  }

  private async searchLegacy(
    jql: string,
    fields: string[],
    expand: string | undefined,
    maxPages: number,
  ): Promise<SearchResult> {
    const issues: RawIssue[] = [];
    let startAt = 0;
    let total: number | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const raw = await this.request<{ issues?: RawIssue[]; total?: number }>(
        `/rest/api/${this.apiVersion}/search`,
        {
          method: 'POST',
          body: {
            jql,
            fields,
            startAt,
            maxResults: PAGE_SIZE,
            ...(expand ? { expand: [expand] } : {}),
          },
        },
      );
      const batch = raw.issues ?? [];
      total = raw.total ?? total;
      issues.push(...batch);
      startAt += batch.length;
      if (batch.length === 0 || (total !== undefined && startAt >= total)) {
        return { issues, truncated: false, total };
      }
    }
    return { issues, truncated: total === undefined ? true : startAt < total, total };
  }
}

const SEARCH_CHANGELOG_CAP = 40;

export function changelogNeedsPaging(changelog?: RawChangelog): boolean {
  if (!changelog?.histories) return true;
  if (typeof changelog.total === 'number') return changelog.total > changelog.histories.length;
  return changelog.histories.length >= SEARCH_CHANGELOG_CAP;
}

function sprintSortKey(sprint: JiraSprintOption): number {
  const stateRank = sprint.state === 'active' ? 3 : sprint.state === 'future' ? 2 : 1;
  const date = sprint.startDate ? Date.parse(sprint.startDate) : 0;
  return stateRank * 1e13 + (Number.isFinite(date) ? date : 0);
}

function describeStatus(status: number, path: string): string {
  switch (status) {
    case 401:
      return 'Jira rejected the credentials (401). Check the email and API token, or the personal access token.';
    case 403:
      return 'Jira accepted the credentials but refused the request (403). The account may lack permission, or CAPTCHA may be required.';
    case 404:
      return `Jira answered 404 for ${path}. Either the thing being asked for does not exist, the URL points at the wrong site, or this API is unavailable on this deployment. Jira's own reason is in the detail below.`;
    case 400:
      return `Jira rejected the request (400): ${path}. This is usually an invalid JQL or field id.`;
    default:
      return `Jira returned HTTP ${status} for ${path}.`;
  }
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> };
      const messages = [
        ...(parsed.errorMessages ?? []),
        ...Object.entries(parsed.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
      ];
      if (messages.length > 0) return messages.join('; ');
    } catch {
      // Fall through to the raw body.
    }
    return text.slice(0, 500);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
