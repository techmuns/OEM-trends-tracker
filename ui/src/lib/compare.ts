// Compare Workspace model — a self-contained snapshot layer over the precomputed
// view-models. A dragged item captures its FULL time-series (all reported frequencies) at
// drop time, so the Compare Workspace keeps working while the analyst moves between pages
// and categories. No business math is invented here: values / yoy / share / pp-change are
// read straight from the bundle, exactly like the rest of the UI. Missing stays missing —
// never zero, never interpolated.

import type { Flow, PeriodType, Powertrain, ViewModel } from "./types";
import { getSeries, priorKey } from "./view";
import { shortName } from "./format";

export type MetricKey =
  | "sales"
  | "exports"
  | "production"
  | "ev_volume"
  | "market_share"
  | "ev_share"
  | "ev_penetration";

// Two honest axes: absolute volumes (units) and shares (%). Percentage-point CHANGES are
// never plotted as a series — they live in tooltips / the table only.
export type UnitGroup = "volume" | "share";

export interface MetricDef {
  label: string; // "Sales volume"
  short: string; // "Sales"
  unit: string; // "units" | "%"
  group: UnitGroup;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  sales: { label: "Sales volume", short: "Sales", unit: "units", group: "volume" },
  exports: { label: "Export volume", short: "Exports", unit: "units", group: "volume" },
  production: { label: "Production volume", short: "Production", unit: "units", group: "volume" },
  ev_volume: { label: "EV volume", short: "EV", unit: "units", group: "volume" },
  market_share: { label: "Market share", short: "Share", unit: "%", group: "share" },
  ev_share: { label: "EV-universe share", short: "EV share", unit: "%", group: "share" },
  ev_penetration: { label: "EV penetration", short: "EV penetration", unit: "%", group: "share" },
};

// (flow, powertrain) source for company-level metrics. ev_penetration is industry-level and
// read from the precomputed penetration map instead.
const FLOW_PW: Partial<Record<MetricKey, [Flow, Powertrain]>> = {
  sales: ["domestic", "all"],
  exports: ["export", "all"],
  production: ["production", "all"],
  ev_volume: ["domestic", "ev"],
  market_share: ["domestic", "all"],
  ev_share: ["domestic", "ev"],
};

export interface CapPoint {
  key: string;
  label: string;
  date: string;
  value: number | null; // the PLOTTED metric (volume for volume-group, share fraction for share-group)
  abs: number | null; // absolute volume (tooltip / table)
  share: number | null; // share fraction (tooltip / table)
  yoy: number | null; // YoY growth fraction (volume metrics)
  chg: number | null; // share change vs same period last year, in pp (share metrics)
}

export interface CompareSeries {
  id: string;
  category: string; // "2W"
  categoryLabel: string; // "Two-Wheelers"
  company: string; // canonical company key, or industry total label / "Industry"
  display: string; // short display name, or "Industry"
  isIndustry: boolean;
  metric: MetricKey;
  metricLabel: string; // "Sales volume"
  unit: string; // "units" | "%"
  unitGroup: UnitGroup;
  source: string; // "SIAM"
  universeLabel: string; // reported-universe wording, preserved verbatim
  metricDefinition: string; // one-line definition for the source drawer
  nativeFrequency: PeriodType; // the frequency this series is genuinely reported at
  frequencies: PeriodType[]; // frequencies that actually carry data
  lastUpdated: string; // meta.generated_at
  coverageStart: string; // first reported period (native frequency)
  coverageEnd: string; // latest reported period (native frequency)
  data: Partial<Record<PeriodType, CapPoint[]>>;
}

// Meaning-led series palette: purple (primary), green (positive), yellow (attention),
// red (decline), grey (neutral), then brighter variants. The focused series is violet
// (applied at render time, never stored here).
export const SERIES_COLORS = [
  "var(--chart-1)", // purple
  "var(--chart-2)", // green
  "var(--chart-3)", // yellow
  "var(--chart-4)", // red
  "var(--chart-neutral)", // grey
  "var(--purple-strong)",
  "var(--green-bright)",
  "var(--yellow-bright)",
];
export const FOCUS_COLOR = "var(--chart-focus)"; // violet

export const MAX_SERIES = 8;
export const WARN_SERIES = 6;

// Stable identity: the same company+metric from the same category is one series.
export function dedupeKey(s: Pick<CompareSeries, "category" | "company" | "metric">): string {
  return `${s.category}|${s.company}|${s.metric}`;
}

let SEQ = 0;

function metricUniverse(view: ViewModel, metric: MetricKey): string {
  if (metric === "ev_share" || metric === "ev_penetration") return "Share within reported EV universe";
  if (metric === "market_share") return view.meta.share_caveat; // "Share within reported SIAM universe"
  if (metric === "exports") return `${view.meta.source} wholesale dispatches (exports)`;
  if (metric === "production") return "Source-reported quarterly production";
  return `${view.meta.source} wholesale dispatches (domestic)`;
}

function metricDefinition(metric: MetricKey): string {
  switch (metric) {
    case "sales":
      return "Wholesale dispatches (domestic), all powertrains.";
    case "exports":
      return "Wholesale export dispatches, all powertrains.";
    case "production":
      return "Source-reported production volume. Not derived from monthly figures.";
    case "ev_volume":
      return "Electric wholesale dispatches (domestic).";
    case "market_share":
      return "OEM share of domestic dispatches within the reported universe.";
    case "ev_share":
      return "OEM share within the reported EV universe.";
    case "ev_penetration":
      return "EV volume as a share of the total reported universe.";
  }
}

// Is this metric genuinely reported for this category? Production is featured only where the
// source reports it natively (Commercial Vehicles, quarterly) — mirrors the Production page's
// own honesty gate; EV metrics only where the source carries an EV block.
export function metricAvailable(view: ViewModel, metric: MetricKey): boolean {
  const m = view.meta;
  if (metric === "production") return m.has_production && m.native_frequency === "quarter";
  if (metric === "ev_volume" || metric === "ev_share" || metric === "ev_penetration") return m.has_ev;
  return true; // sales / exports / market_share exist for every category
}

// Short reason a metric can't be added for the current category (drop-rejection copy).
export function unavailableReason(view: ViewModel, metric: MetricKey): string {
  const cat = view.meta.category_label;
  if (metric === "production")
    return `Production is unavailable for ${cat} in the current source. It is source-reported only for Commercial Vehicles (quarterly).`;
  return `${METRICS[metric].label} is unavailable for the selected category and source.`;
}

function capture(view: ViewModel, company: string, metric: MetricKey, pt: PeriodType): CapPoint[] {
  const axis = view.periods[pt] ?? [];
  if (metric === "ev_penetration") {
    const pen = view.ev_penetration["domestic"]?.[pt] ?? {};
    return axis.map((p) => {
      const cur = pen[p.key] ?? null;
      const yv = pen[priorKey(pt, p.key)] ?? null;
      return {
        key: p.key,
        label: p.label,
        date: p.date,
        value: cur,
        abs: null,
        share: cur,
        yoy: null,
        chg: cur != null && yv != null ? cur - yv : null,
      };
    });
  }
  const [flow, pw] = FLOW_PW[metric]!;
  const s = getSeries(view, company, flow, pw, pt);
  const isShare = metric === "market_share" || metric === "ev_share";
  return axis.map((p) => {
    const pnt = s?.points[p.key];
    const abs = pnt?.v ?? null;
    const share = pnt?.share ?? null;
    return {
      key: p.key,
      label: p.label,
      date: p.date,
      value: isShare ? share : abs,
      abs,
      share,
      yoy: pnt?.yoy ?? null,
      chg: pnt?.chg ?? null,
    };
  });
}

// Capture a full series snapshot from the currently-loaded view-model. Returns null when the
// metric is unsupported for the category or the company simply has no data for it.
export function buildSeries(view: ViewModel, company: string, metric: MetricKey): CompareSeries | null {
  if (!metricAvailable(view, metric)) return null;
  const def = METRICS[metric];
  const totalLabel = view.meta.industry_total_label;
  const isIndustry = metric === "ev_penetration" || company === totalLabel || company === "Industry";
  // ev_penetration is industry-only; volume/share totals read from the total series.
  const sourceCompany = metric === "ev_penetration" ? company : isIndustry ? totalLabel : company;

  const allPts: PeriodType[] = (["month", "quarter", "year"] as PeriodType[]).filter(
    (pt) => (view.periods[pt]?.length ?? 0) > 0,
  );
  const data: Partial<Record<PeriodType, CapPoint[]>> = {};
  const frequencies: PeriodType[] = [];
  for (const pt of allPts) {
    const caps = capture(view, sourceCompany, metric, pt);
    if (caps.some((c) => c.value != null)) {
      data[pt] = caps;
      frequencies.push(pt);
    }
  }
  if (!frequencies.length) return null;

  const nat = view.meta.native_frequency;
  const nativeFrequency = frequencies.includes(nat) ? nat : frequencies[frequencies.length - 1];
  const defined = (data[nativeFrequency] ?? []).filter((c) => c.value != null);
  const coverageStart = defined[0]?.date ?? view.meta.coverage_start;
  const coverageEnd = defined[defined.length - 1]?.date ?? view.meta.latest_period;

  return {
    id: `cs_${++SEQ}`,
    category: view.meta.category,
    categoryLabel: view.meta.category_label,
    company: isIndustry ? "Industry" : company,
    display: isIndustry ? "Industry" : shortName(company),
    isIndustry,
    metric,
    metricLabel: def.label,
    unit: def.unit,
    unitGroup: def.group,
    source: view.meta.source,
    universeLabel: metricUniverse(view, metric),
    metricDefinition: metricDefinition(metric),
    nativeFrequency,
    frequencies,
    lastUpdated: view.meta.generated_at,
    coverageStart,
    coverageEnd,
    data,
  };
}

// --- alignment / axis helpers (COMPARISON LOGIC §7, PERIOD & FREQUENCY §11) ---

export function unitGroups(series: CompareSeries[]): UnitGroup[] {
  const set = new Set<UnitGroup>();
  for (const s of series) set.add(s.unitGroup);
  return [...set];
}

// Frequencies common to EVERY active series — the only ones we can align honestly.
export function commonFrequencies(series: CompareSeries[]): PeriodType[] {
  const order: PeriodType[] = ["month", "quarter", "year"];
  if (!series.length) return order;
  return order.filter((pt) => series.every((s) => s.frequencies.includes(pt)));
}

export interface AlignedAxis {
  keys: string[];
  labels: string[];
  dates: string[];
}

// Union of period keys across the active series at a frequency, ordered oldest→newest.
// A series that starts later simply contributes nulls before its first period (a gap in the
// line) — we do not fabricate values.
export function alignedAxis(series: CompareSeries[], freq: PeriodType): AlignedAxis {
  const seen = new Map<string, { label: string; date: string }>();
  for (const s of series) {
    for (const c of s.data[freq] ?? []) {
      if (!seen.has(c.key)) seen.set(c.key, { label: c.label, date: c.date });
    }
  }
  const entries = [...seen.entries()].sort((a, b) => a[1].date.localeCompare(b[1].date));
  return {
    keys: entries.map((e) => e[0]),
    labels: entries.map((e) => e[1].label),
    dates: entries.map((e) => e[1].date),
  };
}

export function pointAt(s: CompareSeries, freq: PeriodType, key: string): CapPoint | undefined {
  return (s.data[freq] ?? []).find((c) => c.key === key);
}

// First axis period where EVERY series has a value — the honest base for indexed comparison.
export function baseIndexKey(series: CompareSeries[], freq: PeriodType, keys: string[]): string | null {
  for (const k of keys) {
    if (series.every((s) => pointAt(s, freq, k)?.value != null)) return k;
  }
  return null;
}
