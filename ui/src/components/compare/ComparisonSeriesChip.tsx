// A comparison series, as a removable chip. Company/industry · metric · unit · source, with
// a remove action and a reorder grip. Copper marks the focused series; the swatch otherwise
// carries the series' restrained-blue line colour. Reordering uses a private dataTransfer
// type so it can never be mistaken for an add-to-compare drop.

import { useState } from "react";
import type { CompareSeries } from "../../lib/compare";

const REORDER = "application/x-cmp-reorder";

export function ComparisonSeriesChip({
  series,
  color,
  focused,
  onFocus,
  onRemove,
  onReorder,
}: {
  series: CompareSeries;
  color: string;
  focused: boolean;
  onFocus: () => void;
  onRemove: () => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`cmp-chip ${focused ? "on" : ""} ${over ? "over" : ""}`}
      onClick={onFocus}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(REORDER)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const from = e.dataTransfer.getData(REORDER);
        if (from) {
          e.preventDefault();
          onReorder(from, series.id);
        }
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onFocus())}
      aria-pressed={focused}
      title={`${series.display} · ${series.metricLabel} — click to focus`}
    >
      <span
        className="cmp-chip-grip"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(REORDER, series.id);
        }}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        aria-hidden="true"
      >
        <svg width="8" height="12" viewBox="0 0 8 12">
          <circle cx="2" cy="2" r="1" />
          <circle cx="6" cy="2" r="1" />
          <circle cx="2" cy="6" r="1" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="2" cy="10" r="1" />
          <circle cx="6" cy="10" r="1" />
        </svg>
      </span>
      <span className="cmp-chip-swatch" style={{ background: color }} />
      <span className="cmp-chip-text">
        <b>{series.display}</b>
        <span className="cmp-chip-metric">{series.metricLabel}</span>
      </span>
      <span className="cmp-chip-meta">
        {series.unit} · {series.source} · {series.categoryLabel}
      </span>
      <button
        className="cmp-chip-x"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title={`Remove ${series.display} · ${series.metricLabel}`}
        aria-label={`Remove ${series.display} ${series.metricLabel}`}
      >
        ×
      </button>
    </div>
  );
}
