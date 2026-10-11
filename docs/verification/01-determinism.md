# Task 1: deterministic math verification

Local verification: 2026-10-10, Windows x64, Node 22.16.0, Ryzen 9 9900X.
Before: `a114403`. Imported implementation: `2980d33`, preserved by merge
`c806d39` on `claude/dazzling-faraday-2kxdhl`.

## Implementation review

The ten changed existing source files are exactly their old source with the
appropriate `Math` prefixes replaced and dmath imports added. An automated
source comparison confirmed this in addition to reviewing each call site:
`atan2(y, x)`, negative damping/knockback exponents, director curves, XP,
workshop costs, passive multipliers, and relic weights retain their formulas.
No renderer, UI, or audio file changed. The dmath function bodies are unchanged
from `2980d33`; only the fdlibm permission notice was added. Musl attribution
still needs the owner's confirmation, as specified in the task.

The five golden cases, all 15 checkpoints, comparison operators, output values,
and pinned dmath hashes remain unchanged from `2980d33`. The golden header now
identifies that original deliberate capture commit. No new capture was made.

Workshop costs: 0 differences in 231 comparisons (11 upgrades, levels 0–20).
XP: 0 differences over levels 1–500. Director HP growth's maximum relative
difference over 0–660 seconds at 0.01-second intervals was 2.38e-16.
`pow(0, 2.4)` remains exactly zero.

## Numerics

A temporary harness used seeded inputs (seed 20261010), one million game-range
inputs and one million random IEEE-754 bit-pattern inputs for each function.
Reported distances are representable-double ULP distances against this Node
runtime's native Math, not a claim that native Math is a correctly rounded oracle.

| Function | Game-range max ULP | Random-bit max ULP | dmath/native time |
|---|---:|---:|---:|
| sin | 1 | 1 | 0.97 |
| cos | 1 | 1 | 1.00 |
| atan | 0 | 0 | 1.18 |
| atan2 | 0 | 1 | 0.98 |
| exp | 0 | 0 | 1.27 |
| log | 0 | 0 | 1.36 |
| pow | 1 | 1 | 1.34 |
| hypot | 2 | 2 | 0.60 |

Ranges: angles ±1e5; atan across magnitudes 1e-8–1e8; atan2 coordinates ±2000;
exp −745–709; log inputs 1e-300–1e300; pow bases 0.001–10 and exponents ±5;
hypot coordinates ±4000. Microbenchmarks took the minimum of four million-call
passes over the same 4096 pre-generated argument arrays.

Additional checks passed:

- NaN, signed zeros, infinities, smallest subnormals, minimum normals and their
  binary combinations: no special-value mismatches.
- 100,000 huge angles per trig function, magnitudes 1e6–1e300: max 1 ULP.
- 100,000 angles per trig function beside k*pi/2, |k| <= 4,000,000: max 1 ULP.
- Both exp thresholds and three neighboring doubles each side: exact matches.
- 100,000 negative-base integer powers: max 1 ULP.
- Million-point monotonic intervals for sin, cos, atan and exp; another million
  adjacent-double comparisons for each trig function across the game range:
  no backward steps exceeding 1 ULP.

Permanent tests now cover exp-threshold neighbors, minimum normals, negative
integer powers, and signed neighboring doubles around multiples of pi/2.

## Guard and mutations

The AST allow-list scans every game file and its runtime imports, including
orphan files and helpers imported only by an orphan. Only directly accessed,
exact Math operations/constants are allowed. The file-specific `Math.random`
exception is for seed creation in `src/core/rng.ts`; the runtime trap also
traps random calls during seeded simulations.

All 12 temporary mutations failed with the expected `file:line` diagnostic:
world Math.sin; director Math.pow; exponentiation; exponentiation inside a
template; imported core helper; orphan game file; Math alias; globalThis.Math;
destructuring assignment; computed Math member; computed global Math access;
and a core helper imported only by an orphan game file. Each mutation was
restored byte-for-byte in a finally block. The clean guard passes.

Runtime traps passed for 90-second solo, rank-8 three-pilot co-op and fixed-date
daily bot runs. Math functions are restored in a finally block before assertions.

## Performance and behavior

Four seeds (1000, 1001, 2024, 31337), rank 6, skill 0.6, up to 300 seconds each;
minimum of three passes, elapsed time divided by actual simulated tick count:

| Before | After | Ratio | Budget |
|---:|---:|---:|---:|
| 22.50 us/tick | 15.74 us/tick | 0.70 | <= 1.10 |

Both revisions used the same TypeScript transpilation and headless simulation
helper, on the same machine. Shared-machine timings are indicative.

The standard balance profiles used 48 seeds each, skill 0.6, a 660-second cap,
and the same inputs as `tests/balance.sim.ts`. Before source came from a separate
detached worktree; the harness imported each revision's `simulateRun` helper.

| Profile | Survival median, seconds | Reaching 10:00 | Score median | Kill median |
|---|---:|---:|---:|---:|
| Fresh before | 267.93 | 3/48 | 104652.5 | 1879 |
| Fresh after | 374.35 | 9/48 | 240880 | 4108 |
| Veteran before | 660.02 | 42/48 | 1378750 | 15377 |
| Veteran after | 660.02 | 40/48 | 1476512.5 | 15678 |
| 2P before | 422.93 | 13/48 | 482020 | 7867 |
| 2P after | 402.10 | 14/48 | 479777.5 | 7884.5 |

Tie-corrected Mann-Whitney z for survival/score/kills: fresh −2.37/−1.71/−2.20,
veteran −0.27/−0.90/−1.08, 2P −0.39/−0.64/−0.46. Because the fresh sample shifted,
an independent confirmation used 128 fresh seeds 5000–5127, interleaving before
and after runs with the same skill/cap:

| Revision | Survival median, seconds | Reaching 10:00 | Score median | Kill median |
|---|---:|---:|---:|---:|
| Before | 301.74 | 20/128 | 105847.5 | 2038.5 |
| After | 325.80 | 24/128 | 108307.5 | 2217 |

Confirmation z for survival/score/kills: +0.077/−0.053/+0.015 (all approximate
two-sided p > 0.93). The original fresh shift did not reproduce in the independent
batch. These results support seed variance rather than systematic balance drift;
they are a bot sanity check, not proof of human play equivalence. No balance
constants were adjusted in response to these samples.

## Local acceptance

- Typecheck clean; all 322 unit tests pass, including the golden and pinned hashes.
- Browser suite: 30 pass; 8 existing device-specific skips, unchanged.
- Single-file build: 293628 -> 300595 bytes (+6967 bytes / 6.8 KiB), below 10 KB.
- Standalone `file://` Chromium smoke: Play starts a run, simulation advances
  from 2.02 to 4.20 seconds, no page errors; screenshot inspected.
- `git diff --check` clean.

Remote acceptance passed at `2be4888eb7f604f5c7c9a1641c5861458cf7ad06`:

- [CI: typecheck, unit tests, single build, desktop/mobile e2e](https://github.com/jefftom/addictive-game/actions/runs/38110261838).
- [Desktop: macOS arm64 tests and universal packaging, Windows and Linux builds, Linux smoke](https://github.com/jefftom/addictive-game/actions/runs/38110261834).

All required jobs succeeded. The deployment job was intentionally skipped.
An extra local Windows Electron smoke exposed a trailing-backslash launch-path
problem in the existing test script; task 2 fixes it and records a 48-check pass.
Firefox/Safari and signed macOS distribution are outside this task's executed checks.
