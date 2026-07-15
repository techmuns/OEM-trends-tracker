// The Compare dock tab in the shared header. Closed and unobtrusive by default; shows a count
// badge once series exist. While a drag is in flight it presents itself as a drop target
// (soft-blue fill, copper outline, "Drop to compare") — but it never opens on hover, only on a
// real drop or a deliberate click.

import { useState } from "react";
import { useCompare } from "../../lib/useCompare";
import { currentDrag } from "../../lib/dragfx";

export function CompareDockTab() {
  const c = useCompare();
  const [over, setOver] = useState(false);
  const count = c.series.length;

  return (
    <button
      className={`cmp-dock ${c.dragging ? "dragging" : ""} ${over ? "over" : ""} ${c.isOpen && !c.expanded ? "open" : ""}`}
      onClick={() => (c.isOpen ? c.close() : c.open())}
      onDragOver={(e) => {
        if (!currentDrag()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const s = currentDrag();
        if (!s) return;
        e.preventDefault();
        c.add(s); // add() also opens the workspace
      }}
      title={c.dragging ? "Drop to compare" : c.isOpen ? "Collapse the Compare Workspace" : "Open the Compare Workspace"}
      aria-label="Compare"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" />
      </svg>
      <span className="cmp-dock-label">{c.dragging ? "Drop to compare" : "Compare"}</span>
      {count > 0 && !c.dragging && <span className="cmp-dock-badge">{count}</span>}
    </button>
  );
}
