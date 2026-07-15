// Split layout for the analysis workspace (left) and the docked Compare Workspace (right),
// with a draggable divider. Minimum widths keep both sides usable. When expanded, the compare
// pane takes the whole area while the analysis pane stays mounted (hidden) so collapsing back
// restores it with all its local state intact. When closed, only the analysis pane renders.

import { useRef } from "react";
import type { ReactNode } from "react";

const MIN_PX = 360;

export function ResizableSplitPane({
  left,
  right,
  open,
  expanded,
  ratio,
  onRatio,
}: {
  left: ReactNode;
  right: ReactNode;
  open: boolean;
  expanded: boolean;
  ratio: number; // analysis-pane fraction
  onRatio: (r: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onDown = (e: React.PointerEvent) => {
    if (!ref.current) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add("cmp-resizing");
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging.current || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const minR = MIN_PX / rect.width;
    const maxR = 1 - minR;
    const r = (e.clientX - rect.left) / rect.width;
    onRatio(Math.max(minR, Math.min(maxR, r)));
  };
  const onUp = (e: React.PointerEvent) => {
    dragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    document.body.classList.remove("cmp-resizing");
  };

  const showSplit = open && !expanded;

  return (
    <div
      className={`cmp-split ${open ? "open" : "closed"} ${expanded ? "expanded" : ""}`}
      ref={ref}
      style={{ ["--cmp-ratio"]: ratio } as React.CSSProperties}
    >
      <div className="cmp-pane cmp-pane-analysis" aria-hidden={open && expanded ? true : undefined}>
        {left}
      </div>

      {showSplit && (
        <div
          className="cmp-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the Compare Workspace"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onDoubleClick={() => onRatio(0.6)}
          title="Drag to resize · double-click to reset"
        >
          <span className="cmp-divider-grip" />
        </div>
      )}

      {open && <div className="cmp-pane cmp-pane-compare">{right}</div>}
    </div>
  );
}
