export const meta = {
  name: 'shardstorm-deterministic-math',
  description: 'Make the sim bit-identical across CPU architectures (macOS arm64 golden-master failure): deterministic math module, guard test, golden re-capture, adversarial verification',
  phases: [
    { title: 'Implement', detail: 'dmath module, replace sim call sites, import-closure guard test, re-capture golden' },
    { title: 'Verify', detail: 'numerical fuzzing, platform-dependence sweep, behaviour/perf/balance equivalence' },
    { title: 'Fix', detail: 'apply confirmed findings, rerun all checks' },
  ],
}

const ROOT = '/home/user/addictive-game'
const WT = ROOT + '/.claude/worktrees/fix-dmath'
const SP = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad'
const OUT = SP + '/dmath'

const CONTEXT = `PROJECT: SHARDSTORM, a TypeScript + Vite arena-survival roguelite. src/game/ is a deterministic fixed-step 60 Hz simulation (World in src/game/world.ts, seeded RNG streams in src/core/rng.ts, an autoplay bot in src/game/bot.ts, run setup in src/game/runconfig.ts, upgrades in src/game/upgrades.ts, content tables in src/game/content/*). tests/golden.solo.test.ts is a golden master: it plays fixed seeds with the bot and compares checkpoints (score, kills, x, y, hp, enemies, combo, weapons, next) to inline recorded values.
THE BUG: in CI the golden master passes on Linux x64 and Windows x64 but FAILS on the macOS arm64 runner (same Node 22): one seed drifts by ~1e-3 in x/y, others diverge completely. Root cause: the sim uses Math.sin/cos/atan2/exp/pow/hypot (and the ** operator). ECMAScript leaves these 'implementation-approximated'; V8's C++ implementations give different last-bit results on arm64 vs x64 (e.g. FMA contraction in the compiled libm ports), and the chaotic sim amplifies the difference. This also means a Daily Run (same seed for everyone) plays differently on a Mac than on a PC. Basic IEEE-754 ops (+ - * /), Math.sqrt, Math.abs/floor/ceil/round/trunc/sign/min/max/fround/imul and comparisons are exactly specified and identical everywhere; JS engines never fuse JS-level multiply-adds.
WORKTREE: ${WT} (branch fix/dmath, node_modules symlinked). The main checkout ${ROOT} is OFF LIMITS (no edits, no git commands that change it). Other agents are working in other worktrees on rendering; do not touch those.
COMMITS: every commit message ends with (after a blank line):
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ufw2FXiEUyE3RQq4NbkUr6
Never put AI model names in commits or code. Do not push.
CHECKS: npx tsc --noEmit; npx vitest run --maxWorkers=2; npm run build:single; e2e: E2E_PORT=4441 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test. Shared machine: kill only processes you started.`

const IMPL = `${CONTEXT}

YOUR TASK: fix the root cause.
1. Add src/core/dmath.ts: deterministic replacements written ONLY with exactly-specified operations (see above; bit-level access via Float64Array/DataView/Int32Array is fine; no Math transcendental functions, no ** operator): sin, cos (Cody-Waite range reduction with a multi-part pi/2 constant, fdlibm-style minimax kernels), atan, atan2 (all quadrants, signed zeros and infinities like Math.atan2), exp (fdlibm-style ln2 hi/lo reduction + polynomial, exact 2^k scaling, overflow/underflow), log, pow (for the cases the sim needs: y = 0, integer y by binary exponentiation, x > 0 with fractional y via exp(y*log x) or better; NaN/edge semantics matching Math.pow where reachable), hypot (2 args; sqrt(a*a + b*b) is fine at game scale, or a scaled version). Accuracy target: within a few ulps of Math.* over the game's input ranges (angles up to ~1e5 rad, exp args in [-745, 709]); document the guarantees in a short header comment. Keep them fast (they run thousands of times per tick).
2. Replace every implementation-approximated operation in the sim's code paths: compute the transitive import closure of src/game/world.ts, src/game/bot.ts, src/game/runconfig.ts, src/game/upgrades.ts and anything else the golden/daily/co-op tests drive (src/meta/daily.ts seed generation if it feeds the sim), and replace Math.sin/cos/tan/atan/atan2/exp/log/pow/hypot/cbrt/... and every ** operator (incl. x ** 2 -> x * x) in those files with dmath or plain arithmetic. src/core/math.ts helpers (e.g. damp uses exp, easing uses pow/sin) are shared with the renderer: switch them to dmath too (harmless for rendering). Do not change gameplay formulas otherwise.
3. Add a guard test tests/determinism.guard.test.ts in the style of tests/no-p1-alias.test.ts: it computes the import closure of the sim entry points by parsing import statements (relative imports; ignore type-only imports if you like, but simplest is to include them) and fails, with file:line, on any Math.<transcendental>( call or ** operator (strip comments and strings first so JSDoc /** does not count). Prove it works: temporarily add Math.sin to world.ts, see it fail, revert.
4. Re-capture the golden master ON PURPOSE: the values must change once because the math changed. Write a small capture helper (e.g. a script or an env-gated test path) that prints the checkpoints in the file's exact format, paste the new values, and update the header comment ('Re-captured on <this commit> after moving the sim to deterministic math (src/core/dmath.ts) so runs are identical on every CPU architecture'). Check any other tests with recorded sim numbers (coop.test.ts, game.test.ts daily determinism, story tests) and update only values that legitimately changed because of the math switch.
5. Sanity: the game must play the same in spirit. Compare a few bot runs before/after (score/time within normal seed variance) and measure the sim's per-tick cost before/after (bot run of 300 s game time, wall clock): report both.
6. Update docs/GAME_DESIGN.md (a short 'Determinism' note) and commit (one or two focused commits).
RETURN: summary of what changed (files, functions), accuracy you measured, perf before/after, the new golden header, anything uncertain.`

const VERDICT = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          line: { type: 'number' },
          problem: { type: 'string' },
          evidence: { type: 'string', description: 'Concrete input/output, command and output, or code path proving it' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'problem', 'evidence', 'fix'],
      },
    },
    checked: { type: 'string', description: 'What you checked and how (so the lead knows the coverage)' },
  },
  required: ['findings', 'checked'],
}

const lens = (name, body) => `${CONTEXT}

An implementer just fixed this in ${WT} (branch fix/dmath; see git -C ${WT} log -3 and git -C ${WT} diff ab45301..HEAD). You are an ADVERSARIAL REVIEWER with the '${name}' lens. Do not edit files in the worktree; write any scratch scripts/tests under ${OUT}/${name}/ (you can import repo modules from there via absolute paths, e.g. with npx tsx or a throwaway vitest config pointing at your scratch dir, or vite-node). Report only real, evidenced problems (each with a concrete reproduction); an empty findings list is a fine answer if the work holds up.
${body}`

const LENSES = [
  ['numerics', `Fuzz src/core/dmath.ts against Math.* : millions of random inputs per function over the game's ranges AND adversarial ones (+-0, NaN, +-Infinity, subnormals, huge angles 1e6..1e15, multiples of pi/2 and near them, exp near overflow/underflow thresholds, pow with x = 0, 1, negative, y = 0, integers, halves, huge; atan2 every quadrant and axis incl. signed zeros, hypot with infinities/NaN). Report max ulp error per function and range, any NaN/Infinity mismatch where the sim could plausibly reach it, any discontinuity or non-monotonic step large enough to matter in gameplay, and any use of a non-exactly-specified operation inside dmath itself (Math transcendental, **, toFixed parsing, etc.). Also micro-benchmark dmath vs Math.`],
  ['coverage', `Hunt for anything that can STILL make the sim differ across platforms or runs: build the import closure of the sim entry points yourself (world, bot, runconfig, upgrades, daily, director, enemyai, weapons, content, core rng/math/grid) and look for remaining Math transcendentals or ** (incl. in default parameters, content tables evaluated at load, getters), Math.random, Date/performance.now in sim logic, Intl/localeCompare/toLocaleString, sort comparators that are inconsistent, iteration over Sets/Maps keyed by floats, Float32 rounding differences, dependence on object key order with numeric-like keys, typed-array endianness. Then attack the guard test: mutation-test it (insert Math.sin, Math.pow, x ** 2, a ** in a template string, an import of a new helper file that uses Math.exp) and check it fails/passes correctly, and that it cannot be trivially bypassed by a sim file that is reachable but not in its entry list. Also confirm the golden re-capture was a pure re-record (the header/comment explains it; no checkpoints removed or tolerances loosened).`],
  ['equivalence', `Review every call-site replacement in the diff for semantic changes: argument order (atan2(y, x)), pow edge cases at the actual inputs (e.g. HP formula (t/220)^2.4 at t = 0, workshop cost curves with integer and fractional exponents), hypot of points, exp sign, any formula accidentally altered, any renderer-only code needlessly changed. Then measure: (1) sim cost per tick before (commit ab45301) vs after on identical bot runs (e.g. 4 seeds x 300 s game time; wall clock); (2) gameplay equivalence: run the balance sim (vitest.sim.config.ts / tests/balance.sim.ts; reduce run count if very slow) or your own bot batch on both commits and compare win rate / median survival / score distributions; flag only differences beyond normal seed variance. (3) Run the full checks on the branch (tsc, vitest, build:single, e2e on port 4442) and report failures.`],
]

phase('Implement')
const impl = await agent(IMPL, { label: 'implement dmath', phase: 'Implement' })

phase('Verify')
const reviews = await parallel(LENSES.map(([name, body]) => () =>
  agent(lens(name, body), { label: 'verify:' + name, phase: 'Verify', schema: VERDICT })))

const findings = reviews.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ lens: LENSES[i][0], ...f })))
log(findings.length + ' findings (' + findings.filter((f) => f.severity !== 'minor').length + ' blocker/major)')

phase('Fix')
let fix = null
if (findings.length) {
  fix = await agent(`${CONTEXT}

The deterministic-math fix is on branch fix/dmath in ${WT}. Implementer's summary:
${impl}

Adversarial reviewers reported these findings (JSON):
${JSON.stringify(findings, null, 2)}

YOUR TASK: verify each finding yourself (reproduce it); fix every real blocker/major one and every minor one that is cheap and clearly correct; for each finding you reject, say why (with evidence). If a fix changes sim numbers, re-capture the golden master again ON PURPOSE (same procedure, header comment kept accurate). Run all checks (port 4443 for e2e), commit, and return: per finding, fixed/rejected + why; final check results; final head commit.`, { label: 'fix findings', phase: 'Fix' })
}
return { impl, reviews, fix }
