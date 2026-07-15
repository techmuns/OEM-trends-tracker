# Phase 2 — Live ingest report

File 2 (`Monthly_SIAM_Industry_Data_Jun26.xlsx`) joined to the series via the watched-folder
pipeline. Bundle `latest_period` now **2026-05-01** (was 2025-12-01). Contract unchanged.

## 1. Discovery (the 6 questions, #2 first)

2. **Company-level or industry-only?** **Company-level** — makers are column-groups
   (Production / Domestic / Exports / Total sales), months down the rows (transposed vs
   File 1). Clears the STOP gate. **But maker-level only: no segment split, no EV/ICE
   block** (Ather/Okinawa/Ola not even listed). It *does* carry Production (File 1's 2W did not).
1. **Date range:** 1992-04 → **2026-05** (despite the "Jun26" filename). Fills the Jan–May
   2026 gap after File 1.
3. **Overlap with File 1?** Yes (Dec-2025 back to 2014). **Industry totals match** (~40-unit
   rounding). **Maker values diverge**: File 2 reads higher than File 1's segment sums —
   Bajaj +18%, TVS +12%, Hero +3% at Dec-2025 (consistent with File 1 being a lossy hand
   summary). Honda/Suzuki/Royal Enfield/Piaggio/Yamaha match.
4. **Mirror File 1 structure?** No — transposed, no segments, no Electric block.
5. **Names identical?** No — new aliases (see §4).
6. **MHCV/LCV vs File 1 CV?** Out of scope (only 2W is in the store; CV not yet ingested).

## 2. Seam result

**Policy (your decision): extend-only.** File 1 owns 2012–Dec-2025 (with segment + EV
detail); File 2 supplies **only** Jan–May 2026, at maker level (`segment=null`,
`powertrain=all`). File 2 never supersedes File 1.

- **`source_seam_check`: PASS.** The one truly comparable series — the reported **industry
  total** — matches across the whole overlap within tolerance, so the join is continuous.
- **Maker-level differences are reported, not failed:** 115 maker-months differ (max
  ~23%). These are surfaced in the gate details and the bundle note, not silently
  superseded. Since File 1's maker rows are segmented and File 2's are `segment=null`, they
  are different observation keys — there is no value conflict in the store.
- Bundle note records the seam and the EV/segment freeze explicitly so the UI can label it.

## 3. Revisions detected

**None on this run** — File 2's Jan–May 2026 months are all new (File 1 ended Dec-2025), so
nothing was restated. The revision machinery (supersede at `revision+1`, never delete;
`revision_detection` reports but does not quarantine) is in place and exercised by tests;
it activates when a future monthly file restates an already-ingested 2026 month.

## 4. New aliases (File 2 → canonical)

| File 2 name | canonical |
|---|---|
| HMSI | Honda Motorcycle & Scooter India |
| TVS Motor | TVS Motor Company |
| Suzuki Motorcycles | Suzuki Motorcycle India |
| Yamaha | India Yamaha Motor |
| Others | Others (new — SIAM residual bucket) |
| Industry | → reported-universe total sentinel |

`Bajaj Auto`, `Hero MotoCorp`, `Royal Enfield`, `Piaggio Vehicles` already matched. Defunct
makers carried as all-zero for 2026 (Kinetic Motor, LML, Maruti Udyog, Mahindra & Mahindra,
Majestic Auto) are **omitted** (inactive → absence, not a fabricated zero); an *active*
unknown maker would hard-fail the ingest.

## 5. Latest period + partial periods

- `latest_period = 2026-05-01`. May-2026 is a complete past month (no running-month issue);
  June-2026 is simply absent.
- **Partial periods:** any quarter/FY that would include Jun-2026 is incomplete —
  **Q1FY27** (Apr+May+Jun) aggregates to `is_partial=true, periods_present=2,
  periods_expected=3`; **FY27** likewise partial (2 of 12). The aggregation sets these
  automatically and the UI must never render them as complete.

## 6. What remains manual — and what removes it

**One manual step:** a person obtains the licensed monthly SIAM workbook and drops it into
`data/raw/incoming/`. Everything after that is automated — detect adapter → gates →
snapshot/normalize/bundle → archive to `processed/` → commit → Cloudflare deploys. No
scraper is built: company-level SIAM data is behind a paid, no-redistribution subscription
with no public endpoint at this granularity (`siam_scrape.py` stays a stub). The drop
disappears the day a licensed feed or scheduled delivery exists — without touching the
pipeline or UI. That is what the adapter layer buys.

## Product consequence (flagged)

Past Dec-2025 the dashboard continues **maker-level Sales / Market Share / Exports / (new)
Production** through May-2026. **EV-vs-ICE and segment breakdowns stop at Dec-2025** and
should show an honest "no data after Dec-2025" state — File 2 cannot provide them. This was
your accepted trade-off; it is not fabricated.
