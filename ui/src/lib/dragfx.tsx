// Native HTML5 drag-and-drop helpers for the Compare Workspace — no drag library, in keeping
// with the app's zero-runtime-dependency ethos. The dragged payload is held in a module ref
// (dataTransfer is write-only during dragover) and mirrored into dataTransfer text for the
// drop. A small window-event pulse lets the Compare dock tab light up as a drop target while
// a drag is in flight — without opening anything until a real drop or click.

import type { CompareSeries } from "./compare";

let CURRENT: CompareSeries | null = null;

export function currentDrag(): CompareSeries | null {
  return CURRENT;
}

export const DRAG_START = "compare-dragstart";
export const DRAG_END = "compare-dragend";

// Build a compact, on-theme drag preview: "TVS · Export volume" / "Two-Wheelers · units · Monthly".
function freqWord(f: string): string {
  return f === "month" ? "Monthly" : f === "quarter" ? "Quarterly" : "Yearly";
}

function makeGhost(s: CompareSeries): HTMLElement {
  const el = document.createElement("div");
  el.className = "cmp-drag-ghost";
  const l1 = document.createElement("div");
  l1.className = "cmp-drag-ghost-1";
  l1.textContent = `${s.display} · ${s.metricLabel}`;
  const l2 = document.createElement("div");
  l2.className = "cmp-drag-ghost-2";
  l2.textContent = `${s.categoryLabel} · ${s.unit} · ${freqWord(s.nativeFrequency)}`;
  el.appendChild(l1);
  el.appendChild(l2);
  // off-screen so the real element isn't shown as the drag image
  el.style.position = "fixed";
  el.style.top = "-1000px";
  el.style.left = "-1000px";
  document.body.appendChild(el);
  return el;
}

// Spread onto any element to make it a Compare drag source. `build` is called lazily on
// drag-start so we only snapshot the (potentially large) series when a drag actually begins.
export function dragProps(build: () => CompareSeries | null) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const s = build();
      if (!s) {
        e.preventDefault();
        return;
      }
      CURRENT = s;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", `${s.display} · ${s.metricLabel}`);
      const ghost = makeGhost(s);
      try {
        e.dataTransfer.setDragImage(ghost, 14, 16);
      } catch {
        /* setDragImage unsupported — fall back to the default preview */
      }
      // remove the ghost after the browser has snapshotted it
      window.setTimeout(() => ghost.remove(), 0);
      window.dispatchEvent(new CustomEvent(DRAG_START));
    },
    onDragEnd: () => {
      CURRENT = null;
      window.dispatchEvent(new CustomEvent(DRAG_END));
    },
  };
}

// A subtle grip that appears on hover and starts a drag; clicking it adds the series directly
// (keyboard/pointer accessible "Add to Compare"). Stops propagation so it never triggers the
// underlying row's select/lock behaviour.
export function DragHandle({
  build,
  onAdd,
  label,
  className,
}: {
  build: () => CompareSeries | null;
  onAdd?: (s: CompareSeries) => void;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`cmp-grip ${className ?? ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Add ${label} to Compare`}
      title={`Drag to compare, or click to add · ${label}`}
      {...dragProps(build)}
      onClick={(e) => {
        e.stopPropagation();
        const s = build();
        if (s && onAdd) onAdd(s);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          const s = build();
          if (s && onAdd) onAdd(s);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
        <circle cx="3" cy="3" r="1.1" />
        <circle cx="7" cy="3" r="1.1" />
        <circle cx="3" cy="7" r="1.1" />
        <circle cx="7" cy="7" r="1.1" />
        <circle cx="3" cy="11" r="1.1" />
        <circle cx="7" cy="11" r="1.1" />
      </svg>
    </span>
  );
}
