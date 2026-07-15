# OEM Tracker — Product Requirements (v1)

## What it is
An embedded, table-first dashboard that tracks Indian automobile manufacturers — sales,
exports, market share, and EV-vs-ICE penetration — **over time**. It replaces a manually
maintained SIAM Excel workbook. The audience is an equity fund tracking the market.

## The core problem
The existing view shows only the latest month; **history is getting lost**. Users cannot
answer "is Hero losing share?" or "is Ather gaining?" across time. Time-series is the whole
point: Monthly / Quarterly / Yearly, Absolute + YoY, and market-share *trends*.

## What v1 delivers
- Sales & Market Share (default), EV vs ICE, and Production & Exports views.
- Current-period vs comparable prior-year, always visible together.
- Share movement in percentage points, with share-trend charts per OEM.
- Honest coverage: 2W production is unavailable in the source and is shown as such, never
  faked. CV is quarterly-only and never rendered as monthly.
- **v1 scope: Two-Wheelers, end-to-end.** Richest EV data and the user's real examples
  (Hero, Ather). The contract and components generalise to PV/3W/Tractor/CV without a
  rewrite — category is a dimension, never hardcoded.

## Hard product rules (enforced in data, not just UI)
1. **One source per table/chart.** Sales, wholesale dispatches (SIAM), registrations
   (VAHAN), exports, and production are not interchangeable. Blocked at computation time.
2. **Share is computed, never stored**, and only when numerator and denominator share the
   same source, segment, period, geography, and powertrain scope. A believable-but-wrong
   share is the single worst failure mode.
3. **Never call SIAM-based share "market share."** The label is *"Share within reported
   SIAM universe"* — some pure-EV makers (e.g. Ola) are not SIAM members, so EV share is
   understated.
4. **Monthly is the base.** Quarterly = sum of 3 months; Yearly = sum of 12. Derived rows
   are marked `derived`. CV is the only source-reported higher-frequency data.
5. **Fiscal year = April–March.** Q1 = Apr–Jun. Never calendar-year.
6. **0 ≠ missing.** A reported 0 (e.g. a maker not yet launched) is never coerced to null,
   and missing is never coerced to 0.
7. **Never delete data.** Corrections supersede via a new revision; the old value stays as
   an audit trail.

## Architecture (one line)
A Python pipeline commits tidy data (JSON) to the repo against a **frozen JSON-Schema
contract**; Cloudflare Pages serves it behind Cloudflare Access; a React dashboard (Phase
3) binds to the frozen bundle. No database in v1. Ingestion is fully automated (monthly
cron + validation gates); zero humans in the loop.

## Non-goals (v1)
No AI commentary, supplier mapping, product benchmarking, pricing modules, or marketing
copy. No persistent left sidebar. No public access to the underlying licensed data.
