// The docked Compare Workspace: header (title + active count, view selector, expand/restore,
// collapse, clear) over a body of series chips, a frequency aligner, the chart/table/split
// views, and the source drawer. It is self-contained — it renders entirely from the captured
// series snapshots, so it keeps working across page and category switches.

import type { PeriodType } from "../../lib/types";
import {
  commonFrequencies,
  type CompareSeries,
  FOCUS_COLOR,
  SERIES_COLORS,
} from "../../lib/compare";
import { useCompare, type ViewMode } from "../../lib/useCompare";
import { ComparisonSeriesChip } from "./ComparisonSeriesChip";
import { CompareChart } from "./CompareChart";
import { CompareTable } from "./CompareTable";
import { CompareDropZone } from "./CompareDropZone";
import { CompareSourceDrawer } from "./CompareSourceDrawer";

const FREQ_LABEL: Record<PeriodType, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };

export function DockedCompareWorkspace() {
  const c = useCompare();
  const { series } = c;

  // stable colour per series (order-based); focused series is copper
  const colorFor = new Map<string, string>();
  series.forEach((s, i) => colorFor.set(s.id, SERIES_COLORS[i % SERIES_COLORS.length]));
  const colorOf = (s: CompareSeries) => (s.id === c.focusedId ? FOCUS_COLOR : colorFor.get(s.id) ?? SERIES_COLORS[0]);

  const common = commonFrequencies(series);
  const effFreq: PeriodType = common.includes(c.freqPref) ? c.freqPref : common[0] ?? "year";
  const forced = series.length > 0 && effFreq !== c.freqPref;

  const views: { id: ViewMode; label: string }[] = [
    { id: "chart", label: "Chart" },
    { id: "table", label: "Table" },
    { id: "split", label: "Split" },
  ];

  return (
    <div className="cmp-ws">
      <header className="cmp-ws-head">
        <div className="cmp-ws-title">
          <span className="cmp-ws-name">Compare Workspace</span>
          <span className="cmp-ws-count">
            {series.length} {series.length === 1 ? "series" : "series"}
          </span>
        </div>
        <div className="cmp-ws-actions">
          <div className="seg mini" role="group" aria-label="Workspace view">
            {views.map((v) => (
              <button key={v.id} className={c.viewMode === v.id ? "active" : ""} onClick={() => c.setViewMode(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <button
            className="btn sm"
            onClick={() => c.setExpanded(!c.expanded)}
            title={c.expanded ? "Return to the split view" : "Expand to the full workspace"}
          >
            {c.expanded ? "⤢ Restore split" : "⤢ Expand"}
          </button>
          <button className="btn sm icon" onClick={() => c.close()} title="Collapse — contents are kept" aria-label="Collapse workspace">
            ⤬
          </button>
          <button
            className="btn sm"
            onClick={() => c.clear()}
            disabled={!series.length}
            title="Remove all comparison series"
          >
            Clear all
          </button>
        </div>
      </header>

      {c.notice && <div className={`cmp-notice ${c.notice.tone}`}>{c.notice.text}</div>}

      <div className="cmp-ws-body">
        {series.length === 0 ? (
          <CompareDropZone mode="empty" active={c.dragging} onAdd={c.add} />
        ) : (
          <>
            <div className="cmp-chips" role="list" aria-label="Comparison series">
              {series.map((s) => (
                <ComparisonSeriesChip
                  key={s.id}
                  series={s}
                  color={colorOf(s)}
                  focused={c.focusedId === s.id}
                  onFocus={() => c.focus(c.focusedId === s.id ? null : s.id)}
                  onRemove={() => c.remove(s.id)}
                  onReorder={c.reorder}
                />
              ))}
            </div>

            <div className="cmp-align">
              <span className="cmp-align-label">Frequency</span>
              <div className="seg mini" role="group" aria-label="Comparison frequency">
                {(["month", "quarter", "year"] as PeriodType[]).map((f) => (
                  <button
                    key={f}
                    className={effFreq === f ? "active" : ""}
                    disabled={!common.includes(f)}
                    title={common.includes(f) ? FREQ_LABEL[f] : "Not reported by every selected series"}
                    onClick={() => c.setFreqPref(f)}
                  >
                    {FREQ_LABEL[f]}
                  </button>
                ))}
              </div>
              {forced && (
                <span className="cmp-align-note">
                  Aligned to {FREQ_LABEL[effFreq]} — not every series reports {FREQ_LABEL[c.freqPref].toLowerCase()}.
                </span>
              )}
            </div>

            <div className={`cmp-views ${c.viewMode}`}>
              {(c.viewMode === "chart" || c.viewMode === "split") && (
                <CompareChart
                  series={series}
                  freq={effFreq}
                  mode={c.chartMode}
                  setMode={c.setChartMode}
                  rangeIdx={c.rangeIdx}
                  setRangeIdx={c.setRangeIdx}
                  focusedId={c.focusedId}
                  onFocus={(id) => c.focus(id)}
                  colorOf={colorOf}
                />
              )}
              {(c.viewMode === "table" || c.viewMode === "split") && (
                <CompareTable
                  series={series}
                  freq={effFreq}
                  focusedId={c.focusedId}
                  colorOf={colorOf}
                  onFocus={(id) => c.focus(id)}
                />
              )}
            </div>

            <CompareSourceDrawer series={series} />

            <CompareDropZone mode="overlay" active={c.dragging} onAdd={c.add} />
          </>
        )}
      </div>
    </div>
  );
}
