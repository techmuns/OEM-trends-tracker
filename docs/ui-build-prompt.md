# Claude Code Prompt — Build the OEM Tracker UI

Implement the OEM Tracker dashboard using the attached `design.md` and the approved UI mockup as the source of truth.

## Objective

Turn the existing OEM tracker into a simple, table-first, deeply insightful embedded dashboard. The first screen must directly answer sales, YoY growth, share movement, and historical trend questions without a marketing landing page or broad capability modules.

## Required UI

1. Keep the app as a `100vh` iframe layout with a 48px sticky header and only the content region scrolling.
2. Apply the approved dark visual system:
   - near-black canvas
   - warm cream text
   - champagne-gold selected states and chart emphasis
   - hairline borders
   - 4px card/button radii
   - no shadows, glows, gradients, card lifts, or hover expansion
3. Header controls:
   - Category
   - OEM
   - Monthly / Quarterly / Yearly
   - Metric: Sales / Exports / EV
   - Refresh
   - Export Excel / PDF
4. Add three primary tabs directly below the header:
   - Sales & Market Share — default
   - EV vs ICE
   - Production & Exports
5. Build the default Sales & Market Share view exactly in this order:
   - year/period navigation
   - five KPI cards
   - main OEM comparison table
   - selected OEM market-share trend chart
   - three compact insight cards
   - source/provenance card

## Main table

Make the table the dominant element. Default columns:

- OEM
- current-period sales
- comparable prior-year sales
- YoY
- current-period share within reported universe
- share change in percentage points

Requirements:

- sticky table header
- sticky OEM column
- current sales descending by default
- pinned total/reported-universe row
- subtle alternate row tint only
- positive/negative colour only on deltas
- clicking a row selects the OEM and updates the chart/KPIs
- include `Both | Absolute | YoY` display mode; default `Both`
- do not create separate pages for table detail; expand inline

## Period behaviour

- Monthly uses month labels such as `Jun '26`.
- Quarterly uses fiscal labels such as `Q1 FY27`.
- Yearly uses `FY27`.
- Fiscal year is April–March.
- Current and prior-year comparisons must use equivalent complete periods.
- If a period is incomplete, label it YTD/QTD and compare equivalent elapsed months only.

## EV vs ICE

Create a dedicated tab with:

- EV volume
- EV YoY
- EV share within reported 2W universe
- EV share change in pp
- ICE volume/share
- EV vs ICE trend
- EV OEM table showing current volume, prior-year volume, YoY, reported-universe share, and pp change

Use champagne gold for EV and muted warm grey for ICE. Never label incomplete-universe share as unqualified `market share`.

## Production & Exports

- Exports are supported and should have KPIs, OEM table, and trend chart.
- Do not invent 2W production data.
- For Two-Wheelers, display this exact state:

`Production data is not available for Two-Wheelers in the current source workbook. Export analysis remains available. Production will appear here only after a validated source is connected.`

- CV production is quarterly only. Disable Monthly and label it `Source-reported quarterly data`.

## Data integrity

- One table/chart = one source.
- Numerator and denominator for share must come from the same source, segment, and period.
- Display metric definition, source, last updated, coverage, and revision status.
- Sales, wholesale dispatches, registrations, exports, and production are not interchangeable.
- Missing values use `—`; never convert missing data to zero.
- Do not use placeholder or invented production values.

## Styling tokens

Use these as the base:

```css
--canvas: #080a0b;
--surface-1: #0e1113;
--surface-2: #131719;
--text-primary: #fff7dd;
--text-secondary: rgba(255,247,221,.72);
--text-muted: rgba(255,247,221,.46);
--accent: #c8ad86;
--accent-soft: rgba(200,173,134,.12);
--border: rgba(255,247,221,.14);
--positive: #4ade80;
--negative: #ff6b5e;
--ice: #66635f;
```

Use Switzer if already available; otherwise Inter/system sans. Use tabular numerals for all figures.

## States

Implement loading, empty, error, partial-data, unsupported-metric, unsupported-granularity, and export-capture states for every analytical widget. Preserve layout dimensions during loading. Do not use fake data to fill gaps.

## Engineering constraints

- Reuse the existing data pipeline and application structure wherever possible.
- Do not rewrite working ingestion/calculation logic without evidence it is incorrect.
- Keep components reusable across 2W, PV, 3W, Tractors, and CV.
- Keep filters and selected state in URL query parameters.
- Do not add a persistent left sidebar.
- Do not add AI commentary, supplier mapping, product benchmarking, pricing modules, or marketing copy in this version.
- No hover-triggered layout changes.

## Final validation

Before finishing, verify:

- Jun '26 can be compared directly with Jun '25.
- Absolute values and YoY are both visible.
- Share movement is shown in percentage points.
- Hero MotoCorp/Ather-style share trends are easy to identify.
- EV vs ICE is separate and clearly qualified.
- Exports work in 2W.
- Production is not fabricated for 2W.
- Every table/chart includes source and freshness.
- The UI visually matches the approved mockup while remaining responsive and buildable.
