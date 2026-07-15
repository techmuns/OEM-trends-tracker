"""Frozen contract constants.

Strings and structural facts that the non-negotiable rules depend on live HERE, not in
UI code or scattered across the pipeline. Phase 3 (UI) imports the label strings via the
bundle (`source_universe_label`) so they are never re-typed.
"""

from __future__ import annotations

CONTRACT_VERSION = "1.0.0"

# --- Share labelling (rule §4: never label SIAM-based share as plain "market share") ---
# Some pure-EV makers are not SIAM members, so EV share is understated. This exact string
# must accompany any SIAM-derived share.
SIAM_UNIVERSE_LABEL = "Share within reported SIAM universe"

SOURCE_UNIVERSE_LABELS: dict[str, str] = {
    "SIAM": SIAM_UNIVERSE_LABEL,
    "VAHAN": "Share within reported VAHAN (registrations) universe",
    "BROKER": "Share within reported broker universe",
    "MANUAL": "Share within reported (manual) universe",
}

# --- Inclusive-dimension guard (rule: never sum across values where one contains another) ---
# powertrain: "all" already includes "ev"; "ice" is derived = all - ev.
# flow:       "total" already includes "domestic" + "export".
# Aggregation must fix each of these to a single non-overlapping basis. Summing across a
# key together with any of its members double-counts. The guard in
# pipeline/aggregate/periods.py raises on violation (it does NOT warn).
INCLUSIVE_DIMENSIONS: dict[str, dict[str, tuple[str, ...]]] = {
    "powertrain": {
        # value -> values it already contains
        "all": ("ev", "ice"),
    },
    "flow": {
        "total": ("domestic", "export"),
    },
}

# --- Measurement basis (rule §Data integrity: dispatches != registrations != production) ---
# The human basis label is DERIVED from source (kept out of the row per the locked
# decision). Display labels live in dictionaries/metrics.yaml; this is the machine mapping.
MEASUREMENT_BASIS_BY_SOURCE: dict[str, str] = {
    "SIAM": "wholesale_dispatches",
    "VAHAN": "registrations",
    "BROKER": "broker_estimate",
    "MANUAL": "manual_entry",
}

# --- Coverage floors observed in the source workbook (encode, don't design around) ---
# Industry totals begin Apr-2012, but company-level rows begin Apr-2014, so company-level
# market share cannot be computed before FY15. Recorded in docs/contract-coverage.md.
COMPANY_HISTORY_FLOOR = "2014-04-01"
INDUSTRY_HISTORY_FLOOR = "2012-04-01"
