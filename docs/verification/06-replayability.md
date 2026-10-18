# Replayability checkpoints — 2026-10-18

Baseline: `b528dc7` on `claude/dazzling-faraday-2kxdhl`. Implement in the order
in [spec 06](../specs/06-replayability-and-monetization.md), with remote web and
all desktop checks between implementation milestones.

## 6a: evolution planning

Read-only weapon-card hints and a collapsible owned-weapon guide show actual
level/partner requirements, eligible/completed states and full-slot blockers.
A solo-only pinned goal lasts one run. Co-op information belongs to the picker,
and only that pilot can operate the guide with their controller.

Strict types, 456 unit tests (27 suites), 97 browser cases (13 unchanged device
exclusions), and normal/single-file builds passed.
The six new browser cases cover pinning without time/build/RNG/offer changes,
keyboard/controller ownership, reset on a new run and 320px/portrait/landscape
fit. No simulation, balance, golden fixture or HUD snapshot changed.

Evidence: `F:\addictive-game-handoff\2026-10-18-replayability`, including build
and test logs, `6a-shardstorm.html` and four reviewed UI screenshots. The first
320px case exposed an existing content-box pause panel overflow; the panel now
includes padding in its width. The initial failure traces are preserved in
`6a-overflow-traces`. Touch sizes remain at least 44 CSS pixels; tall phone
menus scroll. Physical-device comfort and outside-player comprehension remain
playtest gates. Final suite/remote gate receipts are recorded at each push.

Earlier phone performance and co-op balance acceptance gaps remain open;
these UI changes do not resolve them. No deployment, purchase flow or ads.
