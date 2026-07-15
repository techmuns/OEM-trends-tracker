"""Generate fixtures/sample_bundle.json — synthetic, schema-valid, deterministic.

Phase 3 (UI) can be built and tested entirely against this fixture without waiting for
Phase 1. It also proves the design's empty/partial-data states work — hard to test once
real data exists. Company names are OBVIOUSLY fake (Alpha Motors, Beta Auto, ...) so this
data can never be mistaken for real output.

Deterministic (no RNG): values come from a formula on the month index, so regenerating
yields byte-identical output. Run: `uv run python scripts/gen_fixture.py`.

Edge cases deliberately included (see design.md "Widget states"):
  * a missing month (Gamma has no row for one month) -> period_continuity gap
  * a null value (distinct from 0)                   -> "missing, marked —"
  * a genuine 0 value (Epsilon not yet launched)     -> 0 != null
  * a revised value (rev0 superseded, rev1 live)     -> revision/supersede + "Revised" badge
  * an EV row and a derived ICE row                  -> EV vs ICE tab
  * a derived quarter and a reported quarter         -> "derived" vs "source-reported"
  * a partial YTD quarter (2/3 months)               -> partial-data state
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pipeline.aggregate.periods import fiscal_quarter_of, fiscal_year_of
from pipeline.contract.constants import CONTRACT_VERSION, SIAM_UNIVERSE_LABEL
from pipeline.contract.models import Bundle, ContractRow

IST = timezone(timedelta(hours=5, minutes=30))
INGEST = datetime(2026, 7, 1, 9, 0, 0, tzinfo=IST)
GENERATED_AT = datetime(2026, 7, 1, 9, 5, 0, tzinfo=IST)
SOURCE_FILE = "sample_fixture_v1"

# 24 months: Jul 2024 .. Jun 2026
MONTHS: list[date] = []
y, m = 2024, 7
for _ in range(24):
    MONTHS.append(date(y, m, 1))
    m += 1
    if m > 12:
        m = 1
        y += 1

# obviously-fake OEMs; base level + monthly drift used to synthesise values
OEMS = {
    "Alpha Motors": 40000,
    "Beta Auto": 30000,
    "Gamma Mobility": 18000,
    "Delta Two Wheelers": 12000,
    "Epsilon EV": 0,  # ramps from 0 (not launched) -> exercises the 0 != null rule
}
# tuple, not set: deterministic iteration order so regeneration is byte-identical
EV_MAKERS = ("Delta Two Wheelers", "Epsilon EV")


def base_row(**overrides) -> dict:
    """Defaults shared by every fixture row; overrides set the distinctive fields."""
    row = dict(
        period_date=None,
        period_type="month",
        fiscal_year=None,
        fiscal_quarter=None,
        category="2W",
        segment=None,
        sub_segment=None,
        company_canonical=None,
        company_raw=None,
        flow="domestic",
        powertrain="all",
        geography="IN",
        metric="units",
        value=None,
        unit="units",
        source="SIAM",
        source_file=SOURCE_FILE,
        source_period="2026-06",
        native_frequency="month",
        calc_status="reported",
        revision=0,
        ingest_date=INGEST,
        confidence="high",
        is_superseded=False,
        is_partial=False,
        periods_present=None,
        periods_expected=None,
    )
    row.update(overrides)
    return row


def monthly_value(base: int, i: int) -> int:
    """Deterministic pseudo-series: gentle growth + a fixed seasonal wobble."""
    seasonal = (i % 12 - 6) * 37  # -222..+185, repeats yearly
    return base + i * 180 + seasonal


FIXTURE_PATH = Path("fixtures/sample_bundle.json")


def serialize(bundle: Bundle) -> str:
    """Canonical on-disk form. main() and the up-to-date test use the SAME serializer."""
    return json.dumps(bundle.model_dump(mode="json"), indent=2) + "\n"


def build() -> Bundle:
    rows: list[dict] = []

    for i, d in enumerate(MONTHS):
        fy = fiscal_year_of(d)
        fq = fiscal_quarter_of(d)
        period = d.strftime("%Y-%m")
        for oem, base in OEMS.items():
            # --- deliberate edge cases inside the main series ---
            # Gamma is missing exactly one month (2025-01) -> period-continuity gap.
            if oem == "Gamma Mobility" and d == date(2025, 1, 1):
                continue
            # Beta has one genuinely-unreported month (null, NOT zero) at 2025-03.
            if oem == "Beta Auto" and d == date(2025, 3, 1):
                val = None
            elif oem == "Epsilon EV":
                # not launched until 2025-04: reported ZERO before then (0 != null).
                val = 0 if d < date(2025, 4, 1) else monthly_value(2000, i)
            else:
                val = monthly_value(base, i)

            rows.append(
                base_row(
                    period_date=d.isoformat(),
                    fiscal_year=fy,
                    fiscal_quarter=fq,
                    segment="Scooter" if oem != "Beta Auto" else "Motor cycles",
                    company_canonical=oem,
                    company_raw=oem,
                    value=val,
                    source_period=period,
                    confidence="high" if val not in (None,) else "low",
                )
            )

        # EV + derived-ICE rows for EV makers (only once launched)
        for oem in EV_MAKERS:
            if oem == "Epsilon EV" and d < date(2025, 4, 1):
                continue
            ev_val = monthly_value(1500 if oem == "Delta Two Wheelers" else 1200, i)
            all_val = monthly_value(OEMS[oem] or 2000, i)
            rows.append(
                base_row(
                    period_date=d.isoformat(),
                    fiscal_year=fy,
                    fiscal_quarter=fq,
                    segment="Scooter",
                    company_canonical=oem,
                    company_raw=oem,
                    powertrain="ev",
                    value=ev_val,
                    source_period=period,
                )
            )
            # ICE is DERIVED = all - ev (calc_status='derived'), never summed with the others.
            rows.append(
                base_row(
                    period_date=d.isoformat(),
                    fiscal_year=fy,
                    fiscal_quarter=fq,
                    segment="Scooter",
                    company_canonical=oem,
                    company_raw=oem,
                    powertrain="ice",
                    value=max(all_val - ev_val, 0),
                    calc_status="derived",
                    confidence="medium",
                    source_period=period,
                )
            )

    # --- revision/supersede pair: Alpha 2024-08 domestic/all was corrected upward ---
    # rev0 (superseded)
    rows.append(
        base_row(
            period_date="2024-08-01",
            fiscal_year=fiscal_year_of(date(2024, 8, 1)),
            fiscal_quarter=fiscal_quarter_of(date(2024, 8, 1)),
            segment="Scooter",
            company_canonical="Alpha Motors",
            company_raw="Alpha Motors",
            value=41000,
            revision=0,
            is_superseded=True,
            source_period="2024-08",
        )
    )
    # NOTE the main loop already emitted a live 2024-08 Alpha row at revision 0. Bump that
    # loop-emitted row's identity apart by giving THIS corrected observation a distinct
    # segment so the pair is self-contained and unambiguous in the fixture.
    # (Use "Mopeds" so it doesn't collide with the Scooter series above.)
    rows[-1]["segment"] = "Mopeds"
    rows.append(
        base_row(
            period_date="2024-08-01",
            fiscal_year=fiscal_year_of(date(2024, 8, 1)),
            fiscal_quarter=fiscal_quarter_of(date(2024, 8, 1)),
            segment="Mopeds",
            company_canonical="Alpha Motors",
            company_raw="Alpha Motors",
            value=42250,
            revision=1,
            is_superseded=False,
            source_period="2026-06",
            confidence="high",
        )
    )

    # --- a DERIVED quarter (Alpha, Q1FY26 = Apr-Jun 2025), summed from 3 months ---
    rows.append(
        base_row(
            period_date="2025-04-01",
            period_type="quarter",
            fiscal_year="FY26",
            fiscal_quarter="Q1FY26",
            segment=None,
            company_canonical="Alpha Motors",
            company_raw="Alpha Motors",
            value=monthly_value(40000, 9) + monthly_value(40000, 10) + monthly_value(40000, 11),
            native_frequency="month",
            calc_status="derived",
            confidence="high",
            source_period="2025-06",
            periods_present=3,
            periods_expected=3,
        )
    )

    # --- a REPORTED quarter (native_frequency='quarter', like CV) -> "source-reported" ---
    rows.append(
        base_row(
            period_date="2025-07-01",
            period_type="quarter",
            fiscal_year="FY26",
            fiscal_quarter="Q2FY26",
            segment=None,
            company_canonical="Beta Auto",
            company_raw="Beta Auto",
            value=95000,
            native_frequency="quarter",
            calc_status="reported",
            source_period="2025-09",
        )
    )

    # --- a PARTIAL (YTD/QTD) derived quarter: only 2 of 3 months present ---
    rows.append(
        base_row(
            period_date="2026-04-01",
            period_type="quarter",
            fiscal_year="FY27",
            fiscal_quarter="Q1FY27",
            segment=None,
            company_canonical="Alpha Motors",
            company_raw="Alpha Motors",
            value=monthly_value(40000, 21) + monthly_value(40000, 22),
            native_frequency="month",
            calc_status="derived",
            confidence="medium",
            source_period="2026-05",
            is_partial=True,
            periods_present=2,
            periods_expected=3,
        )
    )

    # validate-by-construction through the pydantic contract models
    return Bundle(
        contract_version=CONTRACT_VERSION,
        generated_at=GENERATED_AT,
        source_universe_label=SIAM_UNIVERSE_LABEL,
        rows=[ContractRow(**r) for r in rows],
    )


def main() -> None:
    bundle = build()
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(serialize(bundle), encoding="utf-8")
    print(f"wrote {FIXTURE_PATH} with {len(bundle.rows)} rows")


if __name__ == "__main__":
    main()
