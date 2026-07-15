"""Validation-gate framework + registry.

Hard requirement: zero humans in the loop. There is no ingest preview and no manual
approval. The gates decide automatically:

  * all gates pass (or skip)  -> ACCEPT: write snapshot, rebuild bundle, deploy.
  * any gate FAILS            -> QUARANTINE the payload, keep the last good bundle live,
                                 and fail loudly (a GitHub Actions failure IS the alert).

Never let a bad file silently poison the store, and never let a bad file take the live
dashboard down.

The framework (protocol, result type, runner, quarantine path) plus all six gates are
implemented here. A gate returns SKIP when it is not applicable to the given context
(e.g. reconciliation with no reference data, or continuity with no industry-total series).
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Protocol, runtime_checkable

from jsonschema import Draft202012Validator

from pipeline.contract.constants import (
    ABSURD_MONTHLY_MAGNITUDE,
    INDUSTRY_TOTAL_CANONICAL,
    KNOWN_MISSING_MONTHS,
    KNOWN_SOURCE_OVERSHOOTS,
    SEAM_INDUSTRY_TOL_ABS,
    SEAM_INDUSTRY_TOL_REL,
)
from pipeline.contract.models import ContractRow
from pipeline.store.revisions import observation_key
from pipeline.validate.reconciliation import (
    reconcile_industry_totals,
    reconcile_quarters,
    reconcile_segment_sums,
    series_key,
)

QUARANTINE_DIR = Path("data/raw/quarantine")
SCHEMA_PATH = Path(__file__).resolve().parents[1] / "contract" / "schema.json"


class GateStatus(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"  # gate not applicable, or (Phase 0) not yet implemented


@dataclass(frozen=True)
class GateResult:
    name: str
    status: GateStatus
    message: str = ""
    details: dict[str, object] = field(default_factory=dict)

    @property
    def failed(self) -> bool:
        return self.status is GateStatus.FAIL


@dataclass
class GateContext:
    """Everything a gate might need. Kept loose in Phase 0; gates read what they use.

    `rows` are the freshly-parsed candidate rows. `previous_rows` is the last accepted
    store (for delta / revision / continuity gates). `extras` carries run metadata.
    """

    rows: Sequence[ContractRow]
    previous_rows: Sequence[ContractRow] = ()
    extras: dict[str, object] = field(default_factory=dict)


@runtime_checkable
class Gate(Protocol):
    name: str

    def run(self, ctx: GateContext) -> GateResult: ...


@dataclass(frozen=True)
class RunReport:
    """Aggregate outcome of a gate run and the resulting accept/quarantine decision."""

    results: list[GateResult]
    accepted: bool

    @property
    def failures(self) -> list[GateResult]:
        return [r for r in self.results if r.failed]

    def summary(self) -> str:
        counts: dict[GateStatus, int] = {}
        for r in self.results:
            counts[r.status] = counts.get(r.status, 0) + 1
        parts = ", ".join(f"{s.value}={counts.get(s, 0)}" for s in GateStatus)
        verdict = "ACCEPTED" if self.accepted else "QUARANTINED"
        return f"[{verdict}] gates: {parts}"


# --- Gate implementations (Phase 1) ----------------------------------------------------


@lru_cache(maxsize=1)
def _row_validator() -> Draft202012Validator:
    root = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft202012Validator({"$ref": "#/$defs/ContractRow", "$defs": root["$defs"]})


class SchemaConformanceGate:
    name = "schema_conformance"

    def run(self, ctx: GateContext) -> GateResult:
        validator = _row_validator()
        errors: list[str] = []
        for r in ctx.rows:
            for e in validator.iter_errors(r.model_dump(mode="json")):
                errors.append(f"{series_key(r)} {r.period_date}: {e.message}")
                break  # one error per row is enough to fail it
            if len(errors) >= 20:
                break
        if errors:
            return GateResult(
                self.name, GateStatus.FAIL, f"{len(errors)}+ rows fail schema", {"errors": errors}
            )
        return GateResult(self.name, GateStatus.PASS, f"{len(ctx.rows)} rows conform")


class TotalsReconciliationGate:
    """(a) company sums vs segment totals, (b) segment totals vs industry, (c) derived vs
    file-reported quarters. Pre-FY15 divergences are a documented exception, not a fail."""

    name = "totals_reconciliation"

    def run(self, ctx: GateContext) -> GateResult:
        recon = ctx.extras.get("reconciliation")
        if recon is None:
            return GateResult(self.name, GateStatus.SKIP, "no reconciliation data provided")
        rows = list(ctx.rows)
        # documented source overshoots for THIS category are acknowledged, not failed
        category = next((r.category.value for r in rows), None)
        known = {
            (flow, seg, date.fromisoformat(month))
            for (cat, flow, seg, month) in KNOWN_SOURCE_OVERSHOOTS
            if cat == category
        }
        a_hard, a_exc = reconcile_segment_sums(rows, recon, known)
        b_hard, b_exc = reconcile_industry_totals(recon, known)
        q_match, q_total, q_mis = reconcile_quarters(rows, recon)
        expected = a_exc + b_exc
        unlisted = [m for m in expected if m.kind == "unlisted"]
        pre_fy15 = [m for m in expected if m.kind == "pre_fy15"]
        acknowledged = [m for m in expected if m.kind == "acknowledged_overshoot"]
        hard = a_hard + b_hard + q_mis  # overshoots (double-counts) + quarter mismatches
        details = {
            "overshoots": [m.detail for m in (a_hard + b_hard)[:10]],
            "quarter_match": q_match,
            "quarter_compared": q_total,
            "quarter_mismatches": [m.detail for m in q_mis[:10]],
            "unlisted_maker_gaps": len(unlisted),
            "pre_fy15_exceptions": len(pre_fy15),
            "acknowledged_overshoots": [m.detail for m in acknowledged],
            "example_unlisted_gaps": [m.detail for m in unlisted[:3]],
        }
        rate = (q_match / q_total * 100) if q_total else 100.0
        ack = f", {len(acknowledged)} acknowledged source overshoot(s)" if acknowledged else ""
        msg = (
            f"quarters {q_match}/{q_total} ({rate:.1f}%); {len(hard)} hard; "
            f"{len(unlisted)} unlisted-maker gaps, {len(pre_fy15)} pre-FY15{ack}"
        )
        status = GateStatus.PASS if not hard else GateStatus.FAIL
        return GateResult(self.name, status, msg, details)


class RowCountDeltaGate:
    name = "row_count_delta"
    MAX_FRACTION = 0.30  # a run should not add/drop more than 30% of rows vs the last

    def run(self, ctx: GateContext) -> GateResult:
        n = len(ctx.rows)
        prev = len(ctx.previous_rows)
        if prev == 0:
            return GateResult(self.name, GateStatus.PASS, f"baseline: {n} rows (no previous run)")
        frac = abs(n - prev) / prev
        if frac > self.MAX_FRACTION:
            return GateResult(
                self.name,
                GateStatus.FAIL,
                f"row count changed {prev}->{n} ({frac:.0%} > {self.MAX_FRACTION:.0%})",
            )
        return GateResult(self.name, GateStatus.PASS, f"row count {prev}->{n} ({frac:.0%})")


class ValueRangeSanityGate:
    """Negatives are FLAGGED (SIAM posts legitimate negative adjustments) but do not fail.
    A single monthly magnitude beyond the absurd cap fails."""

    name = "value_range_sanity"

    def run(self, ctx: GateContext) -> GateResult:
        negatives: list[str] = []
        absurd: list[str] = []
        for r in ctx.rows:
            if r.value is None:
                continue
            if r.value < 0:
                negatives.append(f"{series_key(r)} {r.period_date}: {r.value}")
            if abs(r.value) > ABSURD_MONTHLY_MAGNITUDE:
                absurd.append(f"{series_key(r)} {r.period_date}: {r.value}")
        details = {"negatives": negatives[:20], "negative_count": len(negatives), "absurd": absurd}
        if absurd:
            return GateResult(
                self.name, GateStatus.FAIL, f"{len(absurd)} absurd magnitudes", details
            )
        return GateResult(
            self.name,
            GateStatus.PASS,
            f"ok ({len(negatives)} flagged negative adjustments)",
            details,
        )


class PeriodContinuityGate:
    """No gaps inside [min..max] of the industry-total monthly series, except documented
    known-missing months (e.g. Apr-2020 COVID lockdown). End-of-data is not a gap."""

    name = "period_continuity"

    def run(self, ctx: GateContext) -> GateResult:
        months = sorted(
            r.period_date
            for r in ctx.rows
            if r.company_canonical == INDUSTRY_TOTAL_CANONICAL
            and r.period_type.value == "month"
            and r.flow.value == "domestic"
        )
        if not months:
            return GateResult(
                self.name, GateStatus.SKIP, "no industry-total monthly series present"
            )
        present = set(months)
        known = {date.fromisoformat(k) for k in KNOWN_MISSING_MONTHS}
        expected: set[date] = set()
        cur = months[0]
        while cur <= months[-1]:
            expected.add(cur)
            y, m = (cur.year + 1, 1) if cur.month == 12 else (cur.year, cur.month + 1)
            cur = date(y, m, 1)
        gaps = sorted(expected - present - known)
        known_hit = sorted((expected - present) & known)
        details = {
            "gaps": [d.isoformat() for d in gaps],
            "known_gaps": [d.isoformat() for d in known_hit],
        }
        if gaps:
            return GateResult(self.name, GateStatus.FAIL, f"{len(gaps)} unexplained gaps", details)
        msg = f"continuous {months[0]}..{months[-1]} ({len(known_hit)} known gaps allowed)"
        return GateResult(self.name, GateStatus.PASS, msg, details)


class RevisionDetectionGate:
    """Flags observations whose value changed vs the previous accepted store. Revisions are
    normal (a new file corrects an old month) and are handled by the supersede logic, so
    this PASSES and reports — it does not quarantine."""

    name = "revision_detection"

    def run(self, ctx: GateContext) -> GateResult:
        if not ctx.previous_rows:
            return GateResult(self.name, GateStatus.PASS, "no previous run to compare")
        prev_val: dict[tuple, float | None] = {}
        for r in ctx.previous_rows:
            if not r.is_superseded:
                prev_val[observation_key(r)] = r.value
        revisions: list[str] = []
        for r in ctx.rows:
            k = observation_key(r)
            if k in prev_val and prev_val[k] != r.value:
                revisions.append(f"{series_key(r)} {r.period_date}: {prev_val[k]} -> {r.value}")
        details = {"revisions": revisions[:20], "revision_count": len(revisions)}
        return GateResult(
            self.name, GateStatus.PASS, f"{len(revisions)} revisions detected", details
        )


class SourceSeamCheckGate:
    """Validate the join where two source_files meet in one series.

    The only truly comparable series across File 1 (segmented) and File 2 (maker-level) is
    the reported INDUSTRY total — it must match within tolerance over the overlap, else the
    join is a real discontinuity and fails loudly. Maker-level differences (File 1 is a
    lossy hand-summary) are REPORTED, not failed — the extend-only policy never supersedes
    File 1's rows, so there is no value conflict in the store, only a documented seam.

    Reads File-2 overlap values from ctx.extras['seam_reference'] and compares against the
    File-1 rows already in the store (ctx.rows).
    """

    name = "source_seam_check"

    def run(self, ctx: GateContext) -> GateResult:
        seam = ctx.extras.get("seam_reference")
        if not seam:
            return GateResult(self.name, GateStatus.SKIP, "no cross-source overlap to check")

        # index File-1 side: industry totals (segment=null) and maker sums (over segments)
        f1_industry: dict[tuple[str, date], float | None] = {}
        f1_maker: dict[tuple[str, str, date], float] = {}
        for r in ctx.rows:
            if r.is_superseded or r.period_type.value != "month":
                continue
            if r.company_canonical == INDUSTRY_TOTAL_CANONICAL and r.segment is None:
                f1_industry[(r.flow.value, r.period_date)] = r.value
            elif r.segment is not None and r.powertrain.value == "all" and r.value is not None:
                k = (r.company_canonical, r.flow.value, r.period_date)
                f1_maker[k] = f1_maker.get(k, 0.0) + r.value

        industry_mismatches: list[str] = []
        maker_diffs: list[str] = []
        max_maker_pct = 0.0
        for (canonical, flow), monthly in seam.items():
            for month, f2 in monthly.items():
                if canonical == INDUSTRY_TOTAL_CANONICAL:
                    f1 = f1_industry.get((flow, month))
                    if f1 is None:
                        continue
                    if abs(f1 - f2) > max(SEAM_INDUSTRY_TOL_ABS, SEAM_INDUSTRY_TOL_REL * abs(f1)):
                        industry_mismatches.append(
                            f"{flow} {month}: File1={f1:.0f} vs File2={f2:.0f}"
                        )
                else:
                    k = (canonical, flow, month)
                    if k not in f1_maker:
                        continue
                    f1 = f1_maker[k]
                    if abs(f1 - f2) > 0.5:
                        pct = (abs(f1 - f2) / f1 * 100) if f1 else 0.0
                        max_maker_pct = max(max_maker_pct, pct)
                        maker_diffs.append(
                            f"{canonical}/{flow} {month}: File1={f1:.0f} vs File2={f2:.0f} ({pct:.1f}%)"
                        )

        details = {
            "industry_mismatches": industry_mismatches[:10],
            "maker_diff_count": len(maker_diffs),
            "max_maker_diff_pct": round(max_maker_pct, 1),
            "example_maker_diffs": maker_diffs[:5],
        }
        if industry_mismatches:
            return GateResult(
                self.name,
                GateStatus.FAIL,
                f"{len(industry_mismatches)} industry-total discontinuities at the seam",
                details,
            )
        msg = (
            f"industry totals match across overlap; {len(maker_diffs)} maker-level diffs "
            f"(max {max_maker_pct:.1f}%, reported not superseded)"
        )
        return GateResult(self.name, GateStatus.PASS, msg, details)


# The registry. Order is the run order.
REGISTERED_GATES: list[Gate] = [
    SchemaConformanceGate(),
    TotalsReconciliationGate(),
    SourceSeamCheckGate(),
    RowCountDeltaGate(),
    ValueRangeSanityGate(),
    PeriodContinuityGate(),
    RevisionDetectionGate(),
]


def run_gates(ctx: GateContext, gates: Iterable[Gate] | None = None) -> RunReport:
    """Run every gate and decide accept vs quarantine.

    Decision rule: ACCEPT iff no gate FAILED (SKIP and PASS both allow acceptance). Any
    FAIL means the whole payload is rejected — callers must then quarantine and fail loudly.
    """
    chosen = list(REGISTERED_GATES if gates is None else gates)
    results = [g.run(ctx) for g in chosen]
    accepted = not any(r.failed for r in results)
    return RunReport(results=results, accepted=accepted)


def quarantine_path(source_file: str, quarantine_dir: Path = QUARANTINE_DIR) -> Path:
    """Where a rejected payload is parked. Real move/copy happens in the Phase-1 runner."""
    return quarantine_dir / Path(source_file).name
