#!/bin/sh
# Builds the combined four-layer copy (galaxy + warp grid + entities + post-FX).
set -e
D=$(cd "$(dirname "$0")/.." && pwd)
cp "$D/postfx.ts" "$D/combined/src/render/postfx.ts"
cd "$D/combined" && npx tsc --noEmit -p tsconfig.json && npx vite build --outDir "$D/combined-dist" --emptyOutDir >/dev/null && echo built
