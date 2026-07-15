# Phase 1 — Backfill report

File 1 (`Auto_Database__Summary__-_Spark.xlsx`, sheet `OEM - Summary - 2W, PV, 3W`, 2W
region) parsed into the tidy store. Contract bumped to **1.1.0** (added `Bundle.meta`;
`ContractRow` unchanged). Bundle `latest_period = 2025-12-01`.

## 1. Rows ingested (5,942 monthly rows, 2W)

| flow | powertrain | rows |
|---|---|---|
| domestic | all | 2,856 |
| domestic | ev | 292 |
| export | all | 2,726 |
| export | ev | 68 |

- Segments (`all` rows): `Scooter`, `Motor cycles`, `Mopeds`. EV rows carry `segment=null`
  (the source has no EV-by-segment split — not faked).
- Industry totals (`Total Domestic/Exports Two Wheelers`) ingested as `reported`
  (`company_canonical = "Total Reported Universe"`), the share denominator.
- Coverage: **Apr-2012 → Dec-2025**. ICE is not stored (derived `all − ev`).

## 2. Quarter reconciliation (the free correctness check)

**1863 / 1863 = 100.0%.** Every fully-covered derived quarter equals the file's
pre-computed quarterly column for the same series. This validates the monthly parse and the
M→Q aggregation end-to-end. Zero mismatches.

## 3. Company-sum vs reported-total divergence

The reported totals include SIAM makers **not individually listed** in this workbook, so
Σlisted < Total (an undershoot), throughout the series — **not just pre-FY15**:

- **0 overshoots** (no company set ever exceeds its total → no double-count).
- **110 undershoot months** (segment/industry), max gap ~5.9%, growing from ~2022 as
  unlisted EV makers (e.g. Ola, Ampere) scaled — they are in SIAM's total but not broken
  out here.
- **48 pre-FY15 exceptions** (company rows begin Apr-2014; totals begin Apr-2012).

Handling: the reported total is preserved as the denominator and **never reconstructed by
summing**. Reconciliation fails only on an overshoot; undershoots are reported, not failed.

## 4. Unresolved names

**None.** All raw company strings resolved via `companies.yaml`, including the alias
variants (`Bajaj Auto Ltd`/`Bajaj Auto`, Honda's two spellings, the
`India Kawasaki MotorsPrivate Ltd` typo). An unresolved name hard-fails the ingest.

## 5. Ragged-start map

- Industry totals: **Apr-2012**.
- All 15 listed companies: first appear **Apr-2014** (FY15). No row exists before a
  company's first appearance — never back-filled, never zero-filled.
- Electric Two Wheelers block: data begins **May-2020** (Ather, Bajaj, Hero, Honda,
  Okinawa, TVS).
- `0` is preserved as a reported value (593 zero cells, incl. Ather's Apr-2023 domestic 0);
  YoY from 0 or from absence → `null` (never ∞).

## 6. Data realities the contract had to absorb (flagged)

- **Apr-2020 is entirely blank** — COVID-19 lockdown, no dispatches. A real gap *inside* the
  range; `period_continuity` treats it as a documented known-missing month, not a failure.
- **3 negative monthly values** (Mahindra Jul-2020 −22/−1; Piaggio Oct-2023 −1) — legitimate
  SIAM adjustments; `value_range_sanity` flags them but does not quarantine.
- The reported totals > Σ listed makers (unlisted-maker gap, §3).

None required a contract change beyond the agreed `Bundle.meta`.

## 7. Decisions taken (please confirm)

- **`source="SIAM"`** on all rows: the figures are SIAM wholesale dispatches (the reported
  SIAM universe), even though File 1 is a manually maintained transcription. `source_file`
  preserves the workbook name. This is what gives the UI the correct
  "Share within reported SIAM universe" label.
- **Raw workbook committed** to `data/raw/` as the audit trail (per the Phase-0 design).
  The repo is private and the dashboard sits behind Cloudflare Access. Easy to move to
  external storage if you'd rather not commit the source binary.

## 8. What Phase 2 needs from File 2 to continue past Dec-2025

File 2 (`Monthly_SIAM_Industry_Data_Jun26.xlsx`) has a **different shape** — one sheet per
category, CV split into MHCV/LCV. To extend the series to Jun-2026 we need to: confirm its
measurement basis matches File 1 (wholesale dispatches), map its layout to the same
contract rows, and let `revision_detection` + supersede reconcile any overlapping months
File 2 restates. That is Phase 2 (a separate adapter), not touched here.
