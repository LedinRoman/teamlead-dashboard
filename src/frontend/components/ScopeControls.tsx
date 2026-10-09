'use client';

import { useEffect, useState } from 'react';

import { Segmented } from './ui';
import type { Team } from '@shared/types';

export const WINDOW_OPTIONS = [14, 30, 60, 90, 180];

export function TeamPicker({
  teams,
  value,
  onChange,
  label = 'Team',
}: {
  teams: Team[];
  value: string;
  onChange: (teamId: string) => void;
  label?: string;
}) {
  if (teams.length === 0) return null;
  if (teams.length <= 4) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <span className="caption">{label}</span>
        <Segmented
          value={value}
          onChange={onChange}
          options={teams.map((team) => ({ value: team.id, label: team.name }))}
        />
      </div>
    );
  }
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="caption">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={{ width: 220 }}>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function WindowPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (windowDays: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="caption">Window</span>
      <input
        type="number"
        min={1}
        max={365}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next >= 1 && next <= 365) onChange(next);
        }}
        style={{ width: 72 }}
        aria-label="Window in days"
      />
      <span className="caption">days</span>
      <Segmented
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={WINDOW_OPTIONS.map((days) => ({ value: days, label: `${days}d` }))}
      />
    </div>
  );
}

export function WindowFromPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (windowFrom: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft && draft !== value) onChange(draft);
  };

  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="caption">From</span>
      <input
        type="date"
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        aria-label="Window start date"
      />
    </div>
  );
}

export function ModePicker({
  value,
  onChange,
}: {
  value: 'active-sprint' | 'open' | 'recent';
  onChange: (mode: 'active-sprint' | 'open' | 'recent') => void;
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <span className="caption">Scope</span>
      <Segmented
        value={value}
        onChange={onChange}
        options={[
          { value: 'active-sprint', label: 'Active sprint' },
          { value: 'open', label: 'All unfinished' },
          { value: 'recent', label: 'Recent movement' },
        ]}
      />
    </div>
  );
}
