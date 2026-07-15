#!/usr/bin/env bash
# Build the deployable static site into ./dist (Cloudflare Pages output dir).
#
# The pipeline commits per-category UI view-models at data/bundle/<cat>.json plus a
# manifest data/bundle/categories.json (precomputed derived fields — the UI does no math).
# This script copies them into the UI, builds the React app, and publishes it as the site
# root (with /data/<cat>.json + /data/categories.json alongside).
#
# Deploy only needs Node + pnpm (the data is already committed); no Python at deploy time.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST=data/bundle/categories.json
if [ ! -f "$MANIFEST" ]; then
  echo "[build-site] $MANIFEST not found — run the pipeline (ingest) first." >&2
  exit 1
fi

# 1. Hand every committed view-model + the manifest to the UI as static assets. Views are
#    data/bundle/<cat>.json; skip the canonical bundles (bundle*.json), which the UI never reads.
mkdir -p ui/public/data
cp "$MANIFEST" ui/public/data/categories.json
for v in data/bundle/*.json; do
  base=$(basename "$v")
  case "$base" in
    categories.json|bundle*.json) continue ;;
  esac
  cp "$v" "ui/public/data/$base"
done

# 2. Build the React UI. Prefer the committed lockfile; fall back if the deploy image's
#    pnpm can't consume it (version drift) so the deploy never hard-fails on the lockfile.
cd ui
if [ -z "${SKIP_UI_INSTALL:-}" ]; then
  pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
fi
pnpm build   # -> ui/dist (includes /data/*.json from public/)
cd ..

# 3. Publish the built UI as the site root.
rm -rf dist
cp -r ui/dist dist
echo "[build-site] wrote dist/ (UI + /data/categories.json + per-category views)"
