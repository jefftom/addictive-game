#!/bin/sh
# Pulls the sibling workstreams' latest repo-bound modules into the combined copy (renderer glue stays ours).
set -e
D=$(cd "$(dirname "$0")/.." && pwd)
PL=$(cd "$D/../.." && pwd)
R="$D/combined/src/render"
cp "$PL/galaxy/galaxy.ts" "$R/galaxy.ts"
cp "$PL/gfx/grid/grid.ts" "$R/warpgrid.ts"
cp "$PL/gfx/grid/gridfx.ts" "$R/gridfx.ts"
for f in vessels shardfx entityfx; do cp "$PL/gfx/entities/src/$f.ts" "$R/$f.ts"; done
ls -la --time-style=+%H:%M "$PL/galaxy/galaxy.ts" "$PL/gfx/grid/grid.ts" "$PL/gfx/grid/gridfx.ts" "$PL/gfx/entities/src/"*.ts
