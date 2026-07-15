# Delivery phases

Everything in Phase 0 exists so Phases 1–3 can be built **independently** against a stable
interface (the frozen contract).

| Phase | Goal | State |
|---|---|---|
| **0 — Foundation** | Repo, frozen contract, dictionaries, adapter interface, validation framework, aggregation calendar, snapshot/revision store, fixtures, CI/CD, docs | done |
| **1 — Backfill** | File 1 → tidy store (2W), real gate logic, aggregation, first real snapshot + bundle (`latest_period` Dec-2025) | **done — see [phase1-report.md](phase1-report.md)** |
| 2 — Live ingest | Source adapters (SIAM / VAHAN / file-drop), revision handling, monthly cron, quarantine + alert | next |
| 3 — Dashboard UI | Munshot embedded dashboard reading the frozen bundle | later |

## Phase 0 — what's built (and what is deliberately NOT)

**Built (foundation + contract):**
- `pipeline/contract/` — `schema.json` (v1.0.0) as the single source of truth; generated
  `models.py` (pydantic) and `types.ts`; a test proving all three stay in sync.
- `pipeline/adapters/` — `SourceAdapter` ABC + three `NotImplementedError` stubs
  (excel_spark, siam, vahan), proving one interface spans file-drop / scraper / API.
- `pipeline/dictionaries/` — companies/segments/metrics seeded from the **real** 2W names.
- `pipeline/validate/gates.py` — gate framework + registry + 6 named stubs + quarantine
  path + auto-accept/quarantine policy.
- `pipeline/aggregate/periods.py` — fiscal calendar (implemented + tested) and the
  inclusive-dimension guard (implemented + tested); M→Q→Y aggregation as signatures.
- `pipeline/store/` — immutable snapshot writer, revision/supersede logic, build_bundle
  signature.
- `fixtures/sample_bundle.json` — synthetic, schema-valid, with every edge case.
- CI (`ci.yml`), monthly ingest cron (`ingest.yml`, no-op exit 0), Cloudflare Pages config.

**Deliberately NOT built in Phase 0** (leaving Phase 0 means writing business logic):
- No Excel parsing (Phase 1). No scraping (Phase 2). No UI components (Phase 3).
- No real/hardcoded data values anywhere.
- Gate logic and aggregation summing are signatures/stubs only.

## What each later phase fills in
- **Phase 1** implements `ExcelSparkAdapter`, the six gates, `aggregate_months_to_*`, and
  `build_bundle`, then produces the first real snapshot + bundle for 2W.
- **Phase 2** implements `SiamAdapter` / `VahanAdapter`, wires the cron to select an
  adapter, and turns on the quarantine-and-fail-loudly path.
- **Phase 3** replaces `ui/` with the dashboard from `docs/design.md`, reading the bundle.
