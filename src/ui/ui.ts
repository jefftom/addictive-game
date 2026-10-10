import { deviceLabels, type InputSlot, type MenuAction } from '../core/bindings';
import { formatNumber, formatTime } from '../core/math';
import { PLAYER_COLORS, PLAYER_MARKS } from '../game/content/coop';
import { ENEMIES } from '../game/content/enemies';
import { PASSIVES, RARITY_COLOR, RELICS } from '../game/content/passives';
import { SHIPS, SHIP_IDS } from '../game/content/ships';
import { WEAPONS } from '../game/content/weapons';
import { WORKSHOP } from '../game/content/workshop';
import type { PassiveId, ShipId } from '../game/types';
import { offerColor, offerIcon, offerRarity, offerText, offerTitle, type Offer } from '../game/upgrades';
import type { World } from '../game/world';
import { ACHIEVEMENTS, achievementDef } from '../meta/achievements';
import { currentStreak, dailyBonus, playedDailyToday, type DailyInfo } from '../meta/daily';
import { missionDef, missionReward, missionText } from '../meta/missions';
import { affordableUpgrades, coopBest, isShipUnlocked, nextCost, nextWorkshopGoal, workshopLevel, type RunSummary } from '../meta/progression';
import { HARD_MODE_RANK, TRAILS, rankXpNeeded } from '../meta/rank';
import type { ChatterMode, SaveData, Settings, TrailId } from '../meta/save';
import { SpriteCache } from '../render/sprites';
import { characterById, type ResolvedLine } from '../story/director';
import { logbookFraction, logbookHint, logbookView, markLogSeen, unseenLogCount } from '../story/logbook';
import { STORY, type CharacterDef, type LogbookEntry } from '../story/script';
import { castRole, signatureLine } from './cast';
import { OpeningCrawl } from './crawl';
import { $, el, esc, focusables, moveFocus, pips } from './dom';
import { LOBBY_COUNTDOWN, MIN_COOP_PILOTS, type CoopLobby, type RosterDevice } from './lobby';

export type ScreenId = 'title' | 'hangar' | 'workshop' | 'records' | 'settings' | 'log' | 'crawl' | 'lobby' | 'levelup' | 'pause' | 'victory' | 'results' | 'hud';

/** Mouse/touch actions on a lobby slot card. */
export type LobbyMouseAction = 'left' | 'right' | 'ready' | 'leave';

/** What the lobby screen shows besides the lobby model itself. */
export interface LobbyView {
  lobby: CoopLobby;
  /** Connected gamepad indices. */
  pads: number[];
  /** Desktop build: RightCtrl is a kbB dash key. */
  allowCtrl: boolean;
  /** `?bots`: show "Add bot". */
  bots: boolean;
}

/** Co-op extras for the level-up screen: whose pick it is and how they control it. */
export interface CoopPickInfo {
  pid: number;
  device: RosterDevice;
  /** The picker's controller is unplugged: any other captain may pick for them. */
  lost: boolean;
  /** Devices allowed to steer and pick (the picker's own, or every connected captain's when `lost`). */
  allowed: readonly InputSlot[];
  ship: ShipId;
  /** Pilots in the run. */
  players: number;
  /** Ships by pid (for the round chips). */
  ships: ShipId[];
  /** Level round progress; null for a cache pick. */
  round: { index: number; total: number } | null;
  allowCtrl: boolean;
}

/** Co-op results awards and what earns them (the legend under the Squadron report). */
const AWARDS: readonly (readonly [string, string])[] = [
  ['Top gun', 'most destroyed'],
  ['Heavy hitter', 'most damage'],
  ['Medic', 'most revives'],
  ['Daredevil', 'most perfect dashes'],
];
const awardWhy = (name: string): string => AWARDS.find(([n]) => n === name)?.[1] ?? '';

/** Pilot number label, e.g. "P2". */
export const pilotLabel = (pid: number): string => `P${pid + 1}`;
const pilotColor = (pid: number): string => PLAYER_COLORS[pid % PLAYER_COLORS.length]!;
const pilotMark = (pid: number): string => PLAYER_MARKS[pid % PLAYER_MARKS.length]!;

/** Story bits for the results screen. */
export interface ResultsStory {
  /** Game-over quip under the score (absent on a victory). */
  quip?: ResolvedLine;
  /** Boss victory taunt, used as the header line when a capital ship destroyed the player. */
  taunt?: ResolvedLine;
  /** Ship's Log entries unlocked by this run. */
  newLog: LogbookEntry[];
  /** The player quit the run from the pause menu (no quip, "Retreated" header). */
  retreat?: boolean;
}

type LogTab = 'entries' | 'cast' | 'fleet';

export interface UiCallbacks {
  play(daily: boolean): void;
  /** Co-op "Play again" (same roster). */
  again(): void;
  openCoop(): void;
  lobbyMouse(slot: number, action: LobbyMouseAction): void;
  addBot(): void;
  /** `slot` = the device that pressed it; omitted for mouse/touch and autoplay (always accepted). */
  pick(index: number, slot?: InputSlot): void;
  reroll(slot?: InputSlot): void;
  resume(): void;
  quitRun(): void;
  continueOvertime(): void;
  cashOut(): void;
  buy(id: string): boolean;
  selectShip(id: ShipId): void;
  settingsChanged(s: Settings): void;
  resetSave(): void;
  toTitle(): void;
  pause(): void;
  /** Story state in the save changed (log entry read, intro seen): persist it. */
  storyChanged(): void;
  sfx: {
    hover(): void;
    click(): void;
    buy(): void;
    deny(): void;
    tick(p?: number): void;
    countUp(p: number): void;
    fanfare(): void;
    rankUp(): void;
    reveal(r: string): void;
  };
}

export class UI {
  private screens = new Map<ScreenId, HTMLElement>();
  private cb: UiCallbacks;
  current: ScreenId = 'title';
  private settingsReturn: ScreenId = 'title';
  private offers: Offer[] = [];
  private sprites = new SpriteCache();
  private pauseBtn: HTMLButtonElement;
  private topbar: HTMLElement;
  private toasts: HTMLElement;
  private tutorialEl: HTMLElement;
  private resultTimers: number[] = [];
  private shownAt = 0;
  /** Anti-mash grace (ms) of the pause on screen: set when the game paused itself (a controller dropped). */
  private pauseGrace = 0;
  private lastRunDaily = false;
  private lastRunCoop = false;
  /** Co-op level-up: the picker's device (only it may steer the cards). */
  private pickDevice: RosterDevice | null = null;
  /** Devices that may steer the co-op level-up on screen. */
  private pickSlots: readonly InputSlot[] = [];
  /** Pause/victory/results of a co-op run also accept WASD + E (kbA). */
  private coopMenus = false;

  private crawl: OpeningCrawl | null = null;
  private logTab: LogTab = 'entries';
  private logEntry: string | null = null;

  constructor(root: HTMLElement, cb: UiCallbacks) {
    this.cb = cb;
    const ids: ScreenId[] = ['title', 'hangar', 'workshop', 'records', 'settings', 'log', 'crawl', 'lobby', 'levelup', 'pause', 'victory', 'results'];
    for (const id of ids) {
      const s = el(`<section class="screen" id="screen-${id}" hidden></section>`);
      this.screens.set(id, s);
      root.appendChild(s);
    }
    this.pauseBtn = el<HTMLButtonElement>('<button class="btn btn-sm" id="pause-btn" aria-label="Pause" hidden>❚❚</button>');
    this.pauseBtn.addEventListener('click', () => this.cb.pause());
    document.body.appendChild(this.pauseBtn);
    this.topbar = el('<div class="topbar" hidden></div>');
    document.body.appendChild(this.topbar);
    this.toasts = document.getElementById('toasts')!;
    this.tutorialEl = document.getElementById('tutorial')!;

    // Sound on hover/click for every button.
    root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t && !(t as HTMLButtonElement).disabled) this.cb.sfx.hover();
    });
    root.addEventListener('focusin', (e) => {
      if ((e.target as HTMLElement).matches('button')) this.cb.sfx.hover();
    });

    window.addEventListener('keydown', (e) => this.onKey(e));
    // Space is the dash key: on screens that appear mid-action it must never activate a button.
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && (this.current === 'levelup' || this.current === 'results' || this.current === 'lobby')) e.preventDefault();
    });
  }

  // ───────────────────────── plumbing ─────────────────────────

  private show(id: ScreenId | 'hud'): void {
    for (const [sid, s] of this.screens) s.hidden = sid !== id;
    if (this.current !== id) this.shownAt = performance.now();
    this.current = id;
    if (id !== 'levelup') this.pickDevice = null;
    if (id !== 'pause') this.pauseGrace = 0;
    this.pauseBtn.hidden = id !== 'hud';
    this.tutorialEl.style.visibility = id === 'hud' ? 'visible' : 'hidden';
    this.topbar.hidden = !(id === 'title' || id === 'hangar' || id === 'workshop' || id === 'records' || id === 'log');
  }

  private screen(id: ScreenId): HTMLElement {
    return this.screens.get(id)!;
  }

  private focusFirst(id: ScreenId, selector?: string): void {
    const s = this.screen(id);
    requestAnimationFrame(() => {
      const target = selector ? s.querySelector<HTMLElement>(selector) : focusables(s)[0];
      target?.focus({ preventScroll: true });
    });
  }

  private bind(root: HTMLElement, sel: string, fn: (el: HTMLElement) => void): void {
    root.querySelectorAll<HTMLElement>(sel).forEach((b) =>
      b.addEventListener('click', () => {
        this.cb.sfx.click();
        fn(b);
      }),
    );
  }

  showHud(): void {
    this.show('hud');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  hideAll(): void {
    this.show('hud');
    this.pauseBtn.hidden = true;
  }

  /**
   * True right after a screen that pops up during play appears, so a held or
   * mashed key/button cannot pick a card or skip the results by accident.
   */
  private inGrace(): boolean {
    const grace = this.current === 'levelup' ? 350 : this.current === 'results' ? 900 : this.current === 'pause' ? this.pauseGrace : 0;
    return performance.now() - this.shownAt < grace;
  }

  private onKey(e: KeyboardEvent): void {
    const id = this.current;
    if (id === 'hud' || id === 'crawl') return;
    // Slot-routed screens: Input sends each device's own keys through the app (menuAction).
    if (id === 'lobby') {
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        this.cb.toTitle();
      }
      return;
    }
    if (id === 'levelup' && this.pickDevice !== null) return;
    const s = this.screen(id as ScreenId);
    const activates = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
    if ((id === 'levelup' || id === 'results') && (e.code === 'Space' || (activates && (e.repeat || this.inGrace())))) {
      e.preventDefault();
      return;
    }
    if (id === 'pause' && activates && this.inGrace()) {
      e.preventDefault();
      return;
    }
    if (e.repeat && (activates || e.code.startsWith('Digit') || e.code.startsWith('Numpad'))) {
      e.preventDefault();
      return;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'range' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) return;
      e.preventDefault();
      const dx = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
      const dy = e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0;
      moveFocus(s, dx, dy);
      return;
    }
    if (this.coopMenus && (id === 'pause' || id === 'victory' || id === 'results')) {
      // Co-op menus: kbA steers focus with WASD and activates with E (kbB has arrows + Enter).
      const v = ({ KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] } as Record<string, [number, number]>)[e.code];
      if (v) {
        e.preventDefault();
        moveFocus(s, v[0], v[1]);
        return;
      }
      if (e.code === 'KeyE') {
        e.preventDefault();
        if (e.repeat || this.inGrace()) return;
        const a = document.activeElement as HTMLElement | null;
        if (a && s.contains(a)) a.click();
        else focusables(s)[0]?.focus();
        return;
      }
    }
    if (id === 'levelup') {
      if (this.inGrace()) return;
      const n = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
      if (n >= 0) {
        e.preventDefault();
        this.cb.pick(n % 3);
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        this.cb.reroll();
      }
      return;
    }
    if (e.code === 'Escape' || (e.code === 'KeyP' && id === 'pause')) {
      if (id === 'pause') this.cb.resume();
      else if (id === 'settings') this.back();
      else if (id === 'log' && this.closeLogReader()) return;
      else if (id === 'hangar' || id === 'workshop' || id === 'records' || id === 'log') this.cb.toTitle();
      return;
    }
    if (id === 'title' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement === document.body) {
      e.preventDefault();
      this.cb.play(false);
      return;
    }
    if (id === 'results' && e.code === 'Enter' && document.activeElement === document.body) {
      e.preventDefault();
      if (this.lastRunCoop) this.cb.again();
      else this.cb.play(this.lastRunDaily);
    }
  }

  /**
   * Co-op level-up: a menu action from one device (routed by Input). Only the
   * current picker's device may steer, pick or reroll; mouse/touch clicks are
   * handled by the buttons themselves and always accepted.
   */
  menuAction(slot: InputSlot, action: MenuAction): void {
    if (this.current !== 'levelup' || this.pickDevice === null || !this.pickSlots.includes(slot)) return;
    const s = this.screen('levelup');
    if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
      const dx = action === 'left' ? -1 : action === 'right' ? 1 : 0;
      const dy = action === 'up' ? -1 : action === 'down' ? 1 : 0;
      moveFocus(s, dx, dy);
      return;
    }
    if (this.inGrace()) return;
    if (action === 'reroll') {
      this.cb.reroll(slot);
    } else if (action === 'pick0' || action === 'pick1' || action === 'pick2') {
      this.cb.pick(Number(action.slice(4)), slot);
    } else if (action === 'confirm') {
      const a = document.activeElement as HTMLElement | null;
      const i = a && s.contains(a) ? a.dataset.pick : undefined;
      if (i !== undefined) this.cb.pick(Number(i), slot);
      else if (a?.dataset.act === 'reroll') this.cb.reroll(slot);
      else s.querySelector<HTMLElement>('[data-pick="0"]')?.focus({ preventScroll: true });
    }
  }

  /** Gamepad navigation for menus. */
  padNav(nav: { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean; alt: boolean }): void {
    const id = this.current;
    if (id === 'hud') return;
    if (id === 'crawl') {
      if (nav.confirm || nav.back) this.crawl?.skip();
      return;
    }
    const s = this.screen(id as ScreenId);
    if (nav.up) moveFocus(s, 0, -1);
    if (nav.down) moveFocus(s, 0, 1);
    if (nav.left) moveFocus(s, -1, 0);
    if (nav.right) moveFocus(s, 1, 0);
    if (nav.confirm && !this.inGrace()) {
      const a = document.activeElement as HTMLElement | null;
      if (a && s.contains(a)) a.click();
      else focusables(s)[0]?.focus();
    }
    if (nav.alt && id === 'levelup') this.cb.reroll();
    if (nav.back && !this.inGrace()) {
      if (id === 'pause') this.cb.resume();
      else if (id === 'settings') this.back();
      else if (id === 'log' && this.closeLogReader()) return;
      else if (id === 'hangar' || id === 'workshop' || id === 'records' || id === 'log') this.cb.toTitle();
    }
  }

  private back(): void {
    if (this.settingsReturn === 'pause') this.show('pause');
    else this.cb.toTitle();
  }

  toast(text: string, icon = '◆', gold = false): void {
    const t = el(`<div class="toast${gold ? ' gold' : ''}"><span class="t-icon">${esc(icon)}</span><span>${esc(text)}</span></div>`);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), 3700);
  }

  tutorial(text: string | null, sub = ''): void {
    if (!text) {
      this.tutorialEl.hidden = true;
      return;
    }
    this.tutorialEl.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.tutorialEl.hidden = false;
  }

  private renderTopbar(save: SaveData): void {
    this.topbar.innerHTML = `<span class="cores">${formatNumber(save.cores)}</span>`;
  }

  // ───────────────────────── Title ─────────────────────────

  /** `coopAvailable`: show the Co-op button (keyboard/mouse or a gamepad; hidden on touch-only devices). */
  showTitle(save: SaveData, daily: DailyInfo, touch: boolean, coopAvailable = false): void {
    const s = this.screen('title');
    const streak = currentStreak(save);
    const played = playedDailyToday(save);
    const need = rankXpNeeded(save.rank);
    const affordable = affordableUpgrades(save);
    const ship = SHIPS[save.ship];
    const best = save.stats.bestScore;
    const unread = unseenLogCount(save);
    const logCount = save.story?.logUnlocked.length ?? 0;
    const missions = save.missions
      .map((m) => {
        const def = missionDef(m.def);
        const k = Math.min(1, m.progress / m.target);
        const prog = def?.scope === 'run' ? `Best ${formatNumber(m.progress)} / ${formatNumber(m.target)}` : `${formatNumber(m.progress)} / ${formatNumber(m.target)}`;
        return `<div class="mission${m.done ? ' done' : ''}">
          <span class="m-text">${esc(missionText(m))}</span><span class="m-reward">+${missionReward(m.tier)} ◈</span>
          <div class="meter"><i style="width:${(k * 100).toFixed(1)}%"></i></div>
          <span class="m-prog">${prog}</span>
        </div>`;
      })
      .join('');

    s.className = 'screen scrim';
    s.innerHTML = `
      <div class="title-left">
        <h1 class="logo"><span>ALLIED BEACON FLEET</span>SHARD<br/>STORM</h1>
        <p class="tagline">Captain one small starship against the Shardstorm, a crystal armada led by an overlord who writes poetry. Your guns fire on their own: steer, dash through the swarm, chain the combo and hold the line for 10:00.</p>
        <button class="btn btn-primary" data-act="play">Play <span class="key">${touch ? 'TAP' : 'ENTER'}</span></button>
        <div class="menu-grid">
          <button class="btn btn-gold wide" data-act="daily">
            <span>Daily Run</span>
            <span class="meta">${esc(daily.modifier.name)} · ${played ? `best ${formatNumber(save.daily.best[daily.date] ?? 0)}` : `+${dailyBonus(streak + 1)} ◈`}${streak > 0 ? ` · <span class="streak">🔥 ${streak}</span>` : ''}</span>
          </button>
          ${
            coopAvailable
              ? `<button class="btn btn-coop wide" data-act="coop"><span class="label">Co-op<span class="marks" aria-hidden="true">▲●■◆</span></span><span class="meta">${save.coop.runs > 0 ? `${formatNumber(save.coop.runs)} squad ${save.coop.runs === 1 ? 'run' : 'runs'}` : '2–4 captains · one screen'}</span></button>`
              : ''
          }
          <button class="btn" data-act="hangar"><span>Hangar</span><span class="meta">${esc(ship.name)}</span></button>
          <button class="btn" data-act="workshop"><span>Workshop</span><span class="meta">${affordable > 0 ? `<span class="badge">${affordable} READY</span>` : `◈ ${formatNumber(save.cores)}`}</span></button>
          <button class="btn" data-act="log"><span>Ship's Log</span><span class="meta">${unread > 0 ? `<span class="badge badge-ice">${unread} NEW</span>` : `${logCount}/${STORY.logbook.length}`}</span></button>
          <button class="btn" data-act="records"><span>Records</span><span class="meta">${Object.keys(save.achievements).length}/${ACHIEVEMENTS.length}</span></button>
          <button class="btn wide" data-act="settings"><span>Settings</span><span class="meta"></span></button>
        </div>
        <p class="hint">${touch ? 'Drag to move · tap DASH or a second finger to dash' : 'WASD / arrows to move · SPACE to dash · ESC to pause'}</p>
      </div>
      <div class="title-right">
        <div class="panel">
          <div class="rank-row"><span class="eyebrow">Rank</span><span class="dim num">${formatNumber(save.rankXp)} / ${formatNumber(need)} XP</span></div>
          <div class="rank-row"><span class="rank-num">${save.rank}</span><span class="dim">${best > 0 ? `Best score <b class="num">${formatNumber(best)}</b>` : 'No runs yet'}</span></div>
          <div class="meter" style="--c: var(--violet)"><i style="width:${((save.rankXp / need) * 100).toFixed(1)}%"></i></div>
        </div>
        <div class="panel">
          <div class="rank-row"><h3>Missions</h3><span class="eyebrow">${save.missionsCompleted} done</span></div>
          ${missions || '<p class="dim">Missions appear after your first run.</p>'}
        </div>
      </div>`;
    this.bind(s, '[data-act="play"]', () => this.cb.play(false));
    this.bind(s, '[data-act="daily"]', () => this.cb.play(true));
    this.bind(s, '[data-act="coop"]', () => this.cb.openCoop());
    this.bind(s, '[data-act="hangar"]', () => this.showHangar(save));
    this.bind(s, '[data-act="workshop"]', () => this.showWorkshop(save));
    this.bind(s, '[data-act="records"]', () => this.showRecords(save));
    this.bind(s, '[data-act="log"]', () => this.showLog(save));
    this.bind(s, '[data-act="settings"]', () => this.showSettings(save, 'title'));
    this.renderTopbar(save);
    this.show('title');
    this.focusFirst('title', '[data-act="play"]');
  }

  // ───────────────────────── Hangar ─────────────────────────

  private shipArt(color: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 168;
    c.height = 168;
    this.sprites.setResolution(3);
    const sp = this.sprites.get('player', color, 22);
    const ctx = c.getContext('2d')!;
    ctx.translate(84, 84);
    ctx.rotate(-Math.PI / 2);
    const px = sp.size * 2.2;
    ctx.drawImage(sp.canvas, -px / 2, -px / 2, px, px);
    return c;
  }

  showHangar(save: SaveData): void {
    const s = this.screen('hangar');
    s.className = 'screen scrim-heavy';
    const cards = SHIP_IDS.map((id) => {
      const def = SHIPS[id];
      const unlocked = isShipUnlocked(save, id);
      const ach = def.unlockAchievement ? achievementDef(def.unlockAchievement) : null;
      const prog = ach?.progress?.(save);
      const w = WEAPONS[def.weapon];
      const v = STORY.vessels[id];
      const cap = characterById(STORY.pilots[id]);
      return `<div class="panel card ship-card${save.ship === id ? ' selected' : ''}${unlocked ? '' : ' locked'}" data-ship="${id}" style="--sc:${def.color}">
        <div class="ship-art" data-art="${id}"></div>
        <div class="ship-class">${esc(v.className)}</div>
        <div class="row"><h3 style="color:${def.color}">${esc(def.name)}</h3>${save.ship === id ? '<span class="badge badge-ice">SELECTED</span>' : ''}</div>
        ${cap ? `<div class="ship-captain">${portrait(cap, 'sm')}<span>${esc(cap.name)}</span></div>` : ''}
        <p class="ship-blurb">${esc(v.blurb)}</p>
        <div class="desc">${esc(def.trait)}<br/><span class="dim">Starts with <b style="color:${w.color}">${esc(w.name)}</b></span></div>
        ${
          unlocked
            ? `<button class="btn btn-sm" data-select="${id}" ${save.ship === id ? 'disabled' : ''}>${save.ship === id ? 'Selected' : 'Select'}</button>`
            : `<div class="dim">🔒 ${esc(def.unlockText)}${prog ? ` <span class="num">(${prog[0]}/${prog[1]})</span>` : ''}</div>`
        }
      </div>`;
    }).join('');
    s.innerHTML = `<div class="sub">
      <div class="sub-head"><div><div class="eyebrow">Allied Beacon Fleet · Choose your ship</div><h2>Hangar</h2></div><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div>
      <div class="grid-cards">${cards}</div>
    </div>`;
    s.querySelectorAll<HTMLElement>('[data-art]').forEach((n) => {
      const id = n.dataset.art as ShipId;
      n.appendChild(this.shipArt(isShipUnlocked(save, id) ? SHIPS[id].color : '#4a4a66'));
    });
    this.bind(s, '[data-act="back"]', () => this.cb.toTitle());
    this.bind(s, '[data-select]', (b) => {
      this.cb.selectShip(b.dataset.select as ShipId);
      this.showHangar(save);
    });
    this.show('hangar');
    this.focusFirst('hangar');
  }

  // ───────────────────────── Co-op lobby ─────────────────────────

  private lobbyView: LobbyView | null = null;

  /** Opens (or re-renders) the co-op lobby. */
  showLobby(view: LobbyView): void {
    this.lobbyView = view;
    const s = this.screen('lobby');
    s.className = 'screen scrim-heavy';
    const { lobby } = view;
    const joinedDevices = new Set(lobby.joined().map((j) => j.device));
    const joinHints: string[] = [];
    if (!joinedDevices.has('kbA')) joinHints.push(`<li><span class="key">SPACE</span><span>Keyboard · WASD</span></li>`);
    if (!joinedDevices.has('kbB')) joinHints.push(`<li><span class="key">ENTER</span><span>Keyboard · Arrows</span></li>`);
    const freePads = view.pads.filter((i) => !joinedDevices.has(`pad${i}` as InputSlot));
    if (freePads.length > 0) for (const i of freePads) joinHints.push(`<li><span class="key">Ⓐ</span><span>Controller ${i + 1}</span></li>`);
    else if (view.pads.length === 0) joinHints.push(`<li><span class="key">Ⓐ</span><span>Any controller</span></li>`);
    let firstEmpty = true;
    const cards = lobby.slots
      .map((slot, i) => {
        const head = `<div class="slot-top"><span class="slot-id"><b>${pilotMark(i)}</b> ${pilotLabel(i)}</span>${slot ? `<span class="slot-dev">${esc(slot.device === 'bot' ? 'Bot pilot' : deviceLabels(slot.device, view.allowCtrl).name)}</span>` : ''}</div>`;
        if (!slot) {
          const hints = firstEmpty ? `<ul class="join-list">${joinHints.join('')}</ul>` : '';
          const body = firstEmpty ? '<div class="join-pulse">Press to join</div>' : '<div class="join-idle">Open slot</div>';
          firstEmpty = false;
          return `<div class="panel slot-card empty" style="--pc:${pilotColor(i)}" data-slot="${i}">${head}${body}${hints}</div>`;
        }
        const def = SHIPS[slot.ship];
        const vessel = STORY.vessels[slot.ship];
        const w = WEAPONS[def.weapon];
        const lab = slot.device === 'bot' ? null : deviceLabels(slot.device, view.allowCtrl);
        const confirmKey = slot.device === 'kbA' ? 'SPACE' : lab?.join ?? '';
        const canCycle = !slot.ready && slot.device !== 'bot';
        return `<div class="panel slot-card${slot.ready ? ' ready' : ''}" style="--pc:${pilotColor(i)}" data-slot="${i}">
          ${head}
          <div class="slot-art" data-art="${i}"></div>
          <div class="slot-ship">
            <button class="slot-arrow" data-lobby="left" aria-label="Previous ship" ${canCycle ? '' : 'disabled'}>◀</button>
            <div class="slot-name"><h3>${esc(def.name)}</h3><span>${esc(vessel?.shipName ?? def.trait)}</span></div>
            <button class="slot-arrow" data-lobby="right" aria-label="Next ship" ${canCycle ? '' : 'disabled'}>▶</button>
          </div>
          <div class="slot-desc">${esc(def.trait)} <span class="dim">Starts with <b style="color:${w.color}">${esc(w.name)}</b>.</span></div>
          ${
            slot.ready
              ? `<button class="btn btn-sm slot-ready is-ready" data-lobby="ready"><span>Ready ✓</span>${lab ? `<span class="key">${esc(lab.back)}<span class="k-word"> cancel</span></span>` : ''}</button>`
              : `<button class="btn btn-sm slot-ready" data-lobby="ready"><span>Ready up</span>${lab ? `<span class="key">${esc(confirmKey)}</span>` : ''}</button>`
          }
          <div class="slot-keys">${lab ? `<span><b>${esc(lab.cycle)}</b> ship<br><b>${esc(lab.dash)}</b> dash</span>` : '<span>Flies itself</span>'}<button class="slot-leave" data-lobby="leave">${lab && !slot.ready ? `Leave · ${esc(lab.back)}` : 'Leave'}</button></div>
        </div>`;
      })
      .join('');
    s.innerHTML = `<div class="sub lobby-wrap">
      <div class="sub-head"><div><div class="eyebrow">Local co-op · one screen · 2–4 captains</div><h2>Assemble the Squadron</h2></div><button class="btn btn-sm" data-act="back">Back <span class="key">${view.pads.length > 0 ? 'ESC · Ⓑ' : 'ESC'}</span></button></div>
      <div class="lobby">${cards}</div>
      <div class="lobby-foot">
        <div class="lobby-status" id="lobby-status"></div>
        <p class="hint">Shared XP and level-ups · every captain picks their own upgrades · fly over a downed captain to revive them</p>
        <p class="hint">Gamepads are best for 3–4 captains${view.pads.length > 0 ? ` · ${view.pads.length} controller${view.pads.length === 1 ? '' : 's'} detected` : ' · press a button on a controller to wake it up'}</p>
        ${view.bots && lobby.joined().length < 4 ? '<button class="btn btn-sm" data-act="bot">Add bot</button>' : ''}
      </div>
    </div>`;
    s.querySelectorAll<HTMLElement>('[data-art]').forEach((n) => {
      const i = Number(n.dataset.art);
      n.appendChild(this.shipArt(pilotColor(i)));
    });
    this.bind(s, '[data-act="back"]', () => this.cb.toTitle());
    this.bind(s, '[data-act="bot"]', () => this.cb.addBot());
    s.querySelectorAll<HTMLElement>('[data-lobby]').forEach((b) =>
      b.addEventListener('click', () => {
        const card = b.closest<HTMLElement>('[data-slot]');
        if (!card) return;
        this.cb.sfx.click();
        this.cb.lobbyMouse(Number(card.dataset.slot), b.dataset.lobby as LobbyMouseAction);
      }),
    );
    this.lobbyTick();
    if (this.current !== 'lobby') {
      this.show('lobby');
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }

  /** Updates the lobby status line (countdown) without re-rendering the cards. */
  lobbyTick(): void {
    const view = this.lobbyView;
    if (!view) return;
    const el = this.screen('lobby').querySelector<HTMLElement>('#lobby-status');
    if (!el) return;
    const { lobby } = view;
    const joined = lobby.joined();
    let html: string;
    let cls = '';
    if (lobby.countdown >= 0) {
      html = `Launching in <b class="num">${Math.max(1, Math.ceil(lobby.countdown))}</b>`;
      cls = 'go';
      el.style.setProperty('--k', String(1 - lobby.countdown / LOBBY_COUNTDOWN));
    } else if (joined.length === 0) {
      html = 'Each captain presses their join key';
    } else if (joined.length < MIN_COOP_PILOTS) {
      html = 'Need one more captain to launch';
    } else {
      const waiting = lobby.slots.map((sl, i) => (sl && !sl.ready ? pilotLabel(i) : '')).filter(Boolean);
      html = `Waiting for ${waiting.join(', ')} to ready up`;
    }
    el.className = `lobby-status ${cls}`;
    el.innerHTML = html;
  }

  // ───────────────────────── Workshop ─────────────────────────

  showWorkshop(save: SaveData, focusId?: string): void {
    const s = this.screen('workshop');
    s.className = 'screen scrim-heavy';
    const cards = WORKSHOP.map((def) => {
      const lvl = workshopLevel(save, def.id);
      const cost = nextCost(save, def);
      const can = cost !== null && save.cores >= cost;
      return `<div class="panel card">
        <div class="row"><div class="glyph">${esc(def.icon)}</div>${pips(lvl, def.maxLevel)}</div>
        <h3>${esc(def.name)}</h3>
        <div class="desc">${esc(def.text)} per level</div>
        <button class="btn btn-sm ${can ? 'btn-gold' : ''}" data-buy="${def.id}" ${cost === null ? 'disabled' : ''}>
          <span>${cost === null ? 'Maxed' : `Upgrade to ${lvl + 1}`}</span><span class="cores">${cost === null ? '—' : formatNumber(cost)}</span>
        </button>
      </div>`;
    }).join('');
    const goal = nextWorkshopGoal(save);
    s.innerHTML = `<div class="sub">
      <div class="sub-head"><div><div class="eyebrow">Permanent upgrades</div><h2>Workshop</h2></div>
        <div style="display:flex;gap:12px;align-items:center"><span class="cores" style="font-size:22px">${formatNumber(save.cores)}</span><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div></div>
      ${goal ? `<p class="dim">Next goal: <b>${esc(goal.def.name)}</b>, ${formatNumber(goal.missing)} more cores.</p>` : ''}
      <div class="grid-cards">${cards}</div>
    </div>`;
    this.bind(s, '[data-act="back"]', () => this.cb.toTitle());
    s.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy!;
        if (this.cb.buy(id)) {
          this.cb.sfx.buy();
          this.showWorkshop(save, id);
        } else {
          this.cb.sfx.deny();
        }
      }),
    );
    this.renderTopbar(save);
    this.show('workshop');
    this.focusFirst('workshop', focusId ? `[data-buy="${focusId}"]` : undefined);
  }

  // ───────────────────────── Records ─────────────────────────

  showRecords(save: SaveData): void {
    const s = this.screen('records');
    s.className = 'screen scrim-heavy';
    const st = save.stats;
    const rows: [string, string][] = [
      ['Runs', formatNumber(st.runs)],
      ['Best score', formatNumber(st.bestScore)],
      // Co-op runs count toward these lifetime records too; say so once there are any.
      [save.coop.runs > 0 ? 'Longest run (any mode)' : 'Longest run', formatTime(st.bestTime)],
      ['Best combo', formatNumber(st.bestCombo)],
      ['Highest level', String(st.bestLevel)],
      ['Enemies destroyed', formatNumber(st.kills)],
      ['Bosses defeated', formatNumber(st.bossKills)],
      ['Perfect dashes', formatNumber(st.perfects)],
      ['Weapons evolved', formatNumber(st.evolutions)],
      [save.coop.runs > 0 ? 'Victories (all modes)' : 'Victories', formatNumber(st.victories)],
      ['Cores earned', formatNumber(st.coresEarned)],
      ['Time in the storm', formatTime(st.timePlayed)],
      ['Co-op runs', formatNumber(save.coop.runs)],
      ...(['2', '3', '4'] as const)
        .filter((n) => coopBest(save, Number(n)) > 0)
        .map((n): [string, string] => [`Squad best (${n}P)`, formatNumber(coopBest(save, Number(n)))]),
      ...(save.coop.runs > 0
        ? ([
            ['Co-op victories', formatNumber(save.coop.victories)],
            ['Teammates revived', formatNumber(save.coop.revives)],
          ] as [string, string][])
        : []),
    ];
    const ach = ACHIEVEMENTS.map((a) => {
      const got = !!save.achievements[a.id];
      const prog = !got && a.progress ? a.progress(save) : null;
      return `<div class="panel ach ${got ? 'unlocked' : 'locked'}"><div class="glyph">${got ? '★' : '☆'}</div><div><h3>${esc(a.name)}</h3><div class="dim">${esc(a.text)}${prog ? ` <span class="num">(${formatNumber(prog[0])}/${formatNumber(prog[1])})</span>` : ''}</div></div></div>`;
    }).join('');
    const hist = save.history.slice(-24);
    const maxScore = Math.max(1, ...hist.map((h) => h.score));
    const bars = hist
      .map((h, i) => {
        const cls = [i === hist.length - 1 ? 'last' : '', (h.players ?? 1) > 1 ? 'coop' : ''].filter(Boolean).join(' ');
        return `<i class="${cls}" style="height:${Math.max(4, (h.score / maxScore) * 100)}%" title="${formatNumber(h.score)}${(h.players ?? 1) > 1 ? ` · co-op ${h.players}` : ''}"></i>`;
      })
      .join('');
    s.innerHTML = `<div class="sub">
      <div class="sub-head"><div><div class="eyebrow">Your storm so far</div><h2>Records</h2></div><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div>
      <div class="panel"><div class="stat-list">${rows.map(([k, v]) => `<div><span class="dim">${k}</span><b class="num">${v}</b></div>`).join('')}</div>
      ${hist.length > 1 ? `<div style="margin-top:14px"><div class="eyebrow" style="margin-bottom:8px">Last ${hist.length} runs</div><div class="history">${bars}</div></div>` : ''}</div>
      <h3>Achievements · ${Object.keys(save.achievements).length}/${ACHIEVEMENTS.length}</h3>
      <div class="grid-cards">${ach}</div>
    </div>`;
    this.bind(s, '[data-act="back"]', () => this.cb.toTitle());
    this.renderTopbar(save);
    this.show('records');
    this.focusFirst('records');
  }

  // ───────────────────────── Settings ─────────────────────────

  showSettings(save: SaveData, from: 'title' | 'pause'): void {
    this.settingsReturn = from;
    const s = this.screen('settings');
    s.className = 'screen scrim-heavy';
    const st = save.settings;
    const slider = (id: keyof Settings, label: string, v: number) =>
      `<div class="setting"><label for="set-${id}">${label}</label><input type="range" id="set-${id}" min="0" max="100" value="${Math.round(v * 100)}" /></div>`;
    const toggle = (id: keyof Settings, label: string, sub: string, v: boolean, disabled = false) =>
      `<div class="setting"><label for="set-${id}">${label}<small>${sub}</small></label><input type="checkbox" class="toggle" id="set-${id}" ${v ? 'checked' : ''} ${disabled ? 'disabled' : ''} /></div>`;
    const trails = (Object.keys(TRAILS) as TrailId[])
      .map((t) => `<option value="${t}" ${st.trail === t ? 'selected' : ''} ${save.rank < TRAILS[t].rank ? 'disabled' : ''}>${TRAILS[t].name}${save.rank < TRAILS[t].rank ? ` (rank ${TRAILS[t].rank})` : ''}</option>`)
      .join('');
    const chatterLabels: Record<ChatterMode, string> = { all: 'All', important: 'Important only', off: 'Off' };
    const chatter = (Object.keys(chatterLabels) as ChatterMode[])
      .map((m) => `<option value="${m}" ${st.chatter === m ? 'selected' : ''}>${chatterLabels[m]}</option>`)
      .join('');
    s.innerHTML = `<div class="sub">
      <div class="sub-head"><div><div class="eyebrow">Options</div><h2>Settings</h2></div><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div>
      <div class="panel settings-list">
        ${slider('master', 'Master volume', st.master)}
        ${slider('music', 'Music', st.music)}
        ${slider('sfx', 'Sound effects', st.sfx)}
        <div class="setting"><label for="set-chatter">Crew chatter<small>Bridge-crew comms during a run</small></label><select id="set-chatter">${chatter}</select></div>
        ${slider('shake', 'Screen shake', st.shake)}
        ${toggle('flashes', 'Screen flashes', 'Turn off to reduce flashing effects', st.flashes)}
        ${toggle('damageNumbers', 'Damage numbers', 'Show numbers when enemies are hit', st.damageNumbers)}
        ${toggle('breakReminder', 'Break reminder', 'A gentle nudge after an hour of play', st.breakReminder)}
        ${toggle('showFps', 'Show FPS', 'Performance overlay', st.showFps)}
        ${toggle('hardMode', 'Nightmare mode', save.rank >= HARD_MODE_RANK ? 'Tougher, faster enemies; ×1.5 score' : `Unlocks at rank ${HARD_MODE_RANK}`, st.hardMode, save.rank < HARD_MODE_RANK)}
        <div class="setting"><label for="set-trail">Ship trail<small>Unlock more by ranking up</small></label><select id="set-trail">${trails}</select></div>
        ${
          from === 'title'
            ? `<div class="setting"><label>Reset progress<small>Erases cores, upgrades, ranks and records</small></label><div class="confirm-row" id="reset-row"><button class="btn btn-sm btn-rose" data-act="reset">Reset…</button></div></div>`
            : ''
        }
      </div>
    </div>`;
    const read = (): Settings => ({
      master: Number(($(s, '#set-master') as HTMLInputElement).value) / 100,
      music: Number(($(s, '#set-music') as HTMLInputElement).value) / 100,
      sfx: Number(($(s, '#set-sfx') as HTMLInputElement).value) / 100,
      shake: Number(($(s, '#set-shake') as HTMLInputElement).value) / 100,
      flashes: ($(s, '#set-flashes') as HTMLInputElement).checked,
      damageNumbers: ($(s, '#set-damageNumbers') as HTMLInputElement).checked,
      breakReminder: ($(s, '#set-breakReminder') as HTMLInputElement).checked,
      showFps: ($(s, '#set-showFps') as HTMLInputElement).checked,
      hardMode: ($(s, '#set-hardMode') as HTMLInputElement).checked,
      trail: ($(s, '#set-trail') as HTMLSelectElement).value as TrailId,
      chatter: ($(s, '#set-chatter') as HTMLSelectElement).value as ChatterMode,
    });
    s.querySelectorAll('input, select').forEach((i) => i.addEventListener('input', () => this.cb.settingsChanged(read())));
    this.bind(s, '[data-act="back"]', () => this.back());
    const resetRow = s.querySelector<HTMLElement>('#reset-row');
    if (resetRow) {
      this.bind(resetRow, '[data-act="reset"]', () => {
        resetRow.innerHTML = `<button class="btn btn-sm btn-rose" data-act="confirm">Erase everything</button><button class="btn btn-sm" data-act="cancel">Keep</button>`;
        this.bind(resetRow, '[data-act="confirm"]', () => this.cb.resetSave());
        this.bind(resetRow, '[data-act="cancel"]', () => this.showSettings(save, from));
        resetRow.querySelector<HTMLElement>('[data-act="cancel"]')?.focus();
      });
    }
    this.show('settings');
    this.focusFirst('settings');
  }

  // ───────────────────────── Level-up ─────────────────────────

  /**
   * Level-up / cache picks. Solo: unchanged. Co-op (`opts.pilot`): one modal
   * per pick, headed by whose pick it is (number, colour, mark, ship), with the
   * round chips and that pilot's device hints; only their device steers.
   */
  showLevelUp(offers: Offer[], opts: { cache: boolean; rerolls: number; level: number; world: World; reroll?: boolean; pilot?: CoopPickInfo }): void {
    this.offers = offers;
    // The anti-mash grace restarts on every new pick (so on every picker change), not on rerolls.
    if (!opts.reroll) this.shownAt = performance.now();
    const s = this.screen('levelup');
    const co = opts.pilot ?? null;
    this.pickDevice = co ? co.device : null;
    this.pickSlots = co ? co.allowed : [];
    const pid = co ? co.pid : 0;
    const keys = co && co.device !== 'bot' && !co.lost ? deviceLabels(co.device, co.allowCtrl) : null;
    s.className = `screen scrim-heavy${co ? ' coop-pick' : ''}`;
    if (co) s.style.setProperty('--pc', pilotColor(pid));
    else s.style.removeProperty('--pc');
    const pickKey = (i: number): string => {
      if (!co) return `<span class="key">${i + 1}</span>`;
      return keys?.picks ? `<span class="key">${esc(keys.picks[i]!)}</span>` : '';
    };
    const cards = offers
      .map((o, i) => {
        const rarity = offerRarity(o);
        let tag = '';
        let foot = '';
        if (o.kind === 'evolve') {
          tag = 'EVOLUTION';
          foot = `<span>${esc(WEAPONS[o.id].name)} + ${esc(PASSIVES[WEAPONS[o.id].evolvesWith].name)}</span>`;
        } else if (o.kind === 'weapon') {
          tag = o.isNew ? 'NEW WEAPON' : 'WEAPON';
          foot = `${pips(o.level - 1, 5, o.level - 1)}<span>LV ${o.level}</span>`;
          if (o.level === 5) {
            const partner = WEAPONS[o.id].evolvesWith;
            const owned = (opts.world.players[pid]!.build.passives[partner as PassiveId] ?? 0) > 0;
            foot += `</div><div class="o-foot"><span>${owned ? 'Evolution ready next level' : `Evolves with ${esc(PASSIVES[partner].name)}`}</span>`;
          }
        } else if (o.kind === 'passive') {
          tag = o.isNew ? 'NEW PASSIVE' : 'PASSIVE';
          foot = `${pips(o.level - 1, 5, o.level - 1)}<span>LV ${o.level}</span>`;
          const evolves = Object.values(WEAPONS).find((w) => w.evolvesWith === o.id);
          if (evolves && o.isNew) foot += `</div><div class="o-foot"><span>Evolves ${esc(evolves.name)}</span>`;
        } else if (o.kind === 'relic') {
          tag = `${RELICS[o.id].rarity.toUpperCase()} RELIC`;
        } else {
          tag = 'BONUS';
        }
        return `<button class="offer ${rarity}" data-pick="${i}" style="--oc:${offerColor(o) === '#ffffff' ? RARITY_COLOR[rarity] : offerColor(o)}">
          <div class="o-top"><div class="glyph">${esc(offerIcon(o))}</div><span class="o-tag">${tag}</span></div>
          <div class="o-name">${esc(offerTitle(o))}</div>
          <div class="o-text">${esc(offerText(o))}</div>
          <div class="o-foot">${foot}${pickKey(i)}</div>
        </button>`;
      })
      .join('');
    const rerollKey = co && keys ? esc(keys.reroll) : 'R';
    const hints = !co
      ? ''
      : keys
        ? `<div class="lu-hints">${esc(keys.picks ? `${keys.picks.join(' ')} take` : `${keys.cycle} choose`)} · ${esc(keys.confirm)} take selected · ${esc(keys.reroll)} reroll</div>`
        : co.lost
          ? `<div class="lu-hints">${co.allowed.length ? 'Any captain: your own pick keys · confirm takes selected · or click a card' : 'Click a card to pick'}</div>`
          : `<div class="lu-hints">${esc(pilotLabel(co.pid))} is a bot pilot and is choosing…</div>`;
    const head = co
      ? this.coopLevelHead(co, opts)
      : `<div class="lu-head${opts.cache ? ' cache' : ''}"><div class="eyebrow">${opts.cache ? 'Elite cache opened' : `Level ${opts.level}`}</div><h2>${opts.cache ? 'CACHE' : 'LEVEL UP'}</h2></div>`;
    s.innerHTML = `
      ${head}
      <div class="offers">${cards}</div>
      <div class="lu-actions">
        <button class="btn btn-sm btn-violet" data-act="reroll" ${opts.rerolls > 0 ? '' : 'disabled'}><span>Reroll (${opts.rerolls})</span>${co && !keys ? '' : `<span class="key">${rerollKey}</span>`}</button>
      </div>
      ${hints}`;
    s.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        if (!this.inGrace()) this.cb.pick(Number(b.dataset.pick));
      }),
    );
    this.bind(s, '[data-act="reroll"]', () => this.cb.reroll());
    const top = offers.map(offerRarity).find((r) => r === 'legendary' || r === 'epic');
    if (top) this.cb.sfx.reveal(top);
    this.show('levelup');
    window.setTimeout(() => {
      if (this.current === 'levelup') s.querySelector<HTMLElement>('[data-pick="0"]')?.focus({ preventScroll: true });
    }, 300);
  }

  private coopLevelHead(co: CoopPickInfo, opts: { cache: boolean; level: number }): string {
    const def = SHIPS[co.ship];
    const chips = co.round
      ? `<div class="lu-chips">${co.ships
          .map((ship, i) => {
            const state = i < co.pid ? 'done' : i === co.pid ? 'now' : 'wait';
            const tail = state === 'done' ? '✓' : state === 'now' ? '…' : '·';
            return `<span class="lu-chip ${state}" style="--cc:${pilotColor(i)}" title="${esc(SHIPS[ship].name)}"><b>${pilotMark(i)}</b>${pilotLabel(i)} <i>${tail}</i></span>`;
          })
          .join('')}</div>`
      : '';
    const eyebrow = opts.cache
      ? `Elite cache · ${pilotLabel(co.pid)}'s bonus pick`
      : `Level ${opts.level} · pick ${co.round ? co.round.index : 1} of ${co.round ? co.round.total : co.players}`;
    return `<div class="lu-head coop${opts.cache ? ' cache' : ''}">
      <div class="lu-who"><b>${pilotMark(co.pid)}</b> ${pilotLabel(co.pid)}<span>${esc(def.name)}</span></div>
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h2>${opts.cache ? 'CACHE' : 'LEVEL UP'}</h2>
      ${chips}
      ${co.lost && co.device !== 'bot' ? `<div class="lu-lost" role="status">⚠ ${esc(deviceLabels(co.device).name)} is disconnected · ${co.allowed.length ? 'any captain' : 'the mouse'} can pick for ${esc(pilotLabel(co.pid))}</div>` : ''}
    </div>`;
  }

  offerAt(i: number): Offer | undefined {
    return this.offers[i];
  }

  // ───────────────────────── Pause / victory ─────────────────────────

  /** One pilot's build as chips. */
  private buildChips(world: World, pid: number): string {
    const b = world.players[pid]!.build;
    return [
      ...b.weapons.map((w) => `<span style="color:${w.evolved ? 'var(--gold)' : WEAPONS[w.id].color}">${esc(w.evolved ? WEAPONS[w.id].evolvedName : WEAPONS[w.id].name)} ${w.evolved ? '★' : `LV${w.level}`}</span>`),
      ...(Object.keys(b.passives) as PassiveId[]).map((id) => `<span style="color:${PASSIVES[id].color}">${esc(PASSIVES[id].name)} LV${b.passives[id]}</span>`),
      ...b.relics.map((id) => `<span style="color:${RARITY_COLOR[RELICS[id].rarity]}">${esc(RELICS[id].name)}</span>`),
    ].join('');
  }

  /** "▲ P1 · Spark" header for a pilot (co-op screens). */
  private pilotTag(pid: number, ship: ShipId): string {
    return `<span class="pilot-tag" style="--pc:${pilotColor(pid)}"><b>${pilotMark(pid)}</b> ${pilotLabel(pid)}<span>${esc(SHIPS[ship].name)}</span></span>`;
  }

  /** `note`: why the game paused itself (`noteOk`: good news, e.g. a controller came back). */
  showPause(world: World, save: SaveData, note = '', noteOk = false): void {
    const s = this.screen('pause');
    s.className = 'screen modal scrim-heavy';
    this.coopMenus = world.coop;
    const build = world.coop
      ? `<div class="coop-builds">${world.players
          .map(
            (p) => `<div class="pilot-build" style="--pc:${pilotColor(p.pid)}">
              <div class="pb-head">${this.pilotTag(p.pid, p.ship)}${p.downed ? '<span class="pb-down">DOWN</span>' : `<span class="dim num">${Math.ceil(p.hp)}/${Math.round(p.stats.maxHp)} HP</span>`}</div>
              <div class="build-list">${this.buildChips(world, p.pid)}</div>
            </div>`,
          )
          .join('')}</div>`
      : `<div class="build-list">${this.buildChips(world, 0)}</div>`;
    s.innerHTML = `<div class="panel modal-box${world.coop ? ' wide' : ''}">
      <div><div class="eyebrow">${formatTime(world.time)} · Level ${world.level} · ${formatNumber(world.score)} pts${world.coop ? ` · ${world.players.length} captains` : ''}</div><h2>Paused</h2></div>
      ${note ? `<div class="pause-note${noteOk ? ' ok' : ''}" role="status">${esc(note)}</div>` : ''}
      ${build}
      <div class="modal-actions">
        <button class="btn btn-primary" data-act="resume">Resume <span class="key">${world.coop ? 'ESC · START' : 'ESC'}</span></button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn btn-rose" data-act="quit">End run</button>
      </div>
    </div>`;
    this.bind(s, '[data-act="resume"]', () => this.cb.resume());
    this.bind(s, '[data-act="settings"]', () => this.showSettings(save, 'pause'));
    // A pause the game opened by itself (a controller dropped) ignores mashed confirm presses for a moment.
    if (note && !noteOk) {
      this.pauseGrace = 700;
      this.shownAt = performance.now();
    }
    this.bind(s, '[data-act="quit"]', () => this.cb.quitRun());
    this.show('pause');
    this.focusFirst('pause', '[data-act="resume"]');
  }

  showVictory(world: World): void {
    const s = this.screen('victory');
    s.className = 'screen modal scrim-heavy';
    this.coopMenus = world.coop;
    const v = STORY.victory;
    const score = world.coop
      ? `Your squad of ${world.players.length} held the line with <b class="num">${formatNumber(world.score)}</b> points. Fly on together into <b>Overtime</b> for more score, or cash out now.`
      : `You held the line with <b class="num">${formatNumber(world.score)}</b> points. Keep going into <b>Overtime</b> for more score, or cash out now.`;
    s.innerHTML = `<div class="panel modal-box victory-box">
      <div><div class="eyebrow">Victory · 10:00 survived${world.coop ? ' · squad victory' : ''}</div><h2 class="victory-title">${esc(v.title)}</h2></div>
      <div class="victory-text">${v.paragraphs.map((p, i) => `<p style="animation-delay:${(0.25 + i * 0.35).toFixed(2)}s">${esc(p)}</p>`).join('')}</div>
      <p class="victory-score">${score}</p>
      <div class="modal-actions">
        <button class="btn btn-primary" data-act="continue">Continue into Overtime</button>
        <button class="btn btn-gold" data-act="cashout">Cash out</button>
      </div>
    </div>`;
    this.bind(s, '[data-act="continue"]', () => this.cb.continueOvertime());
    this.bind(s, '[data-act="cashout"]', () => this.cb.cashOut());
    this.show('victory');
    this.focusFirst('victory', '[data-act="continue"]');
  }

  // ───────────────────────── Results ─────────────────────────

  showResults(sum: RunSummary, save: SaveData, touch: boolean, story: ResultsStory = { newLog: [] }): void {
    for (const t of this.resultTimers) window.clearTimeout(t);
    this.resultTimers = [];
    const r = sum.result;
    const s = this.screen('results');
    s.className = 'screen scrim-heavy';
    const coop = (r.players ?? 1) > 1 && !!r.team;
    this.coopMenus = coop;
    const killedBoss = r.bossesKilled.map((k) => ENEMIES[k].name).join(', ');
    const head = r.victory ? (coop ? 'Squad victory' : 'Victory') : story.retreat ? 'Retreated' : coop ? 'Squad down' : 'Ship lost';
    const stamps = [
      sum.newBest.score ? (coop ? 'NEW SQUAD BEST' : 'NEW BEST SCORE') : '',
      sum.daily?.best && r.daily ? 'DAILY BEST' : '',
      sum.newBest.time && !sum.newBest.score ? (coop ? 'LONGEST RUN · ANY MODE' : 'LONGEST RUN') : '',
    ].filter(Boolean);
    const goal = nextWorkshopGoal(save);
    const affordable = affordableUpgrades(save);
    const need = rankXpNeeded(save.rank);
    const missions = save.missions
      .map((m) => {
        const k = Math.min(1, m.progress / m.target);
        return `<div class="mission"><span class="m-text">${esc(missionText(m))}</span><span class="m-reward">+${missionReward(m.tier)} ◈</span><div class="meter"><i style="width:${(k * 100).toFixed(1)}%"></i></div></div>`;
      })
      .join('');
    const unlocks = [
      ...story.newLog.map(
        (e) =>
          `<div class="unlock log-unlock"><b>NEW LOG ENTRY</b><span>${esc(e.title)}</span><button class="btn btn-sm" data-log="${esc(e.id)}">Read</button></div>`,
      ),
      ...sum.rankUps.map((u) => `<div class="unlock"><b>RANK ${u.rank}</b><span>${esc(u.reward)}</span></div>`),
      ...sum.unlockedShips.map((id) => `<div class="unlock"><b>NEW SHIP</b><span>The ${esc(SHIPS[id].name)} has joined your fleet. Find it in the Hangar.</span></div>`),
      ...sum.achievements.map((a) => `<div class="unlock"><b>★</b><span>${esc(a.name)}: ${esc(a.text)}</span></div>`),
      ...sum.missionsCompleted.map((m) => `<div class="unlock"><b>✓</b><span>Mission complete: ${esc(m.text)}</span></div>`),
    ].join('');

    s.innerHTML = `<div class="sub">
      ${story.taunt ? `<div class="res-taunt" style="--cc:${story.taunt.speaker.color}">${portrait(story.taunt.speaker, 'md')}<div><div class="res-taunt-name">${esc(story.taunt.speaker.name)}</div><q>${esc(story.taunt.text)}</q></div></div>` : ''}
      <div class="results-head">
        <div>
          <div class="eyebrow">${head} · ${formatTime(r.time)}${coop ? ` · Co-op · ${r.players} captains` : ''}${r.daily ? ' · Daily Run' : ''}${r.hard ? ' · Nightmare' : ''}</div>
          <div class="big-score" id="res-score">0</div>
          <div class="dim">${
            coop
              ? sum.prevBest.score > 0
                ? `Team score · squad best (${r.players} captains) ${formatNumber(Math.max(sum.prevBest.score, r.score))}`
                : `Team score · first ${r.players}-captain squad record`
              : sum.prevBest.score > 0
                ? `Best ${formatNumber(Math.max(sum.prevBest.score, r.score))}`
                : 'Your first score on the board'
          }</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${stamps.map((t, i) => `<span class="stamp" style="animation-delay:${1.2 + i * 0.25}s">${t}</span>`).join('')}</div>
      </div>
      ${!story.taunt && story.quip ? `<div class="res-quip" style="--cc:${story.quip.speaker.color}">${portrait(story.quip.speaker, 'sm')}<div><span class="res-quip-name">${esc(story.quip.speaker.name)}</span><q>${esc(story.quip.text)}</q></div></div>` : ''}
      ${sum.nearMiss ? `<div class="near-miss">${esc(sum.nearMiss)}</div>` : ''}
      <div class="result-actions">
        <button class="btn btn-primary" data-act="again">Play again <span class="key">${touch ? 'TAP' : coop ? 'ENTER · E · Ⓐ' : 'ENTER'}</span></button>
        <button class="btn btn-gold" data-act="workshop"><span>Workshop</span><span class="meta">${affordable > 0 ? `<span class="badge">${affordable} READY</span>` : goal ? `${formatNumber(goal.missing)} ◈ to go` : ''}</span></button>
        <button class="btn" data-act="menu">Menu</button>
      </div>
      ${coop ? this.coopTable(r) : ''}
      <div class="results-grid">
        <div class="panel">
          <div class="kpis">
            <div class="kpi"><b>${formatTime(r.time)}</b><span>Survived</span></div>
            <div class="kpi"><b>${r.level}</b><span>Level</span></div>
            <div class="kpi"><b>${formatNumber(r.kills)}</b><span>Destroyed</span></div>
            <div class="kpi"><b>${formatNumber(r.maxCombo)}</b><span>Best combo</span></div>
            <div class="kpi"><b>${coop ? r.perfectsTeam ?? r.perfects : r.perfects}</b><span>Perfect dashes</span></div>
            <div class="kpi"><b>${r.bossesKilled.length}</b><span>Bosses</span></div>
          </div>
          ${killedBoss ? `<p class="dim" style="margin:12px 0 0">Defeated: ${esc(killedBoss)}</p>` : ''}
          <div style="margin-top:16px">
            <div class="rank-row"><span class="eyebrow">Rank ${save.rank}</span><span class="dim num">+${formatNumber(sum.rankXpGained)} XP</span></div>
            <div class="meter" style="--c: var(--violet);margin-top:6px"><i id="res-rank" style="width:${sum.rankUps.length ? 0 : ((sum.rankXpBefore / need) * 100).toFixed(1)}%"></i></div>
          </div>
        </div>
        <div class="panel">
          <h3 style="margin-bottom:8px">Cores earned</h3>
          <div id="res-rewards">${sum.rewards.map((l, i) => `<div class="reward-line" style="animation-delay:${0.4 + i * 0.18}s"><span class="label">${esc(l.label)}</span><b class="cores">${formatNumber(l.amount)}</b></div>`).join('')}</div>
          <div class="reward-total"><span>Total</span><span class="cores" id="res-total">0</span></div>
          <div class="dim" style="margin-top:6px">Balance <span class="cores">${formatNumber(save.cores)}</span></div>
        </div>
      </div>
      ${unlocks ? `<div style="display:grid;gap:8px">${unlocks}</div>` : ''}
      <div class="panel"><div class="rank-row"><h3>Missions</h3></div>${missions}</div>
    </div>`;

    this.lastRunDaily = r.daily;
    this.lastRunCoop = coop;
    this.bind(s, '[data-act="again"]', () => {
      if (this.inGrace()) return;
      if (coop) this.cb.again();
      else this.cb.play(r.daily);
    });
    this.bind(s, '[data-act="workshop"]', () => this.showWorkshop(save));
    this.bind(s, '[data-act="menu"]', () => this.cb.toTitle());
    this.bind(s, '[data-log]', (b) => this.showLog(save, { entry: b.dataset.log }));
    this.renderTopbar(save);
    this.show('results');

    this.focusFirst('results', '[data-act="again"]');

    // Count-up animations.
    const scoreEl = $(s, '#res-score');
    const totalEl = $(s, '#res-total');
    const dur = 1100;
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      scoreEl.textContent = formatNumber(r.score * e);
      totalEl.textContent = formatNumber(sum.totalCores * Math.min(1, k * 1.2));
      if (k < 1) {
        this.cb.sfx.countUp(e);
        requestAnimationFrame(step);
      } else if (sum.newBest.score) {
        this.cb.sfx.fanfare();
      }
    };
    requestAnimationFrame(step);
    const rankBar = s.querySelector<HTMLElement>('#res-rank');
    this.resultTimers.push(
      window.setTimeout(() => {
        if (rankBar) rankBar.style.width = `${((save.rankXp / need) * 100).toFixed(1)}%`;
        if (sum.rankUps.length) this.cb.sfx.rankUp();
      }, 900),
    );
  }

  /** Co-op results: one row per pilot plus a few friendly awards. */
  private coopTable(r: RunSummary['result']): string {
    const team = r.team ?? [];
    const awards: string[][] = team.map(() => []);
    const award = (label: string, value: (t: (typeof team)[number]) => number, min = 1) => {
      let best = -1;
      let bestV = -Infinity;
      let tie = false;
      team.forEach((t, i) => {
        const v = value(t);
        if (v > bestV) {
          bestV = v;
          best = i;
          tie = false;
        } else if (v === bestV) {
          tie = true;
        }
      });
      if (best >= 0 && !tie && bestV >= min) awards[best]!.push(label);
    };
    award('Top gun', (t) => t.kills);
    award('Heavy hitter', (t) => t.damage);
    award('Medic', (t) => t.revivesGiven);
    award('Daredevil', (t) => t.perfects, 3);
    const given = new Set(awards.flat());
    const legend = AWARDS.filter(([name]) => given.has(name))
      .map(([name, why]) => `<span><b>${esc(name)}</b> ${esc(why)}</span>`)
      .join('');
    const rows = team
      .map(
        (t, i) => `<tr style="--pc:${pilotColor(i)}">
          <td>${this.pilotTag(i, t.ship)}${awards[i]!.length ? `<span class="awards">${awards[i]!.map((a) => `<span class="award" title="${esc(awardWhy(a))}">${esc(a)}</span>`).join('')}</span>` : ''}</td>
          <td class="num">${formatNumber(t.kills)}</td>
          <td class="num">${formatNumber(t.damage)}</td>
          <td class="num">${t.perfects}</td>
          <td class="num">${t.downs}</td>
          <td class="num">${t.revivesGiven}</td>
        </tr>`,
      )
      .join('');
    return `<div class="panel coop-panel">
      <div class="rank-row"><h3>Squadron report</h3><span class="eyebrow">${team.length} captains</span></div>
      <div class="coop-scroll"><table class="coop-table">
        <thead><tr><th>Captain</th><th><span class="th-long">Destroyed</span><span class="th-short">Kills</span></th><th>Damage</th><th>Perfect</th><th>Downs</th><th>Revives</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${legend ? `<div class="award-legend">${legend}</div>` : ''}
    </div>`;
  }

  setCoresTopbar(save: SaveData): void {
    this.renderTopbar(save);
  }

  // ───────────────────────── Opening crawl ─────────────────────────

  /** Plays the opening briefing over the attract mode; `then` runs once it closes. */
  showCrawl(then: () => void): void {
    this.crawl?.close();
    const s = this.screen('crawl');
    s.className = 'screen crawl-screen';
    s.innerHTML = '';
    this.show('crawl');
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.crawl = new OpeningCrawl(s, {
      title: STORY.intro.title,
      paragraphs: STORY.intro.paragraphs,
      tick: () => this.cb.sfx.tick(0.25),
      onDone: () => {
        this.crawl = null;
        then();
      },
    });
  }

  get crawlOpen(): boolean {
    return !!this.crawl?.isOpen;
  }

  // ───────────────────────── Ship's Log ─────────────────────────

  private narrow(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 860px)').matches;
  }

  /** Closes the phone-width log reader sheet; returns true if one was open (never on wide layouts). */
  private closeLogReader(): boolean {
    const split = this.screen('log').querySelector('.log-split.reading');
    if (!split || !this.narrow()) return false;
    split.classList.remove('reading');
    this.screen('log').querySelector<HTMLElement>(`[data-entry="${this.logEntry ?? ''}"]`)?.focus({ preventScroll: true });
    return true;
  }

  showLog(save: SaveData, opts: { tab?: LogTab; entry?: string; read?: boolean } = {}): void {
    if (opts.tab) this.logTab = opts.tab;
    if (opts.entry) {
      this.logTab = 'entries';
      this.logEntry = opts.entry;
    }
    const s = this.screen('log');
    s.className = 'screen scrim-heavy';
    const rows = logbookView(save);
    const unlockedCount = rows.filter((r) => r.unlocked).length;
    if (!this.logEntry || !rows.some((r) => r.entry.id === this.logEntry)) {
      this.logEntry = (rows.find((r) => r.unlocked && !r.seen) ?? rows.find((r) => r.unlocked) ?? rows[0])?.entry.id ?? null;
    }
    // The reader is on screen on wide layouts, or when explicitly opened on narrow ones
    // (only there is it a sheet that Esc/back closes first).
    const reading = (!!opts.read || !!opts.entry) && this.narrow();
    const readerVisible = this.logTab === 'entries' && (reading || !this.narrow());
    const sel = rows.find((r) => r.entry.id === this.logEntry);
    if (readerVisible && sel?.unlocked && !sel.seen) {
      markLogSeen(save, sel.entry.id);
      sel.seen = true;
      this.cb.storyChanged();
    }

    const tabs: [LogTab, string, string][] = [
      ['entries', 'Entries', `${unlockedCount}/${rows.length}`],
      ['cast', 'Crew & cast', String(STORY.characters.length)],
      ['fleet', 'Vessels', String(SHIP_IDS.length)],
    ];
    const tabHtml = tabs
      .map(
        ([id, label, meta]) =>
          `<button class="tab${this.logTab === id ? ' on' : ''}" role="tab" aria-selected="${this.logTab === id}" data-tab="${id}"><span>${label}</span><span class="tab-meta">${
            id === 'entries' && unseenLogCount(save) > 0 ? `<span class="badge badge-ice">${unseenLogCount(save)} NEW</span>` : `<span class="count">${meta}</span>`
          }</span></button>`,
      )
      .join('');

    let body = '';
    if (this.logTab === 'entries') body = this.logEntriesHtml(rows, reading);
    else if (this.logTab === 'cast') body = this.castHtml();
    else body = this.fleetHtml(save);

    s.innerHTML = `<div class="sub log-screen">
      <div class="sub-head"><div><div class="eyebrow">Allied Beacon Fleet · Archives</div><h2>Ship's Log</h2></div>
        <div class="head-actions"><button class="btn btn-sm btn-violet" data-act="intro"><span>Replay briefing</span><span aria-hidden="true">▶</span></button><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div></div>
      <div class="tabs" role="tablist">${tabHtml}</div>
      ${body}
    </div>`;

    this.bind(s, '[data-act="back"]', () => this.cb.toTitle());
    this.bind(s, '[data-act="intro"]', () => this.showCrawl(() => this.showLog(save)));
    this.bind(s, '[data-tab]', (b) => {
      this.logTab = b.dataset.tab as LogTab;
      this.showLog(save);
      this.focusFirst('log', `[data-tab="${this.logTab}"]`);
    });
    this.bind(s, '[data-entry]', (b) => {
      this.logEntry = b.dataset.entry!;
      this.showLog(save, { read: true });
      const reader = this.narrow() ? s.querySelector<HTMLElement>('[data-act="close-reader"]') : s.querySelector<HTMLElement>(`[data-entry="${this.logEntry}"]`);
      reader?.focus({ preventScroll: true });
    });
    this.bind(s, '[data-act="close-reader"]', () => this.closeLogReader());
    s.querySelectorAll<HTMLElement>('[data-art]').forEach((n) => {
      const id = n.dataset.art as ShipId;
      n.appendChild(this.shipArt(isShipUnlocked(save, id) ? SHIPS[id].color : '#4a4a66'));
    });
    this.renderTopbar(save);
    const wasLog = this.current === 'log';
    this.show('log');
    if (!wasLog) this.focusFirst('log', opts.entry ? `[data-entry="${opts.entry}"]` : `[data-tab="${this.logTab}"]`);
  }

  private logEntriesHtml(rows: ReturnType<typeof logbookView>, reading: boolean): string {
    const list = rows
      .map((r, i) => {
        const id = r.entry.id;
        const [cur, goal] = r.progress;
        const status = r.unlocked
          ? r.seen
            ? ''
            : '<span class="badge badge-ice">NEW</span>'
          : `<span class="log-lock" aria-label="Locked">🔒</span>`;
        return `<button class="log-row${r.unlocked ? '' : ' locked'}${id === this.logEntry ? ' sel' : ''}" data-entry="${esc(id)}">
          <span class="log-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="log-row-main"><span class="log-row-title">${esc(r.entry.title)}</span>${
            r.unlocked ? '' : `<span class="log-hint">${esc(logbookHint(r.entry))}</span><span class="meter"><i style="width:${(logbookFraction(r.entry, cur, goal) * 100).toFixed(1)}%"></i></span>`
          }</span>${status}
        </button>`;
      })
      .join('');
    const idx = rows.findIndex((r) => r.entry.id === this.logEntry);
    const sel = rows[idx];
    let reader = '';
    if (sel) {
      const num = String(idx + 1).padStart(2, '0');
      if (sel.unlocked) {
        reader = `<div class="eyebrow">Entry ${num} · Ship's log</div>
          <h3 class="log-title">${esc(sel.entry.title)}</h3>
          <p class="log-text">${esc(sel.entry.text)}</p>
          <div class="log-sign">End of entry. Allied Beacon Fleet archives.</div>`;
      } else {
        const [cur, goal] = sel.progress;
        reader = `<div class="eyebrow">Entry ${num} · Encrypted</div>
          <h3 class="log-title">${esc(sel.entry.title)}</h3>
          <div class="log-cipher" aria-hidden="true">${cipher(sel.entry.text)}</div>
          <p class="log-unlock-hint"><b>To decrypt:</b> ${esc(logbookHint(sel.entry))}</p>
          ${progressLabel(sel.entry, cur, goal) ? `<div class="rank-row"><span class="eyebrow">Progress</span><span class="dim num">${progressLabel(sel.entry, cur, goal)}</span></div>` : ''}
          <div class="meter"><i style="width:${(logbookFraction(sel.entry, cur, goal) * 100).toFixed(1)}%"></i></div>`;
      }
    }
    return `<div class="log-split${reading ? ' reading' : ''}">
      <div class="log-list">${list}</div>
      <article class="panel log-reader" tabindex="0">
        <button class="btn btn-sm log-close" data-act="close-reader">Close</button>
        ${reader}
      </article>
    </div>`;
  }

  private castHtml(): string {
    const group = (title: string, ids: string[]) => {
      const cards = ids
        .map((id) => characterById(id))
        .filter((c): c is CharacterDef => !!c)
        .map(
          (c) => {
            const quote = signatureLine(c.id);
            // Focusable so keyboard/gamepad navigation can scroll through the cast.
            return `<div class="panel cast-card" tabindex="0" style="--cc:${c.color}">
            ${portrait(c, 'md')}
            <div><h3>${esc(c.name)}</h3><div class="cast-role">${esc(castRole(c))}</div>${quote ? `<q class="cast-quote">${esc(quote)}</q>` : ''}</div>
          </div>`;
          },
        )
        .join('');
      return `<section class="cast-group"><div class="eyebrow">${esc(title)}</div><div class="grid-cards">${cards}</div></section>`;
    };
    const captains = SHIP_IDS.map((s) => STORY.pilots[s]);
    const lattice = [STORY.villainId, 'warden', 'hydra', 'voidheart'];
    const crew = STORY.characters.map((c) => c.id).filter((id) => !captains.includes(id) && !lattice.includes(id));
    return `<div class="cast">
      ${group('Bridge crew', crew)}
      ${group('Captains of the fleet', captains)}
      ${group(STORY.enemyName, lattice)}
    </div>`;
  }

  private fleetHtml(save: SaveData): string {
    const cards = SHIP_IDS.map((id) => {
      const def = SHIPS[id];
      const v = STORY.vessels[id];
      const cap = characterById(STORY.pilots[id]);
      const unlocked = isShipUnlocked(save, id);
      return `<div class="panel card ship-card vessel${unlocked ? '' : ' locked'}" tabindex="0" style="--sc:${def.color}">
        <div class="ship-art" data-art="${id}"></div>
        <div class="ship-class">${esc(v.className)}</div>
        <h3 style="color:${def.color}">${esc(def.name)}</h3>
        ${cap ? `<div class="ship-captain">${portrait(cap, 'sm')}<span>${esc(cap.name)}</span></div>` : ''}
        <p class="ship-blurb">${esc(v.blurb)}</p>
        <div class="vessel-status">${unlocked ? 'In service' : `🔒 ${esc(def.unlockText)}`}</div>
      </div>`;
    }).join('');
    return `<p class="dim log-fleet-intro">${esc(STORY.fleetName)}: five small ships against ${esc(STORY.enemyName.replace(/^The /, 'the '))}. Choose yours in the Hangar.</p>
      <div class="grid-cards fleet">${cards}</div>`;
  }
}

/** A character's glyph in a chamfered portrait chip tinted with their colour. */
export function portrait(c: CharacterDef, size: 'sm' | 'md' | 'lg'): string {
  return `<span class="portrait ${size}" style="--cc:${c.color}" aria-hidden="true">${esc(c.glyph)}</span>`;
}

/** Progress text for a locked log entry ('' for yes/no unlocks). */
function progressLabel(entry: LogbookEntry, cur: number, goal: number): string {
  const k = entry.unlock.kind;
  if (k === 'boss' || k === 'ship') return '';
  if (k === 'time') return `${formatTime(cur)} / ${formatTime(goal)}`;
  return `${formatNumber(cur)} / ${formatNumber(goal)}`;
}

/** Scrambled stand-in text for an encrypted entry (stable per entry, keeps word shapes). */
function cipher(text: string): string {
  const glyphs = '▚▞▙▟▛▜░▒▓◇◈⌧';
  let h = 7;
  const words = text.split(/\s+/).slice(0, 34);
  return words
    .map((w) =>
      [...w]
        .map((ch) => {
          h = (h * 31 + ch.charCodeAt(0)) % 9973;
          return glyphs[h % glyphs.length];
        })
        .join(''),
    )
    .join(' ');
}
