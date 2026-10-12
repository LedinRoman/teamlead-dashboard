'use client';

import { useState } from 'react';

import { useI18n } from '@frontend/i18n/locale';
import type { CycleBar } from '@backend/metrics/cycle-overview';
import { cycleBarTooltip, formatCycleDuration, formatStoryPoints } from '@backend/metrics/cycle-overview';
import type { CategoryCount, SeriesPoint } from '@shared/types';
import { formatNumber, toneColor, type Tone } from './ui';

const VIEW_WIDTH = 600;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 30;
const MAX_TICKS = 8;

interface AxisChartProps {
  data: SeriesPoint[];
  xLabel: string;
  yLabel: string;
  caption?: string;
  height?: number;
  tone?: Tone;
  formatX?: (label: string) => string;
  formatY?: (value: number) => string;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = magnitude * step;
    if (candidate >= value) return candidate;
  }
  return magnitude * 10;
}

function axisFrame(data: SeriesPoint[], height: number) {
  const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const max = niceMax(Math.max(...data.map((point) => point.value), 0));
  const ticks = [0, max / 2, max];
  const yOf = (value: number) => PAD_TOP + plotHeight - (value / max) * plotHeight;
  const tickEvery = Math.max(1, Math.ceil(data.length / MAX_TICKS));
  return { plotWidth, plotHeight, max, ticks, yOf, tickEvery };
}

function Axes({
  height,
  ticks,
  yOf,
  xLabel,
  yLabel,
  formatY = (value) => formatNumber(Math.round(value * 10) / 10),
}: {
  height: number;
  ticks: number[];
  yOf: (value: number) => number;
  xLabel: string;
  yLabel: string;
  formatY?: (value: number) => string;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="chart-grid-line" x1={PAD_LEFT} x2={VIEW_WIDTH - PAD_RIGHT} y1={yOf(tick)} y2={yOf(tick)} />
          <text className="chart-tick" x={PAD_LEFT - 5} y={yOf(tick) + 3} textAnchor="end">
            {formatY(tick)}
          </text>
        </g>
      ))}
      <text className="chart-axis-label" x={VIEW_WIDTH - PAD_RIGHT} y={height - 4} textAnchor="end">
        {xLabel}
      </text>
      <text
        className="chart-axis-label"
        x={0}
        y={0}
        transform={`translate(9 ${PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {yLabel}
      </text>
    </>
  );
}

export function BarChart({
  data,
  xLabel,
  yLabel,
  caption,
  height = 190,
  tone = 'info',
  formatX = (label) => label,
  formatY,
}: AxisChartProps) {
  const { t } = useI18n();
  const [hover, setHover] = useState<string | null>(null);
  if (data.length === 0) return null;
  const { plotWidth, ticks, yOf, tickEvery } = axisFrame(data, height);
  const slot = plotWidth / data.length;
  const barWidth = Math.max(2, Math.min(26, slot * 0.66));
  const hovered = hover ? data.find((point) => point.label === hover) : undefined;

  return (
    <figure className="chart-frame" style={{ margin: 0 }}>
      <svg className="chart-svg" viewBox={`0 0 ${VIEW_WIDTH} ${height}`} role="img" aria-label={t(`${yLabel} by ${xLabel}`, `${yLabel} по ${xLabel}`)}>
        <Axes height={height} ticks={ticks} yOf={yOf} xLabel={xLabel} yLabel={yLabel} formatY={formatY} />
        {data.map((point, index) => {
          const centre = PAD_LEFT + slot * index + slot / 2;
          const top = yOf(point.value);
          const tip = point.hint ?? `${point.label}: ${formatNumber(point.value)}`;
          return (
            <g
              key={`${point.label}-${index}`}
              onMouseEnter={() => setHover(point.label)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={centre - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(0, yOf(0) - top)}
                fill={toneColor(tone)}
                opacity={hovered && hovered.label !== point.label ? 0.35 : 1}
                rx={1}
              />
              <rect
                x={centre - Math.max(barWidth, slot * 0.8) / 2}
                y={PAD_TOP}
                width={Math.max(barWidth, slot * 0.8)}
                height={Math.max(0, yOf(0) - PAD_TOP)}
                fill="transparent"
              >
                <title>{tip}</title>
              </rect>
              {index % tickEvery === 0 && (
                <text className="chart-tick" x={centre} y={height - PAD_BOTTOM + 12} textAnchor="middle">
                  {formatX(point.label)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="caption">
        {hovered ? hovered.hint ?? `${hovered.label}: ${formatNumber(hovered.value)}` : caption ?? t('Hover a bar for the count.', 'Наведите на столбец, чтобы увидеть число.')}
      </figcaption>
    </figure>
  );
}

export function LineChart({
  data,
  xLabel,
  yLabel,
  caption,
  height = 190,
  tone = 'accent' as Tone,
  formatX = (label) => label,
  formatY,
}: AxisChartProps) {
  const { t } = useI18n();
  if (data.length === 0) return null;
  const { plotWidth, ticks, yOf, tickEvery } = axisFrame(data, height);
  const xOf = (index: number) =>
    data.length === 1 ? PAD_LEFT + plotWidth / 2 : PAD_LEFT + (plotWidth * index) / (data.length - 1);
  const points = data.map((point, index) => `${xOf(index)},${yOf(point.value)}`).join(' ');
  const colour = toneColor(tone);

  return (
    <figure className="chart-frame" style={{ margin: 0 }}>
      <svg className="chart-svg" viewBox={`0 0 ${VIEW_WIDTH} ${height}`} role="img" aria-label={t(`${yLabel} over ${xLabel}`, `${yLabel} по ${xLabel}`)}>
        <Axes height={height} ticks={ticks} yOf={yOf} xLabel={xLabel} yLabel={yLabel} formatY={formatY} />
        <polyline points={points} fill="none" stroke={colour} strokeWidth={1.8} strokeLinejoin="round" />
        {data.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={xOf(index)} cy={yOf(point.value)} r={data.length > 40 ? 0 : 2} fill={colour} />
            {index % tickEvery === 0 && (
              <text className="chart-tick" x={xOf(index)} y={height - PAD_BOTTOM + 12} textAnchor="middle">
                {formatX(point.label)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {caption && <figcaption className="caption">{caption}</figcaption>}
    </figure>
  );
}

const SLICE_COLOURS = ['var(--accent)', 'var(--info)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--text-faint)'];

export function DonutChart({
  data,
  caption,
  unitLabel = 'work items',
}: {
  data: CategoryCount[];
  caption?: string;
  unitLabel?: string;
}) {
  const { t } = useI18n();
  const units = unitLabel === 'work items' ? t('work items', 'задачи') : unitLabel;
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0 || data.length === 0) return null;

  const size = 132;
  const centre = size / 2;
  const outer = 58;
  const inner = 36;
  let cursor = -Math.PI / 2;

  const slices = data.map((slice, index) => {
    const angle = (slice.value / total) * Math.PI * 2;
    const path = donutSlice(centre, centre, inner, outer, cursor, cursor + angle);
    cursor += angle;
    return {
      ...slice,
      path,
      colour: slice.tone ? toneColor(slice.tone) : SLICE_COLOURS[index % SLICE_COLOURS.length],
    };
  });

  return (
    <figure className="chart-frame" style={{ margin: 0 }}>
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t(`Share of ${units}`, `Доля: ${units}`)}>
          {slices.map((slice) => (
            <path key={slice.label} d={slice.path} fill={slice.colour} />
          ))}
          <text x={centre} y={centre - 2} textAnchor="middle" style={{ fontSize: 17, fontWeight: 600, fill: 'var(--text)' }}>
            {total}
          </text>
          <text x={centre} y={centre + 12} textAnchor="middle" className="chart-tick">
            {t('total', 'всего')}
          </text>
        </svg>
        <div className="stack" style={{ gap: 3, minWidth: 0, flex: 1 }}>
          {slices.map((slice) => (
            <div key={slice.label} className="chart-legend" style={{ justifyContent: 'space-between' }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="swatch" style={{ background: slice.colour }} />
                {slice.label}
              </span>
              <span style={{ color: 'var(--text)' }}>
                {slice.value} · {Math.round((slice.value / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
      {caption && <figcaption className="caption">{caption}</figcaption>}
    </figure>
  );
}

function donutSlice(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
): string {
  // A full circle cannot be drawn with a single arc, so nudge it just short of 2pi.
  const end = to - from >= Math.PI * 2 ? from + Math.PI * 1.9999 : to;
  const largeArc = end - from > Math.PI ? 1 : 0;
  const p = (radius: number, angle: number) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  const [x1, y1] = p(outer, from);
  const [x2, y2] = p(outer, end);
  const [x3, y3] = p(inner, end);
  const [x4, y4] = p(inner, from);
  return [
    `M ${x1} ${y1}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/** Horizontal bars, which stay readable with many long category names. */
export function HBarList({
  data,
  caption,
  limit = 12,
  unitLabel = 'work items',
}: {
  data: CategoryCount[];
  caption?: string;
  limit?: number;
  unitLabel?: string;
}) {
  const { t } = useI18n();
  const units = unitLabel === 'work items' ? t('work items', 'задачи') : unitLabel;
  if (data.length === 0) return null;
  const rows = data.slice(0, limit);
  const hidden = data.length - rows.length;
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <figure className="chart-frame" style={{ margin: 0 }}>
      <div className="hbar-list" role="list" aria-label={t(`${units} per category`, `${units} по категориям`)}>
        {rows.map((row) => (
          <div key={row.label} className="hbar-row" role="listitem">
            <span className="hbar-label" title={row.label}>
              {row.label}
            </span>
            <span className="hbar-track">
              <span
                className="hbar-fill"
                style={{ width: `${(row.value / max) * 100}%`, background: toneColor(row.tone) }}
              />
            </span>
            <span className="hbar-value">{row.value}</span>
          </div>
        ))}
      </div>
      {(caption || hidden > 0) && (
        <figcaption className="caption">
          {caption}
          {hidden > 0 ? `${caption ? ' · ' : ''}${t(`${hidden} more not shown`, `ещё ${hidden} не показано`)}` : ''}
        </figcaption>
      )}
    </figure>
  );
}

export function SegmentBar({
  segments,
  caption,
  onSelect,
  selected,
}: {
  segments: Array<{ label: string; value: number; tone?: Tone; color?: string; id?: string; title?: string }>;
  caption?: string;
  onSelect?: (id: string) => void;
  selected?: string;
}) {
  const { t } = useI18n();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) return null;
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <figure className="chart-frame" style={{ margin: 0 }}>
      <div className="usage-bar" role="img" aria-label={caption ?? t('Composition', 'Состав')}>
        {visible.map((segment) => {
          const id = segment.id ?? segment.label;
          const active = selected === id;
          return (
            <button
              key={id}
              type="button"
              className="usage-segment"
              title={segment.title ?? `${segment.label}: ${segment.value}`}
              disabled={!onSelect}
              data-active={active ? 'true' : undefined}
              onClick={() => onSelect?.(id)}
              style={{
                width: `${(segment.value / total) * 100}%`,
                background: segment.color ?? toneColor(segment.tone),
                opacity: selected && !active ? 0.45 : 1,
                cursor: onSelect ? 'pointer' : 'default',
                border: 0,
                padding: 0,
              }}
            />
          );
        })}
      </div>
      <div className="chart-legend">
        {visible.map((segment) => {
          const id = segment.id ?? segment.label;
          return (
            <button
              key={id}
              type="button"
              className="chart-legend-item"
              disabled={!onSelect}
              onClick={() => onSelect?.(id)}
              style={{ cursor: onSelect ? 'pointer' : 'default', opacity: selected && selected !== id ? 0.55 : 1 }}
            >
              <span className="swatch" style={{ background: segment.color ?? toneColor(segment.tone) }} />
              {segment.label} {segment.value}
            </button>
          );
        })}
      </div>
      {caption && <figcaption className="caption">{caption}</figcaption>}
    </figure>
  );
}

const CYCLE_ROW_PX = 26;
const CYCLE_MAX_ROWS = 12;

export function CycleTimeBarChart({
  bars,
  median,
  p85,
  endStatus,
  onExclude,
  onOverrideStart,
}: {
  bars: CycleBar[];
  median: number | null;
  p85: number | null;
  endStatus?: string;
  onExclude?: (key: string) => void;
  onOverrideStart?: (key: string) => void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState<string | null>(null);
  if (bars.length === 0) return null;

  const maxValue = Math.max(...bars.map((bar) => bar.cycleTimeDays), median ?? 0, p85 ?? 0, 0.1);
  const max = niceMax(maxValue);
  const ticks = [0, max / 2, max];
  const hovered = hover ? bars.find((bar) => bar.key === hover) : undefined;
  const medianPct = median === null ? undefined : (median / max) * 100;
  const p85Pct = p85 === null ? undefined : (p85 / max) * 100;
  const p85LabelSide = medianPct !== undefined && p85Pct !== undefined && Math.abs(p85Pct - medianPct) < 12;

  return (
    <figure
      className={`chart-frame cycle-chart${onExclude || onOverrideStart ? ' cycle-chart-excludable' : ''}${onOverrideStart ? ' cycle-chart-overridable' : ''}`}
      style={{ margin: 0 }}
    >
      <div className="cycle-chart-head">
        <span className="cycle-chart-legend" aria-label={t('Development and the QA queue', 'Разработка и очередь QA')}>
          <span className="cycle-chart-legend-item">
            <span className="cycle-chart-legend-swatch cycle-chart-seg-dev" />
            {t('Development', 'Разработка')}
          </span>
          <span className="cycle-chart-legend-item">
            <span className="cycle-chart-legend-swatch cycle-chart-seg-qa" />
            {t('QA WIP', 'QA WIP')}
          </span>
        </span>
        <span className="cycle-chart-scale">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="cycle-chart-tick"
              style={{ left: `${(tick / max) * 100}%` }}
            >
              {formatCycleDuration(tick)}
            </span>
          ))}
          {medianPct !== undefined && (
            <span className="cycle-ref-label" style={{ left: `${medianPct}%` }}>
              {t('Median', 'Медиана')}
            </span>
          )}
          {p85Pct !== undefined && (
            <span
              className="cycle-ref-label cycle-ref-label-p85"
              style={{
                left: `${p85Pct}%`,
                transform: p85LabelSide ? 'translateX(4px)' : 'translateX(-50%)',
              }}
            >
              P85
            </span>
          )}
        </span>
        <span />
        {onExclude ? <span /> : null}
        {onOverrideStart ? <span /> : null}
      </div>
      <div
        className="cycle-chart-scroll"
        style={{ maxHeight: Math.min(bars.length, CYCLE_MAX_ROWS) * CYCLE_ROW_PX }}
        role="list"
        aria-label={t('Cycle time by work item', 'Cycle time по задачам')}
      >
        {bars.map((bar) => {
          const tip = cycleBarTooltip(bar, endStatus);
          const dimmed = hovered && hovered.key !== bar.key;
          return (
            <div
              key={bar.key}
              className="cycle-chart-row"
              role="listitem"
              title={tip}
              onMouseEnter={() => setHover(bar.key)}
              onMouseLeave={() => setHover(null)}
              style={{ opacity: dimmed ? 0.4 : 1, height: CYCLE_ROW_PX }}
            >
              <span className="cycle-chart-id">
                {bar.url ? (
                  <a className="cycle-chart-key" href={bar.url} target="_blank" rel="noreferrer">
                    {bar.key}
                  </a>
                ) : (
                  <span className="cycle-chart-key">{bar.key}</span>
                )}
                {bar.storyPoints !== undefined && (
                  <span className="cycle-chart-sp">{formatStoryPoints(bar.storyPoints)}</span>
                )}
                {(bar.startOverridden || bar.endOverridden) && (
                  <span className="cycle-chart-override-mark" title={t('Date override', 'Override дат')}>
                    *
                  </span>
                )}
              </span>
              <span className="cycle-chart-track">
                <span
                  className="cycle-chart-fill"
                  style={{ width: `${(bar.cycleTimeDays / max) * 100}%` }}
                >
                  {bar.qaWipDays > 0 ? (
                    <>
                      {bar.devDays > 0 ? (
                        <span className="cycle-chart-seg cycle-chart-seg-dev" style={{ flexGrow: bar.devDays }} />
                      ) : null}
                      <span className="cycle-chart-seg cycle-chart-seg-qa" style={{ flexGrow: bar.qaWipDays }} />
                    </>
                  ) : (
                    <span className="cycle-chart-seg cycle-chart-seg-dev" style={{ flexGrow: 1 }} />
                  )}
                </span>
                {medianPct !== undefined && (
                  <span className="cycle-ref cycle-ref-median" style={{ left: `${medianPct}%` }} />
                )}
                {p85Pct !== undefined && (
                  <span className="cycle-ref cycle-ref-p85" style={{ left: `${p85Pct}%` }} />
                )}
              </span>
              <span className="cycle-chart-value">{formatCycleDuration(bar.cycleTimeDays)}</span>
              {onExclude ? (
                <button
                  type="button"
                  className="cycle-chart-exclude"
                  aria-label={t(`Exclude ${bar.key}`, `Исключить ${bar.key}`)}
                  title={t('Exclude from the calculation and the chart', 'Исключить из расчёта и графика')}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onExclude(bar.key);
                  }}
                >
                  ×
                </button>
              ) : null}
              {onOverrideStart ? (
                <button
                  type="button"
                  className="cycle-chart-override"
                  aria-label={t(`Date override ${bar.key}`, `Override дат ${bar.key}`)}
                  title={t('Fill this key into the date override', 'Подставить ключ в override дат')}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOverrideStart(bar.key);
                  }}
                >
                  ↺
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <figcaption className="caption cycle-chart-caption">
        {hovered ? (
          <span className="cycle-chart-tip">
            {cycleBarTooltip(hovered, endStatus)
              .split('\n')
              .map((line, index) => (
                <span key={`${hovered.key}-${index}`}>{line}</span>
              ))}
          </span>
        ) : (
          t(
            'Blue is development, teal is the Ready to QA queue. Median and P85 are the full cycle.',
            'Синий — разработка, бирюзовый — очередь Ready to QA. Медиана и P85 — полный цикл.',
          )
        )}
      </figcaption>
    </figure>
  );
}

/** `2026-03-14` renders as `Mar 14`; ISO week keys keep their week number. */
export function shortLabel(label: string): string {
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (isoDay) {
    const date = new Date(`${label}T00:00:00Z`);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const isoWeek = /^\d{4}-W(\d{2})$/.exec(label);
  if (isoWeek) return `W${isoWeek[1]}`;
  return label;
}
