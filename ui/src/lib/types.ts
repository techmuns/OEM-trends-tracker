// Types mirroring the precomputed view-model emitted by pipeline/build_view.py.
// The UI does NO business math — it selects and formats these precomputed fields.

export type PeriodType = "month" | "quarter" | "year";
export type Flow = "domestic" | "export" | "production";
export type Powertrain = "all" | "ev" | "ice";

export interface Point {
  v: number | null; // value
  prior: number | null; // matched-elapsed prior-year value (QTD/YTD basis, pairs with yoy)
  yoy: number | null; // fraction, e.g. 0.083 = +8.3%
  share: number | null; // fraction within reported universe of same flow+powertrain
  chg: number | null; // share change in percentage points (fraction)
  partial: boolean;
  present: number;
  expected: number;
  revised: boolean;
}

export interface Series {
  company: string;
  flow: Flow;
  powertrain: Powertrain;
  period_type: PeriodType;
  points: Record<string, Point>;
}

export interface Period {
  key: string;
  label: string;
  date: string;
  fiscal_year?: string;
  fiscal_quarter?: string;
}

export interface Meta {
  contract_version: string;
  generated_at: string;
  category: string;
  category_label: string;
  source: string;
  source_universe_label: string;
  share_caveat: string;
  coverage_start: string;
  latest_period: string;
  native_frequency: PeriodType;
  has_ev: boolean;
  has_production: boolean;
  ev_only_makers: string[]; // EV-only makers reported inline (never summed into an EV total)
  ev_latest_period: string | null;
  production_first_period: string | null;
  company_history_floor: string;
  file1_last_period: string;
  snapshot_id: string | null;
  notes: string | null;
  industry_total_label: string;
}

// data/bundle/categories.json — the categories the UI can switch between.
export interface CategoryInfo {
  key: string;
  label: string;
  latest_period: string;
  coverage_start: string;
  native_frequency: PeriodType;
  has_ev: boolean;
  has_production: boolean;
  source: string;
}

export interface Manifest {
  categories: CategoryInfo[];
}

export interface ViewModel {
  meta: Meta;
  companies: string[];
  flows: Flow[];
  periods: Record<PeriodType, Period[]>;
  ev_penetration: Record<string, Record<PeriodType, Record<string, number | null>>>;
  series: Series[];
}
