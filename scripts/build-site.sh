#!/usr/bin/env bash
# Build the deployable static site into ./dist (Cloudflare Pages output dir).
#
# The pipeline commits the UI view-model at data/bundle/2w.json (precomputed derived
# fields — the UI does no math). This script copies it into the UI, builds the React app,
# and publishes the built app as the site root (with /data/2w.json alongside).
#
# Deploy only needs Node + pnpm (the data is already committed); no Python at deploy time.
set -euo pipefail
cd "$(dirname "$0")/.."

VIEW=data/bundle/2w.json
if [ ! -f "$VIEW" ]; then
  echo "[build-site] $VIEW not found — run the pipeline (backfill/ingest) first." >&2
  exit 1
fi

# 1. Hand the committed view-model to the UI as a static asset.
mkdir -p ui/public/data
cp "$VIEW" ui/public/data/2w.json

# 2. Build the React UI.
cd ui
if [ -z "${SKIP_UI_INSTALL:-}" ]; then
  pnpm install --frozen-lockfile
fi
pnpm build   # -> ui/dist (includes /data/2w.json from public/)
cd ..

# 3. Publish the built UI as the site root.
rm -rf dist
cp -r ui/dist dist
echo "[build-site] wrote dist/ (UI + /data/2w.json)"
