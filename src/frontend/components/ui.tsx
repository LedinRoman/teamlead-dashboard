'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { formatSnapshotAge } from '@backend/metrics/time';
import type { StatValue } from '@shared/types';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Card({
  title,
  caption,
  actions,
  children,
  open = false,
}: {
  title?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <section className={open ? 'card card-open' : 'card'}>
      {(title || caption || actions) && (
        <header className="card-header">
          <div>
            {title && <div className="card-title">{title}</div>}
            {caption && <div className="card-caption">{caption}</div>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatBar({ stats }: { stats: StatValue[] }) {
  return (
    <div className="stat-bar">
      {stats.map((stat) => (
        <div key={stat.label} className={`stat tone-${stat.tone ?? 'neutral'}`}>
          <span className="stat-label">{stat.label}</span>
          <span className="stat-value">{formatNumber(stat.value)}</span>
          {stat.unit && <span className="stat-unit">{stat.unit}</span>}
          {stat.hint && <span className="stat-hint">{stat.hint}</span>}
        </div>
      ))}
    </div>
  );
}

export function Pill({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`callout callout-${tone}`}>
      {title && <span className="callout-title">{title}</span>}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <abbr className="hint" title={text}>
      {children}
    </abbr>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `segmented ${className}` : 'segmented'}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          data-active={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="caption">
      <span className="spinner" /> {label ?? 'Loading'}
    </span>
  );
}

export function SnapshotBar({
  queriedAt,
  fromCache,
  refreshing,
  onRefresh,
}: {
  queriedAt?: string;
  fromCache?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const age = queriedAt ? formatSnapshotAge(queriedAt) : undefined;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      {age && (
        <span className="caption">
          Снимок {age}
          {fromCache === false ? ' · с Jira' : ''}
        </span>
      )}
      <button type="button" className="subtle" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? 'Обновляю…' : 'Обновить'}
      </button>
    </div>
  );
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="col-half skeleton" style={{ height: 150 }} />
      ))}
    </div>
  );
}

/** Exact JQL, timestamps and field coverage, so every number on screen is checkable. */
export function SourceAppendix({
  jql,
  queriedAt,
  fromCache,
  issueCount,
  coverage,
  assumptions,
  extraQueries,
  linkTypes,
}: {
  jql: string;
  queriedAt: string;
  fromCache: boolean;
  issueCount: number;
  coverage: Record<string, boolean>;
  assumptions?: string[];
  extraQueries?: Array<{ label: string; jql: string }>;
  linkTypes?: Array<{ type: string; count: number }>;
}) {
  return (
    <details className="appendix">
      <summary>Source: JQL, field coverage and assumptions</summary>
      <div className="stack" style={{ gap: 8, marginTop: 6 }}>
        <div>
          <div className="caption">Scope query</div>
          <pre className="mono">{jql}</pre>
        </div>
        {extraQueries?.map((entry) => (
          <div key={entry.label}>
            <div className="caption">{entry.label}</div>
            <pre className="mono">{entry.jql}</pre>
          </div>
        ))}
        <div className="caption">
          {issueCount} work items fetched. Queried {formatTimestamp(queriedAt)}
          {fromCache ? ' (served from the local cache)' : ''}.
        </div>
        <div className="row" style={{ gap: 6 }}>
          {Object.entries(coverage).map(([field, present]) => (
            <Pill key={field} tone={present ? 'success' : 'neutral'}>
              {formatFieldName(field)}: {present ? 'present' : 'absent'}
            </Pill>
          ))}
        </div>
        {linkTypes && linkTypes.length > 0 && (
          <div>
            <div className="caption">
              Link phrases in this scope. Jira localises these, so copy the ones that mean waiting into the
              blocking-link rule in Settings.
            </div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {linkTypes.map((entry) => (
                <Pill key={entry.type} tone="neutral">
                  {entry.type} · {entry.count}
                </Pill>
              ))}
            </div>
          </div>
        )}
        {assumptions && assumptions.length > 0 && (
          <ul className="plain">
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const node = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = node.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={node}
      className="modal"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <header className="modal-head">
          <div className="modal-title">{title}</div>
          <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ErrorNotice({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Callout tone="danger" title="Could not load this view">
      <div className="stack" style={{ gap: 8 }}>
        <span>{error}</span>
        {onRetry && (
          <div>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </Callout>
  );
}

/* ----------------------------------------------------------------- format --- */

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1) return `${Math.max(0, Math.round(value * 24))}h`;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}d`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFieldName(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

export function toneColor(tone: Tone | undefined): string {
  switch (tone) {
    case 'success':
      return 'var(--success)';
    case 'warning':
      return 'var(--warning)';
    case 'danger':
      return 'var(--danger)';
    case 'info':
      return 'var(--info)';
    default:
      return 'var(--accent)';
  }
}
