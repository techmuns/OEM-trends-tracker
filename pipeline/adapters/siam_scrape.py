"""SIAM scraper adapter — STUB, intentionally not built.

Company-level SIAM data sits behind a paid subscription with a no-redistribution clause;
there is no free public endpoint at this granularity to scrape (SIAM's public releases are
industry-level aggregates — a different universe that would break the one-source rule).

The recurring artifact is therefore *a file someone obtains*, handled by the file-drop
adapter (`siam_monthly.py`) + the watched folder. This scraper stays a stub and is only
implemented if a licensed feed or scheduled delivery ever exists.
"""

from __future__ import annotations

from pipeline.adapters.base import RawPayload, SourceAdapter, ValidationResult
from pipeline.contract.models import ContractRow

_PHASE = "not built (login-gated, licensed data — see module docstring)"


class SiamScrapeAdapter(SourceAdapter):
    source_id = "SIAM"
    native_frequency = "month"

    def fetch(self, period: str) -> RawPayload:
        raise NotImplementedError(f"SiamScrapeAdapter.fetch: {_PHASE}.")

    def parse(self, raw: RawPayload) -> list[ContractRow]:
        raise NotImplementedError(f"SiamScrapeAdapter.parse: {_PHASE}.")

    def validate(self, rows: list[ContractRow]) -> ValidationResult:
        raise NotImplementedError(f"SiamScrapeAdapter.validate: {_PHASE}.")
