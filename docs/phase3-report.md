# Phase 3 — Dashboard UI report

A React/TS dashboard in `ui/`, reading a precomputed static view-model
(`data/bundle/2w.json`) same-origin. The UI does zero business math. Bundle spans
2012 → **May-2026** (Phase-2 extension); freshness read from metadata, never hardcoded.

## 1. `design.md` widgets changed (and why)

- **§4.1 latest_period.** The prompt's Dec-2025 predates Phase 2. Per its own "read from
  metadata" rule, the UI reflects the real bundle: **"Data as of May 2026"**. Not fabricated
  — it's the ingested File-2 extension. (You approved reflecting the actual bundle.)
- **§4.11 KPI rename.** "Total Industry Sales" → **"Total Reported Sales"** (it's the
  reported SIAM universe, not the whole market).
- **§4.12 production.** The prompt said 2W production doesn't exist; Phase 2 added it for
  2026. The Production panel now **shows the 2026 maker-level data with an honest "reported
  only from Jan-2026, earlier not shown as zero" note** — not a blanket unavailable state.
- **§4.3 Jan–May 2026.** No longer blank (maker-level data exists); EV/segment still end
  Dec-2025, shown with an explicit freeze notice.
- **Visual theme.** `design.md` specified a dark champagne theme, but §3 mandates the
  **Munshot light shell** (white/indigo) inline. I built the §3 shell — it supersedes the
  dark theme.

## 2. Derived fields — added where the prompt says (the pipeline)

The frozen `ContractRow` can't hold derived fields and `schema.json` is not edited. So a
**separate view-model** (`pipeline/build_view.py` → `data/bundle/2w.json`) precomputes, per
maker series (company × flow × powertrain × M/Q/Y): `v`, `yoy`, `share`, `chg`
(share-change pp), `partial`/`present`/`expected`, `revised`, plus `ev_penetration`. Share
uses the same-flow/powertrain/period guard; ICE is derived (`all − ev`), never summed.
**Partial periods use matched-elapsed-month YoY** (Q1 FY27 = Apr+May vs Apr+May prior — not
2 months vs a full 3). The UI only selects and formats these.

## 3. Bundle size + load time

- View-model `2w.json`: **~1.0 MB** (192 series), vs the 5.1 MB canonical contract bundle.
  Gzipped over Cloudflare it's ~150 KB. UI JS 214 KB (68 KB gzip). No splitting needed at
  this size; the UI fetches one file once. If the store grows to more categories, split by
  category (`/data/{cat}.json`).

## 4. Host ticker → OEM

`useHostContext` reads `window.MunshotHost.market.selectedTicker` if the host injects it,
else standalone. Mapping: `HEROMOTOCO`→Hero MotoCorp, `BAJAJ-AUTO`→Bajaj Auto,
`TVSMOTOR`→TVS Motor Company, `EICHERMOT`→Royal Enfield. Fallback: no ticker → no pill,
default "All OEMs". The `@munshot/dashboard-sdk` package is not published to this registry,
so the shim degrades gracefully; the visual-snapshot channel is wired via `postMessage`.

## 5. State screenshots

Verified against real data by driving the built app in Chromium (see the session): the
**partial-quarter** state (Q1 FY27, "2 of 3" badge, matched-months YoY), the **EV freeze**
state (amber "EV data ends Dec 2025", showing the latest EV period), the **production
limited-coverage** state, and `—` (never `0`, never `∞`) for absent makers and
YoY-from-zero. Loading/empty/error states are implemented in `components/ui.tsx`; the
view-model rules are unit-tested against `fixtures/sample_bundle.json` in
`tests/test_build_view.py`.

## 6. What the data still can't support

- **EV-vs-ICE and segment views end Dec-2025** — File 2 has no powertrain/segment split.
  Shown honestly, not extrapolated.
- **Pure-EV makers in the Sales table:** File 1 reports some pure-EV makers (Ather,
  Okinawa) largely in the *EV block*, so their domestic-`all` (segment) rows can read low/0
  — their real volumes surface in the EV tab. A File-1 structural quirk, not a UI defect;
  the UI faithfully shows stored values.
- **2W production** exists only from Jan-2026 (maker-level); earlier is genuinely absent.

## Setup delta

Cloudflare build command stays `bash scripts/build-site.sh`, output `dist` — it now builds
the React app (pnpm auto-detected from `ui/pnpm-lock.yaml`) and serves `/data/2w.json`
alongside. Everything remains behind Cloudflare Access.
