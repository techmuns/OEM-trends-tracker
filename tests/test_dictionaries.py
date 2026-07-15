"""Dictionary resolution: real aliases resolve; unknown names hard-fail."""

from __future__ import annotations

import pytest

from pipeline.dictionaries.loader import (
    UnknownCompanyError,
    UnknownSegmentError,
    load_company_resolver,
    load_segment_resolver,
)


def test_bajaj_alias_variants_resolve_to_one_canonical() -> None:
    r = load_company_resolver()
    assert r.resolve("Bajaj Auto Ltd") == "Bajaj Auto"
    assert r.resolve("Bajaj Auto") == "Bajaj Auto"  # EV-block spelling


def test_honda_paren_variants_resolve() -> None:
    r = load_company_resolver()
    assert r.resolve("Honda Motorcycle & Scooter India (Pvt) Ltd") == r.resolve(
        "Honda Motorcycle & Scooter India Pvt Ltd"
    )


def test_kawasaki_source_typo_resolves() -> None:
    r = load_company_resolver()
    assert r.resolve("India Kawasaki MotorsPrivate Ltd") == "India Kawasaki Motors"


def test_unknown_company_hard_fails() -> None:
    r = load_company_resolver()
    with pytest.raises(UnknownCompanyError):
        r.resolve("Totally Fake Motors Ltd")


def test_segment_headers_and_typo_space() -> None:
    s = load_segment_resolver()
    assert s.is_segment_header("2W", "Motor cycles")  # exact spelling with the space
    assert s.resolve("2W", "Scooter") == "Scooter"
    assert s.resolve("2W", "Mopeds") == "Mopeds"
    with pytest.raises(UnknownSegmentError):
        s.resolve("2W", "Spaceships")
