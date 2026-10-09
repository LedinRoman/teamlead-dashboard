'use client';

import { useState } from 'react';

import { Field, Pill, Spinner } from '@frontend/components/ui';
import type { JiraStatusOption, StatusCategory } from '@shared/types';

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  new: 'To do',
  indeterminate: 'In progress',
  done: 'Done',
  unknown: 'uncategorised',
};

const CATEGORY_TONE: Record<StatusCategory, 'neutral' | 'info' | 'success' | 'warning'> = {
  new: 'neutral',
  indeterminate: 'info',
  done: 'success',
  unknown: 'warning',
};

/** A project, with the boards attached to it for orientation. */
export interface StatusGroup {
  key: string;
  name: string;
  boardNames: string[];
  /** True when one of your teams uses this project, so it is offered first. */
  inUse: boolean;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function toggle(values: string[], name: string): string[] {
  return values.some((entry) => sameName(entry, name))
    ? values.filter((entry) => !sameName(entry, name))
    : [...values, name];
}

/**
 * Selected names as removable chips. The whole point is that a rule can be read
 * and corrected without opening the list it was chosen from.
 */
function Selected({
  value,
  onChange,
  emptyLabel,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  if (value.length === 0) return <span className="caption">{emptyLabel}</span>;
  return (
    <div className="chips">
      {value.map((entry) => (
        <button
          key={entry}
          type="button"
          className="chip"
          title="Remove from this rule"
          onClick={() => onChange(value.filter((candidate) => candidate !== entry))}
        >
          {entry} <span aria-hidden>✕</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Picks status names one project at a time.
 *
 * A Jira site carries far more statuses than any single project uses, so showing
 * them all flat produces a wall of checkboxes with no way to tell which ones a
 * board actually has. Expanding a project fetches just its workflow statuses.
 */
export function StatusRule({
  label,
  hint,
  value,
  onChange,
  groups,
  statusesByProject,
  onExpand,
  loadingProject,
  allStatuses,
  unavailable,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (next: string[]) => void;
  groups: StatusGroup[];
  statusesByProject: Record<string, JiraStatusOption[]>;
  onExpand: (projectKey: string) => void;
  loadingProject?: string;
  /** Used only to point out saved names that no longer exist on the site. */
  allStatuses: JiraStatusOption[];
  /** Set when Jira could not be read, which falls back to typed names. */
  unavailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | undefined>();
  const [showAll, setShowAll] = useState(false);

  if (unavailable) {
    return (
      <Field label={label} hint={`${hint} Comma separated; Jira statuses could not be loaded.`}>
        <input
          type="text"
          value={value.join(', ')}
          onChange={(event) => onChange(splitList(event.target.value))}
        />
      </Field>
    );
  }

  const known = new Set(allStatuses.map((status) => status.name.toLowerCase()));
  const missing = value.filter((entry) => !known.has(entry.trim().toLowerCase()));
  const visibleGroups = showAll ? groups : groups.filter((group) => group.inUse);

  const expand = (projectKey: string) => {
    if (expanded === projectKey) {
      setExpanded(undefined);
      return;
    }
    setExpanded(projectKey);
    if (!statusesByProject[projectKey]) onExpand(projectKey);
  };

  return (
    <Field label={label} hint={hint}>
      <div className="stack" style={{ gap: 7 }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <button type="button" className="subtle" onClick={() => setOpen(!open)}>
            {open ? 'Done choosing' : value.length > 0 ? 'Change' : 'Choose statuses'}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Selected value={value} onChange={onChange} emptyLabel="Nothing selected." />
          </div>
        </div>

        {missing.length > 0 && (
          <span className="caption">
            Saved but not on this site any more: {missing.join(', ')}. Remove the chip if the status was renamed.
          </span>
        )}

        {open && (
          <div className="picker">
            {visibleGroups.length === 0 && (
              <span className="caption">
                None of your teams point at a project yet. Use &ldquo;every project&rdquo; below.
              </span>
            )}
            {visibleGroups.map((group) => {
              const statuses = statusesByProject[group.key];
              const isExpanded = expanded === group.key;
              const selectedHere = statuses?.filter((status) =>
                value.some((entry) => sameName(entry, status.name)),
              ).length;

              return (
                <div key={group.key} className="picker-group">
                  <button type="button" className="picker-head" onClick={() => expand(group.key)}>
                    <span className="picker-caret" data-open={isExpanded}>
                      ›
                    </span>
                    <strong>{group.key}</strong>
                    <span className="truncate">{group.name}</span>
                    {group.boardNames.length > 0 && (
                      <span className="caption truncate">{group.boardNames.join(', ')}</span>
                    )}
                    {selectedHere ? <Pill tone="info">{selectedHere} selected</Pill> : null}
                  </button>

                  {isExpanded && (
                    <div className="picker-body">
                      {loadingProject === group.key && !statuses && <Spinner />}
                      {statuses?.length === 0 && (
                        <span className="caption">This project exposes no statuses.</span>
                      )}
                      {statuses?.map((status) => (
                        <label key={status.id} className="picker-option">
                          <input
                            type="checkbox"
                            checked={value.some((entry) => sameName(entry, status.name))}
                            onChange={() => onChange(toggle(value, status.name))}
                          />
                          <span className="truncate">{status.name}</span>
                          <Pill tone={CATEGORY_TONE[status.category]}>
                            {CATEGORY_LABEL[status.category]}
                          </Pill>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {groups.some((group) => !group.inUse) && (
              <button type="button" className="subtle" onClick={() => setShowAll(!showAll)}>
                {showAll
                  ? 'Show only projects my teams use'
                  : `Show every project (${groups.length})`}
              </button>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

/**
 * Same collapsed shape for a flat list of names, used for issue types where there
 * is no project grouping to make.
 */
export function NameRule({
  label,
  hint,
  value,
  onChange,
  options,
  unavailable,
}: {
  label: string;
  hint: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: Array<{ id: string; name: string; suffix?: string }>;
  unavailable?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (unavailable) {
    return (
      <Field label={label} hint={`${hint} Comma separated; the list could not be loaded from Jira.`}>
        <input
          type="text"
          value={value.join(', ')}
          onChange={(event) => onChange(splitList(event.target.value))}
        />
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint}>
      <div className="stack" style={{ gap: 7 }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <button type="button" className="subtle" onClick={() => setOpen(!open)}>
            {open ? 'Done choosing' : value.length > 0 ? 'Change' : 'Choose work types'}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Selected value={value} onChange={onChange} emptyLabel="Nothing excluded." />
          </div>
        </div>

        {open && (
          <div className="picker">
            <div className="picker-body">
              {options.map((option) => (
                <label key={option.id} className="picker-option">
                  <input
                    type="checkbox"
                    checked={value.some((entry) => sameName(entry, option.name))}
                    onChange={() => onChange(toggle(value, option.name))}
                  />
                  <span className="truncate">{option.name}</span>
                  {option.suffix && <Pill tone="neutral">{option.suffix}</Pill>}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
