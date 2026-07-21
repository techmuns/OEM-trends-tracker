// Interactive focus-trend chart — shared across Sales, EV vs ICE and Production & Exports.
// Inline SVG + HTML tooltip overlay. Hover inspects a period (crosshair + tooltip + enlarged
// active point); hovering a line, legend item, or (via props) a table row focuses that series
// — copper + thicker stroke, all other lines fade. Click a line/legend locks focus; Reset
// restores the default view. Plots either shares (%) or absolute volumes (`valueKind`), with
// an identical tooltip. Only subtle 120-160ms opacity/stroke transitions — no shadows.

import { useLayoutEffect, useRef, useState } from "react";
import { fmtPct, fmtPp, fmtShare, fmtUnits, fmtUnitsCompact } from "../lib/format";
import type { CompareSeries } from "../lib/compare";
import { dragProps } from "../lib/dragfx";

// Measure an element's live content width via ResizeObserver. The chart uses this to render its
// SVG at real pixel dimensions (viewBox = measured px, so 1 user-unit = 1 CSS px). That keeps
// every axis tick, endpoint label and legend a CONSTANT, readable pixel size at any container
// width — instead of a fixed viewBox that scales the whole drawing (and its text) up on wide
// screens and down to an unreadable size on narrow ones. Falls back to a sensible default until
// the first measurement lands (useLayoutEffect measures before paint, so there is no flash).
function useMeasuredWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (next: number) => {
      // round to whole px and ignore sub-pixel noise so we don't thrash on every scroll frame
      const px = Math.round(next);
      if (px > 0) setW((prev) => (Math.abs(prev - px) >= 1 ? px : prev));
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Optional drag-to-compare wiring for legend items (chart series). Additive — the chart works
// exactly as before when omitted.
export interface LegendCompare {
  make: (name: string) => CompareSeries | null;
}

// Focus/highlight colour is theme-driven. SVG presentation attributes don't resolve CSS
// var() reliably, so theme colours are applied via inline `style` throughout this component.
const FOCUS = "var(--chart-focus)";

export type ValueKind = "share" | "volume";

export interface TrendPoint {
  label: string; // period label, e.g. "Jan '26" / "FY24"
  value: number | null; // plotted metric — share (fraction) or absolute volume
  abs: number | null; // absolute volume (tooltip)
  share: number | null; // share fraction (tooltip)
  yoy: number | null; // YoY growth fraction (tooltip)
  prevChg: number | null; // share pp change vs previous period
  yoyChg: number | null; // share pp change vs same period last year
}
export interface TrendLine {
  name: string; // canonical company / series key
  display: string; // short display name
  color: string; // base colour (distinct per rank)
  points: TrendPoint[];
}

function lastDefined(points: TrendPoint[]): number {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value !== null) return i;
  return -1;
}

export function ShareTrendChart({
  lines,
  focusName,
  lockedName,
  showYoY,
  valueKind = "share",
  yLabel = "Market share (%)",
  domain,
  onLock,
  compare,
}: {
  lines: TrendLine[];
  focusName: string | null; // external focus (e.g. table-row hover)
  lockedName: string | null; // locked series (single-focus)
  showYoY: boolean; // false for Yearly (prev period == last year)
  valueKind?: ValueKind; // share → % axis; volume → compact-unit axis
  yLabel?: string;
  domain?: [number, number]; // fixed y-domain (e.g. [0,1] for complementary EV/ICE shares)
  onLock: (name: string) => void;
  compare?: LegendCompare;
}) {
  const fmtVal = (v: number) => (valueKind === "share" ? fmtShare(v) : fmtUnitsCompact(v));
  const fmtTick = (v: number) => (valueKind === "share" ? (v * 100).toFixed(0) + "%" : fmtUnitsCompact(v));
  const [wrapRef, cw] = useMeasuredWidth<HTMLDivElement>(760);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [plotHover, setPlotHover] = useState<string | null>(null); // nearest line under cursor
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Real-pixel geometry (see useMeasuredWidth): the viewBox width tracks the measured container
  // so 1 unit = 1px and all chart text keeps a constant, readable size. Height is held within a
  // readable band (≈340–408px) so the hero chart fills its card at every width without a fixed
  // aspect ratio stretching it tall on wide screens. Paddings are real px, sized so the y-axis
  // labels (left) and the endpoint value labels (right) never clip.
  const W = Math.max(360, cw);
  const H = Math.round(Math.min(408, Math.max(340, W * 0.4)));
  const padL = 56;
  const padR = 168;
  const padT = 20;
  const padB = 48;

  const labels = lines[0]?.points.map((p) => p.label) ?? [];
  const n = labels.length;
  const vals = lines.flatMap((l) => l.points.map((p) => p.value).filter((v): v is number => v !== null));
  if (n < 2 || !vals.length) return <div className="chart-hint">Not enough data to plot.</div>;

  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (domain) {
    [min, max] = domain;
  } else {
    const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 0.01;
    min = Math.max(0, min - pad);
    max += pad;
  }

  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const effFocus = plotHover ?? legendHover ?? focusName ?? lockedName ?? null;

  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);
  // x-axis labels: annual views (<=10 points) show every period; denser views thin out.
  // Always end on the last period, and avoid crowding it against the penultimate tick.
  const step = n <= 10 ? 1 : Math.ceil(n / 8);
  const xIdxs = labels.map((_, i) => i).filter((i) => i % step === 0);
  const lastTick = xIdxs[xIdxs.length - 1];
  if (lastTick !== n - 1) {
    if (n - 1 - lastTick < step) xIdxs[xIdxs.length - 1] = n - 1;
    else xIdxs.push(n - 1);
  }

  const onMove = (e: React.MouseEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const vx = (relX / rect.width) * W;
    const frac = (vx - padL) / (W - padL - padR);
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHoverIdx(idx);
    const vy = (relY / rect.height) * H;
    let best: string | null = null;
    let bestD = Infinity;
    for (const l of lines) {
      const v = l.points[idx]?.value;
      if (v == null) continue;
      const dy = Math.abs(vy - y(v));
      if (dy < bestD) {
        bestD = dy;
        best = l.name;
      }
    }
    setPlotHover(best);
    setTip({ x: relX, y: relY, w: rect.width, h: rect.height });
  };
  const onLeave = () => {
    setHoverIdx(null);
    setPlotHover(null);
    setTip(null);
  };

  const focusLine = effFocus ? lines.find((l) => l.name === effFocus) ?? null : null;
  const tipPoint = hoverIdx != null && focusLine ? focusLine.points[hoverIdx] : null;

  // Latest-share labels: vertically nudge apart so lines with near-equal shares
  // (e.g. two OEMs both ~12%) don't render on top of each other.
  const latestY = new Map<string, number>();
  const anchors = lines
    .map((l) => {
      const li = lastDefined(l.points);
      return li >= 0 && l.points[li].value != null ? { name: l.name, baseY: y(l.points[li].value!) } : null;
    })
    .filter((a): a is { name: string; baseY: number } => a !== null)
    .sort((a, b) => a.baseY - b.baseY);
  const MIN_GAP = 16;
  let prevY = -Infinity;
  for (const a of anchors) {
    const adj = Math.min(H - padB - 2, Math.max(padT + 6, Math.max(a.baseY, prevY + MIN_GAP)));
    latestY.set(a.name, adj);
    prevY = adj;
  }

  // tooltip placement (flip left near the right edge)
  let tipStyle: React.CSSProperties | undefined;
  if (tip && tipPoint && tipPoint.value != null) {
    const left = tip.x > tip.w * 0.62 ? tip.x - 172 : tip.x + 16;
    const top = Math.max(4, Math.min(tip.h - 132, tip.y - 20));
    tipStyle = { left, top };
  }

  return (
    <div className="trend">
      <div
        ref={wrapRef}
        className="trend-plot"
        style={{ cursor: plotHover ? "pointer" : "default" }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={() => plotHover && onLock(plotHover)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="market share trend">
          {/* y grid + ticks */}
          {tickVals.map((tv, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
              <text x={padL - 10} y={y(tv) + 4} textAnchor="end" fontSize={12} style={{ fill: "var(--chart-axis)" }}>
                {fmtTick(tv)}
              </text>
            </g>
          ))}
          {/* y axis label */}
          <text
            transform={`translate(15 ${padT + (H - padT - padB) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={12}
            style={{ fill: "var(--chart-axis)" }}
            letterSpacing="0.02em"
          >
            {yLabel}
          </text>
          {/* x labels */}
          {xIdxs.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 10}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize={12}
              fontWeight={hoverIdx === i ? 600 : 400}
              style={{ fill: hoverIdx === i ? "var(--text-secondary)" : "var(--chart-axis)" }}
            >
              {labels[i]}
            </text>
          ))}

          {/* crosshair */}
          {hoverIdx != null && (
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={padT}
              y2={H - padB}
              style={{ stroke: "var(--chart-crosshair)" }}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* lines */}
          {lines.map((l) => {
            const isFocus = l.name === effFocus;
            const dim = effFocus != null && !isFocus;
            const segs = buildSegments(l.points, x, y);
            const li = lastDefined(l.points);
            const stroke = isFocus ? FOCUS : l.color;
            return (
              <g key={l.name} className="tline" style={{ opacity: dim ? 0.28 : 1 }}>
                {segs.map((d, i) => (
                  <path
                    key={i}
                    className="tpath"
                    d={d}
                    fill="none"
                    style={{ stroke }}
                    strokeWidth={isFocus ? 1.9 : 1.4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {/* faint marker at crosshair for context */}
                {hoverIdx != null && !isFocus && l.points[hoverIdx]?.value != null && (
                  <circle cx={x(hoverIdx)} cy={y(l.points[hoverIdx]!.value!)} r={2.4} style={{ fill: stroke }} opacity={0.7} />
                )}
                {/* latest-share label at the last defined point (collision-avoided y) */}
                {li >= 0 && l.points[li].value != null && (
                  <>
                    <circle cx={x(li)} cy={y(l.points[li].value!)} r={isFocus ? 4 : 3.2} style={{ fill: stroke }} />
                    <text
                      className="tlabel"
                      x={x(li) + 9}
                      y={(latestY.get(l.name) ?? y(l.points[li].value!)) + 4}
                      fontSize={12.5}
                      fontWeight={isFocus ? 600 : 500}
                      style={{ fill: stroke }}
                    >
                      {l.display} {fmtVal(l.points[li].value!)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* enlarged active point with a subtle matching glow */}
          {hoverIdx != null && focusLine && focusLine.points[hoverIdx]?.value != null && (
            <>
              <circle cx={x(hoverIdx)} cy={y(focusLine.points[hoverIdx]!.value!)} r={9} style={{ fill: FOCUS }} opacity={0.16} />
              <circle cx={x(hoverIdx)} cy={y(focusLine.points[hoverIdx]!.value!)} r={5} style={{ fill: FOCUS }} />
              <circle
                cx={x(hoverIdx)}
                cy={y(focusLine.points[hoverIdx]!.value!)}
                r={5}
                fill="none"
                style={{ stroke: "var(--canvas)" }}
                strokeWidth={1.5}
              />
            </>
          )}
        </svg>

        {/* tooltip — identical field set across all pages */}
        {tipStyle && tipPoint && (
          <div className="trend-tip" style={tipStyle}>
            <div className="tt-name">{focusLine!.display}</div>
            <div className="tt-period">{labels[hoverIdx!]}</div>
            {tipPoint.abs != null && (
              <div className="tt-row">
                <span>Volume</span>
                <b>{fmtUnits(tipPoint.abs)}</b>
              </div>
            )}
            {tipPoint.yoy != null && (
              <div className="tt-row">
                <span>YoY</span>
                <b className={ppClass(tipPoint.yoy)}>{fmtPct(tipPoint.yoy)}</b>
              </div>
            )}
            {tipPoint.share != null && (
              <div className="tt-row">
                <span>Share</span>
                <b>{fmtShare(tipPoint.share)}</b>
              </div>
            )}
            <div className="tt-row">
              <span>vs prev period</span>
              <b className={ppClass(tipPoint.prevChg)}>{tipPoint.prevChg == null ? "—" : fmtPp(tipPoint.prevChg)}</b>
            </div>
            {showYoY && (
              <div className="tt-row">
                <span>vs last year</span>
                <b className={ppClass(tipPoint.yoyChg)}>{tipPoint.yoyChg == null ? "—" : fmtPp(tipPoint.yoyChg)}</b>
              </div>
            )}
          </div>
        )}
      </div>

      {/* legend directly below the chart */}
      <div className="trend-legend">
        {lines.map((l) => {
          const isFocus = l.name === effFocus;
          return (
            <button
              key={l.name}
              className={`tleg ${isFocus ? "on" : ""} ${effFocus && !isFocus ? "off" : ""} ${compare ? "draggable" : ""}`}
              onMouseEnter={() => setLegendHover(l.name)}
              onMouseLeave={() => setLegendHover(null)}
              onClick={() => onLock(l.name)}
              title={compare ? `Focus ${l.display} · drag to compare` : `Focus ${l.display}`}
              {...(compare ? dragProps(() => compare.make(l.name)) : {})}
            >
              <i style={{ background: isFocus ? FOCUS : l.color }} />
              {l.display}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ppClass(v: number | null): string {
  if (v == null) return "flat";
  return v > 0.0005 ? "pos" : v < -0.0005 ? "neg" : "flat";
}

function buildSegments(points: TrendPoint[], x: (i: number) => number, y: (v: number) => number): string[] {
  // Split into contiguous runs at missing points (a null breaks the line), then render each run
  // as a smooth curve rather than straight segments.
  const segs: string[] = [];
  let run: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length > 1) segs.push(smoothPath(run));
      run = [];
    } else {
      run.push({ x: x(i), y: y(p.value) });
    }
  });
  if (run.length > 1) segs.push(smoothPath(run));
  return segs;
}

// Monotone cubic interpolation (like d3's curveMonotoneX): a smooth line that passes through
// every point and never overshoots between them — so a smoothed share line can't imply a value
// the data doesn't show (peaks/troughs round off exactly at the data point, never beyond it).
function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  if (n === 2) return d + ` L${f(pts[1].x)},${f(pts[1].y)}`;
  // secant slopes between consecutive points
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) s[i] = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x);
  // tangents at each point (Fritsch–Carlson limited so segments stay monotone → no overshoot)
  const t: number[] = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) {
      t[i] = 0; // local extremum → flat tangent
    } else {
      const h0 = pts[i].x - pts[i - 1].x;
      const h1 = pts[i + 1].x - pts[i].x;
      const p = (s[i - 1] * h1 + s[i] * h0) / (h0 + h1);
      t[i] = (Math.sign(s[i - 1]) + Math.sign(s[i])) * Math.min(Math.abs(s[i - 1]), Math.abs(s[i]), 0.5 * Math.abs(p));
    }
  }
  t[0] = (3 * s[0] - t[1]) / 2;
  t[n - 1] = (3 * s[n - 2] - t[n - 2]) / 2;
  // one cubic bézier per segment, control points a third of the way in along each tangent
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    const c1x = pts[i].x + dx;
    const c1y = pts[i].y + dx * t[i];
    const c2x = pts[i + 1].x - dx;
    const c2y = pts[i + 1].y - dx * t[i + 1];
    d += ` C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}
