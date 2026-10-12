import { useEffect, useRef, useState } from 'react';
import { SERIES } from './data';

// Chart building blocks for the admin site (plain SVG, no chart library).
// Specs: columns <= 24px with 4px rounded data-end, 2px surface gap between
// stacked segments, 2px lines, end dot r4 with a 2px surface ring, hairline
// solid gridlines, text in ink tokens (never the series color), legend for
// >= 2 series, hover tooltips, and a table view under every chart.
//
const GRID = '#e8e4da';
const AXIS = '#d6cdb9';
const SURFACE = '#ffffff';

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(v) {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toFixed(1));
const dayLabel = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };

// Rect with only the top corners rounded (data-end), square at the baseline.
function topRounded(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Tooltip({ x, y, width, children }) {
  if (x == null) return null;
  const left = Math.min(Math.max(x - 80, 0), Math.max(0, width - 170));
  return (
    <div role="status" className="absolute pointer-events-none text-xs px-2.5 py-2"
      style={{ left, top: Math.max(0, y - 8), transform: 'translateY(-100%)', minWidth: 150, background: 'var(--surface)',
               border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-2)', color: 'var(--text)', zIndex: 5 }}>
      {children}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function TableView({ columns, rows }) {
  return (
    <details className="text-xs mt-2">
      <summary className="cursor-pointer font-bold" style={{ color: 'var(--muted)' }}>Xem bảng</summary>
      <div className="overflow-x-auto mt-1.5">
        <table className="w-full text-left" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{columns.map((c) => <th key={c} className="py-1 pr-3 font-bold" style={{ color: 'var(--muted)' }}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>{r.map((v, j) => <td key={j} className="py-1 pr-3">{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 12, right: 12, bottom: 22, left: 34 };

function YAxis({ max, plotH, width }) {
  const ticks = [0, max / 2, max];
  return ticks.map((t) => {
    const y = PAD.top + plotH - (t / max) * plotH;
    return (
      <g key={t}>
        <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={t === 0 ? AXIS : GRID} strokeWidth="1" />
        <text x={PAD.left - 6} y={y} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(t)}</text>
      </g>
    );
  });
}

/** Stacked columns per day. days: [iso], series: [{key,label,color}], value(day,key) -> n */
export function StackedColumns({ days, series, value, height = 190, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const plotH = height - PAD.top - PAD.bottom;
  const totals = days.map((d) => series.reduce((s, se) => s + value(d, se.key), 0));
  const max = niceMax(Math.max(0, ...totals));
  const band = width > 0 ? (width - PAD.left - PAD.right) / days.length : 0;
  const barW = Math.min(24, band * 0.6);
  const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor((width - PAD.left) / 44)));
  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <YAxis max={max} plotH={plotH} width={width} />
          {days.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let base = PAD.top + plotH;
            const segs = series.map((se) => ({ ...se, v: value(d, se.key) })).filter((s) => s.v > 0);
            return (
              <g key={d}>
                {segs.map((s, k) => {
                  const h = (s.v / max) * plotH;
                  const y = base - h;
                  const gap = k > 0 ? 2 : 0;           // surface gap between stacked segments
                  const isTop = k === segs.length - 1;
                  const el = isTop
                    ? <path key={s.key} d={topRounded(cx - barW / 2, y, barW, Math.max(0, h - gap), 4)} fill={s.color} />
                    : <rect key={s.key} x={cx - barW / 2} y={y} width={barW} height={Math.max(0, h - gap)} fill={s.color} />;
                  base = y;
                  return el;
                })}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{dayLabel(d)}</text>
                )}
                {/* Hit target: the whole band, taller than the mark. */}
                <rect x={cx - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
              </g>
            );
          })}
          {hover != null && (
            <line x1={PAD.left + band * hover + band / 2} x2={PAD.left + band * hover + band / 2} y1={PAD.top} y2={PAD.top + plotH}
              stroke={AXIS} strokeWidth="1" pointerEvents="none" />
          )}
        </svg>
      )}
      {hover != null && (
        <Tooltip x={PAD.left + band * hover + band / 2} y={PAD.top + plotH - (totals[hover] / max) * plotH} width={width}>
          <div className="font-bold mb-1">{dayLabel(days[hover])} · {fmt(totals[hover])} ván</div>
          {series.map((se) => (
            <div key={se.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: se.color }} />
              <span style={{ color: 'var(--text-2)' }}>{se.label}</span>
              <span className="ml-auto font-bold">{fmt(value(days[hover], se.key))}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Single-series line + 10% area wash, crosshair tooltip, labeled end value. points: [{x: iso, y}] */
export function LineArea({ points, color = SERIES[0], unit = '', height = 170, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const plotH = height - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => p.y)));
  const innerW = width - PAD.left - PAD.right - 26;   // room for the end label
  const xs = (i) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const ys = (v) => PAD.top + plotH - (v / max) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(p.y)}`).join('');
  const area = points.length ? `${line}L${xs(points.length - 1)},${PAD.top + plotH}L${xs(0)},${PAD.top + plotH}Z` : '';
  const last = points.length - 1;
  const onMove = (e) => {
    const bx = e.currentTarget.getBoundingClientRect().left;
    const rel = (e.clientX - bx - PAD.left) / Math.max(1, innerW);
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))));
  };
  const labelEvery = Math.ceil(points.length / Math.max(1, Math.floor(innerW / 44)));
  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <YAxis max={max} plotH={plotH} width={width} />
          <path d={area} fill={color} opacity="0.1" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => i % labelEvery === 0 && (
            <text key={p.x} x={xs(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">{dayLabel(p.x)}</text>
          ))}
          <circle cx={xs(last)} cy={ys(points[last].y)} r="4" fill={color} stroke={SURFACE} strokeWidth="2" />
          <text x={xs(last) + 8} y={ys(points[last].y)} dy="0.32em" fontSize="11" fontWeight="700" fill="var(--text)">{fmt(points[last].y)}</text>
          {hover != null && (
            <g pointerEvents="none">
              <line x1={xs(hover)} x2={xs(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke={AXIS} strokeWidth="1" />
              <circle cx={xs(hover)} cy={ys(points[hover].y)} r="4" fill={color} stroke={SURFACE} strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hover != null && (
        <Tooltip x={xs(hover)} y={ys(points[hover].y)} width={width}>
          <div className="font-bold">{dayLabel(points[hover].x)}</div>
          <div style={{ color: 'var(--text-2)' }}>{fmt(points[hover].y)}{unit}</div>
        </Tooltip>
      )}
    </div>
  );
}

/** Horizontal bars, value at the tip. rows: [{label, value, max, note}] (value/max in 0..max). */
export function HBars({ rows, color = SERIES[0], format = fmt, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...rows.map((r) => r.max ?? r.value), 1e-9);
  return (
    <div className="flex flex-col gap-2.5" role="img" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <div key={r.label} className="relative grid items-center gap-2" style={{ gridTemplateColumns: '7.5rem 1fr' }}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="text-xs font-semibold truncate text-right" style={{ color: 'var(--text-2)' }}>{r.label}</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <div style={{ width: `${Math.max(1, (r.value / max) * 85)}%`, height: 16, background: color, borderRadius: '0 4px 4px 0' }} />
            <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text)' }}>{format(r.value)}</span>
          </div>
          {hover === i && r.note && (
            <div className="absolute right-0 -top-7 text-xs px-2 py-1 pointer-events-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-2)' }}>
              {r.note}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function StatTile({ label, value, sub }) {
  return (
    <div className="panel-2 p-3.5 flex flex-col gap-0.5 text-left">
      <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="text-2xl font-extrabold" style={{ color: 'var(--text)' }}>{value}</span>
      {sub && <span className="text-[11px]" style={{ color: 'var(--text-2)' }}>{sub}</span>}
    </div>
  );
}
