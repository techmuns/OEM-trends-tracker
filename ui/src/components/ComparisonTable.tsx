// The primary analytical object: OEM × (current vs prior-year) with YoY, share, share-change.
// Sticky OEM column + sticky header. Values are precomputed; this only selects and formats.

import { deltaDir, Delta, RevisedBadge } from "./ui";
import { fmtPct, fmtPp, fmtShare, fmtUnits } from "../lib/format";
import type { TableRow } from "../lib/view";

export type DisplayMode = "both" | "absolute" | "yoy";

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
  onSelect,
}: {
  rows: TableRow[];
  total: TableRow | null;
  curLabel: string;
  priorLabel: string;
  mode: DisplayMode;
  selected?: string;
  onSelect: (company: string) => void;
}) {
  const showPrior = mode !== "yoy";
  const showYoY = mode !== "absolute";
  const showChg = mode !== "absolute";

  const render = (r: TableRow, isTotal = false) => (
    <tr key={r.company} className={isTotal ? "total" : selected === r.company ? "sel" : undefined}>
      <td className="oem" onClick={() => !isTotal && onSelect(r.company)}>
        {selected === r.company && !isTotal ? "★ " : ""}
        {isTotal ? "TOTAL / REPORTED UNIVERSE" : r.company}{" "}
        {r.revised && <RevisedBadge />}
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
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th className="oem" scope="col">
              OEM
            </th>
            <th scope="col">{curLabel}</th>
            {showPrior && <th scope="col">{priorLabel}</th>}
            {showYoY && <th scope="col">YoY</th>}
            <th scope="col">{curLabel} Share</th>
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
