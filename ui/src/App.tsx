import { useEffect, useMemo, useState } from "react";
import { useBundle, useManifest } from "./lib/useBundle";
import { useHostContext, useSnapshotMode } from "./lib/host";
import type { CategoryInfo, Flow, Period, PeriodType, Point, Powertrain, ViewModel } from "./lib/types";
import { buildTable, getSeries, priorKey, type TableRow } from "./lib/view";
import { fmtPct, fmtPp, fmtShare, fmtUnits, fmtUnitsCompact, monthYear, shortName } from "./lib/format";
import { ComparisonTable, type DisplayMode } from "./components/ComparisonTable";
import { TrendChart } from "./components/TrendChart";
import { ShareTrendChart, type TrendLine, type TrendPoint } from "./components/ShareTrendChart";
import {
  Delta,
  deltaDir,
  Empty,
  ErrorState,
  IconBars,
  IconBolt,
  IconDoc,
  IconExternal,
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
import { useTheme } from "./lib/theme";

type Tab = "sales" | "ev" | "prod";

// Series colours are theme tokens (resolved from CSS custom properties). Green/red stay
// reserved for deltas. EV = brighter blue accent, ICE = muted blue-grey.
const EV_LINE = "var(--ev)";
const ICE_LINE = "var(--ice)";
// Distinct default line colours by rank: primary blue, secondary blue, muted slate.
const RANK_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

export function App() {
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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Vehicle category"
      aria-label="Vehicle category"
      disabled={categories.length <= 1}
    >
      {categories.map((c) => (
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
        <div className="header-right">{right}</div>
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

// Compact Light/Dark switch (sun/moon). Persists + applies immediately via useTheme.
function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="btn icon"
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      aria-pressed={theme === "dark"}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

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
  const [tab, setTab] = useQuery<Tab>("tab", "sales");
  const [pt, setPt] = useQuery<PeriodType>("pt", "month");
  const [mode, setMode] = useQuery<DisplayMode>("mode", "both");
  const axis = view.periods[pt];
  const [periodKey, setPeriodKey] = useQuery("period", axis[axis.length - 1]?.key ?? "");
  const [oem, setOem] = useQuery("oem", host.oem ?? "");

  // clamp selected period to the available axis for this period type
  const period = axis.find((p) => p.key === periodKey) ?? axis[axis.length - 1];
  useEffect(() => {
    if (period && period.key !== periodKey) setPeriodKey(period.key);
  }, [period, periodKey, setPeriodKey]);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "sales", label: "Sales & Market Share", icon: <IconBars /> },
    { id: "ev", label: "EV vs ICE", icon: <IconBolt /> },
    { id: "prod", label: "Production & Exports", icon: <IconFactory /> },
  ];

  return (
    <div className={`shell ${snapshot ? "snapshot" : ""}`}>
      <header className="zone1">
        <span className="title">OEM Tracker</span>
        <div className="header-right">
          {host.selectedTicker && (
            <span className="ticker-pill" title="From host ticker">
              {host.selectedTicker}
              {host.oem ? ` · ${shortName(host.oem)}` : ""}
            </span>
          )}
          <CategorySelect categories={categories} value={cat} onChange={setCat} />
          <OemSelect view={view} value={oem} onChange={setOem} />
          <div className="seg" role="group" aria-label="Period granularity">
            {(["month", "quarter", "year"] as PeriodType[]).map((k) => (
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
            <option value="sales">Sales</option>
            <option value="exports">Exports</option>
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
          <ThemeToggle />
          <button className="btn export accent" onClick={() => window.print()} title="Export current view (print / PDF)">
            ↧ Export
          </button>
        </div>
      </header>

      <main className="zone2">
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
        {tab === "ev" && <EvTab view={view} pt={pt} period={period} setPeriod={setPeriodKey} />}
        {tab === "prod" && (
          <ProdTab view={view} pt={pt} period={period} setPeriod={setPeriodKey} oem={oem} setOem={setOem} />
        )}

        <Provenance view={view} />
      </main>
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

// --- KPI card ---
function Kpi({
  label,
  value,
  valueClass,
  cmp,
  scope,
  caveat,
}: {
  label: string;
  value: string;
  valueClass?: string;
  cmp?: React.ReactNode;
  scope?: string;
  caveat?: string;
}) {
  return (
    <div className="card kpi">
      <div className="label">
        {label}
        {caveat && (
          <span className="info" title={caveat}>
            i
          </span>
        )}
      </div>
      <div className={`value ${valueClass ?? ""}`}>{value}</div>
      {cmp && <div className="cmp">{cmp}</div>}
      {scope && <div className="scope">{scope}</div>}
    </div>
  );
}

function yoyNode(p?: Point) {
  if (!p || p.yoy === null) return <span className="dash">—</span>;
  return <Delta text={`${fmtPct(p.yoy)} YoY`} dir={deltaDir(p.yoy)} />;
}

// Build enriched share-trend lines: for each OEM, share plus pp-change vs previous period
// and vs the same period last year, over the visible window. `baseNames` fixes rank colours;
// extra names (e.g. a table-row hover outside the top 3) render as an added focusable line.
function buildTrendLines(
  view: ViewModel,
  names: string[],
  baseNames: string[],
  pt: PeriodType,
  winAxis: Period[],
  fullAxis: Period[],
): TrendLine[] {
  return names.map((name) => {
    const rank = baseNames.indexOf(name);
    const color = rank >= 0 ? RANK_COLORS[rank] ?? "var(--chart-3)" : "var(--chart-3)";
    const s = getSeries(view, name, "domestic", "all", pt);
    const points: TrendPoint[] = winAxis.map((p) => {
      const fi = fullAxis.findIndex((a) => a.key === p.key);
      const cur = s?.points[p.key];
      const prev = fi > 0 ? s?.points[fullAxis[fi - 1].key] : undefined;
      const value = cur?.share ?? null;
      const prevChg = value != null && prev?.share != null ? value - prev.share : null;
      const yoyChg = cur?.chg ?? null; // precomputed YoY share change (pp) from the view-model
      return { label: p.label, value, prevChg, yoyChg };
    });
    return { name, display: shortName(name), color, points };
  });
}

function trendWindow(pt: PeriodType, idx: number): number {
  const opts = pt === "month" ? [6, 12, 24] : pt === "quarter" ? [8, 12, 16] : [5, 8, 10];
  return opts[Math.min(idx, opts.length - 1)];
}
function rangeLabels(pt: PeriodType): string[] {
  return pt === "month" ? ["6M", "12M", "24M"] : pt === "quarter" ? ["8Q", "12Q", "16Q"] : ["5Y", "8Y", "10Y"];
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
  const [details, setDetails] = useState(false);
  const [rangeIdx, setRangeIdx] = useState(1);
  const [hoverOem, setHoverOem] = useState<string | null>(null);
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const key = period.key;
  const priorL = labelFor(axis, priorKey(pt, key));
  const industry = pick(view, TOTAL, "domestic", "all", pt, key);
  const sel = oem ? pick(view, oem, "domestic", "all", pt, key) : undefined;
  const selPrior = oem ? pick(view, oem, "domestic", "all", pt, priorKey(pt, key)) : undefined;
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
  const trendLines = buildTrendLines(view, [...baseNames, ...extra], baseNames, pt, winAxis, axis);
  const hasTrend = trendLines.some((l) => l.points.some((p) => p.value !== null));

  // summary for the single locked OEM: starting share, latest share, total change (pp)
  let summary: { start: number; latest: number; total: number } | null = null;
  if (oem) {
    const l = trendLines.find((x) => x.name === oem);
    const first = l?.points.find((p) => p.value != null)?.value ?? null;
    let last: number | null = null;
    for (let i = (l?.points.length ?? 0) - 1; i >= 0; i--) {
      const v = l!.points[i].value;
      if (v != null) {
        last = v;
        break;
      }
    }
    if (first != null && last != null) summary = { start: first, latest: last, total: last - first };
  }

  // insights from precomputed rows
  const eligible = rows.filter((r) => r.chg !== null || r.yoy !== null);
  const gainer = [...eligible].sort((a, b) => (b.chg ?? -9) - (a.chg ?? -9))[0];
  const loser = [...eligible].sort((a, b) => (a.chg ?? 9) - (b.chg ?? 9))[0];
  const fastest = [...eligible].filter((r) => r.yoy !== null).sort((a, b) => (b.yoy ?? -9) - (a.yoy ?? -9))[0];

  const leader = rows[0];
  const top3Share = rows.slice(0, 3).reduce((s, r) => s + (r.share ?? 0), 0);
  const evLatest = view.meta.ev_latest_period;
  const evAxis = axis.filter((p) => !evLatest || p.date <= evLatest);
  const evP = evAxis[evAxis.length - 1];
  const evPen = evP ? view.ev_penetration["domestic"]?.[pt]?.[evP.key] ?? null : null;
  const norail = pt === "year";

  const trendCard = (
    <WidgetCard
      title={`Market Share Trend — ${oem ? shortName(oem) : "Top OEMs"}`}
      info="Market share is calculated within the reported SIAM wholesale-dispatch universe. It may not represent the complete retail market."
      subtitle="How each OEM's share within the reported SIAM universe has changed over time."
      right={
        <div className="card-h-actions">
          {oem && (
            <button className="btn" onClick={() => setOem("")} title="Return to the Top OEMs view">
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
      footer="Source: SIAM wholesale dispatches"
    >
      {hasTrend ? (
        <>
          <ShareTrendChart
            lines={trendLines}
            focusName={hoverOem}
            lockedName={oem || null}
            showYoY={pt !== "year"}
            onLock={(name) => setOem(name)}
          />
          {oem && summary && (
            <div className="trend-summary">
              <span>
                <em>Start</em> {fmtShare(summary.start)}
              </span>
              <span>
                <em>Latest</em> {fmtShare(summary.latest)}
              </span>
              <span>
                <em>Total change</em>{" "}
                <span className={summary.total > 0.0005 ? "pos" : summary.total < -0.0005 ? "neg" : "flat"}>
                  {fmtPp(summary.total)}
                </span>
              </span>
            </div>
          )}
          <div className="trend-hint">Hover to inspect a period · Click an OEM to lock focus.</div>
        </>
      ) : (
        <div className="chart-hint">No share history is available for the current selection.</div>
      )}
    </WidgetCard>
  );

  return (
    <>
      <div className="kpis">
        <Kpi
          label="Total Industry Sales"
          value={fmtUnitsCompact(industry?.v)}
          cmp={yoyNode(industry)}
          scope={period.label}
          caveat="Total wholesale dispatches within the reported SIAM universe (not the whole market)."
        />
        {oem ? (
          <>
            <Kpi label={`${shortName(oem)} Sales`} value={fmtUnitsCompact(sel?.v)} cmp={yoyNode(sel)} scope={period.label} />
            <Kpi
              label="YoY Growth"
              value={sel?.yoy == null ? "—" : fmtPct(sel.yoy)}
              scope={`vs ${priorL}`}
            />
            <Kpi
              label="Share within Reported Universe"
              value={fmtShare(sel?.share)}
              cmp={selPrior?.share != null ? <span className="flat">vs {fmtShare(selPrior.share)} ({priorL})</span> : undefined}
              scope={shortName(oem)}
              caveat={
                view.meta.share_caveat +
                (view.meta.has_ev ? " Some pure-EV makers (e.g. Ola) are not SIAM members, so EV share is understated." : "")
              }
            />
            <Kpi
              label="Share Change (pp)"
              value={sel?.chg == null ? "—" : fmtPp(sel.chg)}
              cmp={sel?.chg != null ? <Delta text={`${fmtPp(sel.chg)} YoY`} dir={deltaDir(sel.chg)} /> : undefined}
              scope={`vs ${priorL}`}
            />
          </>
        ) : (
          <>
            <Kpi
              label="Market Leader"
              value={fmtShare(leader?.share)}
              valueClass=""
              cmp={leader?.chg != null ? <Delta text={fmtPp(leader.chg)} dir={deltaDir(leader.chg)} /> : undefined}
              scope={leader ? shortName(leader.company) : undefined}
              caveat="Largest OEM by current-period sales, and its share of the reported universe."
            />
            <Kpi label="Industry YoY" value={industry?.yoy == null ? "—" : fmtPct(industry.yoy)} scope={`vs ${priorL}`} />
            <Kpi
              label="Top-3 Concentration"
              value={fmtShare(top3Share || null)}
              scope="share of top 3 OEMs"
              caveat="Combined share of the three largest OEMs within the reported universe."
            />
            {view.meta.has_ev ? (
              <Kpi
                label="EV Penetration"
                value={fmtShare(evPen)}
                scope={evP ? `EV of ${view.meta.category} · ${evP.label}` : "—"}
                caveat={view.meta.share_caveat + " Pure-EV makers outside SIAM are excluded, so this understates EV."}
              />
            ) : (
              <Kpi
                label="Total Exports"
                value={fmtUnitsCompact(pick(view, TOTAL, "export", "all", pt, key)?.v)}
                scope={period.label}
                caveat={`Wholesale ${view.meta.category} exports within the reported SIAM universe. EV is not broken out for this category — EV-only makers are counted inline.`}
              />
            )}
          </>
        )}
      </div>

      <div className={`mainrow ${details ? "details" : ""} ${norail ? "norail" : ""}`}>
        {!norail && <PeriodRail axis={axis} pt={pt} periodKey={period.key} onChange={setPeriod} />}
        <WidgetCard
          title={`OEM Sales & Share Snapshot — ${period.label} vs ${priorL}`}
          subtitle="Wholesale dispatches · SIAM reported universe"
          right={
            <div className="card-h-actions">
              {partial && <PartialBadge present={industry!.present} expected={industry!.expected} />}
              <div className="seg mini" role="group" aria-label="Display mode">
                {(["both", "absolute", "yoy"] as DisplayMode[]).map((m) => (
                  <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                    {m === "both" ? "Both" : m === "absolute" ? "Absolute" : "YoY"}
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setDetails((d) => !d)} title="Expand the full table">
                {details ? "Collapse" : "View details"} <IconExternal />
              </button>
            </div>
          }
        >
          {rows.length ? (
            <ComparisonTable
              rows={rows}
              total={total}
              curLabel={period.label}
              priorLabel={priorL}
              mode={mode}
              selected={oem}
              expanded={details}
              onSelect={(c) => setOem(c)}
              onHover={setHoverOem}
            />
          ) : (
            <Empty onReset={() => setOem("")} />
          )}
        </WidgetCard>
        {!details && trendCard}
      </div>

      {details && <div className="row">{trendCard}</div>}

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
function EvTab({ view, pt, period, setPeriod }: { view: ViewModel; pt: PeriodType; period: Period; setPeriod: (v: string) => void }) {
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
  const norail = pt === "year";

  if (!evPeriod) return <Unavailable title="EV data unavailable">No EV breakdown in this source.</Unavailable>;

  const key = evPeriod.key;
  const evInd = pick(view, TOTAL, "domestic", "ev", pt, key);
  const allInd = pick(view, TOTAL, "domestic", "all", pt, key);
  const pen = view.ev_penetration["domestic"]?.[pt]?.[key] ?? null;
  const penPrior = view.ev_penetration["domestic"]?.[pt]?.[priorKey(pt, key)] ?? null;
  const ice = allInd && evInd ? { v: (allInd.v ?? 0) - (evInd.v ?? 0) } : { v: null };

  const { rows, total } = buildTable(view, {
    flow: "domestic",
    powertrain: "ev",
    periodType: pt,
    periodKey: key,
    totalLabel: TOTAL,
  });

  const penAxis = evAxis.slice(-Math.min(evAxis.length, 24));
  const evPoints = penAxis.map((p) => ({ label: p.label, value: view.ev_penetration["domestic"]?.[pt]?.[p.key] ?? null }));
  const icePoints = penAxis.map((p) => {
    const v = view.ev_penetration["domestic"]?.[pt]?.[p.key];
    return { label: p.label, value: v == null ? null : 1 - v };
  });

  return (
    <>
      {frozen && (
        <Unavailable title={`EV data ends ${monthYear(evLatest!)}`}>
          The monthly source that extends totals past {monthYear(view.meta.file1_last_period)} has no EV split. Showing the
          latest EV period ({evPeriod.label}).
        </Unavailable>
      )}
      <div className="kpis" style={{ marginTop: frozen ? 12 : 0 }}>
        <Kpi label="EV Volume" value={fmtUnitsCompact(evInd?.v)} cmp={yoyNode(evInd)} scope={evPeriod.label} />
        <Kpi label="EV YoY" value={evInd?.yoy == null ? "—" : fmtPct(evInd.yoy)} scope={`vs ${labelFor(axis, priorKey(pt, key))}`} />
        <Kpi
          label="EV Share of 2W Universe"
          value={fmtShare(pen)}
          cmp={pen != null && penPrior != null ? <Delta text={`${fmtPp(pen - penPrior)} YoY`} dir={deltaDir(pen - penPrior)} /> : undefined}
          scope="EV penetration"
          caveat={view.meta.share_caveat + " Pure-EV makers outside SIAM are excluded, so this understates EV."}
        />
        <Kpi label="ICE Volume" value={fmtUnitsCompact(ice.v)} scope={evPeriod.label} />
        <Kpi label="ICE Share" value={pen == null ? "—" : fmtShare(1 - pen)} scope="of reported universe" />
      </div>

      <div className={`mainrow ${norail ? "norail" : ""}`}>
        {!norail && <PeriodRail axis={axis} pt={pt} periodKey={period.key} onChange={setPeriod} />}
        <WidgetCard
          title="EV vs ICE — share of reported 2W universe"
          subtitle={`SIAM reported universe · to ${evPeriod.label}`}
          footer="EV = blue accent · ICE = muted blue-grey · share within reported SIAM universe"
        >
          {evPoints.some((p) => p.value !== null) ? (
            <TrendChart
              series={[
                { name: "EV", color: EV_LINE, points: evPoints },
                { name: "ICE", color: ICE_LINE, points: icePoints },
              ]}
              yFormat={(n) => (n * 100).toFixed(0) + "%"}
              domain={[0, 1]}
              ariaLabel="EV vs ICE share trend"
            />
          ) : (
            <Empty />
          )}
        </WidgetCard>
        <WidgetCard title={`EV makers — ${evPeriod.label}`} subtitle="Share within reported EV universe">
          {rows.length ? (
            <ComparisonTable
              rows={rows}
              total={total}
              curLabel={evPeriod.label}
              priorLabel={labelFor(axis, priorKey(pt, key))}
              mode="both"
              onSelect={() => {}}
            />
          ) : (
            <Empty />
          )}
        </WidgetCard>
      </div>
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
}: {
  view: ViewModel;
  pt: PeriodType;
  period: Period;
  setPeriod: (v: string) => void;
  oem: string;
  setOem: (v: string) => void;
}) {
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const catShort = view.meta.category; // "2W" | "PV" | ...
  const key = period.key;
  const priorL = labelFor(axis, priorKey(pt, key));
  const expInd = pick(view, TOTAL, "export", "all", pt, key);
  const norail = pt === "year";

  const exp = buildTable(view, { flow: "export", powertrain: "all", periodType: pt, periodKey: key, totalLabel: TOTAL });

  // Production exists only where the source reports it (2W: File 2, 2026-01+). Categories
  // with no production flow render it unavailable.
  const prodFirst = view.meta.production_first_period;
  const prodAxis = axis.filter((p) => !prodFirst || p.date >= prodFirst);
  const prodPeriod = view.meta.has_production
    ? prodAxis.find((p) => p.key === key) ?? prodAxis[prodAxis.length - 1]
    : undefined;
  const prod = prodPeriod
    ? buildTable(view, { flow: "production", powertrain: "all", periodType: pt, periodKey: prodPeriod.key, totalLabel: TOTAL })
    : { rows: [], total: null };

  return (
    <>
      <div className="kpis">
        <Kpi label="Total Exports" value={fmtUnitsCompact(expInd?.v)} cmp={yoyNode(expInd)} scope={period.label} />
        <Kpi
          label={oem ? `${shortName(oem)} Exports` : "Export Leader"}
          value={oem ? fmtUnitsCompact(pick(view, oem, "export", "all", pt, key)?.v) : fmtShare(exp.rows[0]?.share)}
          scope={oem ? period.label : exp.rows[0] ? shortName(exp.rows[0].company) : "—"}
        />
        <Kpi label="Export YoY" value={expInd?.yoy == null ? "—" : fmtPct(expInd.yoy)} scope={`vs ${priorL}`} />
        <Kpi
          label={`Production (${catShort})`}
          value={prodPeriod ? fmtUnitsCompact(pick(view, TOTAL, "production", "all", pt, prodPeriod.key)?.v) : "—"}
          scope={prodPeriod ? prodPeriod.label : "unavailable"}
          caveat={
            view.meta.has_production
              ? `${catShort} production is reported only from ${prodFirst ? monthYear(prodFirst) : "recently"} (monthly SIAM). Earlier periods are not available.`
              : `Production is not reported for ${view.meta.category_label.toLowerCase()} in this source. Exports remain available.`
          }
        />
        <Kpi
          label="Export Share Leader"
          value={fmtShare(exp.rows[0]?.share)}
          scope={exp.rows[0] ? shortName(exp.rows[0].company) : "—"}
        />
      </div>

      <div className={`mainrow ${norail ? "norail" : ""}`}>
        {!norail && <PeriodRail axis={axis} pt={pt} periodKey={period.key} onChange={setPeriod} />}
        <WidgetCard title={`Exports by OEM — ${period.label} vs ${priorL}`} subtitle="Wholesale exports · SIAM reported universe">
          {exp.rows.length ? (
            <ComparisonTable
              rows={exp.rows}
              total={exp.total}
              curLabel={period.label}
              priorLabel={priorL}
              mode="both"
              selected={oem}
              onSelect={(c) => setOem(c === oem ? "" : c)}
            />
          ) : (
            <Empty />
          )}
        </WidgetCard>
        <WidgetCard title={`Production (${catShort})`} subtitle="Maker-level · monthly SIAM">
          {prodPeriod && prod.rows.length ? (
            <>
              <div className="unavail" style={{ marginBottom: 12 }}>
                <strong>Limited coverage</strong>
                <span>
                  {catShort} production is reported only from {monthYear(prodFirst!)}. Earlier periods are not in the source
                  and are not shown as zero.
                </span>
              </div>
              <ComparisonTable
                rows={prod.rows}
                total={prod.total}
                curLabel={prodPeriod.label}
                priorLabel={labelFor(axis, priorKey(pt, prodPeriod.key))}
                mode="absolute"
                onSelect={() => {}}
              />
            </>
          ) : (
            <Unavailable title={`Production data is not available for ${view.meta.category_label}`}>
              The current source workbook does not report {view.meta.category_label.toLowerCase()} production for this
              period. Export analysis remains available. Production will appear only after a validated source is connected.
            </Unavailable>
          )}
        </WidgetCard>
      </div>
    </>
  );
}

// --- Provenance / source (design.md §8.4) ---
function Provenance({ view }: { view: ViewModel }) {
  const m = view.meta;
  return (
    <WidgetCard title="Source & freshness" subtitle="Every figure traces to a source file">
      <div className="source">
        <span className="source-ic">
          <IconDoc />
        </span>
        <dl className="prov">
          <div>
            <dt>Source</dt>
            <dd>{m.source} — wholesale dispatches</dd>
          </div>
          <div>
            <dt>Reported universe</dt>
            <dd>{m.source_universe_label}</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>
              {monthYear(m.coverage_start)} – {monthYear(m.latest_period)}
            </dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{new Date(m.generated_at).toLocaleString("en-GB")}</dd>
          </div>
          <div>
            <dt>Snapshot</dt>
            <dd>{m.snapshot_id ?? "—"}</dd>
          </div>
          <div>
            <dt>Company history from</dt>
            <dd>{monthYear(m.company_history_floor)}</dd>
          </div>
        </dl>
      </div>
      <div className="caveat">
        {m.share_caveat} {m.notes}
      </div>
    </WidgetCard>
  );
}
