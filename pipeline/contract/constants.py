"""Frozen contract constants.

Strings and structural facts that the non-negotiable rules depend on live HERE, not in
UI code or scattered across the pipeline. Phase 3 (UI) imports the label strings via the
bundle (`source_universe_label`) so they are never re-typed.
"""

from __future__ import annotations

CONTRACT_VERSION = "1.1.0"

# Sentinel used as company_canonical for the source-reported industry-total rows
# (e.g. "Total Domestic Two Wheelers"). These are the market-share DENOMINATOR and define
# SIAM's actual reported universe. They are ingested as calc_status="reported" and must
# never be reconstructed by summing companies (company rows start later than the total).
INDUSTRY_TOTAL_CANONICAL = "Total Reported Universe"

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

# --- Known data-reality exceptions in File 1 (encode, don't fail on them) ---
# April 2020 is entirely blank in the workbook: the COVID-19 national lockdown halted
# vehicle dispatches, so SIAM reported nothing. This is a legitimate gap INSIDE the
# Apr-2012..Dec-2025 range, not a parser error — period_continuity treats it as expected.
KNOWN_MISSING_MONTHS: dict[str, str] = {
    "2020-04-01": "COVID-19 national lockdown — no dispatches reported by SIAM",
}

# SIAM occasionally posts small NEGATIVE monthly figures (returns/corrections exceeding
# dispatches in a month, e.g. Mahindra Jul-2020, Piaggio Oct-2023). These are real
# adjustments, not corruption — value_range_sanity flags them but does not quarantine.
# A magnitude beyond this cap for a single monthly cell is treated as absurd -> fail.
ABSURD_MONTHLY_MAGNITUDE = 5_000_000  # units/month for one maker+segment; ~50x the market

# --- Coverage floors observed in the source workbook (encode, don't design around) ---
# Industry totals begin Apr-2012, but company-level rows begin Apr-2014, so company-level
# market share cannot be computed before FY15. Recorded in docs/contract-coverage.md.
COMPANY_HISTORY_FLOOR = "2014-04-01"
INDUSTRY_HISTORY_FLOOR = "2012-04-01"

# --- Phase 2: File 2 (monthly SIAM) seam ---
# Decision (extend-only): File 1 owns history through Dec-2025; File 2 supplies ONLY the
# new months from here on. File 2 is coarser (maker-level, no segment, no EV split), so it
# never supersedes File 1's richer rows — it appends the forward extension.
FILE1_LAST_PERIOD = "2025-12-01"
FILE2_EXTEND_FROM = "2026-01-01"

# The seam is validated on the one truly comparable series across sources: the reported
# INDUSTRY total. It must match within tolerance across overlap months, else the join is a
# real discontinuity and fails loudly. Maker-level differences (File 1 is a lossy summary)
# are reported, not failed.
SEAM_INDUSTRY_TOL_ABS = 500.0
SEAM_INDUSTRY_TOL_REL = 0.005
