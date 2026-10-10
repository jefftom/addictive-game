# SHARDSTORM work-in-progress backup (not part of the game build)

Backup of design documents and graphics prototypes made while building the game,
pushed so nothing is lost while work is paused. The playable game lives on the
`claude/dazzling-faraday-2kxdhl` branch (PR #1).

- `design/` – co-op implementation design (`coop.md`), galaxy backdrop design (`galaxy.md`),
  Steam/Electron spec (`steam.md`), final story bible and script, and helper tools.
- `galaxy/` – procedural galaxy sector backdrops (`galaxy.ts` + worker), integration diffs, harness, shots.
- `gfx/postfx/` – WebGL2 bloom/shockwave post-processing (`postfx.ts`), integration guide, before/after shots.
- `gfx/grid/` – WarpGrid spring-mesh background grid (`grid.ts`, `gridfx.ts`), integration guide.
- `gfx/entities/` – starship and crystalline-alien vessel art and shatter effects (`src/`), integration guide, shots.
- `gfx/review/` – art-director review sheets.
- `workflows/` – the orchestration scripts used to build the features.

Related backup branches: `wip/wave3-platform` (finished Steam/desktop wiring and bundled fonts),
`wip/wave3-gfx` (galaxy integration in progress), `wip/fix-dmath` (cross-platform deterministic math in progress).
