export const meta = {
  name: 'shardstorm-graphics-push',
  description: 'Prototype WebGL bloom/post-FX, a warping spring grid, and shatter/animated-sprite effects; critique and revise',
  phases: [
    { title: 'Prototype', detail: 'post-FX, warping grid, entity effects in parallel' },
    { title: 'Critique', detail: 'art director reviews every screenshot and perf number' },
    { title: 'Revise', detail: 'each prototype applies the critique' },
  ],
}

const ROOT = '/home/user/addictive-game'
const PLAN = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan'
const GFX = PLAN + '/gfx'

const BRIEF = `PROJECT: SHARDSTORM, a finished, playable neon arena-survival roguelite (Vampire-Survivors-like) in ${ROOT}. TypeScript + Vite, no runtime deps, Canvas 2D renderer.
Rendering today (read these files first): src/render/renderer.ts (camera; draws rings, mines, pickups, telegraphs, enemies via pre-rendered glow sprites, beams/projectiles/bullets/blades/particles with 'lighter' compositing, player trail, floating text, vignette, flash, HUD), src/render/sprites.ts (SpriteCache: shapes pre-rendered with shadowBlur glow), particles.ts (SoA pool: dots, streaks, spinning shards), effects.ts (float text, callouts, lightning arcs, trauma shake), background.ts (fill + radial-gradient nebula + 3 star layers + beat-pulsing grid + vignette), hud.ts, palette.ts. The sim (src/game/) emits events (kill, hit, explode, ring, bossdead, perfect, dash, hurt, levelup...) that the renderer turns into feedback (Renderer.consume). Bosses: Warden (boss_hex), Hydra (boss_star), Void Heart (boss_core). Enemies: drifter tri, swarmling dart, dasher diamond, splitter circle, shooter hex, brute square. Game designs/intent: docs/GAME_DESIGN.md.
A SEPARATE workstream is already prototyping procedural galaxy sector backdrops (replacing the radial-gradient nebula) at ${PLAN}/galaxy/ - do not duplicate it; your work must compose with it (it draws first, behind everything).
NEW THEME DIRECTION from the owner: starship combat. The player commands a STARSHIP VESSEL of an original allied fleet; five vessel classes map to the existing ship ids: spark = light frigate/scout (balanced), vanguard = armoured heavy cruiser (tanky, orbit blades), tempest = fast interceptor (lightning), bastion = shield dreadnought (nova shockwaves), phantom = stealth raider (two dashes, homing missiles). They fight an invading CRYSTALLINE ALIEN ARMADA called the Shardstorm: today's geometric enemies become alien crystal vessels (drifter = drone, swarmling = dart swarm, dasher = lancer/charger, splitter = budding cell-ship, shooter = gunship, brute = bulwark/hauler) and the bosses become alien capital ships (warden = gate fortress, hydra = multi-headed hunter-cruiser, voidheart = hive mothership). Inspired by classic TV starship adventures but 100% ORIGINAL: no names, logos, catchphrases or recognizable silhouettes from any franchise (no saucer-plus-twin-nacelle lookalikes). Keep the neon-vector arcade look (glowing line art, readable at small sizes): our vessels read as ships (hull, bridge, engine pods of our own design, running lights, engine glow) in cool colours; the aliens read as crystalline, faceted, menacing, in the existing warm-neon enemy colours.
The owner also asked to "push the graphics more". Goal: noticeably more spectacular, juicy and polished visuals while keeping 60 fps on a mid laptop and staying readable in a chaotic 300-enemy fight. Respect a "reduced flashing" accessibility setting (renderer.settings.flashes) and screen-shake setting.
RULES: Do NOT modify anything under ${ROOT} in this phase. Work only under ${GFX}/<your-area>/. You may import/copy repo code into your prototype dir. For screenshots use Playwright: import from ${ROOT}/node_modules/playwright/index.mjs, run with PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (headless Chromium; WebGL there is software SwiftShader, so treat its GPU timings as pessimistic and also report JS-side timings). To capture REAL game frames you can build the game into your own dir (cd ${ROOT} && npx vite build --outDir ${GFX}/<area>/game-dist) and drive it with ?autoplay&warp=200 (debug params: bot plays; warp fast-forwards) - window.shardstorm exposes the app (app.world, app.renderer). LOOK at your screenshots with the Read tool and iterate until they are genuinely impressive. Any code you intend for the repo must compile under the repo's strict tsconfig (noUnusedLocals, noUnusedParameters, verbatimModuleSyntax); check with cd ${ROOT} && npx tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom <file>.`

const PROMPTS = {
  postfx: `${BRIEF}

YOUR AREA: postfx (dir ${GFX}/postfx/). Build a WebGL2 post-processing pipeline module (postfx.ts) that takes the game's Canvas2D frame as an input texture each frame and outputs to a visible WebGL canvas:
- Bloom: bright-pass threshold + multi-level downsample/upsample blur (dual-Kawase or separable Gaussian at 1/2,1/4,1/8 res), additive composite, gentle tone mapping so neon cores stay saturated instead of clipping to white.
- Shockwave distortion: up to 8 simultaneous expanding ripples (center in screen UV, radius, thickness, strength) triggered by explode/ring/bossdead/bomb/perfect events; refraction offset in the composite shader.
- Chromatic aberration: radial, intensity spikes briefly on hurt/bossdead and scales with a 'damage' uniform; 0 when flashes are reduced.
- Vignette, subtle film grain, optional scanlines/CRT curvature (off by default, a setting).
- Dynamic quality: half-res bloom chain, auto-downgrade if frame time is high, and a clean fallback to the plain 2D canvas when WebGL2 is unavailable or context is lost (handle webglcontextlost/restored).
- Integration design: today the 2D canvas IS the visible canvas and also receives pointer events (src/core/input.ts attaches to it). Propose the exact integration (which canvas is visible, DOM order, how input/hit-testing keeps working, resize/DPR handling, how the HUD should be drawn: before post-FX on the 2D canvas or after on a separate overlay so text stays crisp and is not bloomed).
- Since real bloom now provides glow, assess whether sprites.ts shadowBlur padding can shrink (perf + crisper look) and show before/after.
Deliver: postfx.ts (+ shaders inline), a harness that applies it to real captured game frames, before/after screenshots (title attract mode, early game, a boss fight with explosions, a shockwave mid-ripple), JS-side timing per frame, and ${GFX}/postfx/NOTES.md with API + integration plan. Final answer: summary, timings, screenshot paths.`,

  grid: `${BRIEF}

YOUR AREA: grid (dir ${GFX}/grid/). Replace the static background grid with a WARPING ENERGY GRID in the spirit of classic neon arena shooters (original implementation): a spring-mass mesh of points (anchored to rest positions with springs to neighbours) covering the visible world area around the camera (re-anchoring/tiling as the camera moves so it is infinite), reacting to forces:
- explosions/kills/rings: radial outward impulse scaled by size; boss death: huge shock; bomb: screen-wide;
- gravity mines (Singularity) and the Void Heart: continuous inward pull (implosion swirl);
- player dash: a wake/push along the dash path; heavy enemies (brutes, bosses) leave a subtle dent while moving;
- the music beat already pulses grid brightness (renderer.beat 0..1) - keep that.
Render it with glowing additive lines whose brightness/colour respond to local displacement (stretched areas glow hotter), tinted by a per-sector colour (the galaxy work defines 4 sectors: teal, crimson, violet, gold/obsidian). Keep it subtle enough not to hurt readability.
Performance: fixed-step integration (can run at 30-60 Hz), budget <= 1 ms JS per frame at 1080p for ~1500-2500 points; batch all lines into a few paths; no allocations per frame.
API proposal: class WarpGrid { resize(viewW, viewH); impulse(x, y, radius, strength); implode(x, y, radius, strength, dt); wake(x0, y0, x1, y1, strength); update(dt, camX, camY); draw(ctx, camX, camY, k, w, h, color, beat) } with world-space coordinates.
Deliver: grid.ts, a harness (standalone and over real captured game frames), screenshot sequences showing a kill explosion ripple, a boss-death shock, a black-hole implosion, and a dash wake, plus timings; ${GFX}/grid/NOTES.md with API + exact integration points in renderer.ts (which events map to which forces). Final answer: summary, timings, screenshot paths.`,

  entities: `${BRIEF}

YOUR AREA: entities (dir ${GFX}/entities/). Make every moving thing more spectacular and apply the starship theme:
0. VESSEL DESIGNS (most important): design the 5 player starships (spark, vanguard, tempest, bastion, phantom) as distinct, original silhouettes with hull, bridge, engine pods/thrusters, blinking running lights and engine glow, drawn procedurally with canvas paths and pre-rendered to sprites. They are SMALL on screen (collision radius 11 world units; drawn ~13-18 units, roughly 30-45 px), so silhouettes must read instantly at that size and face +x (rotated toward movement). Each ship keeps its existing colour from src/game/content/ships.ts. Then design the alien crystalline armada: 6 enemy vessel types + 3 boss capital ships (collision radii in src/game/content/enemies.ts must still match their visual size), faceted crystal hulls with glowing cores, in their existing colours. Render a gallery at 1x and 3x zoom.
1. SHATTER DEATHS: when an enemy dies it breaks into its polygon fragments (triangulate its shape outline into 4-10 shards that inherit velocity + knockback direction, spin, glow and fade, with a brief white-hot core flash and a thin shockwave ring). Elites and bosses shatter bigger, in layers. Implement as a pooled ShardFx system (SoA like particles.ts) driven by the existing kill event fields (x, y, color, r, elite, boss) - propose any extra event fields needed (e.g. shape, angle, velocity).
2. ANIMATED ENEMY DESIGNS: richer sprites with animated sub-parts while staying cheap: e.g. drifters with a pulsing inner eye, splitters with an orbiting inner ring, shooters whose inner hex counter-rotates and glows before firing, brutes with armour plates, dashers that stretch while charging; hit-flash and a brief squash on hit. Use pre-rendered layers (body + core) combined at draw time rather than per-frame shadowBlur.
3. PLAYER STARSHIP: engine thrust flame from its engine pods (length by speed), banking/tilt when turning, a dash afterimage that reads as speed, a shield bubble shimmer.
4. BOSS CAPITAL SHIPS: multi-part animated alien vessels: the Warden gate fortress with rotating crystal armour rings and a charging core before bursts; the Hydra hunter-cruiser with segmented crystal necks/arms that trail; the Void Heart hive mothership with pulsing tendrils, docking spires and an inward-sucking particle halo. Telegraphs that read clearly.
5. PROJECTILES/EXPLOSIONS: bolt and missile trails (ribbons), layered explosions (flash + ring + sparks + embers), lightning arcs with branching.
Measure: JS ms per frame in a heavy scene (400 enemies, 60 deaths/s) - budget <= 3 ms extra at 1080p. Deliver: entityfx.ts (and any sprite-generation helpers), a harness that renders a gallery of every enemy/boss/player state at 2x zoom plus a heavy-combat scene using real game frames, screenshot paths, timings, and ${GFX}/entities/NOTES.md with exact integration points (renderer.ts draw order, sprites.ts changes, new event fields in src/game/types.ts/world.ts). Final answer: summary, timings, screenshot paths.`,
}

phase('Prototype')
const areas = ['postfx', 'grid', 'entities']
const protos = await parallel(areas.map((a) => () => agent(PROMPTS[a], { label: `proto:${a}`, phase: 'Prototype', effort: 'high' })))

phase('Critique')
const critique = await agent(`${BRIEF}

You are the art director. Three prototypes were built to push SHARDSTORM's graphics. Their reports:
${areas.map((a, i) => `=== ${a} ===\n${protos[i] ?? '(failed)'}`).join('\n\n')}

Open EVERY screenshot under ${GFX}/ (postfx, grid, entities) with the Read tool, and also look at the galaxy backdrop shots under ${PLAN}/galaxy/shots/ if they exist (another team owns those; only comment on how the pieces compose). Read each NOTES.md and skim the code.
Judge: spectacle, the new starship-vs-crystal-armada theme (do our vessels read as starships at 30-45 px? do aliens read as crystalline and menacing? any franchise lookalikes to remove?), cohesion as ONE art style (neon vector + bloom + galaxies + warping grid), readability in heavy combat (can you still see bullets, enemies, shards and your ship?), visual noise budget (what should be toned down so the effects layer instead of competing), accessibility (reduced flashing), and performance against a 60 fps budget on a mid laptop (total new cost target <= 5 ms/frame at 1080p).
Return, PER AREA (postfx, grid, entities), a prioritized list of concrete fixes (max 10 each), plus a short global section: how the layers should compose (draw order, bloom thresholds, which elements get bloom vs stay crisp, grid intensity relative to galaxy brightness) and any element to cut.`, { label: 'art-director', phase: 'Critique', effort: 'high' })

phase('Revise')
const revised = await parallel(areas.map((a, i) => () => agent(`${BRIEF}

YOUR AREA: ${a} (dir ${GFX}/${a}/). You (or a teammate) built this prototype; its report was:
${protos[i] ?? '(the first attempt failed - build it from scratch per the original brief below)'}

ORIGINAL BRIEF:
${PROMPTS[a]}

The art director's critique (apply the section for your area and the global section; push back with a reason on anything you reject):
${critique}

Apply the fixes, re-render ALL screenshots, look at them, iterate until excellent. Re-measure timings. Make sure the repo-bound TypeScript compiles under the strict flags in the brief. Update ${GFX}/${a}/NOTES.md as the definitive integration guide (API, exact renderer.ts/sprites.ts/types.ts/world.ts integration points, settings toggles, perf numbers, fallback behaviour).
Final answer: what changed, final timings, final screenshot paths.`, { label: `revise:${a}`, phase: 'Revise', effort: 'high' })))

return { protos, critique, revised }
