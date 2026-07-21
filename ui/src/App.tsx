import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useBundle, useManifest } from "./lib/useBundle";
import { useHostContext, useSnapshotMode } from "./lib/host";
import type { CategoryInfo, Flow, Period, PeriodType, Point, Powertrain, ViewModel } from "./lib/types";
import { buildTable, getSeries, priorKey, type TableRow } from "./lib/view";
import { fmtPct, fmtPp, fmtShare, fmtUnits, fmtUnitsCompact, monthYear, shortName } from "./lib/format";
import { ComparisonTable, type DisplayMode, type TableCompare } from "./components/ComparisonTable";
import { ShareTrendChart, type LegendCompare, type TrendLine, type TrendPoint, type ValueKind } from "./components/ShareTrendChart";
import { buildSeries, type MetricKey } from "./lib/compare";
import { CompareProvider, useCompare } from "./lib/useCompare";
import { DragHandle } from "./lib/dragfx";
import { CompareDockTab } from "./components/compare/CompareDockTab";
import { DockedCompareWorkspace } from "./components/compare/DockedCompareWorkspace";
import { ResizableSplitPane } from "./components/compare/ResizableSplitPane";
import { UploadPanel } from "./components/UploadPanel";
import { DataCoveragePanel, coverageStats } from "./components/DataCoveragePanel";
import {
  Delta,
  deltaDir,
  Empty,
  ErrorState,
  IconBars,
  IconBolt,
  IconDoc,
  IconFactory,
  IconGrowth,
  IconMoon,
  IconSun,
  IconTrendDown,
  IconTrendUp,
  Loading,
  PartialBadge,
  Unavailable,
  WidgetCard,
} from "./components/ui";

// --- theme (dark/light toggle) ---
type ThemeName = "dark" | "light";
const THEME_KEY = "oem-tracker-theme";
function getInitialTheme(): ThemeName {
  return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}
function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage disabled (private mode): the theme still applies for this session */
  }
}
// Applied once at module load (before first paint) so there's no dark→light flash on reload.
applyTheme(getInitialTheme());

// View Transitions API — present in Chromium/Safari, absent in Firefox. Typed locally (and
// reached via an `unknown` cast) so the build never depends on the DOM lib shipping it.
interface ViewTransitionDoc {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);
  // Keep <html data-theme> + storage in sync for the initial mount and the no-animation path.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggleTheme() {
    const next: ThemeName = theme === "dark" ? "light" : "dark";
    const startViewTransition = (document as unknown as ViewTransitionDoc).startViewTransition;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // No View Transitions support, or the user prefers reduced motion → swap instantly.
    if (typeof startViewTransition !== "function" || reduceMotion) {
      setTheme(next);
      return;
    }

    // Animated path: snapshot the page, swap the theme inside the callback so the incoming
    // theme is captured, then a CSS clip-path wipes the new snapshot across the old one from
    // left to right (see the "THEME WIPE" block in styles.css).
    const root = document.documentElement;
    root.classList.add("theme-vt");
    const transition = startViewTransition.call(document, () => {
      applyTheme(next); // <html data-theme> swap — painted into the "new" snapshot
      flushSync(() => setTheme(next)); // sync-render so the sun/moon icon swaps in the same frame
    });
    transition.finished.finally(() => root.classList.remove("theme-vt"));
  }

  return (
    <button
      className="btn icon"
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label="Toggle light / dark theme"
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

type Tab = "sales" | "ev" | "prod";

// Series colours are theme tokens (resolved from CSS custom properties). Green/red stay
// reserved for deltas. EV = brighter blue accent, ICE = muted blue-grey.
const EV_LINE = "var(--ev)";
const ICE_LINE = "var(--ice)";
// Distinct default line colours by rank: primary blue, secondary blue, muted slate.
const RANK_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

// Measurement basis is DERIVED from the source, so a VAHAN view reads "registrations"
// everywhere a SIAM view reads "wholesale dispatches" — the two are never conflated.
const BASIS_LABEL: Record<string, string> = {
  SIAM: "wholesale dispatches",
  VAHAN: "registrations",
  BROKER: "broker estimates",
  MANUAL: "manual entries",
};
const basisOf = (view: ViewModel): string => BASIS_LABEL[view.meta.source] ?? "reported volumes";
const isRegs = (view: ViewModel): boolean => view.meta.source === "VAHAN";
// The primary-metric noun: SIAM = "Sales", VAHAN = "Registrations".
const flowNoun = (view: ViewModel): string => (isRegs(view) ? "Registrations" : "Sales");
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// The category switcher groups its options by source so it always reads "which dataset is
// this?" — a SIAM (dispatches) view and a VAHAN (registrations) view are never a flat,
// look-alike list. `basisFor`/`sourceHeader` name the group; `optionLabel` keeps each entry
// short because the group header already carries the source + basis.
const basisFor = (source: string): string => BASIS_LABEL[source] ?? "reported volumes";
const SOURCE_ORDER = ["SIAM", "VAHAN", "BROKER", "MANUAL"];
const sourceHeader = (source: string): string => `${source} · ${cap(basisFor(source))}`;
const VAHAN_SHORT: Record<string, string> = {
  VAHAN: "All vehicles",
  VAHAN2W: "Two-Wheelers (2W)",
  VAHANPV: "Passenger (PV)",
  VAHAN3W: "Three-Wheelers (3W)",
  VAHANCV: "Commercial (CV)",
};
const optionLabel = (c: CategoryInfo): string =>
  c.source === "VAHAN" ? (VAHAN_SHORT[c.key] ?? c.label.replace(/\s*·\s*VAHAN$/i, "")) : c.label;

export function App() {
  // Compare state lives ABOVE the category loader so the workspace survives category and page
  // switches within a session.
  return (
    <CompareProvider>
      <AppInner />
    </CompareProvider>
  );
}

function AppInner() {
  const manifest = useManifest();
  if (manifest.status === "loading")
    return (
      <Shell>
        <Loading rows={6} />
      </Shell>
    );
  if (manifest.status === "error")
    return (
      <Shell>
        <ErrorState onRetry={() => location.reload()} />
      </Shell>
    );
  return <CategorizedApp categories={manifest.data.categories} />;
}

// Owns the selected category, fetches that category's view-model, and keeps the category
// switch visible in the header even while a view is loading or errored.
function CategorizedApp({ categories }: { categories: CategoryInfo[] }) {
  const [cat, setCat] = useQuery("cat", categories[0]?.key ?? "2W");
  const active = categories.find((c) => c.key === cat) ?? categories[0];
  const load = useBundle(active?.key ?? "2W");
  const picker = <CategorySelect categories={categories} value={active?.key ?? ""} onChange={setCat} />;
  if (load.status === "loading")
    return (
      <Shell right={picker}>
        <Loading rows={6} />
      </Shell>
    );
  if (load.status === "error")
    return (
      <Shell right={picker}>
        <ErrorState onRetry={() => location.reload()} />
      </Shell>
    );
  return <Dashboard view={load.data} categories={categories} cat={active.key} setCat={setCat} />;
}

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: CategoryInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Group by source (SIAM, VAHAN, …), preserving a sensible source order. With a single
  // source there's nothing to disambiguate, so render a plain list.
  const bySource = new Map<string, CategoryInfo[]>();
  for (const c of categories) bySource.set(c.source, [...(bySource.get(c.source) ?? []), c]);
  const sources = [...bySource.keys()].sort(
    (a, b) => ((SOURCE_ORDER.indexOf(a) + 1 || 99) - (SOURCE_ORDER.indexOf(b) + 1 || 99)),
  );
  const grouped = sources.length > 1;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Dataset — pick a SIAM (dispatches) or VAHAN (registrations) view"
      aria-label="Dataset (source and vehicle category)"
      disabled={categories.length <= 1}
    >
      {grouped
        ? sources.map((s) => (
            <optgroup key={s} label={sourceHeader(s)}>
              {bySource.get(s)!.map((c) => (
                <option key={c.key} value={c.key}>
                  {optionLabel(c)}
                </option>
              ))}
            </optgroup>
          ))
        : categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
    </select>
  );
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="zone1">
        <span className="title">OEM Tracker</span>
        <div className="header-right">
          {right}
          <ThemeToggle />
        </div>
      </header>
      <main className="zone2">{children}</main>
    </div>
  );
}

// --- URL-synced state ---
function useQuery<T extends string>(key: string, def: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => (new URLSearchParams(location.search).get(key) as T) || def);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (val === def) q.delete(key);
    else q.set(key, val);
    history.replaceState(null, "", `${location.pathname}?${q.toString()}`.replace(/\?$/, ""));
  }, [key, val, def]);
  return [val, setVal];
}

const METRIC_FOR_TAB: Record<Tab, string> = { sales: "sales", ev: "ev", prod: "exports" };
const TAB_FOR_METRIC: Record<string, Tab> = { sales: "sales", ev: "ev", exports: "prod" };

function Dashboard({
  view,
  categories,
  cat,
  setCat,
}: {
  view: ViewModel;
  categories: CategoryInfo[];
  cat: string;
  setCat: (v: string) => void;
}) {
  const host = useHostContext();
  const snapshot = useSnapshotMode();
  const compare = useCompare();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const cov = coverageStats(categories);
  const [tab, setTab] = useQuery<Tab>("tab", "sales");
  const [rawPt, setPt] = useQuery<PeriodType>("pt", "month");
  const [mode, setMode] = useQuery<DisplayMode>("mode", "both");
  // Only offer granularities the category actually has (CV is quarterly-native → no month
  // level). Fall back to the native frequency when the requested one is unavailable.
  const PTS: PeriodType[] = ["month", "quarter", "year"];
  const availablePts = PTS.filter((k) => (view.periods[k]?.length ?? 0) > 0);
  const pt = availablePts.includes(rawPt)
    ? rawPt
    : availablePts.includes(view.meta.native_frequency)
      ? view.meta.native_frequency
      : availablePts[0];
  const axis = view.periods[pt];
  const [periodKey, setPeriodKey] = useQuery("period", axis[axis.length - 1]?.key ?? "");
  const [oem, setOem] = useQuery("oem", host.oem ?? "");

  // clamp selected period to the available axis for this period type
  const period = axis.find((p) => p.key === periodKey) ?? axis[axis.length - 1];
  useEffect(() => {
    if (period && period.key !== periodKey) setPeriodKey(period.key);
  }, [period, periodKey, setPeriodKey]);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "sales", label: `${flowNoun(view)} & Market Share`, icon: <IconBars /> },
    { id: "ev", label: "EV vs ICE", icon: <IconBolt /> },
    { id: "prod", label: "Production & Exports", icon: <IconFactory /> },
  ];

  return (
    <div className={`shell ${snapshot ? "snapshot" : ""}`}>
      <header className="zone1">
        <button
          className="title as-home"
          onClick={compare.goHome}
          title="Back to dashboard home"
          aria-label="OEM Tracker — back to home"
        >
          OEM Tracker
        </button>
        <div className="header-right">
          {host.selectedTicker && (
            <span className="ticker-pill" title="From host ticker">
              {host.selectedTicker}
              {host.oem ? ` · ${shortName(host.oem)}` : ""}
            </span>
          )}
          <span
            className="source-pill"
            data-source={view.meta.source}
            title={`You're viewing ${view.meta.source} ${basisOf(view)} — switch datasets in the dropdown to the right`}
          >
            <b>{view.meta.source}</b>
            <span className="src-basis">{cap(basisOf(view))}</span>
          </span>
          <CategorySelect categories={categories} value={cat} onChange={setCat} />
          <OemSelect view={view} value={oem} onChange={setOem} />
          <div className="seg" role="group" aria-label="Period granularity">
            {availablePts.map((k) => (
              <button key={k} className={pt === k ? "active" : ""} onClick={() => setPt(k)}>
                {k === "month" ? "Monthly" : k === "quarter" ? "Quarterly" : "Yearly"}
              </button>
            ))}
          </div>
          <select
            value={METRIC_FOR_TAB[tab]}
            onChange={(e) => setTab(TAB_FOR_METRIC[e.target.value] ?? "sales")}
            title="Metric"
            aria-label="Metric"
          >
            <option value="sales">{flowNoun(view)}</option>
            <option value="exports" disabled={isRegs(view)}>
              Exports
            </option>
            <option value="ev">EV</option>
          </select>
          <button
            className="btn icon"
            onClick={() => location.reload()}
            title={`Last built ${new Date(view.meta.generated_at).toLocaleString("en-GB")}`}
            aria-label="Refresh"
          >
            ↻
          </button>
          <button
            className={`btn coverage${cov.missing > 0 ? " has-missing" : ""}`}
            onClick={() => setCoverageOpen(true)}
            title={`Data coverage — ${cov.loaded} of ${cov.total} datasets loaded${cov.missing > 0 ? `, ${cov.missing} not in yet` : ""}`}
          >
            ◫ Data {cov.loaded}/{cov.total}
          </button>
          <button
            className="btn accent upload"
            onClick={() => setUploadOpen(true)}
            title="Upload a SIAM or VAHAN source file — pick the category, choose the file(s), done"
          >
            ↥ Upload data file
          </button>
          <button className="btn export accent" onClick={() => window.print()} title="Export current view (print / PDF)">
            ↧ Export
          </button>
          <CompareDockTab />
          <ThemeToggle />
        </div>
      </header>

      <main className="zone2">
        <ResizableSplitPane
          open={compare.isOpen}
          expanded={compare.expanded}
          ratio={compare.ratio}
          onRatio={compare.setRatio}
          left={
            <div className="analysis-inner">
              <div className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={`tab ${tab === t.id ? "active" : ""}`}
                    onClick={() => setTab(t.id)}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              <PeriodChips axis={axis} pt={pt} periodKey={period?.key ?? ""} onChange={setPeriodKey} />

              {tab === "sales" && (
                <SalesTab
                  view={view}
                  pt={pt}
                  period={period}
                  setPeriod={setPeriodKey}
                  mode={mode}
                  setMode={setMode}
                  oem={oem}
                  setOem={setOem}
                />
              )}
              {tab === "ev" && (
                <EvTab
                  view={view}
                  pt={pt}
                  period={period}
                  setPeriod={setPeriodKey}
                  oem={oem}
                  setOem={setOem}
                  mode={mode}
                  setMode={setMode}
                />
              )}
              {tab === "prod" && (
                <ProdTab
                  view={view}
                  pt={pt}
                  period={period}
                  setPeriod={setPeriodKey}
                  oem={oem}
                  setOem={setOem}
                  mode={mode}
                  setMode={setMode}
                />
              )}

              <Provenance view={view} />
            </div>
          }
          right={<DockedCompareWorkspace />}
        />
      </main>
      <UploadPanel open={uploadOpen} categories={categories} onClose={() => setUploadOpen(false)} />
      <DataCoveragePanel
        open={coverageOpen}
        categories={categories}
        onClose={() => setCoverageOpen(false)}
        onUpload={() => setUploadOpen(true)}
      />
    </div>
  );
}

// --- shared small controls ---
function OemSelect({ view, value, onChange }: { view: ViewModel; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="OEM" aria-label="OEM">
      <option value="">All OEMs</option>
      {view.companies.map((c) => (
        <option key={c} value={c}>
          {shortName(c)}
        </option>
      ))}
    </select>
  );
}

const yearOf = (p: Period, pt: PeriodType) => (pt === "year" ? p.label : p.date.slice(0, 4));

// Year chips (design.md §7). Yearly: chips are the period selector. Month/Quarter: chips
// pick the calendar year; the period rail (rendered per tab) picks the exact period.
function PeriodChips({
  axis,
  pt,
  periodKey,
  onChange,
}: {
  axis: Period[];
  pt: PeriodType;
  periodKey: string;
  onChange: (v: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const selected = axis.find((p) => p.key === periodKey) ?? axis[axis.length - 1];

  if (pt === "year") {
    const chips = [...axis].reverse();
    const shown = showAll ? chips : chips.slice(0, 6);
    return (
      <div className="periodnav" role="group" aria-label="Fiscal year">
        {shown.map((p) => (
          <button key={p.key} className={`chip ${p.key === periodKey ? "active" : ""}`} onClick={() => onChange(p.key)}>
            {p.label}
          </button>
        ))}
        {chips.length > 6 && !showAll && (
          <button className="chip ghost" onClick={() => setShowAll(true)}>
            More years
          </button>
        )}
      </div>
    );
  }

  const years = Array.from(new Set(axis.map((p) => yearOf(p, pt)))).sort((a, b) => b.localeCompare(a));
  const activeYear = selected ? yearOf(selected, pt) : years[0];
  const shown = showAll ? years : years.slice(0, 6);
  const selectYear = (y: string) => {
    const inYear = axis.filter((p) => yearOf(p, pt) === y);
    const newest = inYear[inYear.length - 1];
    if (newest) onChange(newest.key);
  };
  return (
    <div className="periodnav" role="group" aria-label="Year">
      {shown.map((y) => (
        <button key={y} className={`chip ${y === activeYear ? "active" : ""}`} onClick={() => selectYear(y)}>
          {y}
        </button>
      ))}
      {years.length > 6 && !showAll && (
        <button className="chip ghost" onClick={() => setShowAll(true)}>
          More years
        </button>
      )}
    </div>
  );
}

// Vertical period rail — part of the content grid (design.md §7). Hidden for Yearly.
function PeriodRail({ axis, pt, periodKey, onChange }: { axis: Period[]; pt: PeriodType; periodKey: string; onChange: (v: string) => void }) {
  const selected = axis.find((p) => p.key === periodKey) ?? axis[axis.length - 1];
  const activeYear = selected ? yearOf(selected, pt) : "";
  const items = axis.filter((p) => yearOf(p, pt) === activeYear).reverse();
  return (
    <nav className="rail" aria-label="Period">
      <div className="rail-title">Period</div>
      {items.map((p) => (
        <button
          key={p.key}
          className={`rail-item ${p.key === periodKey ? "active" : ""}`}
          onClick={() => onChange(p.key)}
          aria-current={p.key === periodKey}
        >
          <span className="rail-dot" />
          {p.label}
        </button>
      ))}
    </nav>
  );
}

function pick(view: ViewModel, company: string, flow: Flow, pw: Powertrain, pt: PeriodType, key: string): Point | undefined {
  return getSeries(view, company, flow, pw, pt)?.points[key];
}

function labelFor(axis: Period[], key: string): string {
  return axis.find((p) => p.key === key)?.label ?? key;
}

// Build enriched trend lines for a (flow, powertrain) series set. Each point carries the
// plotted metric (share or absolute volume) plus absolute volume, share, YoY and pp-changes,
// so the tooltip is identical on every page. `baseNames` fixes rank colours; extra names
// (e.g. a hovered row outside the top N) render as an added focusable line.
function buildTrendLines(
  view: ViewModel,
  names: string[],
  baseNames: string[],
  flow: Flow,
  powertrain: Powertrain,
  pt: PeriodType,
  winAxis: Period[],
  fullAxis: Period[],
  valueKind: ValueKind,
): TrendLine[] {
  return names.map((name) => {
    const rank = baseNames.indexOf(name);
    const color = rank >= 0 ? RANK_COLORS[rank] ?? "var(--chart-3)" : "var(--chart-3)";
    const s = getSeries(view, name, flow, powertrain, pt);
    const points: TrendPoint[] = winAxis.map((p) => {
      const fi = fullAxis.findIndex((a) => a.key === p.key);
      const cur = s?.points[p.key];
      const prev = fi > 0 ? s?.points[fullAxis[fi - 1].key] : undefined;
      const abs = cur?.v ?? null;
      const share = cur?.share ?? null;
      const prevChg = share != null && prev?.share != null ? share - prev.share : null;
      return {
        label: p.label,
        value: valueKind === "share" ? share : abs,
        abs,
        share,
        yoy: cur?.yoy ?? null,
        prevChg,
        yoyChg: cur?.chg ?? null, // precomputed YoY share change (pp)
      };
    });
    return { name, display: shortName(name), color, points };
  });
}

// EV vs ICE penetration lines (EV page default): EV/ICE share of the total reported universe.
function evIceLines(view: ViewModel, totalLabel: string, pt: PeriodType, winAxis: Period[], fullAxis: Period[]): TrendLine[] {
  const pen = (k: string) => view.ev_penetration["domestic"]?.[pt]?.[k] ?? null;
  const evTot = getSeries(view, totalLabel, "domestic", "ev", pt);
  const allTot = getSeries(view, totalLabel, "domestic", "all", pt);
  const build = (isEv: boolean): TrendPoint[] =>
    winAxis.map((p) => {
      const fi = fullAxis.findIndex((a) => a.key === p.key);
      const cp = pen(p.key);
      const pp = fi > 0 ? pen(fullAxis[fi - 1].key) : null;
      const yp = pen(priorKey(pt, p.key));
      const share = cp == null ? null : isEv ? cp : 1 - cp;
      const evv = evTot?.points[p.key]?.v ?? null;
      const allv = allTot?.points[p.key]?.v ?? null;
      const abs = isEv ? evv : allv != null && evv != null ? allv - evv : null;
      const prevShare = pp == null ? null : isEv ? pp : 1 - pp;
      const yShare = yp == null ? null : isEv ? yp : 1 - yp;
      return {
        label: p.label,
        value: share,
        abs,
        share,
        yoy: isEv ? evTot?.points[p.key]?.yoy ?? null : null,
        prevChg: share != null && prevShare != null ? share - prevShare : null,
        yoyChg: share != null && yShare != null ? share - yShare : null,
      };
    });
  return [
    { name: "EV", display: "EV", color: EV_LINE, points: build(true) },
    { name: "ICE", display: "ICE", color: ICE_LINE, points: build(false) },
  ];
}

// Start / latest / total-change summary for a locked series (shown below the chart).
function dirCls(v: number): string {
  return v > 0.0005 ? "pos" : v < -0.0005 ? "neg" : "flat";
}
function focusSummary(line: TrendLine | undefined, valueKind: ValueKind): { label: string; value: string; cls?: string }[] | null {
  if (!line) return null;
  const first = line.points.find((p) => p.value != null)?.value ?? null;
  let last: number | null = null;
  for (let i = line.points.length - 1; i >= 0; i--) {
    if (line.points[i].value != null) {
      last = line.points[i].value!;
      break;
    }
  }
  if (first == null || last == null) return null;
  if (valueKind === "share") {
    const total = last - first;
    return [
      { label: "Start", value: fmtShare(first) },
      { label: "Latest", value: fmtShare(last) },
      { label: "Total change", value: fmtPp(total), cls: dirCls(total) },
    ];
  }
  const growth = first ? last / first - 1 : null;
  return [
    { label: "Start", value: fmtUnitsCompact(first) },
    { label: "Latest", value: fmtUnitsCompact(last) },
    { label: "Total change", value: growth == null ? "—" : fmtPct(growth), cls: growth == null ? undefined : dirCls(growth) },
  ];
}

function trendWindow(pt: PeriodType, idx: number): number {
  const opts = pt === "month" ? [6, 12, 24] : pt === "quarter" ? [8, 12, 16] : [5, 8, 10];
  return opts[Math.min(idx, opts.length - 1)];
}
function rangeLabels(pt: PeriodType): string[] {
  return pt === "month" ? ["6M", "12M", "24M"] : pt === "quarter" ? ["8Q", "12Q", "16Q"] : ["5Y", "8Y", "10Y"];
}

// ---- shared analytical template: [period rail | hero trend chart | supporting table] ----
// Every page (Sales, EV, Production/Exports) renders through this so the three behave like
// different datasets inside one template: identical proportions, row hover→focus, click→lock,
// Reset, tooltip, table view-toggle, range control, source footer and details expansion.
// The trend chart is the dominant hero panel (left); the OEM table is the supporting snapshot
// panel (right). Clicking a table row still locks the chart onto that OEM.
interface TableConfig {
  title: string;
  subtitle?: string;
  rows: TableRow[];
  total: TableRow | null;
  curLabel: string;
  priorLabel: string;
  partial?: { present: number; expected: number };
  unavailable?: React.ReactNode; // render instead of the table (honest coverage message)
  compare?: TableCompare; // drag-to-compare wiring (rows + metric column headers)
}
interface ChartConfig {
  title: string;
  info?: string;
  subtitle?: string;
  footer?: string;
  lines: TrendLine[];
  valueKind: ValueKind;
  yLabel: string;
  showYoY: boolean;
  focusName: string | null;
  lockedName: string | null;
  domain?: [number, number];
  summary?: { label: string; value: string; cls?: string }[] | null;
  hint?: string;
  emptyNote?: React.ReactNode; // render instead of the chart (coverage explanation)
  onLock: (name: string) => void;
  compare?: LegendCompare; // drag-to-compare wiring (chart legend items)
}
function AnalyticalTab({
  axis,
  pt,
  period,
  setPeriod,
  oem,
  setOem,
  mode,
  setMode,
  table,
  chart,
  setHoverOem,
  rangeIdx,
  setRangeIdx,
}: {
  axis: Period[];
  pt: PeriodType;
  period: Period;
  setPeriod: (v: string) => void;
  oem: string;
  setOem: (v: string) => void;
  mode: DisplayMode;
  setMode: (v: DisplayMode) => void;
  table: TableConfig;
  chart: ChartConfig;
  setHoverOem: (v: string | null) => void;
  rangeIdx: number;
  setRangeIdx: (v: number) => void;
}) {
  const norail = pt === "year";

  const tableCard = (
    <WidgetCard
      title={table.title}
      subtitle={table.subtitle}
      right={
        table.unavailable ? undefined : (
          <div className="card-h-actions">
            {table.partial && <PartialBadge present={table.partial.present} expected={table.partial.expected} />}
            <div className="seg mini" role="group" aria-label="Display mode">
              {(["both", "absolute", "yoy"] as DisplayMode[]).map((m) => (
                <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                  {m === "both" ? "Both" : m === "absolute" ? "Absolute" : "YoY"}
                </button>
              ))}
            </div>
          </div>
        )
      }
    >
      {table.unavailable ? (
        table.unavailable
      ) : table.rows.length ? (
        <ComparisonTable
          rows={table.rows}
          total={table.total}
          curLabel={table.curLabel}
          priorLabel={table.priorLabel}
          mode={mode}
          selected={oem}
          onSelect={(c) => setOem(c)}
          onHover={setHoverOem}
          compare={table.compare}
        />
      ) : (
        <Empty onReset={() => setOem("")} />
      )}
    </WidgetCard>
  );

  const chartCard = (
    <WidgetCard
      title={chart.title}
      info={chart.info}
      subtitle={chart.subtitle}
      right={
        <div className="card-h-actions">
          {oem && (
            <button className="btn" onClick={() => setOem("")} title="Clear the selection">
              Reset
            </button>
          )}
          <div className="seg mini" role="group" aria-label="Trend range">
            {rangeLabels(pt).map((lbl, i) => (
              <button key={lbl} className={rangeIdx === i ? "active" : ""} onClick={() => setRangeIdx(i)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      }
      footer={chart.footer}
    >
      {chart.emptyNote ? (
        chart.emptyNote
      ) : chart.lines.some((l) => l.points.some((p) => p.value !== null)) ? (
        <>
          <ShareTrendChart
            lines={chart.lines}
            focusName={chart.focusName}
            lockedName={chart.lockedName}
            valueKind={chart.valueKind}
            yLabel={chart.yLabel}
            domain={chart.domain}
            showYoY={chart.showYoY}
            onLock={chart.onLock}
            compare={chart.compare}
          />
          {chart.summary && (
            <div className="trend-summary">
              {chart.summary.map((s) => (
                <span key={s.label}>
                  <em>{s.label}</em> <span className={s.cls}>{s.value}</span>
                </span>
              ))}
            </div>
          )}
          <div className="trend-hint">{chart.hint ?? "Hover to inspect a period · Click an OEM to lock focus."}</div>
        </>
      ) : (
        <div className="chart-hint">No trend data is available for the current selection.</div>
      )}
    </WidgetCard>
  );

  return (
    <div className={`mainrow ${norail ? "norail" : ""}`}>
      {!norail && <PeriodRail axis={axis} pt={pt} periodKey={period.key} onChange={setPeriod} />}
      {chartCard}
      {tableCard}
    </div>
  );
}

// --- Sales & Market Share ---
function SalesTab({
  view,
  pt,
  period,
  setPeriod,
  mode,
  setMode,
  oem,
  setOem,
}: {
  view: ViewModel;
  pt: PeriodType;
  period: Period;
  setPeriod: (v: string) => void;
  mode: DisplayMode;
  setMode: (v: DisplayMode) => void;
  oem: string;
  setOem: (v: string) => void;
}) {
  const compare = useCompare();
  const [rangeIdx, setRangeIdx] = useState(1);
  const [hoverOem, setHoverOem] = useState<string | null>(null);
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const mk = (company: string, metric: MetricKey) => buildSeries(view, company, metric);
  const key = period.key;
  const priorL = labelFor(axis, priorKey(pt, key));
  const industry = pick(view, TOTAL, "domestic", "all", pt, key);
  const partial = industry?.partial;

  const { rows, total } = useMemo(
    () => buildTable(view, { flow: "domestic", powertrain: "all", periodType: pt, periodKey: key, totalLabel: TOTAL }),
    [view, pt, key, TOTAL],
  );

  const win = trendWindow(pt, rangeIdx);
  const winAxis = axis.slice(-Math.min(axis.length, win));
  const top3 = rows.slice(0, 3).map((r) => r.company);
  const baseNames = oem ? [oem] : top3;
  const extra = hoverOem && !baseNames.includes(hoverOem) ? [hoverOem] : [];
  const trendLines = buildTrendLines(view, [...baseNames, ...extra], baseNames, "domestic", "all", pt, winAxis, axis, "share");

  // insights from precomputed rows. "Others" is the transparent long-tail residual, not a
  // single competitor — never crown it top share gainer/loser or fastest-growing OEM.
  const eligible = rows.filter((r) => r.company !== "Others" && (r.chg !== null || r.yoy !== null));
  const gainer = [...eligible].sort((a, b) => (b.chg ?? -9) - (a.chg ?? -9))[0];
  const loser = [...eligible].sort((a, b) => (a.chg ?? 9) - (b.chg ?? 9))[0];
  const fastest = [...eligible].filter((r) => r.yoy !== null).sort((a, b) => (b.yoy ?? -9) - (a.yoy ?? -9))[0];

  const colCompany = oem || rows[0]?.company;
  const table: TableConfig = {
    title: `OEM ${flowNoun(view)} & Share Snapshot — ${period.label} vs ${priorL}`,
    subtitle: `${cap(basisOf(view))} · ${view.meta.source} reported universe`,
    rows,
    total,
    curLabel: period.label,
    priorLabel: priorL,
    partial: partial ? { present: industry!.present, expected: industry!.expected } : undefined,
    compare: {
      rowMake: (c) => mk(c, "sales"),
      valueMake: colCompany ? () => mk(colCompany, "sales") : undefined,
      shareMake: colCompany ? () => mk(colCompany, "market_share") : undefined,
      add: compare.add,
    },
  };
  const chart: ChartConfig = {
    title: `Market Share Trend — ${oem ? shortName(oem) : "Top OEMs"}`,
    info: `Market share is calculated within the reported ${view.meta.source} ${basisOf(view)} universe. It may not represent the complete market.`,
    subtitle: `How each OEM's share within the reported ${view.meta.source} universe has changed over time.`,
    footer: `Source: ${view.meta.source} ${basisOf(view)} · ${view.meta.source_universe_label.toLowerCase()}`,
    lines: trendLines,
    valueKind: "share",
    yLabel: "Market share (%)",
    showYoY: pt !== "year",
    focusName: hoverOem,
    lockedName: oem || null,
    summary: oem ? focusSummary(trendLines.find((l) => l.name === oem), "share") : null,
    onLock: (name) => setOem(name),
    compare: { make: (name) => mk(name, "market_share") },
  };

  return (
    <>
      <AnalyticalTab
        axis={axis}
        pt={pt}
        period={period}
        setPeriod={setPeriod}
        oem={oem}
        setOem={setOem}
        mode={mode}
        setMode={setMode}
        table={table}
        chart={chart}
        setHoverOem={setHoverOem}
        rangeIdx={rangeIdx}
        setRangeIdx={setRangeIdx}
      />

      <div className="insights">
        <Insight title="Top share gainer" row={gainer} kind="chg" icon={<IconTrendUp />} onSelect={setOem} />
        <Insight title="Top share loser" row={loser} kind="chg" icon={<IconTrendDown />} onSelect={setOem} />
        <Insight title="Fastest growth" row={fastest} kind="yoy" icon={<IconGrowth />} onSelect={setOem} />
      </div>
    </>
  );
}

function Insight({
  title,
  row,
  kind,
  icon,
  onSelect,
}: {
  title: string;
  row?: TableRow;
  kind: "chg" | "yoy";
  icon: React.ReactNode;
  onSelect: (c: string) => void;
}) {
  const val = kind === "chg" ? row?.chg ?? null : row?.yoy ?? null;
  return (
    <section
      className="card card-b insight-card"
      onClick={() => row && onSelect(row.company)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && row && onSelect(row.company)}
      role="button"
      tabIndex={0}
      aria-label={`${title}: ${row ? shortName(row.company) : "no data"}`}
    >
      {row ? (
        <div className="insight">
          <span className="insight-ic">{icon}</span>
          <div className="insight-body">
            <div className="k">{title}</div>
            <div className="big" title={row.company}>
              {shortName(row.company)}
            </div>
            <div className="metric">
              <Delta text={kind === "chg" ? `${fmtPp(val)} YoY` : `${fmtPct(val)} YoY`} dir={deltaDir(val)} />{" "}
              <span className="flat">· {kind === "yoy" ? `${fmtUnits(row.cur)} units` : `${fmtShare(row.share)} share`}</span>
            </div>
          </div>
        </div>
      ) : (
        <Empty />
      )}
    </section>
  );
}

// --- EV vs ICE ---
function EvTab({
  view,
  pt,
  period,
  setPeriod,
  oem,
  setOem,
  mode,
  setMode,
}: {
  view: ViewModel;
  pt: PeriodType;
  period: Period;
  setPeriod: (v: string) => void;
  oem: string;
  setOem: (v: string) => void;
  mode: DisplayMode;
  setMode: (v: DisplayMode) => void;
}) {
  const compare = useCompare();
  const mk = (company: string, metric: MetricKey) => buildSeries(view, company, metric);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [hoverOem, setHoverOem] = useState<string | null>(null);

  // For PV/3W/CV the source has no EV block — EV-only makers sit inline among ICE makers,
  // so EV volume is NOT derivable. Render it unavailable rather than a wrong number.
  if (!view.meta.has_ev) {
    const makers = view.meta.ev_only_makers;
    return (
      <Unavailable title={`EV split not available for ${view.meta.category_label.toLowerCase()}`}>
        {view.meta.source} reports {view.meta.category_label.toLowerCase()} without an EV/ICE breakdown — EV-only makers are
        listed inline alongside ICE makers, so an EV volume or share here would be a guess, not a measurement.
        {makers.length > 0 && (
          <>
            {" "}
            EV-only makers present in the data (counted within total sales, never summed into a separate EV figure):{" "}
            <b>{makers.join(", ")}</b>.
          </>
        )}
      </Unavailable>
    );
  }
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const evLatest = view.meta.ev_latest_period;
  const evAxis = axis.filter((p) => !evLatest || p.date <= evLatest);
  const evPeriod = evAxis.find((p) => p.key === period.key) ?? evAxis[evAxis.length - 1];
  const frozen = evLatest && period.date > evLatest;

  if (!evPeriod) return <Unavailable title="EV data unavailable">No EV breakdown in this source.</Unavailable>;

  const key = evPeriod.key;
  const priorEvL = labelFor(axis, priorKey(pt, key));
  const { rows, total } = buildTable(view, { flow: "domestic", powertrain: "ev", periodType: pt, periodKey: key, totalLabel: TOTAL });

  // Chart: default = EV vs ICE penetration; focus (row hover or lock) = that OEM's EV-universe share.
  const focus = hoverOem ?? (oem || null);
  const win = trendWindow(pt, rangeIdx);
  const winAxis = evAxis.slice(-Math.min(evAxis.length, win));
  let chart: ChartConfig;
  if (focus) {
    const lines = buildTrendLines(view, [focus], [focus], "domestic", "ev", pt, winAxis, evAxis, "share");
    chart = {
      title: `EV Share Trend — ${shortName(focus)}`,
      info: `EV share is calculated within the reported EV universe (${view.meta.source} EV makers).${isRegs(view) ? " Battery-electric only (PURE EV + ELECTRIC BOV); hybrids and hydrogen are not counted as EV." : " Pure-EV makers outside SIAM are excluded, so this understates EV."}`,
      subtitle: "OEM share within the reported EV universe over time.",
      footer: `Source: ${view.meta.source} ${basisOf(view)} · EV share within reported EV universe`,
      lines,
      valueKind: "share",
      yLabel: "EV-universe share (%)",
      showYoY: pt !== "year",
      focusName: focus,
      lockedName: oem || null,
      summary: oem ? focusSummary(lines.find((l) => l.name === oem), "share") : null,
      onLock: (name) => setOem(name),
      compare: { make: (name) => mk(name, "ev_share") },
    };
  } else {
    chart = {
      title: "EV Penetration Trend — EV vs ICE",
      info: `EV penetration is EV ${basisOf(view)} as a share of the total reported ${view.meta.source} universe.${isRegs(view) ? " Battery-electric only (PURE EV + ELECTRIC BOV); hybrids and hydrogen are not counted as EV." : " It may understate EV because some pure-EV makers are outside SIAM."}`,
      subtitle: `Share of reported ${view.meta.category_label} universe · to ${evPeriod.label}`,
      footer: `EV = blue accent · ICE = muted blue-grey · EV penetration within reported ${view.meta.source} universe`,
      lines: evIceLines(view, TOTAL, pt, winAxis, evAxis),
      valueKind: "share",
      yLabel: "Penetration (%)",
      domain: [0, 1],
      showYoY: pt !== "year",
      focusName: null,
      lockedName: null,
      summary: null,
      hint: "Hover to inspect a period · Click an EV OEM row to lock its EV-share trend.",
      onLock: (name) => {
        if (name !== "EV" && name !== "ICE") setOem(name);
      },
      compare: { make: (name) => (name === "EV" ? mk("Industry", "ev_penetration") : null) },
    };
  }

  const colCompany = oem || rows[0]?.company;
  const table: TableConfig = {
    title: `EV OEM Sales & Share Snapshot — ${evPeriod.label} vs ${priorEvL}`,
    subtitle: "EV volume · share within reported EV universe",
    rows,
    total,
    curLabel: evPeriod.label,
    priorLabel: priorEvL,
    compare: {
      rowMake: (c) => mk(c, "ev_share"),
      valueMake: colCompany ? () => mk(colCompany, "ev_volume") : undefined,
      shareMake: colCompany ? () => mk(colCompany, "ev_share") : undefined,
      add: compare.add,
    },
  };

  return (
    <>
      {frozen && (
        <Unavailable title={`EV data ends ${monthYear(evLatest!)}`}>
          The monthly source that extends totals past {monthYear(view.meta.file1_last_period)} has no EV split. Showing the
          latest EV period ({evPeriod.label}).
        </Unavailable>
      )}
      <AnalyticalTab
        axis={axis}
        pt={pt}
        period={period}
        setPeriod={setPeriod}
        oem={oem}
        setOem={setOem}
        mode={mode}
        setMode={setMode}
        table={table}
        chart={chart}
        setHoverOem={setHoverOem}
        rangeIdx={rangeIdx}
        setRangeIdx={setRangeIdx}
      />
    </>
  );
}

// --- Production & Exports ---
function ProdTab({
  view,
  pt,
  period,
  setPeriod,
  oem,
  setOem,
  mode,
  setMode,
}: {
  view: ViewModel;
  pt: PeriodType;
  period: Period;
  setPeriod: (v: string) => void;
  oem: string;
  setOem: (v: string) => void;
  mode: DisplayMode;
  setMode: (v: DisplayMode) => void;
}) {
  const compare = useCompare();
  const mk = (company: string, metric: MetricKey) => buildSeries(view, company, metric);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [hoverOem, setHoverOem] = useState<string | null>(null);
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const key = period.key;

  // A registrations source (VAHAN) reports neither exports nor production. Say so plainly
  // instead of rendering an empty table + unavailable production side by side.
  const hasExports = view.flows.includes("export");
  const quarterly = view.meta.native_frequency === "quarter";
  const prodSupported = view.meta.has_production && quarterly;
  const exp = buildTable(view, { flow: "export", powertrain: "all", periodType: pt, periodKey: key, totalLabel: TOTAL });
  // Rules of Hooks: declare this toggle on EVERY render — before the exports/production
  // unavailable early-return below, never after it — or the hook order shifts for a source
  // (VAHAN) that takes that branch, which React forbids.
  const [metric, setMetric] = useState<"exports" | "production">(() =>
    prodSupported && exp.rows.length === 0 ? "production" : "exports",
  );

  if (!hasExports && !prodSupported) {
    return (
      <Unavailable title={`Exports & production are not reported by ${view.meta.source}`}>
        {view.meta.source} reports {basisOf(view)} only — there is no export or production basis in this source. Use
        the {flowNoun(view)} &amp; Market Share and EV vs ICE tabs for {view.meta.category_label}.
      </Unavailable>
    );
  }

  // Production is featured only where it is a proper source-reported series — Commercial
  // Vehicles (quarterly-native). Other categories (2W's limited add-on, PV, 3W) render an
  // honest unavailable state rather than a thin/zero table. Never derive monthly from quarterly.
  const prodFirst = view.meta.production_first_period;
  const prodAxis = axis.filter((p) => !prodFirst || p.date >= prodFirst);
  const prodPeriod = prodSupported ? prodAxis.find((p) => p.key === key) ?? prodAxis[prodAxis.length - 1] : undefined;
  const prod = prodPeriod
    ? buildTable(view, { flow: "production", powertrain: "all", periodType: pt, periodKey: prodPeriod.key, totalLabel: TOTAL })
    : { rows: [], total: null };
  const isExports = metric === "exports";
  const win = trendWindow(pt, rangeIdx);

  let table: TableConfig;
  let chart: ChartConfig;
  if (!isExports && !prodSupported) {
    // Honest unavailable production state — same workspace, no empty table / zeros / estimates.
    table = {
      title: `OEM Production Snapshot — ${view.meta.category_label}`,
      rows: [],
      total: null,
      curLabel: "",
      priorLabel: "",
      unavailable: (
        <div className="unavail">
          <strong>Production data is not available for this category</strong>
          <span>
            Production data is not available for {view.meta.category_label.toLowerCase()} in the current source. Select
            Commercial Vehicles or switch to Exports.
          </span>
        </div>
      ),
    };
    chart = {
      title: `Production Trend — ${view.meta.category_label}`,
      subtitle: "Coverage",
      footer: "Production is source-reported quarterly (Commercial Vehicles)",
      lines: [],
      valueKind: "volume",
      yLabel: "Production (units)",
      showYoY: pt !== "year",
      focusName: null,
      lockedName: null,
      emptyNote: (
        <div className="unavail">
          <strong>No production series for {view.meta.category_label}</strong>
          <span>
            The current source does not report {view.meta.category_label.toLowerCase()} production. Switch to Exports, or
            select Commercial Vehicles for source-reported quarterly production.
          </span>
        </div>
      ),
      onLock: () => {},
    };
  } else {
    const flow: Flow = isExports ? "export" : "production";
    const curPeriod = isExports ? period : prodPeriod!;
    const curPriorL = labelFor(axis, priorKey(pt, curPeriod.key));
    const data = isExports ? exp : prod;
    const chartAxis = isExports ? axis : prodAxis;
    const winAxis = chartAxis.slice(-Math.min(chartAxis.length, win));
    const top3 = data.rows.slice(0, 3).map((r) => r.company);
    const baseNames = oem ? [oem] : top3;
    const extra = hoverOem && !baseNames.includes(hoverOem) ? [hoverOem] : [];
    const lines = buildTrendLines(view, [...baseNames, ...extra], baseNames, flow, "all", pt, winAxis, chartAxis, "volume");
    const metricLabel = isExports ? "Export" : "Production";
    const metricKey: MetricKey = isExports ? "exports" : "production";
    const colCompany = oem || data.rows[0]?.company;
    table = {
      title: isExports
        ? `OEM Export Snapshot — ${curPeriod.label} vs ${curPriorL}`
        : `OEM Production Snapshot — ${curPeriod.label} vs ${curPriorL}`,
      subtitle: isExports ? "Wholesale exports · SIAM reported universe" : "Source-reported quarterly production",
      rows: data.rows,
      total: data.total,
      curLabel: curPeriod.label,
      priorLabel: curPriorL,
      compare: {
        rowMake: (c) => mk(c, metricKey),
        valueMake: colCompany ? () => mk(colCompany, metricKey) : undefined,
        add: compare.add,
      },
    };
    chart = {
      title: `${metricLabel} Trend — ${oem ? shortName(oem) : "Top OEMs"}`,
      info: isExports
        ? "Wholesale export volumes within the reported SIAM universe."
        : "Source-reported quarterly production volumes. Not derived from monthly figures.",
      subtitle: isExports ? "Wholesale export volume over time" : "Source-reported quarterly production over time",
      footer: isExports ? "Source: SIAM wholesale dispatches (exports)" : "Source-reported quarterly production",
      lines,
      valueKind: "volume",
      yLabel: isExports ? "Exports (units)" : "Production (units)",
      showYoY: pt !== "year",
      focusName: hoverOem,
      lockedName: oem || null,
      summary: oem ? focusSummary(lines.find((l) => l.name === oem), "volume") : null,
      onLock: (name) => setOem(name),
      compare: { make: (name) => mk(name, metricKey) },
    };
  }

  return (
    <>
      <div className="periodnav" style={{ justifyContent: "flex-end" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center", marginRight: 2 }}>Metric</span>
        <div className="seg mini" role="group" aria-label="Metric">
          <button className={isExports ? "active" : ""} onClick={() => setMetric("exports")}>
            Exports
          </button>
          <button className={!isExports ? "active" : ""} onClick={() => setMetric("production")}>
            Production
          </button>
        </div>
        {(isExports || prodSupported) && (
          <DragHandle
            build={() => mk(TOTAL, isExports ? "exports" : "production")}
            onAdd={compare.add}
            label={`${isExports ? "Exports" : "Production"} metric`}
            className="metric-grip"
          />
        )}
      </div>

      <AnalyticalTab
        axis={axis}
        pt={pt}
        period={period}
        setPeriod={setPeriod}
        oem={oem}
        setOem={setOem}
        mode={mode}
        setMode={setMode}
        table={table}
        chart={chart}
        setHoverOem={setHoverOem}
        rangeIdx={rangeIdx}
        setRangeIdx={setRangeIdx}
      />
    </>
  );
}

// --- Provenance / source (design.md §8.4) ---
function Provenance({ view }: { view: ViewModel }) {
  const m = view.meta;
  return (
    <WidgetCard title="Source & freshness">
      <div className="source">
        <span className="source-ic">
          <IconDoc />
        </span>
        <dl className="prov">
          <div>
            <dt>Source</dt>
            <dd>{m.source} — {basisOf(view)}</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>
              {monthYear(m.coverage_start)} – {monthYear(m.latest_period)}
            </dd>
          </div>
        </dl>
      </div>
    </WidgetCard>
  );
}
