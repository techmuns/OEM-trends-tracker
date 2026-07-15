import { useEffect, useMemo, useState } from "react";
import { useBundle } from "./lib/useBundle";
import { useHostContext, useSnapshotMode } from "./lib/host";
import type { Flow, Period, PeriodType, Point, Powertrain, ViewModel } from "./lib/types";
import { buildTable, getSeries, priorKey, seriesPoints } from "./lib/view";
import { fmtPct, fmtPp, fmtShare, fmtUnitsCompact, monthYear } from "./lib/format";
import { ComparisonTable, type DisplayMode } from "./components/ComparisonTable";
import { TrendChart } from "./components/TrendChart";
import {
  Delta,
  deltaDir,
  Empty,
  ErrorState,
  Loading,
  PartialBadge,
  Unavailable,
  WidgetCard,
} from "./components/ui";

type Tab = "sales" | "ev" | "prod";
const EV_GOLD = "#b45309";
const ICE_GREY = "#6b7280";
const PRIMARY = "#4f46e5";

export function App() {
  const load = useBundle();
  if (load.status === "loading")
    return (
      <Shell>
        <Loading rows={6} />
      </Shell>
    );
  if (load.status === "error")
    return (
      <Shell>
        <ErrorState onRetry={() => location.reload()} />
      </Shell>
    );
  return <Dashboard view={load.data} />;
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

function Dashboard({ view }: { view: ViewModel }) {
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

  const latest = view.meta.latest_period;
  const evLatest = view.meta.ev_latest_period;

  return (
    <div className={`shell ${snapshot ? "snapshot" : ""}`}>
      <header className="zone1">
        <span className="title">OEM Tracker</span>
        <div className="header-right">
          {host.selectedTicker && (
            <span className="ticker-pill" title="From host ticker">
              {host.selectedTicker}
              {host.oem ? ` · ${host.oem}` : ""}
            </span>
          )}
          <select value="2W" disabled title="Category (2W only in this release)">
            <option>Two-Wheelers</option>
          </select>
          <OemSelect view={view} value={oem} onChange={setOem} />
          <div className="seg">
            {(["month", "quarter", "year"] as PeriodType[]).map((k) => (
              <button key={k} className={pt === k ? "active" : ""} onClick={() => setPt(k)}>
                {k === "month" ? "Monthly" : k === "quarter" ? "Quarterly" : "Yearly"}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => location.reload()} title={`Last built ${view.meta.generated_at}`}>
            ↻
          </button>
          <button className="btn" onClick={() => window.print()} title="Export current view (print / PDF)">
            Export
          </button>
        </div>
      </header>

      <main className="zone2">
        {/* tabs */}
        <div className="tabs" role="tablist">
          <button className={`tab ${tab === "sales" ? "active" : ""}`} onClick={() => setTab("sales")}>
            Sales &amp; Market Share
          </button>
          <button className={`tab ${tab === "ev" ? "active" : ""}`} onClick={() => setTab("ev")}>
            EV vs ICE
          </button>
          <button className={`tab ${tab === "prod" ? "active" : ""}`} onClick={() => setTab("prod")}>
            Production &amp; Exports
          </button>
        </div>

        {/* freshness — loud, near the top */}
        <div className="freshness">
          <span>
            📅 Data as of <b>{monthYear(latest)}</b>
          </span>
          <span className="sub">
            Coverage {monthYear(view.meta.coverage_start)} – {monthYear(latest)}. Maker-level
            sales/exports/production to {monthYear(latest)}; EV &amp; segment detail through{" "}
            {evLatest ? monthYear(evLatest) : "—"}.
          </span>
        </div>

        {/* period + display controls */}
        <div className="tabs" style={{ justifyContent: "space-between" }}>
          <PeriodPicker axis={axis} value={period?.key ?? ""} onChange={setPeriodKey} />
          {tab === "sales" && (
            <div className="seg">
              {(["both", "absolute", "yoy"] as DisplayMode[]).map((m) => (
                <button key={m} className={mode === m ? "active" : ""} onClick={() => setMode(m)}>
                  {m === "both" ? "Both" : m === "absolute" ? "Absolute" : "YoY"}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === "sales" && (
          <SalesTab view={view} pt={pt} period={period} mode={mode} oem={oem} setOem={setOem} />
        )}
        {tab === "ev" && <EvTab view={view} pt={pt} period={period} />}
        {tab === "prod" && <ProdTab view={view} pt={pt} period={period} oem={oem} setOem={setOem} />}

        <Provenance view={view} />
      </main>
    </div>
  );
}

// --- shared small controls ---
function OemSelect({ view, value, onChange }: { view: ViewModel; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="OEM">
      <option value="">All OEMs</option>
      {view.companies.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function PeriodPicker({ axis, value, onChange }: { axis: Period[]; value: string; onChange: (v: string) => void }) {
  // most recent first
  const items = [...axis].reverse();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Period" aria-label="Period">
      {items.map((p) => (
        <option key={p.key} value={p.key}>
          {p.label}
        </option>
      ))}
    </select>
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
  cmp,
  scope,
  caveat,
}: {
  label: string;
  value: string;
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
      <div className="value">{value}</div>
      {cmp && <div className="cmp">{cmp}</div>}
      {scope && <div className="scope">{scope}</div>}
    </div>
  );
}

function yoyNode(p?: Point) {
  if (!p || p.yoy === null) return <span className="dash">—</span>;
  return <Delta text={`${fmtPct(p.yoy)} YoY`} dir={deltaDir(p.yoy)} />;
}

// --- Sales & Market Share ---
function SalesTab({
  view,
  pt,
  period,
  mode,
  oem,
  setOem,
}: {
  view: ViewModel;
  pt: PeriodType;
  period: Period;
  mode: DisplayMode;
  oem: string;
  setOem: (v: string) => void;
}) {
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const key = period.key;
  const priorL = labelFor(axis, priorKey(pt, key));
  const industry = pick(view, TOTAL, "domestic", "all", pt, key);
  const sel = oem ? pick(view, oem, "domestic", "all", pt, key) : industry;
  const partial = industry?.partial;

  const { rows, total } = useMemo(
    () => buildTable(view, { flow: "domestic", powertrain: "all", periodType: pt, periodKey: key, totalLabel: TOTAL }),
    [view, pt, key, TOTAL],
  );

  const trendSeries = getSeries(view, oem || TOTAL, "domestic", "all", pt);
  const trendAxis = axis.slice(-Math.min(axis.length, pt === "month" ? 12 : pt === "quarter" ? 8 : 6));
  const trendPoints = seriesPoints(trendSeries, trendAxis).map((x) => ({
    label: x.label,
    value: x.point?.share ?? null,
  }));

  // insights from precomputed rows
  const eligible = rows.filter((r) => r.chg !== null || r.yoy !== null);
  const gainer = [...eligible].sort((a, b) => (b.chg ?? -9) - (a.chg ?? -9))[0];
  const loser = [...eligible].sort((a, b) => (a.chg ?? 9) - (b.chg ?? 9))[0];
  const fastest = [...eligible].filter((r) => r.yoy !== null).sort((a, b) => (b.yoy ?? -9) - (a.yoy ?? -9))[0];

  return (
    <>
      <div className="kpis">
        <Kpi
          label="Total Reported Sales"
          value={fmtUnitsCompact(industry?.v)}
          cmp={yoyNode(industry)}
          scope={period.label}
          caveat="Total wholesale dispatches within the reported SIAM universe (not the whole market)."
        />
        <Kpi
          label={oem ? `${oem} Sales` : "Reported Universe Sales"}
          value={fmtUnitsCompact(sel?.v)}
          cmp={yoyNode(sel)}
          scope={oem || "All OEMs"}
        />
        <Kpi label="YoY Growth" value={sel?.yoy === null || !sel ? "—" : fmtPct(sel.yoy)} scope={`vs ${priorL}`} />
        <Kpi
          label="Share within Reported Universe"
          value={oem ? fmtShare(sel?.share) : "100.0%"}
          cmp={oem ? undefined : <span className="flat">reported universe</span>}
          scope={oem || "All OEMs"}
          caveat={view.meta.share_caveat + ". Some pure-EV makers (e.g. Ola) are not SIAM members, so EV share is understated."}
        />
        <Kpi
          label="Share Change (pp)"
          value={oem && sel?.chg != null ? fmtPp(sel.chg) : "—"}
          scope={`vs ${priorL}`}
        />
      </div>

      <div className="grid row">
        <div className="span-8">
          <WidgetCard
            title={`OEM Sales & Share — ${period.label} vs ${priorL}`}
            subtitle="Wholesale dispatches · SIAM reported universe"
            right={
              partial ? <PartialBadge present={industry!.present} expected={industry!.expected} /> : undefined
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
                onSelect={(c) => setOem(c === oem ? "" : c)}
              />
            ) : (
              <Empty onReset={() => setOem("")} />
            )}
          </WidgetCard>
        </div>
        <div className="span-4">
          <WidgetCard title={`Share Trend — ${oem || "Reported Universe"}`} subtitle={view.meta.share_caveat}>
            {trendPoints.some((p) => p.value !== null) ? (
              <TrendChart
                series={[{ name: oem || "Universe", color: PRIMARY, points: trendPoints }]}
                yFormat={(n) => (n * 100).toFixed(0) + "%"}
                ariaLabel="market share trend"
              />
            ) : (
              <Empty />
            )}
          </WidgetCard>
        </div>
      </div>

      <div className="grid row">
        <Insight title="Top share gainer" row={gainer} kind="chg" />
        <Insight title="Top share loser" row={loser} kind="chg" />
        <Insight title="Fastest growth" row={fastest} kind="yoy" />
      </div>
    </>
  );
}

function Insight({
  title,
  row,
  kind,
}: {
  title: string;
  row?: { company: string; chg: number | null; yoy: number | null; share: number | null };
  kind: "chg" | "yoy";
}) {
  const val = kind === "chg" ? row?.chg ?? null : row?.yoy ?? null;
  return (
    <div className="span-4">
      <WidgetCard title={title}>
        {row ? (
          <div className="insight">
            <div className="big">{row.company}</div>
            <div className="metric">
              <Delta text={kind === "chg" ? fmtPp(val) : fmtPct(val)} dir={deltaDir(val)} /> ·{" "}
              <span className="flat">{fmtShare(row.share)} share</span>
            </div>
          </div>
        ) : (
          <Empty />
        )}
      </WidgetCard>
    </div>
  );
}

// --- EV vs ICE ---
function EvTab({ view, pt, period }: { view: ViewModel; pt: PeriodType; period: Period }) {
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const evLatest = view.meta.ev_latest_period;
  // EV data ends Dec-2025; if the selected period is beyond that, use the last EV period
  const evAxis = axis.filter((p) => !evLatest || p.date <= evLatest);
  const evPeriod = evAxis.find((p) => p.key === period.key) ?? evAxis[evAxis.length - 1];
  const frozen = evLatest && period.date > evLatest;

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
  const penPoints = penAxis.map((p) => ({
    label: p.label,
    value: view.ev_penetration["domestic"]?.[pt]?.[p.key] ?? null,
  }));

  return (
    <>
      {frozen && (
        <Unavailable title={`EV data ends ${monthYear(evLatest!)}`}>
          The monthly source that extends totals past {monthYear(view.meta.file1_last_period)} has no EV split.
          Showing the latest EV period ({evPeriod.label}).
        </Unavailable>
      )}
      <div className="kpis" style={{ marginTop: frozen ? 12 : 0 }}>
        <Kpi label="EV volume" value={fmtUnitsCompact(evInd?.v)} cmp={yoyNode(evInd)} scope={evPeriod.label} />
        <Kpi label="EV YoY" value={evInd?.yoy == null ? "—" : fmtPct(evInd.yoy)} scope={evPeriod.label} />
        <Kpi
          label="EV share of 2W universe"
          value={fmtShare(pen)}
          cmp={pen != null && penPrior != null ? <Delta text={fmtPp(pen - penPrior)} dir={deltaDir(pen - penPrior)} /> : undefined}
          scope="EV penetration"
          caveat={view.meta.share_caveat + " — pure-EV makers outside SIAM are excluded, so this understates EV."}
        />
        <Kpi label="ICE volume" value={fmtUnitsCompact(ice.v)} scope={evPeriod.label} />
        <Kpi label="ICE share" value={pen == null ? "—" : fmtShare(1 - pen)} scope="of reported universe" />
      </div>

      <div className="grid row">
        <div className="span-8">
          <WidgetCard title="EV penetration of reported 2W universe" subtitle={view.meta.share_caveat}>
            {penPoints.some((p) => p.value !== null) ? (
              <TrendChart
                series={[{ name: "EV %", color: EV_GOLD, points: penPoints }]}
                yFormat={(n) => (n * 100).toFixed(0) + "%"}
                ariaLabel="EV penetration trend"
              />
            ) : (
              <Empty />
            )}
            <div className="legend">
              <span>
                <i style={{ background: EV_GOLD }} />
                EV
              </span>
              <span>
                <i style={{ background: ICE_GREY }} />
                ICE (remainder)
              </span>
            </div>
          </WidgetCard>
        </div>
        <div className="span-4">
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
      </div>
    </>
  );
}

// --- Production & Exports ---
function ProdTab({
  view,
  pt,
  period,
  oem,
  setOem,
}: {
  view: ViewModel;
  pt: PeriodType;
  period: Period;
  oem: string;
  setOem: (v: string) => void;
}) {
  const axis = view.periods[pt];
  const TOTAL = view.meta.industry_total_label;
  const key = period.key;
  const priorL = labelFor(axis, priorKey(pt, key));
  const expInd = pick(view, TOTAL, "export", "all", pt, key);

  const exp = buildTable(view, { flow: "export", powertrain: "all", periodType: pt, periodKey: key, totalLabel: TOTAL });

  // production exists only from File 2 (2026-01+). Pick the latest period that has data.
  const prodFirst = view.meta.production_first_period;
  const prodAxis = axis.filter((p) => !prodFirst || p.date >= prodFirst);
  const prodPeriod = prodAxis.find((p) => p.key === key) ?? prodAxis[prodAxis.length - 1];
  const prod = prodPeriod
    ? buildTable(view, { flow: "production", powertrain: "all", periodType: pt, periodKey: prodPeriod.key, totalLabel: TOTAL })
    : { rows: [], total: null };

  return (
    <>
      <div className="kpis">
        <Kpi label="Total Exports" value={fmtUnitsCompact(expInd?.v)} cmp={yoyNode(expInd)} scope={period.label} />
        <Kpi
          label={oem ? `${oem} Exports` : "Reported Exports"}
          value={fmtUnitsCompact((oem ? pick(view, oem, "export", "all", pt, key) : expInd)?.v)}
          scope={oem || "All OEMs"}
        />
        <Kpi label="Export YoY" value={expInd?.yoy == null ? "—" : fmtPct(expInd.yoy)} scope={`vs ${priorL}`} />
        <Kpi
          label="Production (2W)"
          value={prodPeriod ? fmtUnitsCompact(pick(view, TOTAL, "production", "all", pt, prodPeriod.key)?.v) : "—"}
          scope={prodPeriod ? prodPeriod.label : "unavailable"}
          caveat="2W production is reported only from Jan-2026 (monthly SIAM). Earlier periods are not available."
        />
        <Kpi label="Export share leaders" value={exp.rows[0]?.company ?? "—"} scope={fmtShare(exp.rows[0]?.share)} />
      </div>

      <div className="grid row">
        <div className="span-8">
          <WidgetCard title={`Exports by OEM — ${period.label} vs ${priorL}`} subtitle="SIAM reported universe">
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
        </div>
        <div className="span-4">
          <WidgetCard title="Production (2W)" subtitle="Maker-level, monthly SIAM">
            {prodPeriod && prod.rows.length ? (
              <>
                <div className="unavail" style={{ marginBottom: 10 }}>
                  <strong>Limited coverage</strong>
                  <span>
                    2W production is reported only from {monthYear(prodFirst!)}. Earlier periods are not in the
                    source and are not shown as zero.
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
              <Unavailable title="Production data not available">
                2W production is not reported for the selected period in the current source. Export analysis
                remains available above.
              </Unavailable>
            )}
          </WidgetCard>
        </div>
      </div>
    </>
  );
}

// --- Provenance ---
function Provenance({ view }: { view: ViewModel }) {
  const m = view.meta;
  return (
    <WidgetCard title="Source & provenance" subtitle="Every figure traces to a source file">
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
          <dt>Last built</dt>
          <dd>{new Date(m.generated_at).toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{m.snapshot_id ?? "—"}</dd>
        </div>
        <div>
          <dt>Company history from</dt>
          <dd>{monthYear(m.company_history_floor)} (share not computed earlier)</dd>
        </div>
      </dl>
      <div className="caveat">
        {m.share_caveat}. {m.notes}
      </div>
    </WidgetCard>
  );
}
