"""Revision / supersede logic.

A newer source file can CORRECT an old period. Blind-appending would create duplicates or
silently preserve wrong values. The rule (never negotiable):

    Never delete a row. When a value changes, mark the old row is_superseded=True and
    write a NEW row at revision+1. This preserves a full audit trail.

The "current" view of the store is simply the rows where is_superseded is False.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from pipeline.contract.models import ContractRow

# Fields that identify the SAME observation (its natural grain + source). Everything else
# — value, revision, ingest_date, is_superseded, confidence, source_file, source_period,
# is_partial, periods_present/expected — is either the measurement or provenance-of-revision.
OBSERVATION_KEY_FIELDS = (
    "period_date",
    "period_type",
    "category",
    "segment",
    "sub_segment",
    "company_canonical",
    "flow",
    "powertrain",
    "geography",
    "metric",
    "unit",
    "source",
)


def observation_key(row: ContractRow) -> tuple:
    """The natural key identifying an observation across revisions."""
    return tuple(getattr(row, f) for f in OBSERVATION_KEY_FIELDS)


def current_rows(rows: Sequence[ContractRow]) -> list[ContractRow]:
    """The live view: non-superseded rows only."""
    return [r for r in rows if not r.is_superseded]


@dataclass(frozen=True)
class RevisionOutcome:
    """Result of merging an incoming batch into an existing store."""

    rows: list[ContractRow]  # the full new store (olds flagged, new revisions appended)
    revised_keys: list[tuple]  # observation keys that got a new revision
    added_keys: list[tuple]  # brand-new observation keys
    unchanged: int  # incoming rows that duplicated an existing value (no-op)


def _values_differ(a: ContractRow, b: ContractRow) -> bool:
    # 0 and None are DISTINCT: (0 == None) is False in Python, which is exactly what we
    # want — a change from null to 0 (e.g. a maker launching) IS a real revision.
    return a.value != b.value


def apply_revisions(
    existing: Sequence[ContractRow],
    incoming: Sequence[ContractRow],
) -> RevisionOutcome:
    """Merge `incoming` into `existing`, superseding changed observations.

    - New key            -> appended as-is.
    - Same key, same value -> ignored (duplicate re-report).
    - Same key, new value  -> old row marked is_superseded=True; a copy of the incoming
                              row is appended at revision = latest_existing.revision + 1.

    Input rows are not mutated; a new list is returned.
    """
    # latest non-superseded row per key from the existing store
    latest: dict[tuple, ContractRow] = {}
    for r in existing:
        if r.is_superseded:
            continue
        k = observation_key(r)
        if k not in latest or r.revision > latest[k].revision:
            latest[k] = r

    out: list[ContractRow] = [r.model_copy() for r in existing]
    superseded_ids: set[int] = set()  # index positions in `out` we have flagged
    revised_keys: list[tuple] = []
    added_keys: list[tuple] = []
    unchanged = 0

    # index of out rows by (key, revision) to find the exact row to flag
    def _flag_superseded(key: tuple, revision: int) -> None:
        for i, r in enumerate(out):
            if i in superseded_ids:
                continue
            if observation_key(r) == key and r.revision == revision and not r.is_superseded:
                out[i] = r.model_copy(update={"is_superseded": True})
                superseded_ids.add(i)
                return

    for inc in incoming:
        k = observation_key(inc)
        prev = latest.get(k)
        if prev is None:
            out.append(inc.model_copy())
            added_keys.append(k)
            latest[k] = inc
            continue
        if not _values_differ(prev, inc):
            unchanged += 1
            continue
        # supersede the old, append a new revision
        _flag_superseded(k, prev.revision)
        new_row = inc.model_copy(update={"revision": prev.revision + 1, "is_superseded": False})
        out.append(new_row)
        revised_keys.append(k)
        latest[k] = new_row

    return RevisionOutcome(
        rows=out,
        revised_keys=revised_keys,
        added_keys=added_keys,
        unchanged=unchanged,
    )
