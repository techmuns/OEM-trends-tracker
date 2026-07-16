"""Adapters: the ABC cannot be instantiated; all three stubs raise NotImplementedError."""

from __future__ import annotations

import pytest

from pipeline.adapters.base import RawPayload, SourceAdapter, ValidationResult
from pipeline.adapters.excel_spark import ExcelSparkAdapter
from pipeline.adapters.siam_monthly import SiamMonthlyAdapter
from pipeline.adapters.siam_scrape import SiamScrapeAdapter
from pipeline.adapters.vahan import VahanAdapter

# Stubs still raising NotImplementedError. excel_spark (Phase 1), siam_monthly (Phase 2) and
# vahan (live scrape) are implemented; the SIAM scraper stays a stub (paid, login-gated,
# no public endpoint — see siam_scrape.py's module docstring).
STUB_ADAPTERS = [SiamScrapeAdapter]
ALL_ADAPTERS = [ExcelSparkAdapter, SiamMonthlyAdapter, SiamScrapeAdapter, VahanAdapter]


def test_abc_cannot_be_instantiated() -> None:
    with pytest.raises(TypeError):
        SourceAdapter()  # type: ignore[abstract]


@pytest.mark.parametrize("cls", STUB_ADAPTERS)
def test_stub_methods_raise_not_implemented(cls: type[SourceAdapter]) -> None:
    a = cls()
    assert a.source_id in {"SIAM", "VAHAN", "BROKER", "MANUAL"}
    assert a.native_frequency in {"month", "quarter", "year"}
    with pytest.raises(NotImplementedError):
        a.fetch("2026-06")
    with pytest.raises(NotImplementedError):
        a.parse(RawPayload(a.source_id, "2026-06", "f.xlsx"))
    with pytest.raises(NotImplementedError):
        a.validate([])


def test_interface_holds_for_all_three_source_shapes() -> None:
    # file-drop, scraper, API all satisfy the SAME interface — that's the pluggability proof.
    for cls in ALL_ADAPTERS:
        assert issubclass(cls, SourceAdapter)


def test_validation_result_helpers() -> None:
    assert ValidationResult.passing().ok is True
    r = ValidationResult.failing(["bad"])
    assert r.ok is False and r.errors == ["bad"]
