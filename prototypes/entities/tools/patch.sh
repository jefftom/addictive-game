#!/bin/sh
# Regenerate integration.patch against the repo's current HEAD from game-src, in a clean
# `git archive` tree (verify/), then typecheck it there. Usage: sh tools/patch.sh [--test]
set -e
E=$(cd "$(dirname "$0")/.." && pwd)
R=/home/user/addictive-game
rm -rf "$E/verify" && mkdir -p "$E/verify"
git -C "$R" archive HEAD | tar -x -C "$E/verify"
cd "$E/verify"
# game-src carries whole-file copies of renderer.ts/types.ts/world.ts: refuse to run if upstream
# changed them since orig/head/ was snapshotted (re-merge by hand first).
for f in render/renderer.ts game/types.ts game/world.ts; do
  cmp -s "src/$f" "$E/orig/head/$(basename $f)" || { echo "upstream changed src/$f: merge it into game-src first"; exit 1; }
done
git init -q && git add -A && git -c user.email=x@x -c user.name=x commit -qm "HEAD $(git -C "$R" rev-parse --short HEAD)"
for f in render/entityfx.ts render/shardfx.ts render/vessels.ts render/renderer.ts game/types.ts game/world.ts; do cp "$E/game-src/src/$f" "src/$f"; done
git add -A && git diff --cached > "$E/integration.patch"
git diff --cached --stat
ln -s "$R/node_modules" node_modules
npx tsc --noEmit -p .
npx tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom src/render/vessels.ts src/render/shardfx.ts src/render/entityfx.ts
[ "$1" = "--test" ] && npx vitest run
echo "patch OK against $(git -C "$R" rev-parse --short HEAD)"
