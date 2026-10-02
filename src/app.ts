import { AudioEngine } from './audio/audio';
import { Input } from './core/input';
import { clamp } from './core/math';
import { Rng, randomSeed } from './core/rng';
import { botInput, botResolvePending } from './game/bot';
import { makeRunConfig } from './game/runconfig';
import { applyOffer, generateOffers, offerRarity, type Offer } from './game/upgrades';
import { World } from './game/world';
import { checkAchievements } from './meta/achievements';
import { dailyInfo } from './meta/daily';
import { missionReward, missionText, missionsSatisfiedLive, refillMissions } from './meta/missions';
import { applyRun, buyUpgrade, isShipUnlocked } from './meta/progression';
import { HARD_MODE_RANK, TRAILS } from './meta/rank';
import { resultFromWorld } from './meta/result';
import { clearSave, defaultSave, loadSave, writeSave, type SaveData, type Settings } from './meta/save';
import { Renderer } from './render/renderer';
import { UI } from './ui/ui';

export const DT = 1 / 60;
const MAX_STEPS = 5;

type State = 'title' | 'playing' | 'levelup' | 'paused' | 'victory' | 'dying' | 'results';

export class App {
  private readonly renderer: Renderer;
  private readonly audio = new AudioEngine();
  private readonly input = new Input();
  private readonly ui: UI;
  private save: SaveData;
  private state: State = 'title';
  private world: World | null = null;
  private attract: World;
  private attractRng = new Rng(randomSeed());
  private metaRng = new Rng(randomSeed());
  private last = 0;
  private acc = 0;
  private dyingT = 0;
  private offers: Offer[] = [];
  private offerIsCache = false;
  private victoryShown = false;
  private announced = new Set<string>();
  private missionCheckT = 0;
  private tutorialT = -1;
  private tutorialStage = 0;
  private sessionPlay = 0;
  private nextBreak = 3600;
  private fps = 60;
  private dailyRun = false;
  private dailyDate = '';
  /** Debug/testing: `?autoplay` lets the bot play; `?warp=N` fast-forwards N seconds of a run. */
  private readonly debug = readDebugParams();
  private botRng = new Rng(1234);
  private autoPickT = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.save = loadSave();
    if (this.save.missions.length < 3) refillMissions(this.save, this.metaRng);
    if (!isShipUnlocked(this.save, this.save.ship)) this.save.ship = 'spark';
    this.applySettings(this.save.settings);

    this.input.attach(canvas);
    this.input.dashButtonHit = (x, y) => {
      const b = this.renderer.hud.dashButton;
      return this.renderer.hud.touch && Math.hypot(x - b.x, y - b.y) <= b.r * 1.25;
    };
    this.input.onPadNav = (nav) => this.ui.padNav(nav);

    this.ui = new UI(uiRoot, {
      play: (daily) => this.startRun(daily),
      pick: (i) => this.pick(i),
      reroll: () => this.reroll(),
      resume: () => this.resume(),
      quitRun: () => this.endRun(),
      continueOvertime: () => this.resume(),
      cashOut: () => this.endRun(),
      buy: (id) => this.buy(id),
      selectShip: (id) => {
        this.save.ship = id;
        writeSave(this.save);
      },
      settingsChanged: (s) => {
        this.save.settings = s;
        this.applySettings(s);
        writeSave(this.save);
      },
      resetSave: () => {
        clearSave();
        this.save = defaultSave();
        refillMissions(this.save, this.metaRng);
        writeSave(this.save);
        this.applySettings(this.save.settings);
        this.toTitle();
      },
      toTitle: () => this.toTitle(),
      pause: () => this.pause(),
      sfx: {
        hover: () => this.audio.uiHover(),
        click: () => this.audio.uiClick(),
        buy: () => this.audio.uiBuy(),
        deny: () => this.audio.uiDeny(),
        tick: (p) => this.audio.tick(p),
        countUp: (p) => this.audio.countUp(p),
        fanfare: () => this.audio.fanfare(),
        rankUp: () => this.audio.rankUp(),
        reveal: (r) => this.audio.reveal(r),
      },
    });

    this.attract = this.newAttractWorld();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => this.onResize());

    // Audio can only start after a user gesture.
    const unlock = () => {
      const fresh = !this.audio.ctx;
      this.audio.unlock();
      this.applySettings(this.save.settings);
      if (fresh) this.audio.music?.start(this.state === 'playing' ? 'game' : 'menu');
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pause();
    });

    this.ui.showTitle(this.save, dailyInfo(), this.isTouch());
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.last = t;
      requestAnimationFrame(this.frame);
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private isTouch(): boolean {
    return this.input.isTouch() || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  }

  private onResize(): void {
    const { halfW, halfH } = this.renderer.resize();
    for (const w of [this.world, this.attract]) {
      if (!w) continue;
      w.viewHalfW = halfW;
      w.viewHalfH = halfH;
    }
    this.input.stickRadius = 56 * this.renderer.ui;
  }

  private applySettings(s: Settings): void {
    this.audio.setVolumes(s.master, s.music, s.sfx);
    this.renderer.settings = {
      shake: s.shake,
      flashes: s.flashes,
      damageNumbers: s.damageNumbers,
      showFps: s.showFps,
      trail: TRAILS[s.trail]?.color ?? TRAILS.default.color,
    };
    this.renderer.particles.density = s.flashes ? 1 : 0.6;
  }

  private newAttractWorld(): World {
    const w = new World(makeRunConfig({ seed: randomSeed(), rank: 6, workshop: { might: 3, hull: 3 } }));
    const { halfW, halfH } = { halfW: this.renderer.cssW / 2 / this.renderer.scale, halfH: this.renderer.cssH / 2 / this.renderer.scale };
    w.viewHalfW = halfW;
    w.viewHalfH = halfH;
    this.renderer.reset(w);
    return w;
  }

  // ───────────────────────── run lifecycle ─────────────────────────

  private startRun(daily: boolean): void {
    this.audio.unlock();
    const info = dailyInfo();
    const hard = this.save.settings.hardMode && this.save.rank >= HARD_MODE_RANK;
    const cfg = makeRunConfig({
      seed: daily ? info.seed : randomSeed(),
      ship: this.save.ship,
      workshop: this.save.workshop,
      rank: this.save.rank,
      daily: daily ? info.modifier.id : null,
      hardMode: hard,
    });
    this.dailyRun = daily;
    this.dailyDate = info.date;
    const best = daily ? this.save.daily.best[info.date] ?? 0 : this.save.stats.bestScore;
    this.world = new World(cfg, { bestScore: best });
    this.renderer.hud.bestScore = best;
    this.onResize();
    this.renderer.reset(this.world);
    this.acc = 0;
    this.victoryShown = false;
    this.announced.clear();
    this.missionCheckT = 0;
    this.state = 'playing';
    this.input.releaseAll();
    this.input.gameActive = true;
    this.ui.showHud();
    this.audio.music?.start('game');
    this.audio.music?.setIntensity(0);
    if (!this.save.tutorialDone) {
      this.tutorialStage = 1;
      this.tutorialT = 0;
      this.ui.tutorial(this.isTouch() ? 'DRAG ANYWHERE TO MOVE' : 'WASD OR ARROWS TO MOVE', 'Your weapons fire on their own');
    } else {
      this.tutorialStage = 0;
      this.ui.tutorial(null);
    }
    if (daily) this.ui.toast(`Daily Run: ${info.modifier.name}, ${info.modifier.text}`, '☀', true);
    if (this.debug.warp > 0) {
      const w = this.world;
      while (w.time < this.debug.warp && !w.gameOver) {
        w.update(DT, botInput(w, this.botRng, { skill: 1 }));
        botResolvePending(w, this.botRng, (o) => applyOffer(w, o));
        w.events.length = 0;
      }
      w.hitstop = 0;
      w.slowmoT = 0;
      this.renderer.reset(w);
    }
  }

  private pause(): void {
    if (this.state !== 'playing' || !this.world) return;
    this.state = 'paused';
    this.input.gameActive = false;
    this.input.releaseAll();
    this.ui.showPause(this.world, this.save);
  }

  private resume(): void {
    if (!this.world) return;
    if (this.state === 'paused' || this.state === 'victory' || this.state === 'levelup') {
      this.state = 'playing';
      this.input.releaseAll();
      this.input.gameActive = true;
      this.ui.showHud();
      this.last = performance.now();
    }
  }

  private openLevelUp(): void {
    const w = this.world;
    if (!w) return;
    const cache = w.pendingCaches > 0;
    if (cache) w.pendingCaches--;
    else w.pendingLevelUps--;
    this.offerIsCache = cache;
    this.offers = generateOffers(w, 3, cache);
    this.state = 'levelup';
    this.input.gameActive = false;
    this.input.releaseAll();
    this.ui.showLevelUp(this.offers, { cache, rerolls: w.rerolls, level: w.level, world: w });
  }

  private pick(i: number): void {
    const w = this.world;
    if (this.state !== 'levelup' || !w) return;
    const offer = this.offers[i];
    if (!offer) return;
    applyOffer(w, offer);
    this.audio.pick(offerRarity(offer));
    if (offer.kind === 'evolve') this.renderer.callouts.add('EVOLVED', '#ffc93c', 1, offer.id.toUpperCase(), 1.4);
    if (this.tutorialStage > 0 && this.tutorialStage < 3) {
      this.tutorialStage = 3;
      this.ui.tutorial(null);
    }
    if (w.pendingLevelUps > 0 || w.pendingCaches > 0) this.openLevelUp();
    else this.resume();
  }

  private reroll(): void {
    const w = this.world;
    if (this.state !== 'levelup' || !w) return;
    if (w.rerolls <= 0) {
      this.audio.uiDeny();
      return;
    }
    w.rerolls--;
    this.offers = generateOffers(w, 3, this.offerIsCache);
    this.audio.uiClick();
    this.ui.showLevelUp(this.offers, { cache: this.offerIsCache, rerolls: w.rerolls, level: w.level, world: w, reroll: true });
  }

  private endRun(): void {
    const w = this.world;
    if (!w) return;
    const result = resultFromWorld(w);
    result.daily = this.dailyRun;
    if (this.dailyRun) result.dailyDate = this.dailyDate;
    const summary = applyRun(this.save, result, this.metaRng);
    writeSave(this.save);
    this.state = 'results';
    this.input.gameActive = false;
    this.input.releaseAll();
    this.ui.tutorial(null);
    this.audio.music?.start('menu');
    this.attract = this.newAttractWorld();
    this.ui.showResults(summary, this.save, this.isTouch());
    if (this.save.settings.breakReminder && this.sessionPlay >= this.nextBreak) {
      this.nextBreak = this.sessionPlay + 3600;
      this.ui.toast("You've played for over an hour. A short stretch keeps your reflexes sharp.", '☕');
    }
  }

  private toTitle(): void {
    this.state = 'title';
    this.world = null;
    this.input.gameActive = false;
    this.ui.tutorial(null);
    this.audio.music?.start('menu');
    this.ui.showTitle(this.save, dailyInfo(), this.isTouch());
  }

  private buy(id: string): boolean {
    const ok = buyUpgrade(this.save, id);
    if (ok) {
      const unlocked = checkAchievements(this.save, null);
      for (const a of unlocked) this.ui.toast(`Achievement: ${a.name}`, '★', true);
      writeSave(this.save);
    }
    return ok;
  }

  // ───────────────────────── frame loop ─────────────────────────

  private frame = (now: number): void => {
    const realDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (realDt > 0) this.fps += (1 / realDt - this.fps) * 0.05;
    this.input.pollGamepad();
    this.renderer.hud.touch = this.isTouch();
    this.renderer.hud.fps = this.fps;
    this.renderer.beat = this.audio.music?.beatPulse() ?? 0;

    try {
      if (this.state === 'title' || this.state === 'results') {
        this.input.consumePause();
        this.stepAttract(realDt);
      } else if (this.world) {
        this.stepGame(realDt);
      }
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(this.frame);
  };

  private stepAttract(realDt: number): void {
    const w = this.attract;
    this.acc += realDt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS) {
      w.update(DT, botInput(w, this.attractRng, { skill: 0.75 }));
      botResolvePending(w, this.attractRng, (o) => applyOffer(w, o));
      this.acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.renderer.consume(w.events, w);
    w.events.length = 0;
    w.hitstop = 0;
    w.slowmoT = 0;
    this.renderer.draw(w, steps * DT, { attract: true, realDt });
    if (w.gameOver || w.time > 150) this.attract = this.newAttractWorld();
  }

  private stepGame(realDt: number): void {
    const w = this.world!;
    let simDt = 0;

    if (this.state === 'playing') {
      this.sessionPlay += realDt;
      if (this.input.consumePause()) {
        this.pause();
      } else if (w.hitstop > 0) {
        w.hitstop -= realDt;
      } else {
        let scale = 1;
        if (w.slowmoT > 0) {
          scale = w.slowmoScale;
          w.slowmoT -= realDt;
          if (w.slowmoT <= 0) w.slowmoScale = 1;
        }
        this.acc += realDt * scale;
        let steps = 0;
        const p = w.player;
        const k = this.renderer.scale * this.renderer.dpr;
        const psx = (p.x - this.renderer.camX) * k + this.renderer.w / 2;
        const psy = (p.y - this.renderer.camY) * k + this.renderer.h / 2;
        while (this.acc >= DT && steps < MAX_STEPS) {
          const input = this.debug.autoplay ? botInput(w, this.botRng, { skill: 0.9 }) : this.input.read(psx, psy);
          if (input.dash && this.tutorialStage === 2) {
            this.tutorialStage = 3;
            this.ui.tutorial(null);
          }
          if (this.tutorialStage === 1 && (input.mx !== 0 || input.my !== 0) && this.tutorialT > 1.5) this.advanceTutorial();
          w.update(DT, input);
          this.acc -= DT;
          simDt += DT;
          steps++;
          if (w.gameOver || w.pendingLevelUps > 0 || w.pendingCaches > 0) break;
        }
        if (steps === MAX_STEPS) this.acc = 0;
      }
      this.updateTutorial(realDt);
      this.liveMissions(realDt);
    } else if (this.state === 'paused' && this.input.consumePause()) {
      this.resume();
    } else if (this.state === 'dying') {
      this.dyingT -= realDt;
      simDt = realDt * 0.3;
      if (this.dyingT <= 0) {
        this.endRun();
        return;
      }
    }

    // Feedback.
    this.renderer.consume(w.events, w);
    this.audio.consume(w.events);
    w.events.length = 0;
    const intensity = clamp(w.enemies.length / 220 + w.combo / 250 + (w.boss ? 0.3 : 0), 0, 1);
    this.renderer.intensity = intensity;
    this.audio.music?.setIntensity(intensity);
    this.audio.music?.setBoss(!!w.boss);

    this.renderer.draw(w, simDt, { attract: false, realDt });

    if (this.debug.autoplay && this.state === 'levelup') {
      this.autoPickT += realDt;
      if (this.autoPickT > 0.6) {
        this.autoPickT = 0;
        this.pick(0);
      }
    }
    if (this.debug.autoplay && this.state === 'victory') this.resume();
    if (this.state !== 'playing') return;
    if (w.gameOver) {
      this.state = 'dying';
      this.dyingT = 1.3;
      this.input.gameActive = false;
      this.ui.tutorial(null);
      return;
    }
    if (w.victory && !this.victoryShown) {
      this.victoryShown = true;
      this.state = 'victory';
      this.input.gameActive = false;
      this.input.releaseAll();
      this.ui.showVictory(w);
      return;
    }
    if (w.pendingLevelUps > 0 || w.pendingCaches > 0) this.openLevelUp();
  }

  private advanceTutorial(): void {
    this.tutorialStage = 2;
    this.tutorialT = 0;
    this.ui.tutorial(this.isTouch() ? 'TAP DASH TO DASH' : 'PRESS SPACE TO DASH', 'You are invulnerable mid-dash. Dash through enemies to damage them.');
  }

  private updateTutorial(realDt: number): void {
    if (this.tutorialStage === 0 || this.tutorialStage >= 3) return;
    this.tutorialT += realDt;
    if (this.tutorialStage === 1 && this.tutorialT > 4) this.advanceTutorial();
    else if (this.tutorialStage === 2 && this.tutorialT > 9) {
      this.tutorialStage = 3;
      this.ui.tutorial(null);
    }
  }

  private liveMissions(realDt: number): void {
    const w = this.world;
    if (!w) return;
    this.missionCheckT -= realDt;
    if (this.missionCheckT > 0) return;
    this.missionCheckT = 0.5;
    const r = resultFromWorld(w);
    r.daily = this.dailyRun;
    for (const m of missionsSatisfiedLive(this.save, r)) {
      const key = `${m.def}:${m.tier}`;
      if (this.announced.has(key)) continue;
      this.announced.add(key);
      this.ui.toast(`Mission complete: ${missionText(m)}  +${missionReward(m.tier)} ◈`, '✓', true);
      this.audio.uiBuy();
    }
  }
}

function readDebugParams(): { autoplay: boolean; warp: number } {
  try {
    const q = new URLSearchParams(window.location.search);
    return { autoplay: q.has('autoplay'), warp: Math.max(0, Number(q.get('warp') ?? 0) || 0) };
  } catch {
    return { autoplay: false, warp: 0 };
  }
}
