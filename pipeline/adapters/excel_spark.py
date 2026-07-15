"""Excel 'Spark' summary-workbook adapter — STUB (Phase 1).

Parses `Auto_Database__Summary__-_Spark.xlsx`: 3 sheets (`OEM - Summary - 2W, PV, 3W`,
`Tractors`, `CV`). Phase-1 implementation notes captured now so they are not rediscovered:

- Load with openpyxl `data_only=True`: totals are formula-driven (e.g. `=+B35+B85`) AND
  the date header row itself is formula-driven (`=+EOMONTH(EC2,0)+1`) and mixes real
  dates -> formulas -> the text "FY25" -> blanks. Reading formulas instead of values
  would corrupt both the periods and the numbers.
- Sheet 1's header degrades from monthly columns into fiscal-year columns (mixed
  granularity in one row) — resolve each column's native_frequency from the header cell.
- The "Electric Two Wheelers" block is a SUBSET already inside the Scooter/Motor cycles
  rows: emit powertrain='ev' for it and powertrain='all' for the main blocks; NEVER add
  them. ICE is derived downstream (all - ev), not read here.
- 0 is a real reported value ('not launched'); blank is missing. Do not coerce either way.
- Company rows begin Apr-2014 though totals begin Apr-2012.
"""

from __future__ import annotations

from pipeline.adapters.base import RawPayload, SourceAdapter, ValidationResult
from pipeline.contract.models import ContractRow

_PHASE = "Phase 1 (Backfill)"


class ExcelSparkAdapter(SourceAdapter):
    source_id = "MANUAL"  # the summary workbook is a manually maintained artifact
    native_frequency = "month"

    def fetch(self, period: str) -> RawPayload:
        raise NotImplementedError(f"ExcelSparkAdapter.fetch is implemented in {_PHASE}.")

    def parse(self, raw: RawPayload) -> list[ContractRow]:
        raise NotImplementedError(f"ExcelSparkAdapter.parse is implemented in {_PHASE}.")

    def validate(self, rows: list[ContractRow]) -> ValidationResult:
        raise NotImplementedError(f"ExcelSparkAdapter.validate is implemented in {_PHASE}.")
