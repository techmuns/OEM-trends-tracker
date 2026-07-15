// Table view of the comparison — current vs prior-year for every series, with absolute and
// percentage change, plus the source and coverage that make the numbers legible. Values are
// formatted by their own unit (units vs %); share deltas are shown honestly in percentage
// points. Missing comparison periods render as an em dash, never zero.

import type { PeriodType } from "../../lib/types";
import { type CompareSeries, pointAt } from "../../lib/compare";
import { priorKey } from "../../lib/view";
import { fmtPct, fmtPp, fmtShare, fmtUnits } from "../../lib/format";
import { deltaDir, Delta } from "../ui";

function lastDefinedKey(s: CompareSeries, freq: PeriodType): string | null {
  const pts = s.data[freq] ?? [];
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i].value != null) return pts[i].key;
  return null;
}

function freqWord(f: string): string {
  return f === "month" ? "Monthly" : f === "quarter" ? "Quarterly" : "Yearly";
}

export function CompareTable({
  series,
  freq,
  focusedId,
  colorOf,
  onFocus,
}: {
  series: CompareSeries[];
  freq: PeriodType;
  focusedId: string | null;
  colorOf: (s: CompareSeries) => string;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th className="cmp-t-name" scope="col">
              Series
            </th>
            <th scope="col">Metric</th>
            <th scope="col">Current</th>
            <th scope="col">Value</th>
            <th scope="col">Compare</th>
            <th scope="col">Value</th>
            <th scope="col">Abs Δ</th>
            <th scope="col">% Δ</th>
            <th scope="col">Source</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const isVol = s.unitGroup === "volume";
            const curKey = lastDefinedKey(s, freq);
            const cur = curKey ? pointAt(s, freq, curKey) : undefined;
            const cmpKey = curKey ? priorKey(freq, curKey) : null;
            const cmp = cmpKey ? pointAt(s, freq, cmpKey) : undefined;
            const cv = cur?.value ?? null;
            const pv = cmp?.value ?? null;
            const absDelta = cv != null && pv != null ? cv - pv : null;
            const pctDelta = cv != null && pv != null && pv !== 0 ? cv / pv - 1 : null;
            const fmtVal = (v: number | null) => (v == null ? "—" : isVol ? fmtUnits(v) : fmtShare(v));
            return (
              <tr
                key={s.id}
                className={focusedId === s.id ? "on" : undefined}
                onClick={() => onFocus(s.id)}
                title="Focus this series"
              >
                <td className="cmp-t-name">
                  <span className="cmp-t-swatch" style={{ background: colorOf(s) }} />
                  {s.display}
                </td>
                <td className="cmp-t-metric">
                  {s.metricLabel}
                  <span className="cmp-t-cat">{s.categoryLabel}</span>
                </td>
                <td className="cmp-t-per">{cur ? cur.label : "—"}</td>
                <td>{fmtVal(cv)}</td>
                <td className="cmp-t-per">{cmp ? cmp.label : "—"}</td>
                <td>{fmtVal(pv)}</td>
                <td>
                  {absDelta == null ? (
                    <span className="dash">—</span>
                  ) : isVol ? (
                    <Delta text={fmtUnits(absDelta)} dir={deltaDir(absDelta)} />
                  ) : (
                    <Delta text={fmtPp(absDelta)} dir={deltaDir(absDelta)} />
                  )}
                </td>
                <td>
                  {pctDelta == null ? (
                    <span className="dash">—</span>
                  ) : (
                    <Delta text={fmtPct(pctDelta)} dir={deltaDir(pctDelta)} />
                  )}
                </td>
                <td className="cmp-t-src">{s.source}</td>
                <td className="cmp-t-cov">{freqWord(freq)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cmp-table-foot">
        {series.some((s) => s.unitGroup === "share") && (
          <span>Share Δ shown in percentage points; % Δ is the relative change. </span>
        )}
        Compared period is the same period one year earlier.
      </div>
    </div>
  );
}
