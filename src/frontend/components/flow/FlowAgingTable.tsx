'use client';

import { useMemo, useState } from 'react';

import { formatCycleDuration, formatStoryPoints } from '@backend/metrics/cycle-overview';
import { agingAttention, agingCompareDays, isAgingCompletedStatus } from '@backend/metrics/flow-aging';
import type { FlowAgingRow, FlowSnapshot } from '@backend/metrics/flow-model';
import type { FlowStageId } from '@shared/types';

export function FlowAgingTable({
  flow,
  stageFilter,
  selectedKey,
  onClearStage,
  onOpenTimeline,
}: {
  flow: FlowSnapshot;
  stageFilter?: FlowStageId | 'blocked' | 'oldest' | 'developmentWip' | 'qaWip';
  selectedKey?: string;
  onClearStage?: () => void;
  onOpenTimeline?: (key: string) => void;
}) {
  const [assignee, setAssignee] = useState('');
  const [olderThan, setOlderThan] = useState<'median' | 'p85' | ''>('');
  const [openKey, setOpenKey] = useState<string | undefined>();

  const people = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of flow.aging) {
      if (!row.assigneeId || row.assigneeId === 'unassigned') {
        names.set('unassigned', row.assigneeName || 'Unassigned');
      } else {
        names.set(row.assigneeId, row.assigneeName);
      }
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [flow.aging]);

  const rows = flow.aging.filter((row) => {
    if (!matchesAgingFilter(row, stageFilter, flow.oldest?.key)) return false;
    if (assignee && row.assigneeId !== assignee) return false;
    if (olderThan && flow.thresholds) {
      const limit = olderThan === 'p85' ? flow.thresholds.p85 : flow.thresholds.median;
      if (agingCompareDays(row.stage, row.ages) <= limit) return false;
    }
    return true;
  });

  if (flow.aging.length === 0) {
    if (flow.agingSprints && flow.agingSprints.length === 0) {
      return <p className="caption">No active sprint on the selected boards, so aging WIP is empty.</p>;
    }
    return <p className="caption">The active sprint has no issues in aging for the selected episode rule.</p>;
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="cycle-def-select" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
          <option value="">All assignees</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        {flow.thresholds ? (
          <select
            className="cycle-def-select"
            value={olderThan}
            onChange={(event) => setOlderThan(event.target.value as 'median' | 'p85' | '')}
          >
            <option value="">Any age</option>
            <option value="median">Older than median ({formatCycleDuration(flow.thresholds.median)})</option>
            <option value="p85">Older than P85 ({formatCycleDuration(flow.thresholds.p85)})</option>
          </select>
        ) : (
          <span className="caption">Median/P85 thresholds are hidden: too few completed issues (n&lt;5).</span>
        )}
        {stageFilter && (
          <button type="button" className="cycle-exclude-restore" onClick={onClearStage}>
            clear stage filter
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="caption">No issues match the selected filter.</p>
      ) : (
        <div className="flow-table-wrap">
          <table className="flow-aging">
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>SP</th>
                <th>Episode</th>
                <th>In current status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AgingRow
                  key={row.key}
                  row={row}
                  thresholds={flow.thresholds}
                  open={openKey === row.key}
                  selected={selectedKey === row.key}
                  onToggle={() => setOpenKey(openKey === row.key ? undefined : row.key)}
                  onOpenTimeline={onOpenTimeline}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AgingRow({
  row,
  thresholds,
  open,
  selected,
  onToggle,
  onOpenTimeline,
}: {
  row: FlowAgingRow;
  thresholds: FlowSnapshot['thresholds'];
  open: boolean;
  selected?: boolean;
  onToggle: () => void;
  onOpenTimeline?: (key: string) => void;
}) {
  const attention = agingAttention(row, thresholds);
  return (
    <>
      <tr data-attention={attention} data-selected={selected ? 'true' : undefined}>
        <td>
          <a className="cycle-chart-key" href={row.url} target="_blank" rel="noreferrer">
            {row.key}
          </a>
        </td>
        <td className="flow-aging-summary">{row.summary}</td>
        <td>{row.stageLabel}</td>
        <td>{row.status}</td>
        <td>{row.assigneeName}</td>
        <td>{row.storyPoints !== undefined ? formatStoryPoints(row.storyPoints) : '—'}</td>
        <td>
          {row.ages.episodeLabel}: {formatCycleDuration(row.ages.episodeDays)}
          {isAgingCompletedStatus(row.stage) && (
            <> (cycle time − {formatCycleDuration(row.ages.executionDays)})</>
          )}
          {row.blocked && <span className="flow-badge">Blocked</span>}
        </td>
        <td>{formatCycleDuration(row.ages.statusDays)}</td>
        <td>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {onOpenTimeline && (
              <button type="button" className="cycle-exclude-restore" onClick={() => onOpenTimeline(row.key)}>
                timeline
              </button>
            )}
            <button type="button" className="cycle-exclude-restore" onClick={onToggle}>
              {open ? 'hide' : 'details'}
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="flow-aging-detail">
          <td colSpan={9}>
            <p className="caption">
              Episode start: {formatStamp(row.ages.episodeStartedAt)} · Entered status:{' '}
              {formatStamp(row.ages.statusEnteredAt)}
              {row.doneAt ? ` · First review: ${formatStamp(row.doneAt)}` : ''}
              {row.ages.originalCycleTimeDays !== undefined
                ? ` · Original cycle time: ${formatCycleDuration(row.ages.originalCycleTimeDays)}`
                : ''}
              {row.firstInProgress ? ` · First start: ${formatStamp(row.firstInProgress)}` : ''}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function formatStamp(iso?: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

function matchesAgingFilter(
  row: FlowAgingRow,
  stageFilter: FlowStageId | 'blocked' | 'oldest' | 'developmentWip' | 'qaWip' | undefined,
  oldestKey?: string,
): boolean {
  if (!stageFilter) return true;
  if (stageFilter === 'blocked') return row.blocked;
  if (stageFilter === 'oldest') return oldestKey === row.key;
  if (stageFilter === 'developmentWip') return row.inDevelopmentWip;
  if (stageFilter === 'qaWip' || stageFilter === 'qaQueue' || stageFilter === 'qa') return row.inQaWip;
  if (stageFilter === 'development' || stageFilter === 'rework') {
    return row.stage === 'development' || row.stage === 'rework' || (row.inDevelopmentWip && row.stage === 'other');
  }
  return row.stage === stageFilter;
}
