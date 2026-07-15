# Contract coverage — every `design.md` widget → contract fields

This reconciles the frozen contract (`pipeline/contract/schema.json`, v1.0.0) against every
widget in `design.md`. Done in Phase 0 on purpose: any field a widget needs but the schema
lacks is flagged and resolved **now**, not discovered in Phase 3.

**Verdict: the contract serves every widget.** One field was added (`is_partial` +
`periods_present`/`periods_expected`); everything else is served by the §3 fields or is a
computed/derived value, not a stored one.

Legend: **yes** = served by stored fields · **computed** = derived at query/build time from
stored fields (never stored) · **added** = required a schema addition, now made.

## Header, tabs, period navigation

| Widget | Required from contract | Covered |
|---|---|---|
| Category selector | `category` | yes |
| OEM selector | `company_canonical` | yes |
| Monthly/Quarterly/Yearly | `period_type`, `period_date`, `fiscal_year`, `fiscal_quarter` | yes |
| Metric: Sales/Exports/EV | `flow` (domestic/export), `powertrain` (ev) | yes |
| Year chips + period rail | `fiscal_year`, `fiscal_quarter`, `period_date` | yes |

## Sales & Market Share — KPIs

| KPI | Required | Covered |
|---|---|---|
| Total Industry Sales | Σ `value` where `flow=domestic`, `powertrain=all`, one `source` | computed |
| Selected OEM Sales | Σ `value` filtered by `company_canonical` | computed |
| YoY Growth | current vs prior-year `period_date` | computed |
| Share within Reported Universe | numerator/denominator under the same-scope guard; label from `source_universe_label` | computed |
| Share Change (pp) | current share − prior-year share | computed |

> Label note: the KPI reads "Total Industry Sales" but is really *total reported universe*
> (SIAM is incomplete). The number is a plain sum of reported rows; the qualifier is UI
> copy. The share KPI must use `source_universe_label`, never "market share".

## Sales & Market Share — table, chart, insights, provenance

| Widget | Required | Covered |
|---|---|---|
| Comparison table (OEM, cur, prior-yr, YoY, share, share Δpp) | `company_canonical`, `value`, `period_date`, computed share | yes / computed |
| Pinned TOTAL / REPORTED UNIVERSE row | Σ current rows for the single `source` | computed |
| Share-trend chart (per OEM, over time) | time series of computed share by `period_date` | computed |
| Insight strip (top gainer / loser / fastest growth) | computed deltas across OEMs with valid data | computed |
| Source / provenance card | `source`, `source_file`, `ingest_date` (last updated), min/max `period_date` (coverage), `revision`>0 (Revised badge) | yes |
| Metric definition ("Wholesale dispatches") | derived from `source` via `dictionaries/metrics.yaml` | yes (derived) |

## EV vs ICE

| Widget | Required | Covered |
|---|---|---|
| EV volume / YoY | `value` where `powertrain=ev` | yes / computed |
| EV share of reported 2W universe | ev / all under the same-scope guard | computed |
| EV share change (pp) | current − prior-year | computed |
| ICE volume / share | `powertrain=ice`, **derived** `= all − ev` (`calc_status=derived`) | computed |
| EV vs ICE trend | ev and derived-ice series over `period_date` | computed |
| EV OEM table | same as Sales table, filtered `powertrain=ev` | yes / computed |

## Production & Exports

| Widget | Required | Covered |
|---|---|---|
| Export KPIs / OEM table / trend | `flow=export` | yes / computed |
| 2W production unavailable state | **absence** of `flow=production` rows for `category=2W` | yes (by absence) |
| CV production quarterly-only | `flow=production`, `native_frequency=quarter`, `calc_status=reported` | yes |
| "Source-reported quarterly" badge / disable Monthly | `native_frequency=quarter` | yes |

## Widget states (design §13)

| State | Served by |
|---|---|
| Loading / Error | UI concern; no contract field needed |
| Empty | no rows match the filter | yes |
| Partial data | `value=null` rows present (marked —, never 0) | yes |
| Unsupported granularity (CV Monthly) | `native_frequency` | yes |
| Unsupported metric (2W Production) | absence of production rows | yes |
| **YTD / QTD (incomplete period)** | `is_partial`, `periods_present`, `periods_expected` | **added** |

---

## Resolved gaps and additions

1. **`is_partial` + `periods_present`/`periods_expected` (ADDED).** Design §11–§12 require
   labelling incomplete quarters/years as YTD/QTD. §3 had no completeness field. Added as
   typed ints (not a `"2/3"` string) so the frozen contract stays machine-safe.

2. **Measurement basis — kept derived from `source`, not a new column.** Design forbids
   mixing dispatches / registrations / sales. That distinction is `source` (SIAM=dispatch,
   VAHAN=registration); the one-source-per-table rule already blocks mixing. Human labels
   live in `dictionaries/metrics.yaml`.

3. **Powertrain / flow inclusive-dimension guard.** The workbook's `TWO WHEELERS = B35+B85`
   (Domestic+Exports), and its "Electric Two Wheelers" block is a **subset already inside**
   the Scooter/Motor-cycle rows. So `all ⊇ ev` and `total ⊇ domestic+export`. Summing across
   these double-counts. `pipeline/aggregate/periods.py` raises (never warns) on overlap, and
   ICE is derived (`all − ev`), never read/stored raw.

## Data-reality conflicts (data wins — flagged, not designed around)

- **2W production does not exist** in the source. Design already handles this with an honest
  unavailable card. No conflict — recorded so Phase 3 never fabricates it.
- **Company history starts Apr-2014, industry totals Apr-2012.** Company-level market share
  **cannot** be computed before FY15. Encoded in `constants.COMPANY_HISTORY_FLOOR`; charts
  must not imply company share pre-FY15.
- **Ola Electric is absent** from the SIAM workbook though it is a top e-2W maker. This is
  the concrete justification for the "reported SIAM universe" label — not pedantry.

## Phase-1 parser hazards (flag now, before Phase 1)

- Load the workbook with `openpyxl(data_only=True)`: **both** the totals (`=+B35+B85`) and
  the **date header row itself** (`=+EOMONTH(EC2,0)+1`) are formulas; the header also mixes
  real dates → formulas → the text `"FY25"` → blanks (mixed granularity in one row).
- `0` is a real reported value ("not launched"); blank is missing. Never coerce either way.
- Second source file (`Monthly_SIAM_Industry_Data_Jun26.xlsx`) has a **different shape**:
  one sheet per category and CV split into `MHCV`/`LCV`. The contract holds this
  (`segment` = MHCV/LCV under `category=CV`), but its adapter is separate Phase-2 work.
