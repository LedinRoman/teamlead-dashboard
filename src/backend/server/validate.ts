import { WIDGET_CATALOG, type ScopeSpec, type WidgetConfig, type WidgetType, type WidgetWidth } from '@shared/types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const WIDTHS: WidgetWidth[] = ['third', 'half', 'full'];
const WIDGET_TYPES = new Set<WidgetType>(WIDGET_CATALOG.map((entry) => entry.type));

export function parseScopeSpec(input: unknown): ScopeSpec {
  if (!input || typeof input !== 'object') throw new ValidationError('A scope is required.');
  const scope = input as Record<string, unknown>;
  const label = typeof scope.label === 'string' && scope.label.trim() ? scope.label.trim() : undefined;

  switch (scope.kind) {
    case 'jql': {
      if (typeof scope.jql !== 'string' || !scope.jql.trim()) {
        throw new ValidationError('A JQL scope needs a non-empty jql string.');
      }
      return { kind: 'jql', jql: scope.jql.trim(), label };
    }
    case 'sprint': {
      const sprintId = Number(scope.sprintId);
      if (!Number.isInteger(sprintId)) throw new ValidationError('A sprint scope needs a numeric sprintId.');
      return { kind: 'sprint', sprintId, label };
    }
    case 'board': {
      const boardId = Number(scope.boardId);
      if (!Number.isInteger(boardId)) throw new ValidationError('A board scope needs a numeric boardId.');
      return { kind: 'board', boardId, mode: parseBoardMode(scope.mode), label };
    }
    case 'team': {
      if (typeof scope.teamId !== 'string' || !scope.teamId) {
        throw new ValidationError('A team scope needs a teamId.');
      }
      return { kind: 'team', teamId: scope.teamId, mode: parseBoardMode(scope.mode), label };
    }
    case 'person': {
      if (typeof scope.personId !== 'string' || !scope.personId) {
        throw new ValidationError('A person scope needs a personId.');
      }
      const mode = scope.mode === 'recent' ? 'recent' : 'open';
      return {
        kind: 'person',
        personId: scope.personId,
        teamId: typeof scope.teamId === 'string' && scope.teamId ? scope.teamId : undefined,
        mode,
        label,
      };
    }
    default:
      throw new ValidationError(`Unknown scope kind: ${String(scope.kind)}`);
  }
}

function parseBoardMode(value: unknown): 'active-sprint' | 'open' | 'recent' {
  if (value === 'open' || value === 'recent' || value === 'active-sprint') return value;
  return 'active-sprint';
}

export function parseWindowDays(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(730, Math.max(1, Math.round(parsed)));
}

export function parseWindowFrom(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1];
}

export function parseStatusName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name) return undefined;
  return name.slice(0, 80);
}

export function parseWidgets(input: unknown): WidgetConfig[] {
  if (!Array.isArray(input)) throw new ValidationError('Widgets must be an array.');
  return input.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new ValidationError(`Widget at position ${index + 1} is not an object.`);
    }
    const widget = entry as Record<string, unknown>;
    const type = widget.type;
    if (typeof type !== 'string' || !WIDGET_TYPES.has(type as WidgetType)) {
      throw new ValidationError(`Widget at position ${index + 1} has an unknown type: ${String(type)}`);
    }
    return {
      id:
        typeof widget.id === 'string' && widget.id
          ? widget.id
          : `w_${index}_${Math.random().toString(36).slice(2, 8)}`,
      type: type as WidgetType,
      title: typeof widget.title === 'string' && widget.title.trim() ? widget.title.trim() : undefined,
      width: WIDTHS.includes(widget.width as WidgetWidth) ? (widget.width as WidgetWidth) : 'half',
      scope: parseScopeSpec(widget.scope),
      windowDays: parseWindowDays(widget.windowDays),
      withChangelog: widget.withChangelog === true,
      limit:
        typeof widget.limit === 'number' && Number.isFinite(widget.limit)
          ? Math.min(200, Math.max(1, Math.round(widget.limit)))
          : undefined,
    };
  });
}
