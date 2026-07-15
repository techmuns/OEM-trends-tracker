"""Derived metrics computed from contract rows (never stored as base rows).

Phase 1 ships `yoy` because the Ather-from-zero ramp is the flagship chart and a wrong
YoY there breaks it. Market-share computation (with the same-source/segment/period guard)
lands with the UI in Phase 3; the guard primitives already live in
`pipeline/aggregate/periods.py`.
"""

from __future__ import annotations


def yoy(current: float | None, prior: float | None) -> float | None:
    """Year-on-year growth = current/prior - 1, as a fraction (0.083 == +8.3%).

    Returns None when it cannot be computed truthfully:
      - current is None (not reported)
      - prior is None (not reported)
      - prior is 0 (division by zero / infinite growth from a zero base)

    This is the 0≠null rule at the metric layer: a ramp from 0 or from absence yields a
    null YoY, never infinity or an absurd percentage.
    """
    if current is None or prior is None or prior == 0:
        return None
    return current / prior - 1.0
