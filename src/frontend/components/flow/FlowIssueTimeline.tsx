'use client';

import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import { apiPost, errorMessage } from '@frontend/lib/api';
import { formatCycleDuration, parseIssueKeys } from '@backend/metrics/cycle-overview';
import {
  buildIssueTimelineSegments,
  isTimelineStatusExcluded,
  issueTimelineStatusTotals,
  timelineSegmentWeights,
  uniqueTimelineStatusNames,
  visibleIssueTimelineSegments,
  type FlowIssueTimeline as IssueTimeline,
  type FlowTimelineSegment,
} from '@backend/metrics/flow-issue-timeline';
import { flowTimelineSegmentColor } from '@backend/metrics/flow-stage-tone';
import { uiLabel } from '@shared/locale';
import type { FlowWorkflow } from '@shared/types';

const EXCLUDED_STORAGE = 'flow.timelineExcludedStatuses';
const HIDE_TODO_STORAGE = 'flow.timelineHideNotStarted';

export function FlowIssueTimeline({
  issues,
  workflow,
  selectedKey,
  onSelect,
  cycleStartStatus,
  cycleEndStatus,
  teamIds,
  workingDays,
  holidays,
}: {
  issues: IssueTimeline[];
  workflow: FlowWorkflow;
  selectedKey?: string;
  onSelect: (key: string | undefined) => void;
  cycleStartStatus?: string;
  cycleEndStatus?: string;
  teamIds: string[];
  workingDays?: boolean;
  holidays?: string[];
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [excludedStatuses, setExcludedStatuses] = useState<string[] | undefined>(() => readExcludedStatuses());
  const [remote, setRemote] = useState<IssueTimeline | undefined>();
  const [lookupError, setLookupError] = useState<string | undefined>();
  const [lookupLoading, setLookupLoading] = useState(false);

  const fromList = useMemo(
    () => issues.find((issue) => issue.key.toUpperCase() === (selectedKey ?? '').toUpperCase()),
    [issues, selectedKey],
  );
  const selected =
    fromList ??
    (remote && selectedKey && remote.key.toUpperCase() === selectedKey.toUpperCase() ? remote : undefined);
  const allSegments = useMemo(
    () => (selected ? buildIssueTimelineSegments(selected, workflow, new Date(), { workingDays, holidays }) : []),
    [selected, workflow, workingDays, holidays],
  );
  const excluded = useMemo(() => {
    if (excludedStatuses) return uniqueTimelineStatusNames(excludedStatuses);
    const names = [...workflow.notStarted];
    for (const segment of allSegments) {
      if (segment.stage === 'notStarted' && !isTimelineStatusExcluded(segment.status, names)) names.push(segment.status);
    }
    return uniqueTimelineStatusNames(names);
  }, [excludedStatuses, workflow.notStarted, allSegments]);
  const segments = useMemo(
    () => visibleIssueTimelineSegments(allSegments, excluded),
    [allSegments, excluded.join('|')],
  );
  const totals = useMemo(() => issueTimelineStatusTotals(allSegments), [allSegments]);
  const weights = useMemo(
    () => timelineSegmentWeights(segments, workflow.timelineMinSegmentPct ?? 2),
    [segments, workflow.timelineMinSegmentPct],
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const statusOptions = useMemo(
    () => timelineStatusOptions(allSegments, issues, selected),
    [allSegments, issues, selected],
  );

  useEffect(() => {
    if (!selectedKey) {
      setRemote(undefined);
      setLookupError(undefined);
      setLookupLoading(false);
      return;
    }
    if (teamIds.length === 0) {
      setRemote(undefined);
      setLookupError('need-team');
      setLookupLoading(false);
      return;
    }
    if (fromList) {
      setRemote(undefined);
      setLookupError(undefined);
      setLookupLoading(false);
      return;
    }
    let cancelled = false;
    setLookupLoading(true);
    setLookupError(undefined);
    void (async () => {
      try {
        const payload = await apiPost<{ issue: IssueTimeline }>('/api/flow/issue', {
          key: selectedKey,
          teamIds,
          cycleStartStatus,
          cycleEndStatus,
        });
        if (cancelled) return;
        setRemote(payload.issue);
        setLookupError(undefined);
      } catch (caught) {
        if (cancelled) return;
        setRemote(undefined);
        setLookupError(errorMessage(caught));
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedKey, fromList, cycleStartStatus, cycleEndStatus, teamIds.join(',')]);

  function submitDraft() {
    const keys = parseIssueKeys(draft);
    if (keys[0]) {
      onSelect(keys[0]);
      setDraft('');
    }
  }

  function toggleExcluded(name: string) {
    const next = isTimelineStatusExcluded(name, excluded)
      ? excluded.filter((status) => !isTimelineStatusExcluded(status, [name]))
      : uniqueTimelineStatusNames([...excluded, name]);
    setExcludedStatuses(next);
    writeExcludedStatuses(next);
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <form
        className="cycle-exclude-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
      >
        <input
          list="flow-timeline-keys"
          value={draft}
          placeholder={t('A key from the team projects — CDR-2029', 'Ключ из проектов команды — CDR-2029')}
          aria-label={t('Issue key for the timeline', 'Ключ задачи для таймлайна')}
          onChange={(event) => setDraft(event.target.value)}
        />
        <datalist id="flow-timeline-keys">
          {issues.map((issue) => (
            <option key={issue.key} value={issue.key}>
              {issue.summary}
            </option>
          ))}
        </datalist>
        <button type="submit" className="flow-tl-action" disabled={!parseIssueKeys(draft)[0]}>
          {t('Open', 'Открыть')}
        </button>
        {selectedKey && (
          <button type="button" className="flow-tl-action" onClick={() => onSelect(undefined)}>
            {t('Clear', 'Сбросить')}
          </button>
        )}
        <details className="check-drop flow-tl-status-drop">
          <summary className="flow-tl-action">{excludeSummary(excluded, t)}</summary>
          <div className="check-drop-menu checklist flow-tl-status-menu">
            {statusOptions.length === 0 ? (
              <p className="caption">{t('No statuses to exclude.', 'Нет статусов для исключения.')}</p>
            ) : (
              statusOptions.map((name) => (
                <label key={name.toLowerCase()}>
                  <input
                    type="checkbox"
                    checked={isTimelineStatusExcluded(name, excluded)}
                    onChange={() => toggleExcluded(name)}
                  />
                  <span>{name}</span>
                </label>
              ))
            )}
          </div>
        </details>
      </form>

      {!selectedKey && (
        <p className="caption">{t('A key from the selected teams’ projects, or click “timeline” in Aging. A sprint is not required.', 'Ключ из проектов выбранных команд, или клик «линия» в Aging. Спринт не нужен.')}</p>
      )}
      {lookupLoading && <p className="caption">{t(`Loading ${selectedKey}…`, `Загружаю ${selectedKey}…`)}</p>}
      {lookupError && (
        <p className="caption">
          {lookupError === 'need-team' ? t('At least one team is required.', 'Нужна хотя бы одна команда.') : lookupError}
        </p>
      )}

      {selected && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <a className="cycle-chart-key" href={selected.url} target="_blank" rel="noreferrer">
              {selected.key}
            </a>
            <span>{selected.summary}</span>
            <span className="caption">
              {selected.assigneeName} · {t('now', 'сейчас')} {selected.status}
            </span>
          </div>
          {selected.truncatedHint && <p className="caption">{timelineHint(selected.truncatedHint, t)}</p>}
          {allSegments.length === 0 || allSegments.reduce((sum, segment) => sum + segment.ms, 0) <= 0 ? (
            <p className="caption">{t('This issue has no status transitions in its changelog.', 'Нет переходов статусов в changelog этой задачи.')}</p>
          ) : segments.length === 0 ? (
            <p className="caption">{t('Nothing is left on the line after excluding statuses.', 'После исключения статусов на линии ничего не осталось.')}</p>
          ) : (
            <>
              <div className="flow-tl" role="img" aria-label={t(`Status timeline ${selected.key}`, `Таймлайн статусов ${selected.key}`)}>
                <div className="flow-tl-bar">
                  {segments.map((segment, index) => (
                    <span
                      key={`${segment.from}-${segment.status}-${index}`}
                      className="flow-tl-seg"
                      style={{
                        flexGrow: weights[index] ?? segment.days,
                        background: flowTimelineSegmentColor(segment),
                      }}
                      title={`${formatStamp(segment.from)} → ${formatStamp(segment.to)} · ${segment.status} (${uiLabel(segment.stageLabel)})`}
                    />
                  ))}
                </div>
                <div className="flow-tl-axis">
                  {axisMarks(segments, weights, weightTotal).map((mark) => (
                    <span
                      key={mark.at}
                      className="flow-tl-mark"
                      data-edge={mark.pct <= 1 ? 'start' : mark.pct >= 99 ? 'end' : undefined}
                      style={{ left: `${mark.pct}%` }}
                    >
                      {mark.label}
                    </span>
                  ))}
                </div>
              </div>
              <p className="caption">
                {workingDays
                  ? t(
                      'Durations are working days, without Saturdays, Sundays, and holidays.',
                      'Длительности — рабочие дни, без суббот, воскресений и праздников.',
                    )
                  : t('Durations are calendar days.', 'Длительности — календарные дни.')}{' '}
                {t('The total on the right is every visit to that status on this issue.', 'Сумма справа — все заходы в статус по этой задаче.')}
              </p>
              <div className="flow-tl-legend">
                {totals.map((row) => (
                  <span key={row.status} className={isTimelineStatusExcluded(row.status, excluded) ? 'is-excluded' : undefined}>
                    <span className="swatch" style={{ background: flowTimelineSegmentColor(row) }} />
                    {row.status}
                    <span className="flow-tl-dur">
                      {' '}
                      {formatCycleDuration(row.days)}
                      {row.visits > 1 ? ` · ${row.visits}` : ''}
                    </span>
                  </span>
                ))}
              </div>
              <ol className="flow-tl-list">
                {segments.map((segment, index) => (
                  <li key={`${segment.from}-${segment.status}-${index}`}>
                    <span className="cycle-chart-key">{formatStamp(segment.from)}</span>
                    <span>
                      {segment.status}
                      <span className="caption"> · {uiLabel(segment.stageLabel)}</span>
                    </span>
                    <span className="caption">
                      {formatCycleDuration(segment.days)}
                      {index === segments.length - 1 ? ` · ${t('now', 'сейчас')}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function timelineStatusOptions(
  segments: FlowTimelineSegment[],
  issues: IssueTimeline[],
  selected?: IssueTimeline,
): string[] {
  const names: string[] = [];
  if (segments.length > 0) {
    for (const segment of segments) names.push(segment.status);
  } else if (!selected) {
    for (const issue of issues) {
      names.push(issue.status);
      for (const transition of issue.transitions) {
        if (transition.from) names.push(transition.from);
        if (transition.to) names.push(transition.to);
      }
    }
  }
  return uniqueTimelineStatusNames(names);
}

function timelineHint(hint: string, t: (en: string, ru: string) => string): string {
  if (hint === 'История статусов может быть обрезана (~100 событий в ответе Jira).') {
    return t('Status history may be truncated (~100 events in the Jira response).', hint);
  }
  return hint;
}

function excludeSummary(excluded: string[], t: (en: string, ru: string) => string): string {
  if (excluded.length === 0) return t('Exclude: none', 'Исключить: ничего');
  if (excluded.length === 1) return t(`Exclude: ${excluded[0]}`, `Исключить: ${excluded[0]}`);
  const n10 = excluded.length % 10;
  const n100 = excluded.length % 100;
  const ruWord =
    n10 === 1 && n100 !== 11 ? 'статус' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'статуса' : 'статусов';
  const enWord = excluded.length === 1 ? 'status' : 'statuses';
  return t(`Exclude: ${excluded.length} ${enWord}`, `Исключить: ${excluded.length} ${ruWord}`);
}

function axisMarks(
  segments: FlowTimelineSegment[],
  weights: number[],
  weightTotal: number,
): Array<{ at: string; pct: number; label: string }> {
  if (segments.length === 0 || weightTotal <= 0) return [];
  const marks: Array<{ at: string; pct: number; label: string }> = [];
  let elapsed = 0;
  const push = (iso: string, pct: number) => {
    const label = formatDay(iso);
    if (marks.some((mark) => mark.label === label && Math.abs(mark.pct - pct) < 4)) return;
    marks.push({ at: iso, pct: Math.min(100, Math.max(0, pct)), label });
  };
  push(segments[0].from, 0);
  for (let index = 0; index < segments.length; index += 1) {
    if (elapsed > 0) push(segments[index].from, (elapsed / weightTotal) * 100);
    elapsed += weights[index] ?? segments[index].days;
  }
  push(segments[segments.length - 1].to, 100);
  const maxLabels = 8;
  if (marks.length <= maxLabels) return marks;
  const step = Math.ceil(marks.length / maxLabels);
  return marks.filter((mark, index) => index === 0 || index === marks.length - 1 || index % step === 0);
}

function formatStamp(iso: string): string {
  return iso.replace('T', ' ').replace('Z', '').slice(0, 16);
}

function formatDay(iso: string): string {
  return iso.slice(5, 10);
}

function readExcludedStatuses(): string[] | undefined {
  try {
    const raw = window.localStorage.getItem(EXCLUDED_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
    }
    const legacy = window.localStorage.getItem(HIDE_TODO_STORAGE);
    if (legacy === '0') return [];
    return undefined;
  } catch {
    return undefined;
  }
}

function writeExcludedStatuses(value: string[]): void {
  try {
    window.localStorage.setItem(EXCLUDED_STORAGE, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}
