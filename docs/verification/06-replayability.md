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

6a passed web CI [39122721062](https://github.com/jefftom/addictive-game/actions/runs/39122721062)
and all desktop jobs [39122720902](https://github.com/jefftom/addictive-game/actions/runs/39122720902)
at `511f3db`. All three packaged launch checks logged `title screen ok`; Linux
also passed 49 Electron checks. Direct file-URL standalone launch and its pause
guide were verified without page errors.
Web CI reported 96 first-pass cases plus one co-op flow case passing its
configured retry (13 device exclusions). Its first attempt remained on a
level-up after P2 confirmation; the log is retained. The local full run passed
without retries. This is recorded as a transient test failure, not concealed
as a clean first-pass CI run.

## 6b: results and retry

Final build, a truthful next-run goal, explicit mode labels and Change Ship are
implemented. A duplicate result action cannot settle the run twice or restart
an already launched run. The underlying debug restart hook is preserved for
existing deterministic capture tools. Damage attribution records only the
final lethal hit, without changing damage arithmetic, RNG, balance or golden
fixtures. Contact names the enemy; projectiles identify the category only.
No environmental player-damage path exists. Victory/retreat omit death text.

459 unit tests (28 suites), strict types and normal/single-file builds pass.
The full browser run passed 103 cases with 13 unchanged device exclusions.
After adding the final co-op duplicate-retry guard, the focused results/co-op
run passed 11 cases with three existing mobile co-op exclusions, including
both new repeated-confirm cases. Remote CI runs the final combined suite.
New tests exercise actual contact/projectile collisions, shields, self-revival
and last-pilot co-op death; goal snapshots preserve the source build/save/RNG.
Browser and remote receipts are kept with this checkpoint in the evidence folder.
UI screenshots use synthetic end-of-run fixtures; they demonstrate layout,
not human survival or replay preference.
