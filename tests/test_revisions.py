"""Revision / supersede logic — never delete; correct via a new revision."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pipeline.contract.models import ContractRow
from pipeline.store.revisions import apply_revisions, current_rows, observation_key

IST = timezone(timedelta(hours=5, minutes=30))


def make_row(**overrides) -> ContractRow:
    base = dict(
        period_date="2026-06-01",
        period_type="month",
        fiscal_year="FY27",
        fiscal_quarter="Q1FY27",
        category="2W",
        segment="Scooter",
        sub_segment=None,
        company_canonical="Alpha Motors",
        company_raw="Alpha Motors",
        flow="domestic",
        powertrain="all",
        geography="IN",
        metric="units",
        value=100.0,
        unit="units",
        source="SIAM",
        source_file="f",
        source_period="2026-06",
        native_frequency="month",
        calc_status="reported",
        revision=0,
        ingest_date=datetime(2026, 7, 1, tzinfo=IST),
        confidence="high",
        is_superseded=False,
        is_partial=False,
        periods_present=None,
        periods_expected=None,
    )
    base.update(overrides)
    return ContractRow(**base)


def test_changed_value_creates_revision_and_supersedes() -> None:
    existing = [make_row(value=100.0, revision=0)]
    incoming = [make_row(value=120.0)]  # a corrected figure for the same observation
    out = apply_revisions(existing, incoming)

    assert observation_key(existing[0]) in out.revised_keys
    live = current_rows(out.rows)
    assert len(live) == 1
    assert live[0].value == 120.0
    assert live[0].revision == 1
    # audit trail preserved: the old value still exists, flagged superseded
    superseded = [r for r in out.rows if r.is_superseded]
    assert len(superseded) == 1 and superseded[0].value == 100.0


def test_identical_value_is_noop() -> None:
    existing = [make_row(value=100.0)]
    out = apply_revisions(existing, [make_row(value=100.0)])
    assert out.unchanged == 1
    assert not out.revised_keys
    assert len(out.rows) == 1  # nothing appended


def test_new_key_is_appended() -> None:
    existing = [make_row(company_canonical="Alpha Motors")]
    incoming = [make_row(company_canonical="Beta Auto", company_raw="Beta Auto")]
    out = apply_revisions(existing, incoming)
    assert len(out.added_keys) == 1
    assert len(current_rows(out.rows)) == 2


def test_null_to_zero_is_a_real_revision() -> None:
    # 0 != null: a maker going from 'not reported' to a reported 0 IS a change.
    existing = [make_row(value=None)]
    out = apply_revisions(existing, [make_row(value=0.0)])
    assert out.revised_keys, "null -> 0 must be treated as a revision, not a no-op"
    assert current_rows(out.rows)[0].value == 0.0


def test_revision_chain_increments_from_latest() -> None:
    existing = [make_row(value=100.0, revision=0)]
    out1 = apply_revisions(existing, [make_row(value=120.0)])
    out2 = apply_revisions(out1.rows, [make_row(value=130.0)])
    live = current_rows(out2.rows)
    assert len(live) == 1 and live[0].revision == 2 and live[0].value == 130.0
    assert len([r for r in out2.rows if r.is_superseded]) == 2


def test_inputs_not_mutated() -> None:
    existing = [make_row(value=100.0)]
    apply_revisions(existing, [make_row(value=120.0)])
    assert existing[0].is_superseded is False and existing[0].value == 100.0
