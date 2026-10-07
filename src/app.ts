import { AudioEngine } from './audio/audio';
import { INPUT_SLOTS, isPadSlot, padIndex, type InputSlot, type MenuAction } from './core/bindings';
import { Input } from './core/input';
import { clamp } from './core/math';
import { Rng, randomSeed } from './core/rng';
import { botInput, botPick, botResolvePending } from './game/bot';
import { MAX_PLAYERS } from './game/content/coop';
import { makeRunConfig } from './game/runconfig';
import type { ControlInput, GameEvent, Player } from './game/types';
import { applyOffer, generateOffers, offerRarity, type Offer } from './game/upgrades';
import { World, type PickRequest } from './game/world';
import { checkAchievements } from './meta/achievements';
import { dailyInfo } from './meta/daily';
import { missionReward, missionText, missionsSatisfiedLive, refillMissions } from './meta/missions';
import { applyRun, buyUpgrade, coopBest, isShipUnlocked, unlockedShips } from './meta/progression';
import { HARD_MODE_RANK, TRAILS } from './meta/rank';
import { resultFromWorld } from './meta/result';
import { clearSave, defaultSave, loadSave, writeSave, type SaveData, type Settings } from './meta/save';
import { detectBridge } from './platform/platform';
import { Renderer } from './render/renderer';
import { CoopLobby, type RosterDevice, type RosterEntry } from './ui/lobby';
import { UI, pilotLabel, type LobbyMouseAction } from './ui/ui';

export const DT = 1 / 60;
const MAX_STEPS = 5;
/** Seconds a bot pilot "thinks" on a co-op level-up before picking. */
const BOT_PICK_DELAY = 0.6;

type State = 'title' | 'lobby' | 'playing' | 'levelup' | 'paused' | 'victory' | 'dying' | 'results';

/** Optional zoom-aware projection (the co-op renderer adds it in wave 3). */
interface Projecting {
  worldToScreen?: (x: number, y: number) => [number, number];
}

const isRosterDevice = (d: string): d is RosterDevice => d === 'bot' || (INPUT_SLOTS as readonly string[]).includes(d);

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
  /** The pick on screen (whose, and whether it is a cache). */
  private currentPick: PickRequest | null = null;
  /** Live co-op run: devices and ships in pid order (null = solo). */
  private coop: { roster: RosterEntry[] } | null = null;
  /** Co-op lobby while state === 'lobby'. */
  private lobby: CoopLobby | null = null;
  /** Roster of the last co-op run (results "Play again"). */
  private lastCoopRoster: RosterEntry[] | null = null;
  /** Per-pilot bot streams (bot pilots, autoplay, warp). */
  private botRngs: Rng[] = [];
  private botPickT = 0;
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
  /**
   * Debug/testing: `?autoplay` lets the bot play; `?warp=N` fast-forwards N seconds of a run;
   * `?coop=N` starts an N-pilot run at once (kbA, kbB, then bots); `?bots` adds "Add bot" to the lobby.
   */
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
    this.input.onMenu = (slot, action) => this.onMenu(slot, action);
    this.input.onSlotLost = (slot) => this.onSlotLost(slot);
    this.input.onPadsChanged = () => this.onPadsChanged();
    // Desktop (Electron) build: RightCtrl can be a kbB dash key (in a browser RightCtrl+W closes the tab).
    this.input.allowCtrlDash = detectBridge() !== null;

    this.ui = new UI(uiRoot, {
      play: (daily) => this.startRun(daily),
      again: () => this.again(),
      openCoop: () => this.openCoop(),
      lobbyMouse: (slot, action) => this.lobbyMouse(slot, action),
      addBot: () => {
        if (this.lobby?.join('bot')) this.renderLobby();
      },
      pick: (i, slot) => this.pick(i, slot),
      reroll: (slot) => this.reroll(slot),
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

    this.ui.showTitle(this.save, dailyInfo(), this.isTouch(), this.coopAvailable());
    if (this.debug.coop >= 2) this.startDebugCoop(this.debug.coop);
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

  /** Co-op needs keyboards or gamepads: hidden on touch-only devices unless a pad is connected. */
  private coopAvailable(): boolean {
    return !this.isTouch() || this.input.anyGamepad();
  }

  /** A pilot's on-screen position in device px (mouse steering). */
  private screenPos(p: Player): [number, number] {
    const r = this.renderer as Renderer & Projecting;
    if (typeof r.worldToScreen === 'function') return r.worldToScreen(p.x, p.y);
    // Fallback for a renderer without zoom support (the solo camera): zoom 1.
    const k = r.scale * r.dpr;
    return [(p.x - r.camX) * k + r.w / 2, (p.y - r.camY) * k + r.h / 2];
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
    // Attract mode stays solo until the co-op renderer can show every pilot.
    const w = new World(makeRunConfig({ seed: randomSeed(), rank: 6, workshop: { might: 3, hull: 3 } }));
    const { halfW, halfH } = { halfW: this.renderer.cssW / 2 / this.renderer.scale, halfH: this.renderer.cssH / 2 / this.renderer.scale };
    w.viewHalfW = halfW;
    w.viewHalfH = halfH;
    this.renderer.reset(w);
    return w;
  }

  // ───────────────────────── run lifecycle ─────────────────────────

  /**
   * Starts a run. Solo: exactly as before co-op. Co-op (`roster` with 2+
   * pilots): one ship per roster entry, every device reads only its own pilot,
   * no Daily (solo-only) and no tutorial.
   */
  private startRun(daily: boolean, roster?: RosterEntry[]): void {
    this.audio.unlock();
    const info = dailyInfo();
    const hard = this.save.settings.hardMode && this.save.rank >= HARD_MODE_RANK;
    const squad = roster && roster.length > 1 ? roster.slice(0, MAX_PLAYERS) : null;
    if (squad) daily = false;
    const cfg = makeRunConfig({
      seed: daily ? info.seed : randomSeed(),
      ship: squad ? squad[0]!.ship : this.save.ship,
      players: squad ? squad.map((r) => ({ ship: r.ship })) : undefined,
      workshop: this.save.workshop,
      rank: this.save.rank,
      daily: daily ? info.modifier.id : null,
      hardMode: hard,
    });
    this.dailyRun = daily;
    this.dailyDate = info.date;
    this.coop = squad ? { roster: squad } : null;
    this.lobby = null;
    this.currentPick = null;
    this.botRngs = cfg.players.map(() => new Rng(randomSeed()));
    const best = squad ? coopBest(this.save, squad.length) : daily ? this.save.daily.best[info.date] ?? 0 : this.save.stats.bestScore;
    this.world = new World(cfg, { bestScore: best });
    this.renderer.hud.bestScore = best;
    this.onResize();
    this.renderer.reset(this.world);
    this.acc = 0;
    this.victoryShown = false;
    this.announced.clear();
    this.missionCheckT = 0;
    this.state = 'playing';
    this.input.setMode(squad ? 'coop' : 'solo', squad ? squad.map((r) => r.device).filter((d): d is InputSlot => d !== 'bot') : []);
    this.input.menuMode = 'none';
    this.input.releaseAll();
    this.input.gameActive = true;
    this.ui.showHud();
    this.audio.music?.start('game');
    this.audio.music?.setIntensity(0);
    if (squad) {
      this.tutorialStage = 0;
      this.ui.tutorial(null);
      this.ui.toast(`Squad of ${squad.length} launched. Stick together: fly over a downed captain to revive them.`, '✦');
    } else if (!this.save.tutorialDone) {
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
        if (w.coop) w.update(DT, w.players.map((_, i) => botInput(w, this.botRngs[i]!, { skill: 1 }, i)));
        else w.update(DT, botInput(w, this.botRng, { skill: 1 }, 0));
        botResolvePending(w, this.botRng, (o, pid) => applyOffer(w, o, pid));
        w.events.length = 0;
      }
      w.hitstop = 0;
      w.slowmoT = 0;
      this.renderer.reset(w);
    }
  }

  private pause(note = ''): void {
    if (this.state !== 'playing' || !this.world) return;
    this.state = 'paused';
    this.input.gameActive = false;
    this.input.releaseAll();
    this.ui.showPause(this.world, this.save, note);
  }

  private resume(): void {
    if (!this.world) return;
    if (this.state === 'paused' || this.state === 'victory' || this.state === 'levelup') {
      this.state = 'playing';
      this.currentPick = null;
      this.input.menuMode = 'none';
      this.input.releaseAll();
      this.input.gameActive = true;
      this.ui.showHud();
      this.last = performance.now();
    }
  }

  /**
   * Opens the next pick: caches first (P1→P4), then the team level round
   * (every pilot once, P1→P4). Solo: one level-up or cache, as before.
   */
  private openLevelUp(): void {
    const w = this.world;
    if (!w) return;
    const r = w.beginPick();
    if (!r) {
      this.resume();
      return;
    }
    this.currentPick = r;
    this.offers = generateOffers(w, 3, r.cache, r.pid);
    this.state = 'levelup';
    this.botPickT = 0;
    this.input.gameActive = false;
    this.input.menuMode = this.coop ? 'pick' : 'none';
    this.input.releaseAll();
    this.showPick(false);
  }

  private showPick(reroll: boolean): void {
    const w = this.world;
    const r = this.currentPick;
    if (!w || !r) return;
    const p = w.players[r.pid]!;
    const n = w.players.length;
    this.ui.showLevelUp(this.offers, {
      cache: r.cache,
      rerolls: p.rerolls,
      level: w.level,
      world: w,
      reroll,
      pilot: this.coop
        ? {
            pid: r.pid,
            device: this.coop.roster[r.pid]?.device ?? 'bot',
            ship: p.ship,
            players: n,
            ships: w.players.map((q) => q.ship),
            round: r.cache ? null : { index: n - w.levelRound.length, total: n },
            allowCtrl: this.input.allowCtrlDash,
          }
        : undefined,
    });
  }

  /** True if `slot` may act for the current picker (mouse/touch/autoplay pass no slot). */
  private isPicker(slot: InputSlot | undefined): boolean {
    if (slot === undefined || !this.coop || !this.currentPick) return true;
    return this.coop.roster[this.currentPick.pid]?.device === slot;
  }

  private pick(i: number, slot?: InputSlot): void {
    const w = this.world;
    const r = this.currentPick;
    if (this.state !== 'levelup' || !w || !r || !this.isPicker(slot)) return;
    const offer = this.offers[i];
    if (!offer) return;
    applyOffer(w, offer, r.pid);
    this.audio.pick(offerRarity(offer));
    if (offer.kind === 'evolve') this.renderer.callouts.add('EVOLVED', '#ffc93c', 1, offer.id.toUpperCase(), 1.4);
    if (this.tutorialStage > 0 && this.tutorialStage < 3) {
      this.tutorialStage = 3;
      this.ui.tutorial(null);
    }
    if (w.hasPendingPicks()) this.openLevelUp();
    else this.resume();
  }

  /** Rerolls the current pilot's offers (their own reroll count). */
  private reroll(slot?: InputSlot): void {
    const w = this.world;
    const r = this.currentPick;
    if (this.state !== 'levelup' || !w || !r || !this.isPicker(slot)) return;
    const p = w.players[r.pid]!;
    if (p.rerolls <= 0) {
      this.audio.uiDeny();
      return;
    }
    p.rerolls--;
    this.offers = generateOffers(w, 3, r.cache, r.pid);
    this.audio.uiClick();
    this.showPick(true);
  }

  private endRun(): void {
    const w = this.world;
    if (!w) return;
    const result = resultFromWorld(w);
    if (!this.coop) {
      result.daily = this.dailyRun;
      if (this.dailyRun) result.dailyDate = this.dailyDate;
    }
    const summary = applyRun(this.save, result, this.metaRng);
    writeSave(this.save);
    this.lastCoopRoster = this.coop ? this.coop.roster.map((r) => ({ ...r })) : null;
    this.coop = null;
    this.currentPick = null;
    this.state = 'results';
    this.input.setMode('solo');
    this.input.menuMode = 'none';
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
    this.coop = null;
    this.lobby = null;
    this.currentPick = null;
    this.input.setMode('solo');
    this.input.menuMode = 'none';
    this.input.gameActive = false;
    this.ui.tutorial(null);
    this.audio.music?.start('menu');
    this.ui.showTitle(this.save, dailyInfo(), this.isTouch(), this.coopAvailable());
  }

  // ───────────────────────── co-op lobby ─────────────────────────

  /** Opens the co-op lobby (optionally with devices already joined, e.g. after "Play again"). */
  private openCoop(prejoin: RosterEntry[] = []): void {
    if (this.state !== 'title' && this.state !== 'results') return;
    this.audio.unlock();
    const remembered = this.save.coop.lastRoster.filter((r): r is RosterEntry => isRosterDevice(r.device));
    const lobby = new CoopLobby(unlockedShips(this.save), this.save.ship, remembered);
    for (const r of prejoin) lobby.join(r.device, r.ship);
    this.lobby = lobby;
    this.world = null;
    this.state = 'lobby';
    this.input.setMode('solo');
    this.input.gameActive = false;
    this.input.menuMode = 'lobby';
    this.renderLobby();
  }

  private renderLobby(): void {
    if (!this.lobby) return;
    this.ui.showLobby({ lobby: this.lobby, pads: this.input.connectedPads(), allowCtrl: this.input.allowCtrlDash, bots: this.debug.bots });
  }

  private lobbyMouse(slot: number, action: LobbyMouseAction): void {
    const l = this.lobby;
    if (!l || this.state !== 'lobby') return;
    const changed =
      action === 'left' ? l.cycle(slot, -1) : action === 'right' ? l.cycle(slot, 1) : action === 'ready' ? l.toggleReady(slot) : l.leave(slot);
    if (changed) this.renderLobby();
  }

  /** Per-device menu actions (Input routes them while `menuMode` is set). */
  private onMenu(slot: InputSlot, action: MenuAction): void {
    if (this.state === 'lobby' && this.lobby) {
      const l = this.lobby;
      if (l.action(slot, action)) {
        if (action === 'confirm') this.audio.uiBuy();
        else this.audio.uiClick();
        this.renderLobby();
      } else if (action === 'back' && l.indexOf(slot) < 0 && l.joined().length === 0) {
        this.toTitle();
      }
      return;
    }
    if (this.state === 'levelup' && this.coop) this.ui.menuAction(slot, action);
  }

  /** Lobby countdown finished: remember the roster and launch. */
  private launchCoop(): void {
    const roster = this.lobby?.roster() ?? [];
    if (roster.length < 2) return;
    this.save.coop.lastRoster = roster.filter((r) => r.device !== 'bot').map((r) => ({ device: r.device, ship: r.ship }));
    writeSave(this.save);
    this.startRun(false, roster);
  }

  /** Results "Play again": the same squad if every controller is still there, else the lobby. */
  private again(): void {
    const roster = this.lastCoopRoster;
    if (!roster) {
      this.startRun(this.dailyRun);
      return;
    }
    const present = roster.filter((r) => !isPadSlot(r.device) || this.input.padConnected(padIndex(r.device)));
    if (present.length === roster.length) this.startRun(false, roster);
    else this.openCoop(present);
  }

  private onSlotLost(slot: InputSlot): void {
    const pid = this.coop?.roster.findIndex((r) => r.device === slot) ?? -1;
    if (pid < 0) return;
    const who = pilotLabel(pid);
    this.ui.toast(`${who}'s controller disconnected`, '⚠');
    if (this.state === 'playing') this.pause(`${who}'s controller disconnected. Reconnect it to keep flying; until then ${who}'s ship holds position and keeps firing.`);
  }

  private onPadsChanged(): void {
    if (this.state === 'lobby' && this.lobby) {
      // A controller that disconnects in the lobby gives up its slot.
      for (const s of this.lobby.joined()) {
        if (isPadSlot(s.device) && !this.input.padConnected(padIndex(s.device))) this.lobby.drop(s.device);
      }
      this.renderLobby();
    }
    else if (this.state === 'title' && this.ui.current === 'title') this.ui.showTitle(this.save, dailyInfo(), this.isTouch(), this.coopAvailable());
  }

  /** `?coop=N`: start an N-pilot run at once (kbA, kbB, then bots). */
  private startDebugCoop(n: number): void {
    const ships = unlockedShips(this.save);
    const devices: RosterDevice[] = ['kbA', 'kbB', 'bot', 'bot'];
    const roster = devices.slice(0, Math.min(MAX_PLAYERS, n)).map((device, i) => ({ device, ship: ships[i % ships.length]! }));
    this.startRun(false, roster);
  }

  /** Co-op feedback the renderer does not show yet: downs, revives, last stand. */
  private coopToasts(events: readonly GameEvent[]): void {
    for (const ev of events) {
      if (ev.t === 'downed') this.ui.toast(`${pilotLabel(ev.pid)} is down! Fly over them to revive.`, '✚');
      else if (ev.t === 'revived') this.ui.toast(`${pilotLabel(ev.pid)} is back in the fight (thanks, ${pilotLabel(ev.by)})`, '✦', true);
      else if (ev.t === 'laststand') this.ui.toast(`Last captain standing: ${pilotLabel(ev.pid)}`, '⚠');
    }
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
    this.renderer.hud.touch = this.isTouch() && !this.coop;
    this.renderer.hud.fps = this.fps;
    this.renderer.beat = this.audio.music?.beatPulse() ?? 0;

    try {
      if (this.state === 'title' || this.state === 'results' || this.state === 'lobby') {
        this.input.consumePause();
        this.stepAttract(realDt);
        if (this.state === 'lobby' && this.lobby) {
          if (this.lobby.update(realDt) === 'start') this.launchCoop();
          else if (this.lobby.countdown >= 0) this.ui.lobbyTick();
        }
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
      w.update(DT, botInput(w, this.attractRng, { skill: 0.75 }, 0));
      botResolvePending(w, this.attractRng, (o, pid) => applyOffer(w, o, pid));
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
        const co = this.coop;
        // Mouse steering: P1 in solo; in co-op the kbA pilot (the mouse belongs to kbA).
        const mousePid = co ? co.roster.findIndex((r) => r.device === 'kbA') : 0;
        const [psx, psy] = mousePid >= 0 ? this.screenPos(w.players[mousePid]!) : [0, 0];
        while (this.acc >= DT && steps < MAX_STEPS) {
          if (co) {
            w.update(DT, this.coopInputs(w, co.roster, mousePid, psx, psy));
          } else {
            const input = this.debug.autoplay ? botInput(w, this.botRng, { skill: 0.9 }, 0) : this.input.read(psx, psy);
            if (input.dash && this.tutorialStage === 2) {
              this.tutorialStage = 3;
              this.ui.tutorial(null);
            }
            if (this.tutorialStage === 1 && (input.mx !== 0 || input.my !== 0) && this.tutorialT > 1.5) this.advanceTutorial();
            w.update(DT, input);
          }
          this.acc -= DT;
          simDt += DT;
          steps++;
          if (w.gameOver || w.hasPendingPicks()) break;
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
    if (this.coop) this.coopToasts(w.events);
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
    } else if (this.state === 'levelup' && this.coop && this.currentPick && this.coop.roster[this.currentPick.pid]?.device === 'bot') {
      // Bot pilots pick for themselves after a short beat, so humans can see what they took.
      this.botPickT += realDt;
      if (this.botPickT > BOT_PICK_DELAY) {
        this.botPickT = 0;
        const pid = this.currentPick.pid;
        const choice = botPick(w, this.offers, this.botRngs[pid] ?? this.botRng, pid);
        this.pick(Math.max(0, this.offers.indexOf(choice)));
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
    if (w.hasPendingPicks()) this.openLevelUp();
  }

  /** One tick of co-op input, in pid order: each device drives only its own pilot. */
  private coopInputs(w: World, roster: readonly RosterEntry[], mousePid: number, psx: number, psy: number): ControlInput[] {
    return w.players.map((_, i) => {
      const d = roster[i]?.device ?? 'bot';
      if (this.debug.autoplay || d === 'bot') return botInput(w, this.botRngs[i] ?? this.botRng, { skill: 0.9 }, i);
      return i === mousePid ? this.input.readSlot(d, psx, psy) : this.input.readSlot(d, 0, 0);
    });
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
    if (!this.coop) r.daily = this.dailyRun;
    for (const m of missionsSatisfiedLive(this.save, r)) {
      const key = `${m.def}:${m.tier}`;
      if (this.announced.has(key)) continue;
      this.announced.add(key);
      this.ui.toast(`Mission complete: ${missionText(m)}  +${missionReward(m.tier)} ◈`, '✓', true);
      this.audio.uiBuy();
    }
  }
}

function readDebugParams(): { autoplay: boolean; warp: number; coop: number; bots: boolean } {
  try {
    const q = new URLSearchParams(window.location.search);
    return {
      autoplay: q.has('autoplay'),
      warp: Math.max(0, Number(q.get('warp') ?? 0) || 0),
      coop: Math.min(MAX_PLAYERS, Math.max(0, Math.floor(Number(q.get('coop') ?? 0) || 0))),
      bots: q.has('bots'),
    };
  } catch {
    return { autoplay: false, warp: 0, coop: 0, bots: false };
  }
}
