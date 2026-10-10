#!/bin/sh
# Sync the canonical grid.ts / gridfx.ts into the all-layers game copy and bundle the harness.
set -e
G=$(cd "$(dirname "$0")/.." && pwd)
cp "$G/grid.ts" "$G/combo/src/render/warpgrid.ts"
cp "$G/gridfx.ts" "$G/combo/src/render/gridfx.ts"
/home/user/addictive-game/node_modules/.bin/rolldown "$G/harness.ts" --file "$G/dist/harness.js" --format iife --platform browser
