// Compare Workspace state — deliberately lifted ABOVE the category loader so the workspace
// survives page switches (Sales / EV / Production) and category switches within a session.
// The series list (with its captured data) lives in memory; only lightweight UI preferences
// (split ratio, view mode, expanded/collapsed, frequency, range) persist to localStorage so
// the layout the analyst set up comes back.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PeriodType } from "./types";
import { type CompareSeries, dedupeKey, MAX_SERIES, WARN_SERIES } from "./compare";
import { DRAG_END, DRAG_START } from "./dragfx";

export type ViewMode = "chart" | "table" | "split";
export type ChartMode = "raw" | "indexed" | "dual";

export interface Notice {
  text: string;
  tone: "info" | "warn" | "error";
}

interface CompareState {
  series: CompareSeries[];
  focusedId: string | null;
  isOpen: boolean;
  expanded: boolean;
  ratio: number; // analysis-pane fraction of the split (0..1)
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
  open: () => void;
  close: () => void;
  setExpanded: (b: boolean) => void;
  setRatio: (r: number) => void;
  setViewMode: (m: ViewMode) => void;
  setChartMode: (m: ChartMode) => void;
  setFreqPref: (f: PeriodType) => void;
  setRangeIdx: (i: number) => void;
  setNotice: (n: Notice | null) => void;
}

const Ctx = createContext<CompareState | null>(null);

const LS = "oemc.prefs";
interface Prefs {
  ratio: number;
  viewMode: ViewMode;
  chartMode: ChartMode;
  freqPref: PeriodType;
  rangeIdx: number;
  expanded: boolean;
}
const DEFAULT_PREFS: Prefs = {
  ratio: 0.6,
  viewMode: "split",
  // Raw by default so same-unit series plot on a shared raw axis; mixed units auto-index
  // (see CompareChart.effMode), which also flips the control to Indexed.
  chartMode: "raw",
  freqPref: "month",
  rangeIdx: 1,
  expanded: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [p0] = useState(loadPrefs); // read persisted UI prefs once, on mount

  const [series, setSeries] = useState<CompareSeries[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpandedState] = useState(p0.expanded);
  const [ratio, setRatioState] = useState(p0.ratio);
  const [viewMode, setViewModeState] = useState<ViewMode>(p0.viewMode);
  const [chartMode, setChartModeState] = useState<ChartMode>(p0.chartMode);
  const [freqPref, setFreqPrefState] = useState<PeriodType>(p0.freqPref);
  const [rangeIdx, setRangeIdxState] = useState(p0.rangeIdx);
  const [dragging, setDragging] = useState(false);
  const [notice, setNoticeState] = useState<Notice | null>(null);

  // persist UI preferences (not the in-memory series)
  useEffect(() => {
    const prefs: Prefs = { ratio, viewMode, chartMode, freqPref, rangeIdx, expanded };
    try {
      localStorage.setItem(LS, JSON.stringify(prefs));
    } catch {
      /* storage disabled — degrade silently */
    }
  }, [ratio, viewMode, chartMode, freqPref, rangeIdx, expanded]);

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

  // transient notice — auto-dismiss
  const noticeTimer = useRef<number | undefined>(undefined);
  const setNotice = useCallback((n: Notice | null) => {
    setNoticeState(n);
    window.clearTimeout(noticeTimer.current);
    if (n) noticeTimer.current = window.setTimeout(() => setNoticeState(null), 5000);
  }, []);

  const add = useCallback(
    (s: CompareSeries) => {
      setSeries((prev) => {
        const key = dedupeKey(s);
        const existing = prev.find((x) => dedupeKey(x) === key);
        if (existing) {
          setFocusedId(existing.id);
          setNotice({ text: `${s.display} · ${s.metricLabel} is already in the comparison.`, tone: "info" });
          return prev;
        }
        if (prev.length >= MAX_SERIES) {
          setNotice({ text: `Comparison is limited to ${MAX_SERIES} series to preserve readability.`, tone: "error" });
          return prev;
        }
        const next = [...prev, s];
        setFocusedId(s.id);
        if (next.length > WARN_SERIES) {
          setNotice({
            text: `${next.length} series — chart readability starts to deteriorate beyond ${WARN_SERIES}.`,
            tone: "warn",
          });
        } else {
          setNotice(null);
        }
        return next;
      });
      setIsOpen(true);
    },
    [setNotice],
  );

  const remove = useCallback((id: string) => {
    setSeries((prev) => prev.filter((s) => s.id !== id));
    setFocusedId((f) => (f === id ? null : f));
  }, []);

  const clear = useCallback(() => {
    setSeries([]);
    setFocusedId(null);
    setNoticeState(null);
  }, []);

  const reorder = useCallback((fromId: string, toId: string) => {
    setSeries((prev) => {
      if (fromId === toId) return prev;
      const from = prev.findIndex((s) => s.id === fromId);
      const to = prev.findIndex((s) => s.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const value = useMemo<CompareState>(
    () => ({
      series,
      focusedId,
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
      focus: setFocusedId,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      setExpanded: setExpandedState,
      setRatio: setRatioState,
      setViewMode: setViewModeState,
      setChartMode: setChartModeState,
      setFreqPref: setFreqPrefState,
      setRangeIdx: setRangeIdxState,
      setNotice,
    }),
    [
      series,
      focusedId,
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
