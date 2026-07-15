// Comparison time-series chart. Honest by construction:
//   • same-unit series share one raw axis;
//   • mixed-unit series default to an INDEXED view (all series = 100 at the first common
//     period) so a trend comparison never implies comparable levels;
//   • dual-axis is offered only when exactly two unit groups are present and the analyst opts
//     in, and both axes are labelled.
// Missing periods are gaps, never zeros. Copper marks the focused series.

import { useRef, useState } from "react";
import type { PeriodType } from "../../lib/types";
import {
  type ChartMode,
} from "../../lib/useCompare";
import { alignedAxis, baseIndexKey, type CompareSeries, FOCUS_COLOR, pointAt, unitGroups } from "../../lib/compare";
import { fmtPct, fmtPp, fmtShare, fmtUnits, fmtUnitsCompact } from "../../lib/format";

const RANGES: Record<PeriodType, { label: string; n: number }[]> = {
  month: [
    { label: "12M", n: 12 },
    { label: "24M", n: 24 },
    { label: "All", n: Infinity },
  ],
  quarter: [
    { label: "8Q", n: 8 },
    { label: "16Q", n: 16 },
    { label: "All", n: Infinity },
  ],
  year: [
    { label: "5Y", n: 5 },
    { label: "10Y", n: 10 },
    { label: "All", n: Infinity },
  ],
};

function freqWord(f: string): string {
  return f === "month" ? "monthly" : f === "quarter" ? "quarterly" : "yearly";
}
function ppClass(v: number | null): string {
  return v == null ? "flat" : v > 0.0005 ? "pos" : v < -0.0005 ? "neg" : "flat";
}

interface Plot {
  s: CompareSeries;
  color: string;
  vals: (number | null)[]; // aligned to window keys
  side: "left" | "right";
}

export function CompareChart({
  series,
  freq,
  mode,
  setMode,
  rangeIdx,
  setRangeIdx,
  focusedId,
  onFocus,
  colorOf,
}: {
  series: CompareSeries[];
  freq: PeriodType;
  mode: ChartMode;
  setMode: (m: ChartMode) => void;
  rangeIdx: number;
  setRangeIdx: (i: number) => void;
  focusedId: string | null;
  colorOf: (s: CompareSeries) => string;
  onFocus: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const groups = unitGroups(series);
  const dualPossible = groups.length === 2;
  // Resolve the effective mode against what's valid for the current series set.
  const effMode: ChartMode =
    mode === "dual" && dualPossible ? "dual" : groups.length > 1 ? "indexed" : mode === "indexed" ? "indexed" : "raw";

  const ranges = RANGES[freq];
  const ri = Math.min(rangeIdx, ranges.length - 1);
  const full = alignedAxis(series, freq);
  const take = ranges[ri].n;
  const keys = take === Infinity ? full.keys : full.keys.slice(-take);
  const labels = take === Infinity ? full.labels : full.labels.slice(-take);
  const n = keys.length;

  const controls = (
    <div className="cmp-chart-controls">
      <div className="seg mini" role="group" aria-label="Comparison mode">
        <button
          className={effMode === "raw" ? "active" : ""}
          disabled={groups.length > 1}
          title={groups.length > 1 ? "Raw levels need a single unit — series here use different units" : "Plot raw values"}
          onClick={() => setMode("raw")}
        >
          Raw
        </button>
        <button className={effMode === "indexed" ? "active" : ""} onClick={() => setMode("indexed")} title="Index all series to 100 at the first common period">
          Indexed
        </button>
        <button
          className={effMode === "dual" ? "active" : ""}
          disabled={!dualPossible}
          title={dualPossible ? "Two labelled axes, one per unit group" : "Dual axis needs exactly two unit groups"}
          onClick={() => setMode("dual")}
        >
          Dual axis
        </button>
      </div>
      <div className="seg mini" role="group" aria-label="Range">
        {ranges.map((r, i) => (
          <button key={r.label} className={ri === i ? "active" : ""} onClick={() => setRangeIdx(i)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (n < 2) {
    return (
      <div className="cmp-chart">
        {controls}
        <div className="cmp-chart-empty">
          These series do not have a common comparable period. Adjust the date range or frequency.
        </div>
      </div>
    );
  }

  // indexed base — the first visible period where EVERY series has a value
  const baseKey = effMode === "indexed" ? baseIndexKey(series, freq, keys) : null;
  const baseLabel = baseKey ? labels[keys.indexOf(baseKey)] : "";
  if (effMode === "indexed" && !baseKey) {
    return (
      <div className="cmp-chart">
        {controls}
        <div className="cmp-chart-empty">
          These series do not have a common comparable period. Adjust the date range or frequency.
        </div>
      </div>
    );
  }

  const plots: Plot[] = series.map((s) => {
    const raw = keys.map((k) => pointAt(s, freq, k)?.value ?? null);
    let vals = raw;
    if (effMode === "indexed") {
      const base = baseKey ? pointAt(s, freq, baseKey)?.value ?? null : null;
      vals = raw.map((v) => (v != null && base != null && base !== 0 ? (v / base) * 100 : null));
    }
    const side: "left" | "right" = effMode === "dual" && s.unitGroup === groups[1] ? "right" : "left";
    return { s, color: colorOf(s), vals, side };
  });

  // axis domains
  const leftVals = plots.filter((p) => p.side === "left").flatMap((p) => p.vals.filter((v): v is number => v != null));
  const rightVals = plots.filter((p) => p.side === "right").flatMap((p) => p.vals.filter((v): v is number => v != null));
  const dom = (vals: number[], forceZero = false): [number, number] => {
    if (!vals.length) return [0, 1];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (forceZero) lo = Math.min(lo, 0);
    const pad = (hi - lo) * 0.14 || Math.abs(hi) * 0.1 || 1;
    return [lo - pad, hi + pad];
  };
  const leftDom = dom(leftVals);
  const rightDom = dom(rightVals);

  const W = 680;
  const H = 248;
  const padL = 56;
  const padR = effMode === "dual" ? 62 : 150;
  const padT = 18;
  const padB = 46;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const yOf = (v: number, side: "left" | "right") => {
    const [lo, hi] = side === "right" ? rightDom : leftDom;
    return padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  };

  const leftUnit = effMode === "indexed" ? "Index" : groups.includes("volume") && effMode !== "dual" ? "units" : plotUnit(groups, "left", effMode);
  const rightUnit = effMode === "dual" ? plotUnit(groups, "right", effMode) : "";
  const leftIsShare = effMode !== "indexed" && leftUnit === "%";
  const fmtLeftTick = (v: number) =>
    effMode === "indexed" ? v.toFixed(0) : leftIsShare ? (v * 100).toFixed(0) + "%" : fmtUnitsCompact(v);
  const fmtRightTick = (v: number) => (rightUnit === "%" ? (v * 100).toFixed(0) + "%" : fmtUnitsCompact(v));

  const ticks = 4;
  const leftTicks = Array.from({ length: ticks + 1 }, (_, i) => leftDom[0] + ((leftDom[1] - leftDom[0]) * i) / ticks);
  const rightTicks = Array.from({ length: ticks + 1 }, (_, i) => rightDom[0] + ((rightDom[1] - rightDom[0]) * i) / ticks);

  const step = n <= 10 ? 1 : Math.ceil(n / 8);
  const xIdxs = labels.map((_, i) => i).filter((i) => i % step === 0);
  if (xIdxs[xIdxs.length - 1] !== n - 1) {
    if (n - 1 - xIdxs[xIdxs.length - 1] < step) xIdxs[xIdxs.length - 1] = n - 1;
    else xIdxs.push(n - 1);
  }

  const focusPlot = plots.find((p) => p.s.id === focusedId) ?? null;

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
    setTip({ x: relX, y: relY, w: rect.width, h: rect.height });
  };
  const onLeave = () => {
    setHoverIdx(null);
    setTip(null);
  };

  // final-value labels (single-axis modes only), nudged apart to avoid overlap
  const labelY = new Map<string, number>();
  if (effMode !== "dual") {
    const anchors = plots
      .map((p) => {
        for (let i = p.vals.length - 1; i >= 0; i--) if (p.vals[i] != null) return { id: p.s.id, baseY: yOf(p.vals[i]!, "left") };
        return null;
      })
      .filter((a): a is { id: string; baseY: number } => a !== null)
      .sort((a, b) => a.baseY - b.baseY);
    let prev = -Infinity;
    for (const a of anchors) {
      const adj = Math.min(H - padB - 2, Math.max(padT + 6, Math.max(a.baseY, prev + 13)));
      labelY.set(a.id, adj);
      prev = adj;
    }
  }

  // tooltip series = focused, else the one nearest the cursor at the hovered index
  const tipPlot = focusPlot;
  const tipCap =
    hoverIdx != null && tipPlot ? pointAt(tipPlot.s, freq, keys[hoverIdx]) : null;
  let tipStyle: React.CSSProperties | undefined;
  if (tip && tipCap) {
    const left = tip.x > tip.w * 0.6 ? tip.x - 184 : tip.x + 16;
    const top = Math.max(4, Math.min(tip.h - 150, tip.y - 20));
    tipStyle = { left, top };
  }

  return (
    <div className="cmp-chart">
      {controls}
      {effMode === "indexed" && <div className="cmp-chart-note">Indexed to 100 at {baseLabel}</div>}
      <div className="trend">
        <div
          ref={wrapRef}
          className="trend-plot"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          style={{ cursor: "crosshair" }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="comparison trend">
            {/* left grid + ticks */}
            {leftTicks.map((tv, i) => (
              <g key={`l${i}`}>
                <line x1={padL} x2={W - padR} y1={yOf(tv, "left")} y2={yOf(tv, "left")} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
                <text x={padL - 8} y={yOf(tv, "left") + 3} textAnchor="end" fontSize={10} style={{ fill: "var(--chart-axis)" }}>
                  {fmtLeftTick(tv)}
                </text>
              </g>
            ))}
            <text
              transform={`translate(14 ${padT + (H - padT - padB) / 2}) rotate(-90)`}
              textAnchor="middle"
              fontSize={10}
              style={{ fill: "var(--chart-axis)" }}
            >
              {effMode === "indexed" ? "Index (100 = base)" : leftUnit === "%" ? "Share (%)" : "Volume (units)"}
            </text>

            {/* right axis (dual only) */}
            {effMode === "dual" &&
              rightTicks.map((tv, i) => (
                <text key={`r${i}`} x={W - padR + 8} y={yOf(tv, "right") + 3} textAnchor="start" fontSize={10} style={{ fill: "var(--chart-axis)" }}>
                  {fmtRightTick(tv)}
                </text>
              ))}
            {effMode === "dual" && (
              <text
                transform={`translate(${W - 12} ${padT + (H - padT - padB) / 2}) rotate(90)`}
                textAnchor="middle"
                fontSize={10}
                style={{ fill: "var(--chart-axis)" }}
              >
                {rightUnit === "%" ? "Share (%)" : "Volume (units)"}
              </text>
            )}

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
            {plots.map((p) => {
              const isFocus = p.s.id === focusedId;
              const dim = focusedId != null && !isFocus;
              const stroke = isFocus ? FOCUS_COLOR : p.color;
              const segs = segments(p.vals, x, (v) => yOf(v, p.side));
              const li = lastIdx(p.vals);
              return (
                <g key={p.s.id} className="tline" style={{ opacity: dim ? 0.26 : 1 }} onClick={() => onFocus(p.s.id)}>
                  {segs.map((d, i) => (
                    <path
                      key={i}
                      className="tpath"
                      d={d}
                      fill="none"
                      style={{ stroke, cursor: "pointer" }}
                      strokeWidth={isFocus ? 2.6 : 1.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {hoverIdx != null && p.vals[hoverIdx] != null && (
                    <circle cx={x(hoverIdx)} cy={yOf(p.vals[hoverIdx]!, p.side)} r={isFocus ? 4 : 2.6} style={{ fill: stroke }} />
                  )}
                  {effMode !== "dual" && li >= 0 && (
                    <text
                      className="tlabel"
                      x={x(li) + 8}
                      y={(labelY.get(p.s.id) ?? yOf(p.vals[li]!, p.side)) + 3}
                      fontSize={10.5}
                      fontWeight={isFocus ? 600 : 500}
                      style={{ fill: stroke }}
                    >
                      {p.s.display} {effMode === "indexed" ? p.vals[li]!.toFixed(0) : p.s.unitGroup === "share" ? fmtShare(p.vals[li]) : fmtUnitsCompact(p.vals[li]!)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {tipStyle && tipCap && tipPlot && (
            <div className="trend-tip" style={tipStyle}>
              <div className="tt-name">{tipPlot.s.display}</div>
              <div className="tt-period">
                {tipPlot.s.metricLabel} · {labels[hoverIdx!]}
              </div>
              <div className="tt-row">
                <span>Value</span>
                <b>{tipPlot.s.unitGroup === "share" ? fmtShare(tipCap.value) : fmtUnits(tipCap.value)}</b>
              </div>
              {tipCap.yoy != null && (
                <div className="tt-row">
                  <span>YoY</span>
                  <b className={ppClass(tipCap.yoy)}>{fmtPct(tipCap.yoy)}</b>
                </div>
              )}
              {tipCap.chg != null && (
                <div className="tt-row">
                  <span>vs last year</span>
                  <b className={ppClass(tipCap.chg)}>{fmtPp(tipCap.chg)}</b>
                </div>
              )}
              <div className="tt-row">
                <span>Source</span>
                <b>{tipPlot.s.source}</b>
              </div>
              {tipPlot.s.nativeFrequency !== freq && (
                <div className="tt-cover">Reported {freqWord(tipPlot.s.nativeFrequency)} · shown {freqWord(freq)}</div>
              )}
            </div>
          )}
        </div>
      </div>
      {!focusPlot && <div className="cmp-chart-hint">Click a line or a series chip to focus it.</div>}
    </div>
  );
}

function plotUnit(groups: ("volume" | "share")[], side: "left" | "right", mode: ChartMode): string {
  if (mode === "dual") {
    const g = side === "right" ? groups[1] : groups[0];
    return g === "share" ? "%" : "units";
  }
  return groups[0] === "share" ? "%" : "units";
}

function lastIdx(vals: (number | null)[]): number {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i;
  return -1;
}

function segments(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  vals.forEach((v, i) => {
    if (v == null) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
    } else {
      cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}
