"""Load the canonical dictionaries and resolve raw source strings.

Hard-fail policy: an unresolved company name raises `UnknownCompanyError`. We never
silently pass a raw name through or auto-create a canonical — a bad mapping must stop the
ingest so it can be fixed in `companies.yaml`. `company_raw` is preserved on every row so
the failure is always traceable.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

DICT_DIR = Path(__file__).resolve().parent


class UnknownCompanyError(KeyError):
    """A raw company string had no alias mapping in companies.yaml."""


class UnknownSegmentError(KeyError):
    """A raw segment string had no alias mapping in segments.yaml for its category."""


def _norm(s: str) -> str:
    # exact match, but tolerant of leading/trailing whitespace only (NOT internal spaces —
    # 'Motor cycles' and the 'India Kawasaki MotorsPrivate Ltd' typo are matched literally).
    return s.strip()


class CompanyResolver:
    def __init__(self, alias_to_canonical: dict[str, str]) -> None:
        self._map = alias_to_canonical

    def resolve(self, raw: str) -> str:
        key = _norm(raw)
        try:
            return self._map[key]
        except KeyError as e:
            raise UnknownCompanyError(
                f"unresolved company name {raw!r} — add it to companies.yaml "
                f"(never auto-create a canonical)."
            ) from e

    def known(self, raw: str) -> bool:
        return _norm(raw) in self._map


class SegmentResolver:
    def __init__(self, by_category: dict[str, dict[str, str]]) -> None:
        self._by_category = by_category

    def resolve(self, category: str, raw: str) -> str:
        key = _norm(raw)
        cat_map = self._by_category.get(category, {})
        try:
            return cat_map[key]
        except KeyError as e:
            raise UnknownSegmentError(
                f"unresolved segment {raw!r} for category {category!r} — add it to segments.yaml."
            ) from e

    def is_segment_header(self, category: str, raw: str) -> bool:
        return _norm(raw) in self._by_category.get(category, {})


@lru_cache(maxsize=1)
def load_company_resolver(path: Path | None = None) -> CompanyResolver:
    p = path or (DICT_DIR / "companies.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for entry in data["companies"]:
        canonical = entry["canonical"]
        mapping[_norm(canonical)] = canonical  # canonical resolves to itself
        for alias in entry.get("aliases", []):
            norm = _norm(alias)
            if norm in mapping and mapping[norm] != canonical:
                raise ValueError(
                    f"alias {alias!r} maps to both {mapping[norm]!r} and {canonical!r}"
                )
            mapping[norm] = canonical
    return CompanyResolver(mapping)


@lru_cache(maxsize=1)
def load_segment_resolver(path: Path | None = None) -> SegmentResolver:
    p = path or (DICT_DIR / "segments.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    by_category: dict[str, dict[str, str]] = {}
    for category, entries in data["segments"].items():
        cat_map: dict[str, str] = {}
        for entry in entries:
            canonical = entry["canonical"]
            cat_map[_norm(canonical)] = canonical
            for alias in entry.get("aliases", []):
                cat_map[_norm(alias)] = canonical
        by_category[category] = cat_map
    return SegmentResolver(by_category)
