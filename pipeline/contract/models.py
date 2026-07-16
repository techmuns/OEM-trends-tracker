# GENERATED FROM pipeline/contract/schema.json - DO NOT EDIT BY HAND.
# Regenerate with: ./scripts/gen-contract.sh

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, conint, constr


class Source(StrEnum):
    """
    The single source this bundle was built from (one source per bundle).
    """

    SIAM = 'SIAM'
    VAHAN = 'VAHAN'
    BROKER = 'BROKER'
    MANUAL = 'MANUAL'


class BundleMeta(BaseModel):
    """
    Bundle wrapper metadata. Does not touch the frozen ContractRow grain.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    category: str | None = Field(
        ...,
        description="Category scope of this bundle, e.g. '2W'. Null if the bundle spans multiple categories.",
    )
    source: Source = Field(
        ...,
        description='The single source this bundle was built from (one source per bundle).',
    )
    coverage_start: date = Field(
        ..., description='Earliest period_date present (first day of period).'
    )
    latest_period: date = Field(
        ...,
        description="Latest period_date present (first day of period). The UI's freshness anchor.",
    )
    snapshot_id: str | None = Field(
        ..., description='The immutable snapshot this bundle was built from.'
    )
    row_count: conint(ge=0) = Field(..., description='Number of rows in the bundle.')
    notes: str | None = Field(
        ...,
        description="Freeform provenance note (e.g. 'Data ends Dec-2025; no live feed until Phase 2').",
    )


class PeriodType(StrEnum):
    month = 'month'
    quarter = 'quarter'
    year = 'year'


class Category(StrEnum):
    """
    Vehicle category. A dimension, never an assumption. v1 seeds 2W but the contract holds all. 'ALL' = every vehicle category combined in one reported universe (used by VAHAN all-India registrations, which the source reports across all categories at once); a backward-compatible enum extension, so contract_version stays 1.1.0.
    """

    field_2W = '2W'
    PV = 'PV'
    field_3W = '3W'
    TRACTOR = 'TRACTOR'
    CV = 'CV'
    ALL = 'ALL'


class Flow(StrEnum):
    """
    Different measurements, not variants of 'sales'. total >= domestic + export; never sum total with its parts.
    """

    domestic = 'domestic'
    export = 'export'
    production = 'production'
    total = 'total'


class Powertrain(StrEnum):
    """
    Source reports 'all' and 'ev' (ev is a SUBSET of all). 'ice' is DERIVED = all - ev. Never sum across these values.
    """

    all = 'all'
    ev = 'ev'
    ice = 'ice'


class Metric(StrEnum):
    """
    What is measured. Extensible (e.g. 'value') later without a breaking change to consumers.
    """

    units = 'units'


class Unit(StrEnum):
    units = 'units'


class Source1(StrEnum):
    """
    On every row. Enforces the one-source-per-table rule and encodes measurement basis (SIAM=wholesale dispatches, VAHAN=registrations) via metrics.yaml.
    """

    SIAM = 'SIAM'
    VAHAN = 'VAHAN'
    BROKER = 'BROKER'
    MANUAL = 'MANUAL'


class NativeFrequency(StrEnum):
    """
    What the source ACTUALLY reported. CV is quarterly-native; everything else monthly-native.
    """

    month = 'month'
    quarter = 'quarter'
    year = 'year'


class CalcStatus(StrEnum):
    """
    reported = literal from source. derived = summed M->Q->Y OR ice = all - ev.
    """

    reported = 'reported'
    derived = 'derived'


class Confidence(StrEnum):
    high = 'high'
    medium = 'medium'
    low = 'low'


class ContractRow(BaseModel):
    """
    One observation. Long format: never one column per month. 0 and null are DISTINCT (0 = source-reported zero / not-launched; null = not reported). Never sum across inclusive dimension values (powertrain all>=ev; flow total>=domestic+export).
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    period_date: date = Field(
        ..., description='First day of the period, e.g. 2026-06-01.'
    )
    period_type: PeriodType
    fiscal_year: constr(pattern=r'^FY[0-9]{2}$') = Field(
        ..., description="Fiscal year Apr-Mar, e.g. 'FY26' = Apr 2025 - Mar 2026."
    )
    fiscal_quarter: constr(pattern=r'^Q[1-4]FY[0-9]{2}$') | None = Field(
        ..., description="e.g. 'Q1FY26' = Apr-Jun 2025. Null for yearly rows."
    )
    category: Category = Field(
        ...,
        description="Vehicle category. A dimension, never an assumption. v1 seeds 2W but the contract holds all. 'ALL' = every vehicle category combined in one reported universe (used by VAHAN all-India registrations, which the source reports across all categories at once); a backward-compatible enum extension, so contract_version stays 1.1.0.",
    )
    segment: str | None = Field(
        ...,
        description="e.g. 'Scooter', 'Motor cycles', 'Mopeds' (2W); 'PC', 'UV', 'Van' (PV); 'MHCV', 'LCV' (CV).",
    )
    sub_segment: str | None
    company_canonical: str = Field(
        ..., description='Resolved via dictionaries/companies.yaml.'
    )
    company_raw: str = Field(
        ...,
        description='Exactly as it appeared in the source. Kept so a bad mapping is always traceable and reversible.',
    )
    flow: Flow = Field(
        ...,
        description="Different measurements, not variants of 'sales'. total >= domestic + export; never sum total with its parts.",
    )
    powertrain: Powertrain = Field(
        ...,
        description="Source reports 'all' and 'ev' (ev is a SUBSET of all). 'ice' is DERIVED = all - ev. Never sum across these values.",
    )
    geography: str
    metric: Metric = Field(
        ...,
        description="What is measured. Extensible (e.g. 'value') later without a breaking change to consumers.",
    )
    value: float | None = Field(
        ...,
        description='The measurement. 0 and null are DISTINCT and must never be coerced into each other.',
    )
    unit: Unit
    source: Source1 = Field(
        ...,
        description='On every row. Enforces the one-source-per-table rule and encodes measurement basis (SIAM=wholesale dispatches, VAHAN=registrations) via metrics.yaml.',
    )
    source_file: str = Field(
        ..., description='The dropped source file this row came from (audit trail).'
    )
    source_period: str = Field(
        ..., description='The period the source file reports as-of.'
    )
    native_frequency: NativeFrequency = Field(
        ...,
        description='What the source ACTUALLY reported. CV is quarterly-native; everything else monthly-native.',
    )
    calc_status: CalcStatus = Field(
        ...,
        description='reported = literal from source. derived = summed M->Q->Y OR ice = all - ev.',
    )
    revision: conint(ge=0) = Field(
        ...,
        description='0,1,2... A newer file correcting an old period writes revision+1 and supersedes the old row.',
    )
    ingest_date: AwareDatetime
    confidence: Confidence
    is_superseded: bool = Field(
        ...,
        description='True once a newer revision replaces this row. Never delete; always supersede.',
    )
    is_partial: bool = Field(
        ...,
        description="True for an incomplete period (YTD / QTD / running month). Drives the 'YTD'/'Quarter to date' labels.",
    )
    periods_present: conint(ge=0) | None = Field(
        ...,
        description='Constituent sub-periods actually present in a derived aggregate (e.g. 2 months of a quarter). Null when reported/complete.',
    )
    periods_expected: conint(ge=1) | None = Field(
        ...,
        description='Constituent sub-periods a complete aggregate would have (e.g. 3 for a quarter). Null when reported/complete.',
    )


class Bundle(BaseModel):
    """
    OEM Tracker data contract. contract_version 1.1.0 (Bundle.meta added; ContractRow frozen since 1.0.0). One tidy row per observation (long format). The bundle is the artifact the UI reads. See docs/contract-coverage.md for the widget->field mapping and the non-negotiable rules.
    """

    model_config = ConfigDict(
        extra='forbid',
    )
    contract_version: Literal['1.1.0'] = Field(
        ...,
        description='Contract version. 1.1.0 added the Bundle.meta wrapper object; ContractRow is unchanged from 1.0.0.',
    )
    generated_at: AwareDatetime = Field(
        ...,
        description='When this bundle was built. Injected by the builder; never derived from wall-clock inside pure logic.',
    )
    source_universe_label: str = Field(
        ...,
        description="Human label for share denominators. For SIAM: 'Share within reported SIAM universe'. Lives in the contract, never hardcoded in UI.",
    )
    meta: BundleMeta = Field(
        ...,
        description='Bundle-level provenance/freshness metadata (added in 1.1.0). Surfaces coverage and the latest available period so the UI can label freshness loudly.',
    )
    rows: list[ContractRow] = Field(..., description='The tidy observation rows.')
