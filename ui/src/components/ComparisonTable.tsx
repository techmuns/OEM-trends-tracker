// The primary analytical object: OEM × (current vs prior-year) with YoY, share, share-change.
// Sticky OEM column + sticky header. Values are precomputed; this only selects and formats.

import { useRef } from "react";
import { deltaDir, Delta, RevisedBadge } from "./ui";
import { fmtPct, fmtPp, fmtShare, fmtUnits, shortName } from "../lib/format";
import type { TableRow } from "../lib/view";
import type { CompareSeries } from "../lib/compare";
import { DragHandle } from "../lib/dragfx";

export type DisplayMode = "both" | "absolute" | "yoy";

// Optional drag-to-compare wiring. Rows drag the page's active metric; the value/share column
// headers drag that metric for the selected (or leading) company. Purely additive — omitted
// everywhere the table is used outside the Compare feature.
export interface TableCompare {
  rowMake: (company: string) => CompareSeries | null;
  valueMake?: () => CompareSeries | null; // value column header → volume metric for selected/leader
  shareMake?: () => CompareSeries | null; // share column header → share metric for selected/leader
  add: (s: CompareSeries) => void;
}

function Num({ n }: { n: number | null }) {
  return n === null ? <span className="dash">—</span> : <>{fmtUnits(n)}</>;
}

export function ComparisonTable({
  rows,
  total,
  curLabel,
  priorLabel,
  mode,
  selected,
  expanded,
  onSelect,
  onHover,
  compare,
}: {
  rows: TableRow[];
  total: TableRow | null;
  curLabel: string;
  priorLabel: string;
  mode: DisplayMode;
  selected?: string;
  expanded?: boolean;
  onSelect: (company: string) => void;
  onHover?: (company: string | null) => void;
  compare?: TableCompare;
}) {
  const showPrior = mode !== "yoy";
  const showYoY = mode !== "absolute";
  const showChg = mode !== "absolute";
  const interactive = !!onHover;

  // Scroll-driven selection: while the interactive table is scrolled, the OEM row sitting just
  // below the sticky header becomes the selection, so scrolling the supporting table scrubs the
  // hero chart through the OEMs. rAF-throttled and no-ops when the top row hasn't changed.
  const wrapRef = useRef<HTMLDivElement>(null);
  const selRef = useRef(selected);
  selRef.current = selected;
  const rafPending = useRef(false);
  const onScroll = () => {
    if (!interactive || rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      const el = wrapRef.current;
      if (!el) return;
      const headH = el.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const anchorY = el.getBoundingClientRect().top + headH + 2;
      const trs = el.querySelectorAll<HTMLTableRowElement>("tbody tr[data-company]");
      for (const tr of trs) {
        const rect = tr.getBoundingClientRect();
        if (rect.top <= anchorY && rect.bottom > anchorY) {
          const c = tr.dataset.company;
          if (c && c !== selRef.current) onSelect(c);
          break;
        }
      }
    });
  };

  const render = (r: TableRow, isTotal = false) => (
    <tr
      key={r.company}
      data-company={isTotal ? undefined : r.company}
      className={isTotal ? "total" : selected === r.company ? "sel" : undefined}
      onClick={() => !isTotal && onSelect(r.company)}
      onMouseEnter={interactive && !isTotal ? () => onHover!(r.company) : undefined}
      onMouseLeave={interactive ? () => onHover!(null) : undefined}
    >
      <td className="oem">
        {selected === r.company && !isTotal ? <span className="oem-star">★</span> : ""}
        {isTotal ? "TOTAL / REPORTED UNIVERSE" : shortName(r.company)}{" "}
        {r.revised && <RevisedBadge />}
        {compare && !isTotal && (
          <DragHandle
            build={() => compare.rowMake(r.company)}
            onAdd={compare.add}
            label={shortName(r.company)}
            className="row-grip"
          />
        )}
      </td>
      <td>
        <Num n={r.cur} />
      </td>
      {showPrior && (
        <td>
          <Num n={r.prior} />
        </td>
      )}
      {showYoY && (
        <td>{r.yoy === null ? <span className="dash">—</span> : <Delta text={fmtPct(r.yoy)} dir={deltaDir(r.yoy)} />}</td>
      )}
      <td>{r.share === null ? <span className="dash">—</span> : fmtShare(r.share)}</td>
      {showChg && (
        <td>{r.chg === null ? <span className="dash">—</span> : <Delta text={fmtPp(r.chg)} dir={deltaDir(r.chg)} />}</td>
      )}
    </tr>
  );

  return (
    <div
      ref={wrapRef}
      onScroll={onScroll}
      className={`tbl-wrap ${expanded ? "expanded" : ""} ${interactive ? "interactive" : ""}`}
    >
      <table>
        <thead>
          <tr>
            <th className="oem" scope="col">
              OEM
            </th>
            <th scope="col">
              {curLabel}
              {compare?.valueMake && (
                <DragHandle build={compare.valueMake} onAdd={compare.add} label="value column" className="col-grip" />
              )}
            </th>
            {showPrior && <th scope="col">{priorLabel}</th>}
            {showYoY && <th scope="col">YoY</th>}
            <th scope="col">
              {curLabel} Share
              {compare?.shareMake && (
                <DragHandle build={compare.shareMake} onAdd={compare.add} label="share column" className="col-grip" />
              )}
            </th>
            {showChg && <th scope="col">Share Δ (pp)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => render(r))}
          {total && render(total, true)}
        </tbody>
      </table>
    </div>
  );
}
