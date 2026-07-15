// Source & coverage integrity for the comparison. Every series keeps its source, metric
// definition, reported universe, frequency, last-updated and coverage — visible in a compact,
// expandable drawer. When series span multiple sources (or multiple reported universes) the
// analyst is warned before comparing levels. Universe wording is preserved verbatim.

import { useState } from "react";
import type { CompareSeries } from "../../lib/compare";
import { monthYear } from "../../lib/format";

function freqWord(f: string): string {
  return f === "month" ? "Monthly" : f === "quarter" ? "Quarterly" : "Yearly";
}

export function CompareSourceDrawer({ series }: { series: CompareSeries[] }) {
  const [open, setOpen] = useState(false);
  if (!series.length) return null;

  const sources = [...new Set(series.map((s) => s.source))];
  const universes = [...new Set(series.map((s) => s.universeLabel))];
  const categories = [...new Set(series.map((s) => s.categoryLabel))];
  const multi = sources.length > 1 || universes.length > 1 || categories.length > 1;

  return (
    <div className={`cmp-source ${open ? "open" : ""}`}>
      <button className="cmp-source-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="cmp-source-caret">{open ? "▾" : "▸"}</span>
        Source &amp; coverage
        <span className="cmp-source-count">{series.length}</span>
        {multi && <span className="cmp-source-flag">multiple sources</span>}
      </button>

      {multi && (
        <div className="cmp-source-warn">
          Comparison contains multiple sources. Review definitions before interpreting levels.
        </div>
      )}

      {open && (
        <div className="cmp-source-list">
          {series.map((s) => (
            <div className="cmp-source-item" key={s.id}>
              <div className="cmp-source-head">
                <b>{s.display}</b> · {s.metricLabel}
                <span className="cmp-source-cat">{s.categoryLabel}</span>
              </div>
              <div className="cmp-source-grid">
                <div>
                  <dt>Source</dt>
                  <dd>{s.source}</dd>
                </div>
                <div>
                  <dt>Definition</dt>
                  <dd>{s.metricDefinition}</dd>
                </div>
                <div>
                  <dt>Reported universe</dt>
                  <dd>{s.universeLabel}</dd>
                </div>
                <div>
                  <dt>Frequency</dt>
                  <dd>{freqWord(s.nativeFrequency)}</dd>
                </div>
                <div>
                  <dt>Coverage</dt>
                  <dd>
                    {monthYear(s.coverageStart)} – {monthYear(s.coverageEnd)}
                  </dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{new Date(s.lastUpdated).toLocaleString("en-GB")}</dd>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
