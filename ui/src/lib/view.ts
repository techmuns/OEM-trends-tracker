// Data-SELECTION helpers over the precomputed view-model. No business math:
// values/yoy/share/chg are read straight from the bundle; here we only pick series,
// resolve prior-year period keys, and assemble table rows from precomputed points.

import type { Flow, Period, PeriodType, Point, Powertrain, Series, ViewModel } from "./types";

export function priorKey(periodType: PeriodType, key: string): string {
  if (periodType === "month") {
    const [y, m] = key.split("-");
    return `${Number(y) - 1}-${m}`;
  }
  if (periodType === "quarter") {
    // QnFYyy -> QnFY(yy-1)
    return `${key.slice(0, 4)}${String(Number(key.slice(4)) - 1).padStart(2, "0")}`;
  }
  return `FY${String(Number(key.slice(2)) - 1).padStart(2, "0")}`; // FYyy
}

export function getSeries(
  v: ViewModel,
  company: string,
  flow: Flow,
  powertrain: Powertrain,
  periodType: PeriodType,
): Series | undefined {
  return v.series.find(
    (s) =>
      s.company === company &&
      s.flow === flow &&
      s.powertrain === powertrain &&
      s.period_type === periodType,
  );
}

export interface TableRow {
  company: string;
  cur: number | null;
  prior: number | null;
  yoy: number | null;
  share: number | null;
  chg: number | null;
  partial: boolean;
  revised: boolean;
  isTotal: boolean;
}

// Assemble the OEM comparison table for a selected (flow, powertrain, periodType, period).
// Companies that don't exist before their first appearance simply have no point -> nulls.
export function buildTable(
  v: ViewModel,
  opts: {
    flow: Flow;
    powertrain: Powertrain;
    periodType: PeriodType;
    periodKey: string;
    companies?: string[];
    totalLabel: string;
  },
): { rows: TableRow[]; total: TableRow | null } {
  const { flow, powertrain, periodType, periodKey } = opts;
  const pk = priorKey(periodType, periodKey);
  const wanted = opts.companies && opts.companies.length ? new Set(opts.companies) : null;

  const rows: TableRow[] = [];
  for (const s of v.series) {
    if (s.flow !== flow || s.powertrain !== powertrain || s.period_type !== periodType) continue;
    if (s.company === opts.totalLabel) continue;
    if (wanted && !wanted.has(s.company)) continue;
    const cur = s.points[periodKey];
    const prior = s.points[pk];
    // skip companies with no data at all for this period (ragged / not present)
    if (!cur && !prior) continue;
    rows.push(rowFrom(s.company, cur, prior, false));
  }
  rows.sort((a, b) => (b.cur ?? -Infinity) - (a.cur ?? -Infinity));

  const totalSeries = getSeries(v, opts.totalLabel, flow, powertrain, periodType);
  const total = totalSeries
    ? rowFrom(opts.totalLabel, totalSeries.points[periodKey], totalSeries.points[pk], true)
    : null;
  return { rows, total };
}

function rowFrom(
  company: string,
  cur: Point | undefined,
  prior: Point | undefined,
  isTotal: boolean,
): TableRow {
  return {
    company,
    cur: cur?.v ?? null,
    // The matched-elapsed prior stored on the CURRENT point pairs with its yoy (QTD-vs-QTD for a
    // partial period). Fall back to the prior period's own value only when there is no current
    // point (e.g. a company that has since exited).
    prior: cur?.prior ?? prior?.v ?? null,
    yoy: cur?.yoy ?? null,
    share: cur?.share ?? null,
    chg: cur?.chg ?? null,
    partial: cur?.partial ?? false,
    revised: cur?.revised ?? false,
    isTotal,
  };
}

// Points of a series across the given period axis (for charts), oldest -> newest.
export function seriesPoints(
  s: Series | undefined,
  axis: Period[],
): { key: string; label: string; point: Point | undefined }[] {
  if (!s) return [];
  return axis.map((p) => ({ key: p.key, label: p.label, point: s.points[p.key] }));
}
