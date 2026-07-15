// Drop targets inside the Compare Workspace. Two shapes:
//   • "empty"   — the first-run panel inviting a drag;
//   • "overlay" — a soft-blue / copper-outlined insertion surface shown over a populated
//                 workspace while a compatible drag is in flight.
// Both read the in-flight payload from the drag module; a chip-reorder drag (which sets no
// payload) is ignored, so reordering never lands here.

import { useState } from "react";
import type { CompareSeries } from "../../lib/compare";
import { currentDrag } from "../../lib/dragfx";

export function CompareDropZone({
  mode,
  active,
  onAdd,
}: {
  mode: "empty" | "overlay";
  active: boolean; // a compare drag is in flight
  onAdd: (s: CompareSeries) => void;
}) {
  const [over, setOver] = useState(false);

  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!currentDrag()) return; // ignore reorder / foreign drags
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const s = currentDrag();
      if (!s) return;
      e.preventDefault();
      onAdd(s);
    },
  };

  if (mode === "overlay") {
    if (!active) return null;
    return (
      <div className={`cmp-drop-overlay ${over ? "over" : ""}`} {...handlers}>
        <div className="cmp-drop-overlay-inner">
          <CompareGlyph />
          Drop to add to comparison
        </div>
      </div>
    );
  }

  return (
    <div className={`cmp-empty ${over ? "over" : ""}`} {...handlers}>
      <CompareGlyph large />
      <div className="cmp-empty-title">Drag companies, metrics or KPI cards here to compare.</div>
      <div className="cmp-empty-sub">Compare data from Sales, EV, Exports and supported Production views.</div>
    </div>
  );
}

function CompareGlyph({ large }: { large?: boolean }) {
  const s = large ? 30 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" />
    </svg>
  );
}
