# Phase 4 — Category expansion (PV) report

Phase 4 widens the tracker from 2W to every File-1 category, **one category per PR**. This
is the first: **Passenger Vehicles (PV)**. 2W is untouched and stays green.

The whole platform is now per-category: a normalized store, snapshot, canonical bundle, and
UI view-model per category, plus a manifest the dashboard switches between.

## 1. The rule that shaped everything: EV is NOT derivable for PV

For 2W, "Electric" is a clean subset block, so `ev ⊆ all` and `ice = all − ev` are exact.
**PV has no EV block.** EV-only makers (e.g. *Mahindra Electric Mobility*) sit **inline**
among ICE makers in the same PV rows. There is no way to separate EV from ICE volume from
this source without guessing.

So, non-negotiably:

- Every PV row is `powertrain=all`. There is no `ev` or `ice` row, and none is synthesised.
- `is_ev_only` is a **company attribute** (in `companies.yaml`), never a row dimension. An
  EV-only maker's units are counted in its total — **never summed into a separate "EV
  total."**
- The view-model sets `has_ev=false`. The UI's **EV vs ICE tab renders "unavailable"** for
  PV, naming the inline EV-only makers, rather than showing a wrong number.

A wrong EV figure is worse than an absent one for an equity-research audience — this is the
same principle as the "reported SIAM universe" share caveat, applied to powertrain.

## 2. A different adapter, not a generalized 2W parser

2W's layout (nested Scooter/Motorcycle/Moped blocks with an Electric subset) does not
generalize. PV is a new adapter, `pipeline/adapters/excel_nested.py`
(`NestedBlockAdapter`), driven entirely by `dictionaries/categories.yaml`:

- `region_start`/`region_end` bound the PV region on the shared File-1 sheet.
- `segments` maps each segment header → `(flow, segment, terminator)`. **Terminators differ
  per segment** ("PC Volumes", "UV Volumes", "Total Vans", and their export mirrors) — the
  parser closes a segment on its own terminator, never a generic "Total".
- `industry_totals` maps the reported total labels ("Total DOMESTIC PV" / "Total EXPORT PV")
  → flow. Industry totals are **ingested as reported**, never reconstructed by summing.

Same non-negotiables as 2W carry over: `data_only=True`, label-driven (not positional),
unresolved maker → **hard fail**, `0 ≠ blank` (`"NA"`/`"N/A"`/`"-"` = absence, not zero).

## 3. What PV produced

- **10,052 rows**, `powertrain=all` only, flows `{domestic, export}`, segments `{PC, UV,
  Van}`, industry history from **Apr-2012**, maker history respecting the FY15 floor.
- All 7 gates pass. Quarter reconciliation: **3197/3197 match, 0 overshoot** (2 undershoot
  gaps from unlisted small makers — expected, never a double-count).
- 22 makers. `Volkswagen - Audi` and `Volkswagen India` are kept **separate** (they are
  distinct reporting entities in the source; not merged).
- Realistic sanity check: Dec-2025 domestic PV = **399,216 units**, Maruti Suzuki
  **178,646 (44.8% share)**.

## 4. Per-category platform (2W stays identical)

| Artifact | Path |
| --- | --- |
| Normalized store | `data/normalized/<cat>.json` |
| Immutable snapshot | `data/snapshots/snapshot-<cat>-<id>.json` |
| Canonical bundle (schema-valid) | `data/bundle/bundle-<cat>.json` |
| UI view-model | `data/bundle/<cat>.json` |
| Category manifest | `data/bundle/categories.json` |

- **Ingest** now detects that File 1 carries several categories and runs each as an
  independent adapter (`detect_adapters`, `process_category`). A gate failure in one
  category quarantines the file; the last good views stay live. 2W is idempotent on the
  File-1 re-run (its store already holds File1+File2), so only PV is added.
- **View-model meta** gained `category`, `category_label`, `native_frequency`, `has_ev`,
  `has_production`, and `ev_only_makers`. `has_ev`/`has_production` are **data-derived**
  (presence of ev/production rows), not just config — so they can't drift from reality.
- **Manifest** (`categories.json`) lists each category's key/label/coverage/flags for the
  UI's switch.

## 5. UI: category switch + honest per-category states

- A **category selector** in the header, populated from the manifest and synced to the
  `?cat=` URL param. Switching refetches `/data/<cat>.json`. If `categories.json` is missing
  (older deploy), the UI degrades to a 2W-only manifest rather than blanking.
- **EV vs ICE tab**: for `has_ev=false` it shows an unavailable panel explaining EV-only
  makers are inline (and lists them). For 2W it is unchanged.
- **Production & Exports tab**: production is gated on `has_production`; PV shows exports
  (available) with production marked unavailable. Labels are category-aware (`Production
  (PV)`), no hardcoded "2W".
- Freshness line and share caveats are category-aware (the 2W-only "Ola not a SIAM member"
  note no longer appears under PV).

## 6. Deploy

`scripts/build-site.sh` and the ingest cron now publish **every** per-category view plus
`categories.json` into the committed `dist/data/`, not just `2w.json`. No build step at
deploy time — Cloudflare serves the committed `dist/`.

## 7. Next categories (later PRs)

- **3W** — same `NestedBlockAdapter` + a `3W` block in `categories.yaml` (EV also not
  derivable → same inline-maker treatment).
- **CV** — quarterly-native (`native_frequency=quarter`), has a production flow.
- **Tractors** — **confirm the source is not SIAM/TMA before building**; merged-cell
  forward-fill expected. Blocked on source confirmation.
