// Compare Workspace state — deliberately lifted ABOVE the category loader so the workspace
// survives page switches (Sales / EV / Production) and category switches within a session.
//
// The comparison is organised into up to two saved CHART SLOTS: the analyst can build one
// comparison, keep it, and start another, switching between the two. Slots (with their
// captured series) and the UI preferences (split ratio, view mode, frequency, expanded) are
// persisted to localStorage, so a saved chart comes back.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PeriodType } from "./types";
import { type CompareSeries, dedupeKey, MAX_SERIES, WARN_SERIES } from "./compare";
import { DRAG_END, DRAG_START } from "./dragfx";

export type ViewMode = "chart" | "table" | "split";
export type ChartMode = "raw" | "indexed" | "dual";

export const MAX_CHARTS = 2;

export interface Notice {
  text: string;
  tone: "info" | "warn" | "error";
}

// One saved comparison chart.
interface Slot {
  id: string;
  name: string;
  series: CompareSeries[];
  focusedId: string | null;
}

export interface ChartMeta {
  id: string;
  name: string;
  count: number;
}

interface CompareState {
  // active-slot view of the comparison
  series: CompareSeries[];
  focusedId: string | null;
  // saved charts
  charts: ChartMeta[];
  activeId: string;
  // panel/layout
  isOpen: boolean;
  expanded: boolean;
  ratio: number;
  viewMode: ViewMode;
  chartMode: ChartMode;
  freqPref: PeriodType;
  rangeIdx: number;
  dragging: boolean;
  notice: Notice | null;

  add: (s: CompareSeries) => void;
  remove: (id: string) => void;
  clear: () => void;
  reorder: (fromId: string, toId: string) => void;
  focus: (id: string | null) => void;
  newChart: () => void;
  selectChart: (id: string) => void;
  removeChart: (id: string) => void;
  renameChart: (id: string, name: string) => void;
  open: () => void;
  close: () => void;
  goHome: () => void;
  setExpanded: (b: boolean) => void;
  setRatio: (r: number) => void;
  setViewMode: (m: ViewMode) => void;
  setChartMode: (m: ChartMode) => void;
  setFreqPref: (f: PeriodType) => void;
  setRangeIdx: (i: number) => void;
  setNotice: (n: Notice | null) => void;
}

const Ctx = createContext<CompareState | null>(null);

const LS_PREFS = "oemc.prefs";
const LS_CHARTS = "oemc.charts";

// `expanded` is intentionally NOT persisted — it is a transient view mode, and persisting it
// is what could leave the panel collapsed-but-expanded (a blank screen) after a reload.
interface Prefs {
  ratio: number;
  viewMode: ViewMode;
  chartMode: ChartMode;
  freqPref: PeriodType;
  rangeIdx: number;
}
const DEFAULT_PREFS: Prefs = {
  ratio: 0.6,
  viewMode: "split",
  // Raw by default so same-unit series plot on a shared raw axis; mixed units auto-index
  // (see CompareChart.effMode), which also flips the control to Indexed.
  chartMode: "raw",
  freqPref: "month",
  rangeIdx: 1,
};

let SEQ = 0;
function uid(): string {
  SEQ += 1;
  return `chart_${Date.now().toString(36)}_${SEQ}`;
}

function firstFreeName(charts: Slot[]): string {
  for (let i = 1; i <= MAX_CHARTS; i++) {
    const name = `Chart ${i}`;
    if (!charts.some((c) => c.name === name)) return name;
  }
  return `Chart ${charts.length + 1}`;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function newSlot(name = "Chart 1"): Slot {
  return { id: uid(), name, series: [], focusedId: null };
}

function loadCharts(): { charts: Slot[]; activeId: string } {
  try {
    const raw = localStorage.getItem(LS_CHARTS);
    if (raw) {
      const parsed = JSON.parse(raw) as { charts: Slot[]; activeId: string };
      if (parsed?.charts?.length) {
        const charts = parsed.charts.slice(0, MAX_CHARTS);
        const activeId = charts.some((c) => c.id === parsed.activeId) ? parsed.activeId : charts[0].id;
        return { charts, activeId };
      }
    }
  } catch {
    /* fall through to a fresh single chart */
  }
  const s = newSlot();
  return { charts: [s], activeId: s.id };
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [p0] = useState(loadPrefs); // read persisted UI prefs once, on mount
  const [c0] = useState(loadCharts); // read persisted chart slots once, on mount

  const [charts, setCharts] = useState<Slot[]>(c0.charts);
  const [activeId, setActiveId] = useState<string>(c0.activeId);
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpandedState] = useState(false);
  const [ratio, setRatioState] = useState(p0.ratio);
  const [viewMode, setViewModeState] = useState<ViewMode>(p0.viewMode);
  const [chartMode, setChartModeState] = useState<ChartMode>(p0.chartMode);
  const [freqPref, setFreqPrefState] = useState<PeriodType>(p0.freqPref);
  const [rangeIdx, setRangeIdxState] = useState(p0.rangeIdx);
  const [dragging, setDragging] = useState(false);
  const [notice, setNoticeState] = useState<Notice | null>(null);

  const active = charts.find((c) => c.id === activeId) ?? charts[0];

  // persist UI preferences (not `expanded` — see Prefs)
  useEffect(() => {
    try {
      localStorage.setItem(LS_PREFS, JSON.stringify({ ratio, viewMode, chartMode, freqPref, rangeIdx }));
    } catch {
      /* storage disabled — degrade silently */
    }
  }, [ratio, viewMode, chartMode, freqPref, rangeIdx]);

  // persist the saved chart slots (this is the "save")
  useEffect(() => {
    try {
      localStorage.setItem(LS_CHARTS, JSON.stringify({ charts, activeId }));
    } catch {
      /* storage full/disabled — degrade silently */
    }
  }, [charts, activeId]);

  // reflect an in-flight compare drag so the dock tab can present itself as a drop target
  useEffect(() => {
    const on = () => setDragging(true);
    const off = () => setDragging(false);
    window.addEventListener(DRAG_START, on);
    window.addEventListener(DRAG_END, off);
    return () => {
      window.removeEventListener(DRAG_START, on);
      window.removeEventListener(DRAG_END, off);
    };
  }, []);

  const noticeTimer = useRef<number | undefined>(undefined);
  const setNotice = useCallback((n: Notice | null) => {
    setNoticeState(n);
    window.clearTimeout(noticeTimer.current);
    if (n) noticeTimer.current = window.setTimeout(() => setNoticeState(null), 5000);
  }, []);

  // --- mutate the ACTIVE slot ---
  const mutateActive = useCallback(
    (fn: (slot: Slot) => Slot) => setCharts((prev) => prev.map((c) => (c.id === activeId ? fn(c) : c))),
    [activeId],
  );

  const add = useCallback(
    (s: CompareSeries) => {
      mutateActive((slot) => {
        const key = dedupeKey(s);
        const existing = slot.series.find((x) => dedupeKey(x) === key);
        if (existing) {
          setNotice({ text: `${s.display} · ${s.metricLabel} is already in this chart.`, tone: "info" });
          return { ...slot, focusedId: existing.id };
        }
        if (slot.series.length >= MAX_SERIES) {
          setNotice({ text: `Comparison is limited to ${MAX_SERIES} series to preserve readability.`, tone: "error" });
          return slot;
        }
        const series = [...slot.series, s];
        if (series.length > WARN_SERIES) {
          setNotice({
            text: `${series.length} series — chart readability starts to deteriorate beyond ${WARN_SERIES}.`,
            tone: "warn",
          });
        } else {
          setNotice(null);
        }
        return { ...slot, series, focusedId: s.id };
      });
      setIsOpen(true);
    },
    [mutateActive, setNotice],
  );

  const remove = useCallback(
    (id: string) => mutateActive((slot) => ({ ...slot, series: slot.series.filter((s) => s.id !== id), focusedId: slot.focusedId === id ? null : slot.focusedId })),
    [mutateActive],
  );

  const clear = useCallback(() => {
    mutateActive((slot) => ({ ...slot, series: [], focusedId: null }));
    setNoticeState(null);
  }, [mutateActive]);

  const reorder = useCallback(
    (fromId: string, toId: string) =>
      mutateActive((slot) => {
        if (fromId === toId) return slot;
        const from = slot.series.findIndex((s) => s.id === fromId);
        const to = slot.series.findIndex((s) => s.id === toId);
        if (from < 0 || to < 0) return slot;
        const series = [...slot.series];
        const [moved] = series.splice(from, 1);
        series.splice(to, 0, moved);
        return { ...slot, series };
      }),
    [mutateActive],
  );

  const focus = useCallback((id: string | null) => mutateActive((slot) => ({ ...slot, focusedId: id })), [mutateActive]);

  // --- chart slots ---
  const newChart = useCallback(() => {
    setCharts((prev) => {
      if (prev.length >= MAX_CHARTS) {
        setNotice({ text: `You can keep up to ${MAX_CHARTS} charts. Remove one to add another.`, tone: "info" });
        return prev;
      }
      const slot = newSlot(firstFreeName(prev));
      setActiveId(slot.id);
      return [...prev, slot];
    });
    setIsOpen(true);
  }, [setNotice]);

  const selectChart = useCallback((id: string) => setActiveId(id), []);

  const removeChart = useCallback((id: string) => {
    setCharts((prev) => {
      if (prev.length <= 1) {
        // never delete the last chart — just empty it
        return prev.map((c) => (c.id === id ? { ...c, series: [], focusedId: null } : c));
      }
      const next = prev.filter((c) => c.id !== id);
      setActiveId((a) => (a === id ? next[0].id : a));
      return next;
    });
  }, []);

  const renameChart = useCallback(
    (id: string, name: string) => setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c))),
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setExpandedState(false); // never leave the panel collapsed-but-expanded
  }, []);

  const goHome = useCallback(() => {
    setIsOpen(false);
    setExpandedState(false);
  }, []);

  const chartMetas: ChartMeta[] = charts.map((c) => ({ id: c.id, name: c.name, count: c.series.length }));

  const value = useMemo<CompareState>(
    () => ({
      series: active.series,
      focusedId: active.focusedId,
      charts: chartMetas,
      activeId,
      isOpen,
      expanded,
      ratio,
      viewMode,
      chartMode,
      freqPref,
      rangeIdx,
      dragging,
      notice,
      add,
      remove,
      clear,
      reorder,
      focus,
      newChart,
      selectChart,
      removeChart,
      renameChart,
      open: () => setIsOpen(true),
      close,
      goHome,
      setExpanded: setExpandedState,
      setRatio: setRatioState,
      setViewMode: setViewModeState,
      setChartMode: setChartModeState,
      setFreqPref: setFreqPrefState,
      setRangeIdx: setRangeIdxState,
      setNotice,
    }),
    // chartMetas is derived from charts; active from charts+activeId
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      active,
      charts,
      activeId,
      isOpen,
      expanded,
      ratio,
      viewMode,
      chartMode,
      freqPref,
      rangeIdx,
      dragging,
      notice,
      add,
      remove,
      clear,
      reorder,
      focus,
      newChart,
      selectChart,
      removeChart,
      renameChart,
      close,
      goHome,
      setNotice,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompare(): CompareState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCompare must be used within CompareProvider");
  return ctx;
}
