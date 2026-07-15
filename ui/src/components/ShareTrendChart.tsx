// Interactive market-share trend (Sales tab only). Inline SVG + HTML tooltip overlay.
// Hover inspects a period (crosshair + tooltip + enlarged active point); hovering a line,
// legend item, or (via props) a table row focuses that OEM — champagne gold + thicker
// stroke, all other lines fade to 30%. Click a line/legend locks focus; Reset restores the
// Top-OEMs view. Only subtle 120-160ms opacity/stroke transitions — no shadows or motion.

import { useRef, useState } from "react";
import { fmtPp, fmtShare } from "../lib/format";

// Focus/highlight colour is theme-driven (light: primary blue, dark: pale blue). SVG
// presentation attributes don't resolve CSS var() reliably, so theme colours are applied
// via inline `style` throughout this component.
const FOCUS = "var(--chart-focus)";

export interface TrendPoint {
  label: string; // period label, e.g. "Jan '26" / "FY24"
  value: number | null; // share (fraction)
  prevChg: number | null; // pp vs previous period (fraction)
  yoyChg: number | null; // pp vs same period last year (fraction)
}
export interface TrendLine {
  name: string; // canonical company
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
  yLabel = "Market share (%)",
  onLock,
}: {
  lines: TrendLine[];
  focusName: string | null; // external focus (e.g. table-row hover)
  lockedName: string | null; // locked OEM (single-focus)
  showYoY: boolean; // false for Yearly (prev period == last year)
  yLabel?: string;
  onLock: (name: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [plotHover, setPlotHover] = useState<string | null>(null); // nearest line under cursor
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const W = 664;
  const H = 226;
  const padL = 58;
  const padR = 150;
  const padT = 18;
  const padB = 46;

  const labels = lines[0]?.points.map((p) => p.label) ?? [];
  const n = labels.length;
  const vals = lines.flatMap((l) => l.points.map((p) => p.value).filter((v): v is number => v !== null));
  if (n < 2 || !vals.length) return <div className="chart-hint">Not enough data to plot.</div>;

  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const pad = (max - min) * 0.15 || Math.abs(max) * 0.1 || 0.01;
  min = Math.max(0, min - pad);
  max += pad;

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
  const MIN_GAP = 13;
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
    const top = Math.max(4, Math.min(tip.h - 96, tip.y - 20));
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
              <text x={padL - 10} y={y(tv) + 3} textAnchor="end" fontSize={10} style={{ fill: "var(--chart-axis)" }}>
                {(tv * 100).toFixed(0)}%
              </text>
            </g>
          ))}
          {/* y axis label */}
          <text
            transform={`translate(15 ${padT + (H - padT - padB) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={10}
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
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize={10}
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
                    strokeWidth={isFocus ? 2.6 : 1.6}
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
                    <circle cx={x(li)} cy={y(l.points[li].value!)} r={isFocus ? 3.2 : 2.6} style={{ fill: stroke }} />
                    <text
                      className="tlabel"
                      x={x(li) + 8}
                      y={(latestY.get(l.name) ?? y(l.points[li].value!)) + 3}
                      fontSize={10.5}
                      fontWeight={isFocus ? 600 : 500}
                      style={{ fill: stroke }}
                    >
                      {l.display} {fmtShare(l.points[li].value)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* enlarged active point */}
          {hoverIdx != null && focusLine && focusLine.points[hoverIdx]?.value != null && (
            <>
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

        {/* tooltip */}
        {tipStyle && tipPoint && (
          <div className="trend-tip" style={tipStyle}>
            <div className="tt-name">{focusLine!.display}</div>
            <div className="tt-period">{labels[hoverIdx!]}</div>
            <div className="tt-row">
              <span>Market share</span>
              <b>{fmtShare(tipPoint.value)}</b>
            </div>
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
              className={`tleg ${isFocus ? "on" : ""} ${effFocus && !isFocus ? "off" : ""}`}
              onMouseEnter={() => setLegendHover(l.name)}
              onMouseLeave={() => setLegendHover(null)}
              onClick={() => onLock(l.name)}
              title={`Focus ${l.display}`}
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
  const segs: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
    } else {
      cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    }
  });
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}
