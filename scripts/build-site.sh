#!/usr/bin/env bash
# Assemble the deployable static site into ./dist (Cloudflare Pages output dir).
#
# Phase 0: copy the UI placeholder and expose the SAMPLE bundle so the deploy pipeline is
# exercised end-to-end. Phase 1 writes the real bundle to data/bundle/bundle.json and this
# script will copy THAT (falling back to the fixture only when no real bundle exists yet).
# Phase 3 replaces ui/ with the built dashboard and this script runs its build.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=dist
rm -rf "$OUT"
mkdir -p "$OUT/data"

# UI (Phase 0: static placeholder; Phase 3: built dashboard output)
cp ui/index.html "$OUT/index.html"

# Data: prefer the real committed bundle; fall back to the synthetic fixture in Phase 0.
if [ -f data/bundle/bundle.json ]; then
  cp data/bundle/bundle.json "$OUT/data/bundle.json"
  echo "[build-site] copied real bundle -> $OUT/data/bundle.json"
else
  cp fixtures/sample_bundle.json "$OUT/data/sample_bundle.json"
  echo "[build-site] no real bundle yet — exposed sample fixture -> $OUT/data/sample_bundle.json"
fi

echo "[build-site] wrote $OUT/"
