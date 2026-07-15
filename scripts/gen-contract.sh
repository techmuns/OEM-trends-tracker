#!/usr/bin/env bash
# Regenerate the language bindings from the single source of truth (schema.json).
# Deterministic: the contract sync test regenerates with the SAME commands and diffs.
set -euo pipefail
cd "$(dirname "$0")/.."

SCHEMA=pipeline/contract/schema.json

# Python (pydantic v2)
uv run datamodel-codegen \
  --input "$SCHEMA" \
  --input-file-type jsonschema \
  --output pipeline/contract/models.py \
  --output-model-type pydantic_v2.BaseModel \
  --use-standard-collections \
  --use-union-operator \
  --use-schema-description \
  --target-python-version 3.11 \
  --disable-timestamp \
  --formatters black isort \
  --custom-file-header "# GENERATED FROM pipeline/contract/schema.json - DO NOT EDIT BY HAND.
# Regenerate with: ./scripts/gen-contract.sh"

# TypeScript
pnpm exec json2ts \
  -i "$SCHEMA" \
  -o pipeline/contract/types.ts \
  --additionalProperties false

echo "Contract bindings regenerated."
