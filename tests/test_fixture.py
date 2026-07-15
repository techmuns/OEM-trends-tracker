"""The fixture must validate against the schema and contain the intended edge cases."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import jsonschema

from pipeline.contract.models import Bundle
from pipeline.store.revisions import current_rows, observation_key
from scripts.gen_fixture import build, serialize

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "sample_bundle.json"


def test_fixture_validates_against_schema(schema: dict, bundle_dict: dict) -> None:
    jsonschema.validate(instance=bundle_dict, schema=schema)


def test_generation_is_deterministic() -> None:
    # regenerating must be byte-identical (no sets/RNG/wall-clock in the generator)
    assert serialize(build()) == serialize(build())


def test_committed_fixture_is_up_to_date() -> None:
    committed = FIXTURE_PATH.read_text(encoding="utf-8")
    assert serialize(build()) == committed, (
        "fixtures/sample_bundle.json is stale — run: uv run python scripts/gen_fixture.py"
    )


def test_fixture_parses_through_pydantic(bundle: Bundle) -> None:
    assert bundle.contract_version == "1.0.0"
    assert bundle.rows, "fixture must contain rows"


def test_zero_and_null_are_distinct(bundle: Bundle) -> None:
    values = [r.value for r in bundle.rows]
    assert 0 in values, "fixture must contain a genuine 0 (Epsilon EV pre-launch)"
    assert None in values, "fixture must contain a null (Beta unreported month)"
    # a 0-valued row and a null-valued row must both exist and be different rows
    zero_rows = [r for r in bundle.rows if r.value == 0]
    null_rows = [r for r in bundle.rows if r.value is None]
    assert zero_rows and null_rows


def test_has_missing_month_for_gamma(bundle: Bundle) -> None:
    gamma_months = {r.period_date for r in bundle.rows if r.company_canonical == "Gamma Mobility"}
    assert date(2025, 1, 1) not in gamma_months, "Gamma should be missing 2025-01"
    assert date(2024, 12, 1) in gamma_months and date(2025, 2, 1) in gamma_months


def test_has_revision_pair(bundle: Bundle) -> None:
    superseded = [r for r in bundle.rows if r.is_superseded]
    assert superseded, "fixture must contain a superseded row"
    # the superseding row shares the observation key and is at revision+1
    for old in superseded:
        k = observation_key(old)
        newer = [
            r for r in bundle.rows if observation_key(r) == k and r.revision == old.revision + 1
        ]
        assert newer, f"no rev{old.revision + 1} found superseding {k}"
        assert not newer[0].is_superseded


def test_current_view_excludes_superseded(bundle: Bundle) -> None:
    live = current_rows(bundle.rows)
    assert all(not r.is_superseded for r in live)
    assert len(live) < len(bundle.rows)


def test_has_ev_and_derived_ice(bundle: Bundle) -> None:
    ev = [r for r in bundle.rows if r.powertrain.value == "ev"]
    ice = [r for r in bundle.rows if r.powertrain.value == "ice"]
    assert ev, "fixture must contain EV rows"
    assert ice, "fixture must contain derived ICE rows"
    assert all(r.calc_status.value == "derived" for r in ice), "ICE must be derived"


def test_has_derived_and_reported_quarter(bundle: Bundle) -> None:
    quarters = [r for r in bundle.rows if r.period_type.value == "quarter"]
    assert any(
        q.calc_status.value == "derived" and q.native_frequency.value == "month" for q in quarters
    ), "need a derived (summed) quarter"
    assert any(
        q.calc_status.value == "reported" and q.native_frequency.value == "quarter"
        for q in quarters
    ), "need a source-reported quarter (CV-style)"


def test_has_partial_ytd_quarter(bundle: Bundle) -> None:
    partial = [r for r in bundle.rows if r.is_partial]
    assert partial, "fixture must contain a partial (YTD/QTD) row"
    p = partial[0]
    assert p.periods_present is not None and p.periods_expected is not None
    assert p.periods_present < p.periods_expected


def test_single_source(bundle: Bundle) -> None:
    # the fixture is one source (rule: one source per table); real store may mix, but this
    # synthetic bundle keeps it clean so UI compares apples to apples.
    assert {r.source.value for r in bundle.rows} == {"SIAM"}
