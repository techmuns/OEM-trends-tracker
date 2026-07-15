# OEM Tracker — Design Specification

## 1. Product objective

Build an embedded, table-first OEM intelligence dashboard that replaces a wide historical Excel tracker. The first screen must let an analyst answer, within a few seconds:

- How much did the industry and each OEM sell?
- How fast is each OEM growing YoY?
- Who is gaining or losing share?
- How has share moved across time?
- How is EV penetration changing versus ICE?
- What are the latest export and production trends where valid data exists?

The product must feel simple on the surface, but expose deep time-series analysis without forcing the user to navigate through multiple pages.

## 2. Core design principles

1. **Serve the requested questions directly.** Do not add a marketing hero, capability catalogue, or broad automotive-intelligence modules.
2. **Table first, chart second.** The comparison table is the main analytical object. Charts only reinforce a selected row or trend.
3. **History must stay visible.** Always make the current period and comparable prior-year period easy to compare.
4. **One source per analytical object.** A table or chart must never combine incompatible sources, definitions, segments, or periods.
5. **Restraint is the polish.** Use compact spacing, hairline borders, precise alignment, minimal accent colour, and no decorative effects.

## 3. App shell

The dashboard is an embedded iframe, not a standalone website.

```text
Dashboard App
├── Zone 1: Sticky Header — 48px
└── Zone 2: Scrollable Content — flex: 1
```

### Shell rules

- Root: `height: 100vh; overflow: hidden; background: #080a0b`.
- Only Zone 2 scrolls.
- No persistent left sidebar.
- No full-page marketing content.
- Desktop-first, responsive down to tablet and mobile.
- Main content padding: `20px 28px 28px`.
- Maximum content width: none inside the iframe; use the full available width.

## 4. Visual direction

Premium dark analytical interface inspired by the approved mockup and the Atoms-style reference.

### Colour tokens

```css
:root {
  --canvas: #080a0b;
  --surface-1: #0e1113;
  --surface-2: #131719;
  --surface-hover: #171b1e;

  --text-primary: #fff7dd;
  --text-secondary: rgba(255, 247, 221, 0.72);
  --text-muted: rgba(255, 247, 221, 0.46);
  --text-disabled: rgba(255, 247, 221, 0.28);

  --accent: #c8ad86;
  --accent-soft: rgba(200, 173, 134, 0.12);
  --accent-border: rgba(200, 173, 134, 0.58);

  --border: rgba(255, 247, 221, 0.14);
  --border-subtle: rgba(255, 247, 221, 0.08);

  --positive: #4ade80;
  --positive-soft: rgba(74, 222, 128, 0.10);
  --negative: #ff6b5e;
  --negative-soft: rgba(255, 107, 94, 0.10);
  --neutral-data: #8b8b86;
}
```

### Colour usage

- Champagne gold is the single UI accent: selected tabs, key lines, active borders, and important totals.
- Green and red are used only for analytical direction.
- Do not colour entire rows or cards green/red.
- EV = champagne gold.
- ICE = muted warm grey `#66635f`.
- Historical comparison line = cream at 55% opacity.

### Typography

Preferred: `Switzer`, fallback to `Inter`, then system sans-serif.

| Role | Size | Weight | Colour |
|---|---:|---:|---|
| Dashboard title | 17px | 600 | primary |
| Main tab | 13px | 500 | secondary / accent when active |
| Widget title | 13px | 500 | primary |
| KPI label | 11px | 500 | secondary |
| KPI value | 24px | 500 | primary |
| Table header | 11px | 500 | secondary |
| Table body | 13px | 400 | primary |
| Caption/source | 11px | 400 | muted |

- Use tight tracking for headings only: `-0.02em`.
- Use `font-variant-numeric: tabular-nums` for all numerical values.

### Shape and elevation

- Card radius: `4px`.
- Button radius: `4px`.
- Pill radius: `999px` only for compact segmented controls/chips.
- No shadows, glows, glassmorphism, or decorative gradients.
- Cards are separated using 1px hairline borders and small tonal shifts only.

## 5. Information architecture

### Zone 1 — sticky header

Height exactly `48px`.

**Left**
- Product title: `OEM Tracker`.

**Right controls**
1. Category selector: default `Two-Wheelers`.
2. OEM selector: default `All OEMs`.
3. Period granularity segmented control: `Monthly | Quarterly | Yearly`.
4. Metric selector: `Sales | Exports | EV`.
5. Refresh icon with tooltip containing last refresh timestamp.
6. Export button with dropdown: `Export current view as Excel`, `Export current view as PDF`.

Header styling:
- Background `#080a0b` at 96% opacity.
- Bottom border `1px solid var(--border)`.
- Controls are 32px high with transparent/dark surfaces and hairline borders.

### Zone 2 — first-screen order

1. Primary analysis tabs.
2. Period navigation.
3. KPI row.
4. Main comparison table + selected OEM trend chart.
5. Insight strip.
6. Source/provenance card.

The default screen opens directly on live data. There is no separate landing or onboarding page.

## 6. Primary analysis tabs

Place immediately below the header in a 3-column segmented row, height `58px`.

1. **Sales & Market Share** — default active.
2. **EV vs ICE**.
3. **Production & Exports**.

### Tab styling

- Background: `var(--surface-1)`.
- Border: `1px solid var(--border)`.
- Active tab: accent text, accent border, and a `2px` bottom accent line.
- Inactive icons/text use muted cream.
- No animated sliding indicator. Use a fast 120ms colour/border transition only.

## 7. Period navigation

Directly below the analysis tabs.

### Year chips

A horizontal row of available years, newest first: `2026, 2025, 2024, ...`.

- Active year: accent border + `var(--accent-soft)` fill.
- Show a maximum of six chips, with `More years` for older history.

### Adaptive period rail

A compact period navigator sits to the left of the main content on desktop. It is part of the content grid, not a persistent sidebar.

- Monthly: show months for the selected year, newest first.
- Quarterly: show fiscal quarters, e.g. `Q1 FY27`, `Q4 FY26`.
- Yearly: hide the rail; year chips become the only period selector.
- Active period uses an accent dot and text.
- Historical periods use muted dots and text.
- On widths below 1180px, replace the vertical rail with a horizontal scrollable period strip above the KPIs.

Fiscal-year rule: April–March. June 2026 belongs to `Q1 FY27`.

## 8. Default page — Sales & Market Share

### 8.1 KPI row

Five equal cards on wide desktop; wrap to three plus two below when needed.

1. **Total Industry Sales**
   - Current period volume.
   - YoY industry growth beneath.

2. **Selected OEM Sales**
   - Sum for selected OEMs; if `All OEMs`, show reported-universe total.
   - YoY growth beneath.

3. **YoY Growth**
   - Growth for selected OEM or selected reported universe.
   - Show prior-period comparison only when meaningful.

4. **Share within Reported Universe**
   - Never label as plain `Market Share` where the source universe is incomplete.
   - Show prior-year share beneath.

5. **Share Change (pp)**
   - Current share minus comparable prior-year share.
   - Always use percentage points, never percentage growth.

KPI card specifications:
- Minimum height `104px`.
- Padding `16px 18px`.
- Source tooltip on info icon.
- Positive/negative colour only on the delta line.

### 8.2 Main analytical region

12-column desktop grid:

- Period rail: 1 column.
- Comparison table: 7 columns.
- Trend chart: 4 columns.

When the period rail is hidden, the table gets 8 columns and chart 4.

#### Comparison table card

**Title:** `OEM Sales & Share Snapshot — Jun '26 vs Jun '25`

**Role:** Primary analytical object and Excel replacement.

**Default columns**

| Column | Rule |
|---|---|
| OEM | Sticky first column; company name only, optional selected marker |
| Jun '26 Sales | Current period absolute units |
| Jun '25 Sales | Comparable prior-year absolute units |
| YoY | `(current / prior year) - 1` |
| Jun '26 Share | Numerator and denominator from same source/universe |
| Share Change (pp) | Current share minus prior-year share |

**Default rows**
- All OEMs available for the selected source/category.
- Sort by current-period sales descending.
- Final pinned total row: `TOTAL / REPORTED UNIVERSE`.

**Table behaviour**
- Sticky header.
- Sticky first column.
- Row height `38px`; header `36px`.
- Alternating row treatment uses only a 2–3% surface-value difference.
- Hover changes background slightly; no movement.
- Clicking a row selects the OEM and updates the trend chart and selected-OEM KPIs.
- Multi-select is available through checkboxes revealed via `Compare OEMs`, not shown by default.
- `View details` expands the same table into a full-width drilldown below; it does not open a separate page.
- Column sorting allowed for current sales, YoY, current share, and share change.
- No pagination for the main table unless there are more than 30 OEMs; use a fixed-height scroll area after 12 visible rows.

**Display-mode control inside the table header**

`Both | Absolute | YoY`

- Default `Both`.
- `Absolute` hides YoY and share-change columns.
- `YoY` prioritises YoY and share-change columns while retaining the OEM column and current share.

#### Market share trend card

**Title:** `Share Trend — [Selected OEM]`

- Secondary to the table.
- Default range: 12 months for Monthly, 8 quarters for Quarterly, 5 fiscal years for Yearly.
- Range control: `6M | 12M | 24M` for Monthly; equivalent period counts for other granularities.
- One selected OEM by default.
- Compare mode supports up to four OEM lines.
- Selected line: champagne gold, 2px.
- Comparison lines: cream/grey at reduced opacity.
- Direct labels at the latest data point; avoid a large legend.
- Y-axis should use a truthful domain with visible tick labels; do not exaggerate changes.
- Source and metric definition appear in the card footer.

### 8.3 Insight strip

Three compact insight cards:

1. **Top share gainer** — OEM, pp change, current share.
2. **Top share loser** — OEM, pp change, current share.
3. **Fastest growth** — OEM, YoY, current volume.

Rules:
- Derived only from OEMs with valid current and comparable-period data.
- Exclude low-base anomalies only if an explicit minimum-volume threshold is configured; disclose the threshold in a tooltip.
- Each card is clickable and selects the corresponding OEM in the table/chart.
- No generic AI-written commentary in v1.

### 8.4 Source/provenance card

Always visible below the analytical region.

Show:
- Source name.
- Metric definition, e.g. `Wholesale dispatches`.
- Selected category and reported universe.
- Last updated timestamp.
- Data coverage start/end.
- Revised-period badge when a historical value changed in a newer file.
- Caveat: `Share shown within reported SIAM universe.`

## 9. EV vs ICE tab

The tab must answer two separate questions:

1. How is total EV penetration changing versus ICE?
2. Which EV OEMs are gaining or losing share within the reported EV universe?

### KPI row

- EV volume.
- EV YoY growth.
- EV share of reported 2W universe.
- EV share change in pp.
- ICE volume or ICE share.

### Primary visual

Use a 100% stacked area/column chart or two-share trend lines for EV vs ICE over time.

- EV = champagne gold.
- ICE = muted warm grey.
- Always show the source universe in the title/subtitle.

### EV OEM table

Columns:
- EV OEM.
- Current EV volume.
- Prior-year EV volume.
- YoY.
- Share within reported EV universe.
- Share change (pp).

Use the same table interaction and formatting rules as the Sales tab.

## 10. Production & Exports tab

This tab must be honest about coverage.

### Exports section

Exports are fully supported across categories.

Show:
- Total exports.
- Export YoY.
- Selected OEM exports.
- Export share within reported source universe.
- OEM export comparison table.
- Export trend chart.

### Production section

Current source coverage supports production only for CV.

For Two-Wheelers, show a restrained unavailable card:

> **Production data is not available for Two-Wheelers in the current source workbook.** Export analysis remains available. Production will appear here only after a validated source is connected.

Do not show zero values, dashed fake lines, or estimates.

For CV:
- Monthly control is disabled because CV is source-reported quarterly only.
- Show badge: `Source-reported quarterly data`.
- Never represent quarterly data as monthly.

## 11. Time-series and aggregation logic

- Monthly is the base period where available.
- Quarterly = sum of the three fiscal-quarter months.
- Yearly = sum of April–March.
- Comparable YoY period must match granularity and completeness.
- If the current quarter/year is incomplete, label it `YTD` or `Quarter to date`; never compare partial current periods to full prior periods without matching the same elapsed months.
- CV quarterly data is source-reported, not derived.
- Revised historical periods receive a subtle `Revised` badge and revision tooltip.

## 12. Number and date formatting

- Units: exact integer units in tables using `Intl.NumberFormat('en-IN')`.
- KPIs may use compact Indian notation only when space requires it, e.g. `16.72L`, with exact value in tooltip.
- YoY: one decimal, e.g. `+8.3%`.
- Share: one decimal, e.g. `28.0%`.
- Share change: one decimal and `pp`, e.g. `+0.8 pp`.
- Monthly: `Jun '26`.
- Quarterly: `Q1 FY27`.
- Yearly: `FY27`.
- Missing value: em dash `—`, never `0` unless the source explicitly reports zero.

## 13. Widget states

Every KPI, table, and chart must support:

### Loading
- Preserve the final layout dimensions.
- Use subtle low-contrast skeleton blocks.
- No shimmer animation; use a static or slow opacity pulse.

### Empty
- `No data is available for the selected period and filters.`
- Offer `Reset filters` when relevant.

### Error
- `This dataset could not be loaded. Try refreshing the dashboard.`
- Show a compact `Retry` action.

### Partial data
- `Some OEMs or periods are unavailable in the selected source. Available values are shown; missing values are marked —.`
- Add an amber-neutral coverage badge, not a red error state.

### Unsupported granularity
- CV Monthly: `Monthly data is not reported for CV. Switch to Quarterly or Yearly.`

### Unsupported metric
- 2W Production: use the exact copy defined in Section 10.

### Export capture
- Remove hover states, sticky overlays, internal scroll clipping, and tooltips.
- Expand the visible table to include all filtered rows.
- Include filters, period, source, definition, and last-updated timestamp in the capture.

## 14. Responsive behaviour

### >= 1440px
- Full five-card KPI row.
- Period rail + table + chart in one row.

### 1180–1439px
- Period rail becomes horizontal strip.
- Table 7 columns, chart 5 columns.
- KPI cards may wrap 3 + 2.

### 768–1179px
- Main table full width.
- Chart moves below the table.
- Tabs remain 3 columns with shorter labels where needed.
- Header controls may wrap into a compact second toolbar inside Zone 2.

### < 768px
- Analysis tabs become horizontally scrollable.
- KPI cards become a 2-column grid.
- Table remains horizontally scrollable with sticky OEM column.
- Chart below the table.
- Export defaults to PDF only if Excel control cannot fit.

## 15. Interaction rules

- No hover-triggered expansion or navigation.
- No animated cards, lifts, glows, or scale changes.
- Use click/tap for selection.
- Keep selected OEM, category, metric, period granularity, and period in the URL query string.
- Switching tabs preserves compatible filters.
- Switching category resets unsupported metrics/granularities with an explicit inline message.
- Export reflects the current filters and selected tab.

## 16. Accessibility

- Minimum text contrast WCAG AA.
- Never rely on red/green alone; pair direction with `+`, `−`, and arrow icons.
- Visible keyboard focus: 1px cream outline plus 2px offset.
- All controls have accessible labels.
- Table headers use proper scope and sorting attributes.
- Charts provide a textual data-table alternative.

## 17. Build acceptance criteria

The design is complete only when:

- The first screen is the working Sales & Market Share dashboard, not a landing hero.
- Monthly, Quarterly, and Yearly views work correctly.
- Current period and prior-year comparable values are visible together.
- Absolute volume, YoY, current share, and share change are available in the same table.
- Clicking an OEM updates the trend chart.
- EV vs ICE has a dedicated tab and uses qualified share labels.
- Export analysis works for 2W.
- Production for 2W shows an honest unavailable state.
- Every table/chart exposes source, definition, and last updated.
- The dark cream/champagne visual system is applied consistently.
- No unsupported metric is displayed as zero or estimated data.
