# Cross-platform deterministic simulation (macOS CI fix)

> Task 1 in `docs/HANDOFF.md`, and the highest priority. Merge this before tasks 2 and 3.
> Facts below were checked on 2026-10-11 against the PR branch's code at `a114403` and `wip/fix-dmath` at `2980d33`.
> Later commits on the PR branch (`3f8aef9`, `79fe2f1`, …) only add `docs/specs/`; they change no code or test.
> Measurements were taken on a shared Linux x64 container with Node 22.22, so treat timings as indicative.

## 1. Goal

A given seed and input sequence must play out bit-identically on every CPU, OS and JS engine: Windows x64,
Linux x64 and macOS arm64 Steam builds, and Chrome, Firefox and Safari on the web. A Daily Run (one seed for
everyone that day) must then be the same run on a Mac as on a PC, and co-op/bot runs must replay identically.
The proof is the solo golden master (`tests/golden.solo.test.ts`) passing unchanged on the macOS arm64 runner
of the `desktop` workflow (`.github/workflows/desktop.yml`), which is currently red. The game must play the same
as before: only last-bit differences in maths are allowed, with no change to balance, feel or performance.

## 2. Starting point

**Root cause.** ECMAScript lets engines approximate `Math.sin/cos/tan/atan/atan2/exp/log/pow/hypot/cbrt/…`
and the `**` operator ("implementation-approximated"). V8 implements most of them with C++ ports of fdlibm
(`Math.hypot` is its own sqrt-based code), and the compiled code gives different last bits on arm64 than on x64
(the likely cause is FMA contraction by the C++ compiler on arm64; not confirmed, and the fix does not depend on it).
The simulation is chaotic, so a 1-ulp difference in an angle grows into a completely different run. These are
exactly specified and identical everywhere: IEEE-754 `+ - * /`, `%`, `Math.sqrt`,
`abs/floor/ceil/round/trunc/sign/min/max/fround/imul/clz32`, comparisons, int32 bit ops, typed-array bit
reinterpretation of non-NaN values (byte order is probed at load), BigInt and `Number(bigint)`, numeric literals
with at most 20 significant digits, and `Number#toFixed`. JS engines never fuse a JS-level `a * b + c`.
Two near-misses: `Number#toString` may legally differ in the last digit between engines (the spec only
recommends the closest shortest form), and the bits a typed array stores for `NaN` (sign, payload) are
implementation-defined. Never feed a float's string form or a NaN's bits back into the sim.

**CI evidence.** On PR head `a114403` (run 38105188791), the `desktop` jobs gave: Linux ✓, Windows ✓, macOS ✗ at
step "Typecheck, unit tests, web build" (`npm run check`). Four of the five golden cases fail (seeds 77, 1001, 2024
and 31337; `seed 4242, rank 3, tempest, daily swarm` passes), and the run's annotations list no other failing
test. Examples:
`seed 31337, rank 8, bastion, hard mode @ death: expected { score: 2397070, kills: 17789, … } to deeply equal
{ score: 135049, kills: 1837, … }`, and `seed 2024 … @ death`, where only x/y drift. The earlier Windows red on
`df057a4` was a vitest 5 s timeout. `a114403` fixed it by setting `testTimeout: 30_000` in `vite.config.ts`.
The macOS runs on `df057a4` (run 38105097170) and `a114403` report the **same** wrong values, so the divergence is
reproducible on that runner, not flaky. The docs-only pushes `3f8aef9`/`79fe2f1` triggered `desktop` again (runs
38108328664, 38108795389), confirming that every push to the PR runs it.

**Important:** the macOS job has never got past the test step, so its later steps (achievement check,
`electron-builder --mac` universal packaging, archive, upload) have **never run on macOS**. See §10.

**Branches.**
- `claude/dazzling-faraday-2kxdhl` is the PR branch (draft PR #1 into the empty `main`). Its code at `a114403` =
  `ab45301` + AGENTS.md/HANDOFF + `docs/design/` + `prototypes/` + the test timeout; later commits add only
  `docs/specs/`.
- `fix/dmath` locally, pushed as `origin/wip/fix-dmath`. It is one commit, `2980d33 WIP (paused, unverified):
  deterministic math for cross-platform sim`, on top of `ab45301`. Its changes:
  `src/core/dmath.ts` (new, 681 lines), `src/core/math.ts`, `src/game/{bot,director,enemyai,stats,upgrades,weapons,world}.ts`,
  `src/game/content/{passives,workshop}.ts`, `tests/determinism.guard.test.ts` (new), `tests/dmath.test.ts` (new),
  `tests/golden.solo.test.ts`, `tests/coop.test.ts`.
- The two branches share no changed files, so the merge has no conflicts (checked by file list against `a114403`
  and against `79fe2f1`).

**Verified state of `2980d33`** (checked by extracting the tree while writing this spec):
- `npx tsc --noEmit` is clean. `npx vitest run`: 16 files, **318/318 pass**. `npm run build:single` works
  (single-file HTML 293.5 KB, up from 286.7 KB). **e2e has not been run.**
- `src/core/dmath.ts` exports `sin, cos, atan, atan2, exp, log, pow, hypot`. They are ports of fdlibm's
  algorithms: `sin`/`cos` go through an internal `trig()` with a three-part Cody-Waite π/2 reduction for
  |x| < 1647099 (`MEDIUM_MAX`) and a BigInt Payne-Hanek reduction (`remPio2Huge`) above it, then the `kSin`/`kCos`
  kernels; `atan2`, `exp`, `log` and `pow` follow fdlibm's `e_atan2.c`, `e_exp.c`, `e_log.c` and `e_pow.c` (those
  are the C file names, not identifiers in dmath.ts; `pow` uses e_pow's extra-precision log2, not binary
  exponentiation). Internal helpers: a musl-style `scalbn`, bit access (`hiWord`, `setHigh`, `fromWords`,
  `HI`/`LO`), and `hypot` = `Math.sqrt(a*a+b*b)` with a scaled fallback (`hypotSlow`). The header documents the
  guarantees (accuracy, special values, speed).
- Every `Math.<approximated>` call and `**` in the sim closure is replaced. `tests/determinism.guard.test.ts` passes,
  and the import closure it scans has 20 files: the 15 runtime files of `src/game/**` (`types.ts` is only
  imported as types, so it is skipped), `src/core/{dmath,grid,math,rng}.ts` and `src/meta/daily.ts`.
- The golden was re-captured **as a pure re-record**. Same 5 cases, same 15 checkpoint times, same assertions
  (`toEqual` on the observed fields, `toBeCloseTo(t, 3)`, `gameOver` on `'death'`). The header gained a
  "Re-captured after moving the sim to deterministic math…" note, but it does not name the commit yet (§5 step 4).
  The case loop moved into `play()`, and an env-gated `capture()` was added (`GOLDEN_CAPTURE=1`; in that mode the
  asserting `describe` is replaced by a printing one). `tests/coop.test.ts` "difficulty scaling" now builds its
  expected formula with `pow` imported from `src/core/dmath.ts`, so the exact comparison still holds. The other
  recorded sim number outside the golden, `[solo.score, solo.kills, solo.level]` = `[2395, 94, 5]` in
  `tests/coop.test.ts` "simulateRun plays a co-op run and keeps solo untouched" (seed 77 at 45 s), is unchanged.
- Numerics spot-fuzz against V8 `Math.*` on x64 (300k random inputs per range plus an adversarial grid of ±0,
  NaN, ±∞, subnormals, exp thresholds, near k·π/2 and huge arguments):
  - max 1 ulp for sin/cos/atan/atan2/exp/log/pow;
  - 2 ulp for hypot, which is V8's own `Math.hypot` error;
  - **no** NaN/±0/±∞ mismatches.
- Equivalence spot checks:
  - `workshopCost` gives 0/231 different values and `xpForLevel` 0/500 (they are `Math.round`ed);
  - `Director.hpMult` differs by at most 3.3e-16 relative;
  - `pow(0, 2.4) = 0`.
- Per-tick cost, measured with the sim and bot (`simulateRun`) over 4 seeds × 300 s at rank 6, min of 3–5 runs.
  The two measurements so far disagree, so treat this as **unresolved noise, not a speed-up**:
  - first measurement: `ab45301` 50.6 µs, `2980d33` 32.1 µs;
  - repeat during fact-checking (seeds 11/22/33/44, interleaved before/after/before/after): before 21.8–24.2 µs,
    after 21.8–23.9 µs, i.e. **parity within ±10 %**.
- Microbenchmarks (2·10⁶ calls, dmath time ÷ native time; two runs): sin/cos 0.75–1.0, atan2/exp 1.1–1.3,
  hypot about 0.46 (V8's variadic `Math.hypot` is slow), pow about 2.0–2.2 (off the hot path).
- Behaviour on 64 seeds (5000–5063, rank 1, skill 0.6, 660 s cap; reproduced exactly during fact-checking):
  - median survival 309 s → 358 s;
  - mean survival 374 s → 393 s;
  - runs reaching 10:00: 10/64 → 13/64;
  - Mann-Whitney z = −0.59, so no significant difference.
- Guard mutation test:
  - **Caught:** `Math.sin` added to world.ts; a new helper file with `Math.exp` imported by world.ts; `**` inside a template literal.
  - **Not caught:** `const M = Math; M.sin()`; `globalThis.Math.sin()`; `({ sin: f } = Math)`; `Math[name]` with a computed key;
    and a new `src/game/*.ts` file that the five entry points do not import.

**If `origin/wip/fix-dmath` cannot be fetched**, try these in order:
1. `git fetch origin 2980d33e6520cd4f9fcf75c74eef7d85e9547d16`, then use `2980d33` wherever this spec says
   `origin/wip/fix-dmath` (the merge in §5 step 0 still keeps `2980d33` in history).
2. Ask the owner for `git format-patch -1 2980d33 --stdout > dmath.patch` and apply it with `git am`. This creates
   a new commit instead of `2980d33`, so the "`2980d33` is in `git log`" item in §9 becomes "the applied patch's
   commit is in `git log`, with its original author and message"; say so in the PR.
3. As a last resort, re-implement the original brief's steps 1–4 (table in §5) from this spec: the fdlibm routines
   named above, `tests/determinism.guard.test.ts` and `tests/dmath.test.ts` as described in §5 and §8, then a
   deliberate golden re-capture (§4.5) whose header names the commit that re-captures it.

## 3. Read first

1. `AGENTS.md`: hard rules 1 (determinism/golden), 3 and 4.
2. `docs/HANDOFF.md` §1.
3. `git show origin/wip/fix-dmath --stat`, then `src/core/dmath.ts` (header first), `tests/determinism.guard.test.ts`,
   `tests/dmath.test.ts`, and the `git diff ab45301 origin/wip/fix-dmath -- tests/golden.solo.test.ts src/`.
4. `tests/golden.solo.test.ts` as on `2980d33` (`CASES`, `play`, `capture`; the last two do not exist before the
   merge) and `tests/helpers.ts` (`simulateRun`, `median`, `botRngFor`).
5. `tests/no-p1-alias.test.ts` (the house style for guard tests; `tsFiles()`).
6. `.github/workflows/desktop.yml` and `.github/workflows/ci.yml`.
7. `tests/balance.sim.ts` (env `SIM_RUNS`, `SIM_SKILL`, `SIM_ONLY`) and `vitest.sim.config.ts`.

## 4. Owner decisions and constraints

1. Fix the root cause: the simulation computes with deterministic maths. Do not just pin the Node version,
   skip macOS, or make the golden tolerant.
2. `src/core/dmath.ts` may use **only** exactly specified operations (listed in §2). It must not use a
   transcendental `Math.*`, `**`, string-parsing tricks, or WebAssembly.
3. Accuracy: a few ulp at most against `Math.*` over game ranges (angles up to ~1e5 rad, exp arguments in
   [−745, 709]), with exact `Math.*` semantics for NaN, ±0 and ±∞ wherever the sim can reach them (atan2: all
   quadrants, signed zeros and infinities; pow: `Math.pow`'s edge rules). The guarantees are documented in the
   dmath.ts header comment; keep that header accurate when anything changes. Keep the functions fast, because
   they run thousands of times per tick.
4. Replace every implementation-approximated operation in the sim's runtime import closure, including
   `x ** 2`, which becomes `x * x`. The shared helpers in `src/core/math.ts` (`damp`, `ease`) use dmath too.
   That is harmless for rendering. Do not change any gameplay formula beyond that, and leave renderer, UI
   and audio files on `Math`.
5. **The golden master is re-captured exactly once, on purpose.** This is legitimate under AGENTS.md rule 1:
   the change is deliberate (the maths implementation), it is made once, and it is documented in the
   header. The old values encoded V8-on-x64 libm bits, which were never portable. No checkpoint is removed
   and no tolerance is loosened. After the merge, the golden must **never** be re-captured to get macOS
   green. If a review fix changes dmath output bits, re-capture again on purpose on Linux/Windows x64 using
   the same procedure (`capture()` in the golden file), update the header so it names the re-capture commit
   (§5 step 4) and the pinned hashes in `tests/dmath.test.ts`, and say so in the commit message.
6. A guard test enforces the rule from then on. It must be hard to bypass by accident, as described in §5 step 2.
7. Merge into the PR branch with a **merge commit**. Do not rebase, squash or force-push, and keep `2980d33`
   in the history.
8. The acceptance gate is a fully green macOS `build` job of the `desktop` workflow, and Windows/Linux and the
   `CI` workflow must stay green. (The workflow's `deploy` job is skipped by design: it only runs on a manual
   dispatch with Steam deploy enabled.)
9. Hard rules still apply: strict TypeScript, `build:single` keeps working, no skipped or loosened tests,
   original IP only, and no AI model names in code, comments, docs or commit messages.

## 5. Implementation plan

Status of the original implementation brief (steps 1–6), and what is left:

| Brief step | Status |
|---|---|
| 1. `src/core/dmath.ts` | Done. Needs the numerics review in step 1 below and a licence notice. |
| 2. Replace sim call sites | Done for the closure. Review the call sites in step 3 below. |
| 3. Guard test | Done, but bypassable. Harden it in step 2 below. |
| 4. Golden re-capture | Done as a pure re-record. Verify it in step 4 below. |
| 5. Perf and behaviour sanity | Spot-checked while writing this spec. Re-measure and report (step 3 below). |
| 6. Docs (`docs/GAME_DESIGN.md` determinism note) | **Not done** (step 5 below). |

The original plan had an adversarial review (numerics, coverage, equivalence) followed by a fix pass; steps 1–3
below are that review. For every problem you find: reproduce it, then fix it (all real defects, plus cheap minor
ones) or record why you reject it, with evidence (input/output, command and output). Put the list in the PR
description.

**Step 0: merge (do this first).**
```bash
git fetch origin
git switch claude/dazzling-faraday-2kxdhl && git merge --ff-only origin/claude/dazzling-faraday-2kxdhl
git merge --no-ff origin/wip/fix-dmath -m "Merge deterministic math for a cross-platform simulation (wip/fix-dmath)"
npm ci && npm run typecheck && npm test
```
All follow-up work goes in focused commits on the PR branch after the merge. Do not push until the §9 local
checks pass (HANDOFF: "merge … once each one passes every check"); only the macOS gate needs the push, because
the `desktop` workflow runs only on GitHub.

**Step 1: numerics review.** Write a throwaway fuzz harness and do not commit it. Two ways that work: a file such
as `tests/fuzz-dmath.sim.ts` run with `npx vitest run --config vitest.sim.config.ts tests/fuzz-dmath.sim.ts`
(the default config only picks up `tests/**/*.test.ts`; delete the file afterwards), or a plain `.mjs` script
that does `import * as dm from './src/core/dmath.ts'` and runs with `node --experimental-strip-types`
(dmath.ts has no imports, so Node 22 can load it directly). Make it compare `dmath.*` with `Math.*` (and
optionally a BigInt or decimal high-precision reference) using:
- at least 10⁶ random inputs per function over the game ranges (the original brief asked for millions);
- random bit patterns;
- adversarial values:
  - ±0, NaN, ±∞, ±5e-324, 2.2250738585072014e-308;
  - huge angles from 1e6 to 1e300, k·π/2 for |k| up to 4e6 and their neighbours;
  - the exp thresholds 709.782712893384 and −745.1332191019411 and their next doubles;
  - pow with x ∈ {0, −0, 1, −1, negative} × y ∈ {0, integers, ±0.5, huge, ±∞, NaN};
  - atan2 over every quadrant and axis, including signed zeros;
  - hypot with ∞ and NaN.

Report the max ulp per function and range. Check monotonicity of sin/cos/exp/atan over game ranges (no step
backwards larger than 1 ulp) and look for discontinuities at the reduction boundaries (|x| = π/4, `MEDIUM_MAX`).
Read dmath.ts itself for anything that is not exactly specified (a transcendental `Math.*`, `**`, `toString`
parsing). Also check that no branch depends on the sign or payload bits of a NaN read through `F`/`W` (those bits
are implementation-defined): a NaN input must give the `Math.*` result (NaN, or the special cases such as
`pow(NaN, 0) = 1` and `hypot(NaN, ±∞) = ∞`) whatever its bits.

Acceptance: ≤ 2 ulp against `Math.*` (≤ 3 for hypot, because V8's own hypot is the inaccurate side) and no
special-value mismatch. Fix any real defect, and add a regression input to `tests/dmath.test.ts`.

**Step 2: harden the guard (`tests/determinism.guard.test.ts`).**
- a) Scan every `.ts` file under `src/game/` as well as the closure of `SIM_ENTRIES`, using a `tsFiles()` walk
  like `tests/no-p1-alias.test.ts`. An orphan sim file is then covered before anything imports it. Keep the
  `'the import closure covers the whole sim'` assertions.
- b) Switch `offenders()` from a deny-list to an **allow-list**. Flag every use of the identifier `Math`, of a
  `X.Math` property access (`globalThis.Math`, `window.Math`, `self.Math`) and of a `X['Math']` element access,
  unless it is directly `Math.<member>` with a member in `{ abs, floor, ceil, round, trunc, sign, min, max, sqrt,
  fround, imul, clz32, PI, E, LN2, LN10, LOG2E, LOG10E, SQRT2, SQRT1_2 }`. That catches aliases, destructuring
  assignment and computed keys. (Checked: the sim closure and every `src/game` file today use only `abs`, `ceil`,
  `floor`, `imul`, `max`, `min`, `PI`, `round`, `sqrt`, plus `random` in `rng.ts`, so the allow-list passes
  the current code.) An object-literal key named `Math` (`{ Math: 1 }`) need not be flagged; any `.Math` or
  `['Math']` access should be. Keep the check on the AST so comments and strings never count.
  - `Math.random` appears only in `randomSeed` (`src/core/rng.ts`, used by `src/app.ts` and never during a tick).
    Allow it for that file only, and say why.
  - `**` and `**=` stay banned.
- c) Extend the `'the scanner flags every form and ignores comments and strings'` self-test with the bypasses
  found in §2: alias, `globalThis.Math`, `globalThis['Math']`, destructuring assignment, computed key, plus
  `Math.random` in a file other than `src/core/rng.ts`, and an allowed-member control line that must **not** be
  flagged. Its existing expectation `'6: Math.hypot'` etc. will change wording with the allow-list; update the
  expected strings, not the sample's coverage.
- d) Add a **runtime trap** test in the same file, because a static scan cannot see code paths outside the
  scanned files. In a `try/finally`:
  1. Replace every approximated `Math` function (the `APPROXIMATED` set) on the global `Math` with a recorder.
  2. Only then load the sim with dynamic imports (`await import('./helpers')`, `await import('../src/meta/daily')`),
     so values computed at module load (content tables, top-level constants) run under the trap too. The guard
     file must therefore not import any sim module or `tests/helpers.ts` statically.
  3. Run `simulateRun` (from `tests/helpers.ts`) with `maxTime` 90 for each of: solo
     (`{ seed: 77, rank: 1 }`); 3-pilot co-op at rank 8, so relic offers run (`relicsEnabled` is `rank >= 3`):
     `{ seed: 31337, rank: 8, players: ['spark', 'vanguard', 'bastion'] }`; and a daily run,
     `const d = dailyInfo('2026-01-01')` then `{ seed: d.seed, daily: d.modifier.id }`.
  4. Restore the originals and expect no recorded calls. Record the name plus a short stack so a failure points
     at the caller.

  This was prototyped exactly as above (dynamic imports, those three runs): it passes on `2980d33`, and on
  `ab45301` it catches atan2/cos/exp/hypot/pow/sin. Vitest isolates test files by default (one worker per
  file), so patching `Math` in one file does not leak; keep the `try/finally` anyway.
- e) Mutation-test the hardened guard by hand. Each of the following must fail with `file:line`:
  - `Math.sin` in world.ts;
  - `Math.pow` in director.ts;
  - `x ** 2`, and `**` in a template literal;
  - a new helper file with `Math.exp` imported from world.ts;
  - an orphan `src/game/x.ts`;
  - the five bypasses, plus `globalThis['Math'].sin(x)`;
  - a module-level constant computed with `Math.pow` in a content table (for the runtime trap's load-time
    coverage, temporarily blind the static scan to that file to see the trap fail on its own).

  Revert every mutation, and record the list in the commit message.

**Step 3: equivalence review.**
- Re-read every replaced call site in `git diff ab45301 2980d33 -- src/` and check for the following:
  - argument order `atan2(y, x)`;
  - sign of `exp(-rate * dt)` in `damp` and of `exp(-KNOCK_DECAY * dt)` in `updateEnemies`;
  - `pow` at the real inputs: `Director.rate`, `Director.hpMult` at t = 0, `xpForLevel` at l = 0,
    `workshopCost`, the `overclock`/`dashcoil`/`reflex` multipliers, and `offerCandidates` relic weight
    `pow(luck, tier)`;
  - no formula accidentally altered;
  - no renderer-only file touched.
- Coverage sweep: look through the sim closure and `src/game/**` for anything else that can differ per platform
  or per run, including in default parameters, getters and content tables evaluated at load:
  - remaining transcendentals or `**`; `Math.random`; `Date`/`performance.now` in sim logic;
  - `Intl`, `localeCompare`, `toLocaleString`; inconsistent sort comparators;
  - iteration over `Set`/`Map` keyed by floats; `Float32Array`/`Math.fround` rounding; object key order with
    numeric-like keys; typed-array byte order.

  State found while writing this spec (re-check after the merge): `toLocaleString` appears only in display text
  (`formatNumber` in `src/core/math.ts`, and `offerText` in `src/game/upgrades.ts`);
  `Date` only in `dateKey`/`daysBetween` (`src/core/rng.ts`, called outside ticks); `Set`s hold ints or string
  ids; no `Float32Array`; the only sort is in `src/meta/daily.ts`. None of these may ever feed sim state.
- Measure:
  - sim + bot cost per tick before (`a114403`, which has no dmath) and after, on identical bot runs
    (4 seeds × 300 s; wall clock). Per-tick cost moves ±10 % between runs on a shared machine, so interleave
    before/after/before/after and take the min of at least 5 batches each;
  - gameplay equivalence with the balance sim on both commits, using a `git worktree add` checkout of `a114403`
    for "before" (run `npm ci` in it, or symlink `node_modules`):
    `SIM_RUNS=48 SIM_ONLY=fresh,veteran,coop2 npm run sim` (about 150 bot runs per commit; lower it only if
    it is too slow, and then use the rank test below).
- Compare median survival, the share of runs reaching 10:00 (count the per-seed lines with time ≥ 10:00; the
  report does not print it), and score/kill medians. Flag only differences beyond seed variance, and use a rank
  test (Mann-Whitney) or ≥ 48 seeds before calling a difference real: 16 seeds are too noisy.

**Step 4: golden header.** Confirm it is still a pure re-record (as in §2). Then make a comment-only edit so the
header names the commit, as the original brief asked and as the existing "Captured on commit 18b7adc" line does:
"Re-captured on commit 2980d33 after moving the sim to deterministic math (src/core/dmath.ts) so runs are
identical on every CPU architecture." Do not change any value. (If a later fix forces another deliberate
re-capture per §4.5, a commit cannot name itself: re-capture in one commit, then name that commit in the header in
the next.)

**Step 5: docs.**
- `docs/GAME_DESIGN.md` §9 "Technical architecture": add the "Determinism" note as a bullet directly after the
  "**Seeded RNG streams**" bullet. Proposed text: "**Determinism across platforms** (`src/core/dmath.ts`): the
  simulation never calls the `Math` functions ECMAScript lets engines approximate (`sin`, `cos`, `atan2`,
  `exp`, `pow`, `hypot`, … or `**`); it uses fdlibm-based replacements built only from exactly specified
  operations, so a seed plays out bit-identically on every CPU, OS and browser. Enforced by
  `tests/determinism.guard.test.ts`."
- `AGENTS.md` hard rule 1: add one sentence saying sim code uses `src/core/dmath.ts` and the guard enforces it.
- `README.md`: the "fully deterministic" sentence in "Project layout" can say "on every CPU and browser".
- `docs/HANDOFF.md`: mark task 1 done and update the branch table.
- **Merge-friendliness:** task 2 (`wip/wave3-platform`) rewrites the README "Credits" paragraph and the last
  bullet of GAME_DESIGN §9 ("Versioned localStorage save…"). Keep your edits away from those lines (the bullet
  position above does that) and add the README credit as a separate paragraph; expect, at most, a trivial
  conflict in README "Credits" when task 2 merges.
- **Licence notice:** dmath.ts ports fdlibm (including its `ipio2` table as `TWO_OVER_PI`), and `scalbn` follows
  musl. Copy the Sun notice verbatim from the fdlibm files the code follows into the dmath.ts header: "Copyright
  (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunSoft, a Sun Microsystems, Inc.
  business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this
  notice is preserved." (Not verified here: some fdlibm 5.3 files, reportedly `e_exp.c` and `e_pow.c`, say
  "Copyright (C) 2004"; copy what the files you compare against say, and list both years if they differ.) Add a
  line under `README.md` "Credits". Note that the production
  build strips **all** comments, including `/*! … */` and `@license` ones (checked with `npm run build:single`),
  so the notice does not reach players' copies; if the owner wants it in shipped builds, add it to the licence
  files task 2 emits (its `vite.config.ts` writes `licenses/fonts-OFL.txt`). The musl (MIT) credit for `scalbn`
  is the owner's call: either add musl's copyright line and MIT notice next to the Sun notice, or rewrite
  `scalbn` from fdlibm's `s_scalbn.c` so the Sun notice covers it (it must stay a single rounding of x·2ⁿ, and the
  pinned hashes in `tests/dmath.test.ts` must not change).

**Step 6: full checks, then push.** Run the §9 commands, then
`git push origin claude/dazzling-faraday-2kxdhl` (a normal push). Every push to the PR runs `CI` and
`desktop`: because `main` is an empty commit, the PR diff always includes `desktop/**`, which satisfies the
path filter (the PR diff is under 200 files, below GitHub's 300-file limit for path filters; docs-only pushes
have triggered it, see §2). `gh workflow run desktop.yml` does **not** work: per GitHub's documentation,
`workflow_dispatch` needs the workflow file on the default branch, and `main` is empty.

**Step 7: CI gate.** Watch the run with `gh run list --branch claude/dazzling-faraday-2kxdhl` and
`gh run view <id>` (its annotations show each failing assertion with the full expected/received diff;
`--log-failed` gives full logs, but downloading logs can be blocked by a restrictive network proxy, in which
case the annotations are enough). Done when all three `desktop` build jobs and `CI` are green (the
`deploy` job shows as skipped). `CI` runs `npm run e2e` on Linux, so it also covers the e2e item. If macOS is
still red, follow §10.

**Interfaces for later steps.** `src/core/dmath.ts` is the only maths module the sim may use; the hardened
guard covers every file under `src/game/`. Task 3b adds four optional, render-only fields to the `kill` event in
`src/game/types.ts`/`World.killEnemy` (`prototypes/entities/NOTES.md` §4.1); those copy existing values and need
no maths. The old prototype patches that touch the sim were made before dmath:
`prototypes/galaxy/integration/world.patch` and `director.patch` add `Math.hypot`/`Math.cos`/`Math.sin` calls,
and the `src/game/*` hunks of `prototypes/postfx/combined.patch` carry the same galaxy sector-timing changes.
Their sim parts must not be ported (an owner decision for task 3a), and the guard would flag the `Math` calls.
Renderer code may keep importing `damp`/`ease` from `src/core/math.ts` (now dmath-based). If the sim ever needs
`tan`, `asin` and the like, add them to dmath with the same tests and a pinned hash.

## 6. Settings and save data

There are no new settings and no save change. Saved economy values are unchanged: `workshopCost` and
`xpForLevel` give identical results. Daily bests recorded before the change came from a slightly different
simulation. That is acceptable and needs no migration.

## 7. Accessibility, mobile, co-op and performance requirements

- **Performance budget:** sim + bot cost per tick must stay ≤ 1.10× the pre-merge value on the same machine,
  measured as in §5 step 3 (interleaved, min of ≥ 5 batches; so far it measures at parity within the ±10 %
  noise, see §2). If a measurement lands near the limit, repeat it before acting on it. No dmath function may
  cost more than 3× the native call in a microbenchmark, except `pow`, which is off the hot path. The
  single-file build may grow by ≤ 10 KB (measured: +6.8 KB, 286.7 → 293.5 KB).
- **Co-op:** `tests/coop.test.ts` "two identical 2-player bot runs are identical (determinism)" and the
  runtime trap's co-op run must pass. The bot (`src/game/bot.ts`) is part of the sim closure.
- **Mobile and accessibility:** no UI change. `npm run e2e` (Playwright projects `desktop` and `mobile`, the
  latter a Pixel 7) must stay green.

## 8. Tests to add or update

- `tests/determinism.guard.test.ts`: add the hardening in §5 step 2 (scope, allow-list, self-test cases,
  runtime trap).
- `tests/dmath.test.ts`: add the adversarial inputs from §5 step 1 to `SPECIAL`/accuracy cases (exp threshold
  neighbours, negative base with integer exponents, near k·π/2) and regression inputs for any defect fixed.
  The hashes in `'dmath output bits are pinned (identical on every engine and CPU)'` are the authoritative
  cross-platform check. Change them only together with a deliberate golden re-capture.
- **Must not change:**
  - the golden values in `tests/golden.solo.test.ts` (apart from the single re-capture already in `2980d33`, or
    a deliberate one per §4.5);
  - the number of golden checkpoints and their comparisons;
  - any other recorded sim number.
- Never "fix" a platform failure by adding OS conditions, retries or tolerances.
- Test files may keep using `Math.*` where they assert a relationship, as `tests/coop.test.ts` does when
  placing enemies with `Math.cos/sin` and comparing `Math.hypot` distances. Use dmath when a test value feeds
  the sim and is compared bit-exactly, as the "difficulty scaling" test already does, or when a `Math.*`-based
  expectation could flip on a 1-ulp difference against the sim's dmath result (a near-tie).

## 9. Acceptance checklist

- [ ] The merge commit of `origin/wip/fix-dmath` is on the PR branch, with no rebase or force-push, and `2980d33` is in `git log`.
- [ ] `npm run typecheck` is clean, and `npm test` passes in full (318 + new tests).
- [ ] `npm run build:single` succeeds, and `dist-single/shardstorm.html` plays from `file://`.
- [ ] `npm run e2e` passes on both projects (`E2E_PORT=<free port> npm run e2e` if 4173 is busy; see §10 on
      stale servers).
- [ ] Numerics report: max ulp per function and range, special-value mismatches (must be none), monotonicity,
      and dmath vs Math timings.
- [ ] Guard mutation list, with each mutation failing with `file:line` and the clean tree passing. The runtime trap passes.
- [ ] Coverage sweep result (§5 step 3), and every review finding listed as fixed or rejected with evidence.
- [ ] The golden header names `2980d33` (comment-only change), and the golden values, checkpoint count and
      comparisons are otherwise untouched since `2980d33`.
- [ ] Perf: µs/tick before and after (same machine, same seeds).
- [ ] Balance: before/after table of median survival, share of runs reaching 10:00, and score/kill medians per
      profile, with a statement on seed variance.
- [ ] Docs updated (GAME_DESIGN §9, AGENTS rule 1, HANDOFF, README credits/notice).
- [ ] Pushed. The `desktop` workflow is green on **macOS**, Windows and Linux, and the `CI` workflow is green.
      Give the run URL.
- [ ] Manual smoke (optional): `?autoplay` and `?autoplay&warp=240` look and play normally, and `?coop=4`
      runs with bots.

## 10. Pitfalls and known issues

- **If the macOS job is still red, first read which step failed.**
  - **The test step fails in `tests/dmath.test.ts` "output bits are pinned":** dmath itself computes
    differently on arm64. The hash names the function.
    - Dump `(input, output bits)` pairs on Linux, then compare on macOS through a temporary debug workflow
      (below).
    - Suspects: a non-exact operation inside dmath, a NaN-bit dependency (§5 step 1), the endianness probe
      (`HI`/`LO`), or the BigInt → Number conversions in `remPio2Huge` (`Number(bigint)` is specified to round to
      nearest, so this one is unlikely).
    - Do not loosen the tolerance. If only the *ulp-vs-Math* cases fail on arm64 because V8's arm64 `Math.*`
      is the inaccurate side, change the reference to recorded high-precision values and explain why in the
      test.
  - **The test step fails in the golden while dmath passes:** a platform-dependent operation remains on a sim
    path. To find it:
    1. Run the runtime trap. It reports any approximated `Math` call with its stack.
    2. Grep the closure for `**`.
    3. Run `GOLDEN_CAPTURE=1 npx vitest run tests/golden.solo.test.ts` on Linux and macOS, then diff the output to
       find the first diverging case and checkpoint.
    4. Add a temporary per-tick state hash (to be created on a debug branch only and never merged): FNV-1a over
       the float bits of each player's x/y/vx/vy/hp, each enemy's x/y/hp, and the private `state` of
       `world.rng`/`spawnRng`/`lootRng`/`posRng` (read via a cast).
    5. Print the first tick where Linux and macOS differ, dump the entities at that tick, and trace the field back
       to its code.

    Other suspects: code outside `src/game` running during `update` (callbacks set by the app or tests), and
    an inconsistent sort comparator. None exists in the sim today; the only sort is `Object.keys(...).sort()` in
    `src/meta/daily.ts`, outside a tick.
  - **A later step fails (achievement check `node scripts/gen-steam-achievements.mjs --check`, the "Stamp Steam
    release flags" step when `vars.STEAM_APP_ID` is set, `npx electron-builder --mac --publish never`, archive or
    upload):** this is a first-time macOS packaging issue, not determinism. The likely areas are the universal merge of
    `steamworks.js` binaries (`mac.x64ArchFiles` in `electron-builder.yml`) and `hardenedRuntime` without signing.
    Fix it in `electron-builder.yml` or the workflow, in its own commit. The packaged-smoke step on macOS is
    `continue-on-error`.
  - **The debug workflow:** use a temporary `.github/workflows/determinism-debug.yml` (to be created) with `on: push`
    to a `debug/**` branch and a `macos-latest` + `ubuntu-latest` matrix. Have it run the capture or trace and
    upload the output with `actions/upload-artifact`. Delete the branch afterwards and never merge the file. If
    you cannot push branches other than the PR branch, add the debug job to the PR branch in one clearly
    labelled temporary commit and revert it in a later commit (no force-push); `on: pull_request` runs it.
- Never re-capture the golden on macOS (or anywhere) to get green. The x64 capture is the reference, and macOS
  must match it.
- The guard self-test parses sample code with the TypeScript AST, so JSDoc `/**` and strings never count.
  Keep it AST-based; a regex will produce false hits.
- `src/core/input.ts` (`pointerMove`, `pollPad`, `read`, `readSlot`) and the `dashButtonHit` handler in
  `src/app.ts` use `Math.hypot` on human input and touch positions. They are outside the sim, and live human
  input is not reproducible anyway, so leave them. If replays or ghosts are ever recorded, record the
  `ControlInput` after normalisation.
- Do not enable minifier "unsafe math" or reassociation options. Constant folding in the minifier evaluates in
  IEEE doubles and gives the same bits; reordering would not. Nothing checks the built bundle's sim bits, so
  keep the default build options.
- BigInt (used by dmath) needs ES2020 or later. The build target `es2022` and Electron are fine.
- The golden cases take 2–3 s each locally, and the macOS and Windows runners are slower. `testTimeout: 30_000`
  in `vite.config.ts` covers this. Capture mode sets its own 300 s timeout.
- `GOLDEN_CAPTURE=1 …` is bash syntax. In PowerShell use `$env:GOLDEN_CAPTURE=1`. In capture mode the golden
  **asserts nothing** (it only prints), so never set `GOLDEN_CAPTURE` in `ci.yml`/`desktop.yml` (the temporary
  debug workflow in this section is the only place for it), and never paste a capture just to turn a failure
  green.
- Playwright's `webServer` uses `reuseExistingServer: !process.env.CI`: locally it silently reuses whatever is
  already listening on the port, possibly an old build. Stop stale `vite preview` servers or pick a free
  `E2E_PORT`.

## 11. Out of scope

- The Daily Run seed uses the **local** calendar date (`dateKey` in `src/core/rng.ts`), so players in
  different time zones get different seeds at the same moment. That is a design question for the owner.
- `Math.random` seeds for normal runs (`randomSeed`).
- Replays and ghosts, and any input recording.
- Co-op balance tuning (`COOP_SCALING`, HANDOFF task 4).
- macOS code signing and notarisation (`docs/STEAM.md` §13.4).
- Testing in Firefox or Safari. The design guarantees cross-engine identity, but CI only runs V8.
- Renderer, audio and UI maths. They may keep using `Math`.
