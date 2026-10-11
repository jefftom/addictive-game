#!/bin/sh
# Typecheck + build the integrated game copy and the gallery harness; sync deliverables to src/.
set -e
E=$(cd "$(dirname "$0")/.." && pwd)
cd "$E/game-src" && npx tsc --noEmit -p tsconfig.json
npx vite build --outDir "$E/game-dist" --emptyOutDir >/dev/null
npx vite build --config "$E/harness/vite.config.mjs" >/dev/null
cp "$E/game-src/src/render/vessels.ts" "$E/game-src/src/render/shardfx.ts" "$E/game-src/src/render/entityfx.ts" "$E/src/"
echo built
