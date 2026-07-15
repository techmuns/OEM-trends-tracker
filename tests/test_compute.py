"""YoY: the 0≠null rule at the metric layer (the Ather-ramp headline case)."""

from __future__ import annotations

import pytest

from pipeline.compute import yoy


def test_normal_yoy() -> None:
    assert yoy(108.3, 100.0) == pytest.approx(0.083)


@pytest.mark.parametrize("current,prior", [(100.0, 0.0), (0.0, 0.0), (5.0, 0.0)])
def test_yoy_from_zero_is_null(current: float, prior: float) -> None:
    # Ather ramps from a reported 0 -> YoY must be None, never infinity or an absurd %.
    assert yoy(current, prior) is None


def test_yoy_with_null_operands_is_null() -> None:
    assert yoy(None, 100.0) is None
    assert yoy(100.0, None) is None
    assert yoy(None, None) is None


def test_yoy_negative_growth() -> None:
    assert yoy(90.0, 100.0) == pytest.approx(-0.10)
