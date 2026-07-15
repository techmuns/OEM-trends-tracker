# OEM Tracker

A table-first, time-series dashboard tracking Indian automobile manufacturers — sales,
exports, market share, and EV-vs-ICE — built for an equity fund. It replaces a manually
maintained SIAM Excel workbook whose history was getting lost.

This repository is **Phase 0: the foundation** — the frozen data contract and the
skeleton every later phase builds against. It contains **no real data, no Excel parsing,
no scraping, and no dashboard UI yet** (those are Phases 1–3). See
[`docs/phases.md`](docs/phases.md).

## Architecture in one line
A Python pipeline commits tidy JSON against a **frozen JSON-Schema contract**; Cloudflare
Pages serves it behind Cloudflare Access; a React dashboard (Phase 3) binds to the frozen
bundle. No database. Ingestion is fully automated — zero humans in the loop.

## Repository layout
```
pipeline/
  contract/     schema.json (source of truth) + generated models.py / types.ts + constants
  adapters/     SourceAdapter ABC + excel_spark / siam / vahan stubs (NotImplementedError)
  dictionaries/ companies / segments / metrics (seeded with REAL 2W names)
  validate/     validation-gate framework + 6 registered stub gates
  aggregate/    fiscal calendar (Apr–Mar) + inclusive-dimension guard + M→Q→Y signatures
  store/        immutable snapshot writer + revision/supersede + build_bundle signature
  ingest.py     monthly-cron entrypoint (Phase 0: no-op, exits 0)
data/           raw / snapshots / normalized / bundle  (committed = audit trail)
fixtures/       sample_bundle.json — synthetic, schema-valid, all edge cases
ui/             React + Vite dashboard (reads the precomputed view-model data/bundle/2w.json)
docs/           prd · phases · design · contract-coverage
scripts/        gen-contract.sh · gen_fixture.py · build-site.sh
```

## Local development

Prereqs: [`uv`](https://docs.astral.sh/uv/) (Python) and [`pnpm`](https://pnpm.io/) (Node 22).

```bash
uv sync --extra dev          # Python env + deps
pnpm install                 # Node deps (contract type generation + tsc)

uv run pytest                # run the test suite
uv run ruff check . && uv run ruff format --check .   # lint
pnpm run typecheck           # tsc --noEmit on the generated TS types
```

### The frozen contract
`pipeline/contract/schema.json` is the **single source of truth** (`contract_version`
`1.0.0`). The pydantic and TypeScript bindings are **generated** from it:

```bash
./scripts/gen-contract.sh    # regenerates models.py and types.ts
```

A test (`tests/test_contract_sync.py`) proves schema, pydantic, and TS stay in sync and
that regeneration is byte-stable. **Never hand-edit `models.py` or `types.ts`** — edit
`schema.json` and regenerate.

### The fixture
```bash
uv run python scripts/gen_fixture.py   # regenerates fixtures/sample_bundle.json
```
It is deterministic; a test fails if the committed fixture is stale.

## CI/CD

- **`.github/workflows/ci.yml`** — lint, tests, schema/type-sync, tsc, and a site-build
  smoke check on every PR and every push to `main`.
- **`.github/workflows/ingest.yml`** — monthly cron + `workflow_dispatch`. Phase 0 runs
  `pipeline/ingest.py`, logs "no adapter configured", and exits 0. From Phase 2 it fetches
  → validates → (all gates pass) commits a snapshot + bundle → Cloudflare auto-deploys; any
  gate failure quarantines the payload and **fails the workflow** (the failure is the
  alert), while the last good bundle stays live.

---

## One-time setup (do this once; then it is automated forever)

You perform these steps a single time. After that, every push to `main` auto-deploys and
the monthly cron keeps data fresh with no further action.

### 1. Push the repository
The repo lives at `techmuns/oem-trends-tracker`. Ensure `main` is pushed.

### 2. Connect Cloudflare Pages
1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Select this GitHub repository and the **`main`** branch (production branch).
3. Set the **build configuration** in the dashboard (there is intentionally **no
   `wrangler.toml`** — a Pages `wrangler.toml` with an output dir but no build command makes
   Cloudflare skip the build and fail with *"output directory dist not found"*). Set:
   - **Framework preset:** `None`
   - **Build command:** `bash scripts/build-site.sh` — builds the React app in `ui/` and
     serves the committed view-model at `/data/2w.json`. **This must be set**, or Cloudflare
     skips the build and there is no `dist/` (it is generated, not committed).
   - **Build output directory:** `dist`
   - **Root directory:** `/`
   - Node version is pinned by [`.node-version`](.node-version) (22); pnpm is auto-detected.
4. Save and deploy. Every push to `main` now auto-deploys.

> If a build already failed: open the project → **Settings → Builds & deployments → Build
> configuration → Edit**, set the Build command and Output directory above, then **Retry
> deployment**.

### 3. Environment variables / secrets
- **Phase 0:** none required. The build is static.
- **Phase 2 (later):** add the source-fetch secrets in **GitHub → Settings → Secrets and
  variables → Actions** (not in Cloudflare) — they are consumed by `ingest.yml`. Names will
  be finalised with the adapters; expected: `SIAM_*` / `VAHAN_*` credentials. The
  `ingest.yml` workflow already has `contents: write` permission to commit new data.

### 4. Cloudflare Access — REQUIRED before any real data ships
The underlying SIAM/broker data is proprietary and licence-restricted; the dashboard must
**not** be publicly readable.
1. Cloudflare Dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
   application** → **Self-hosted**.
2. Set the application domain to your Pages URL (e.g. `oem-tracker.pages.dev` or your
   custom domain).
3. Add an **Access policy**: allow only your team (e.g. Action = *Allow*, Include =
   *Emails ending in* `@yourfund.com`, or a named email list).
4. Save. The dashboard now requires authentication.

> Do not connect a custom domain or share the `*.pages.dev` URL until Access is enforced.

---

## Non-negotiable data rules (enforced in the pipeline, summarised)
- **One source per table/chart** — sales / dispatches / registrations / exports /
  production are never interchangeable.
- **Share is computed, never stored**, only within the same source/segment/period/geography/
  powertrain scope; labelled **"Share within reported SIAM universe"**, never "market share".
- **Monthly is the base**; Quarterly/Yearly are summed (`derived`); CV is source-reported
  quarterly. Fiscal year = **April–March**.
- **`0` ≠ missing** — a reported 0 is never null, and missing is never 0.
- **Never delete** — corrections supersede via a new `revision`; the old value is retained.
- **Never sum across inclusive dimensions** — `all ⊇ ev`, `total ⊇ domestic+export`; the
  aggregation guard raises on violation.

See [`docs/contract-coverage.md`](docs/contract-coverage.md) for the full widget→field map.
