import { formatNumber, formatTime } from '../core/math';
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
import { affordableUpgrades, isShipUnlocked, nextCost, nextWorkshopGoal, workshopLevel, type RunSummary } from '../meta/progression';
import { HARD_MODE_RANK, TRAILS, rankXpNeeded } from '../meta/rank';
import type { SaveData, Settings, TrailId } from '../meta/save';
import { SpriteCache } from '../render/sprites';
import { $, el, esc, focusables, moveFocus, pips } from './dom';

export type ScreenId = 'title' | 'hangar' | 'workshop' | 'records' | 'settings' | 'levelup' | 'pause' | 'victory' | 'results' | 'hud';

export interface UiCallbacks {
  play(daily: boolean): void;
  pick(index: number): void;
  reroll(): void;
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
  private lastRunDaily = false;

  constructor(root: HTMLElement, cb: UiCallbacks) {
    this.cb = cb;
    const ids: ScreenId[] = ['title', 'hangar', 'workshop', 'records', 'settings', 'levelup', 'pause', 'victory', 'results'];
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
      if (e.code === 'Space' && (this.current === 'levelup' || this.current === 'results')) e.preventDefault();
    });
  }

  // ───────────────────────── plumbing ─────────────────────────

  private show(id: ScreenId | 'hud'): void {
    for (const [sid, s] of this.screens) s.hidden = sid !== id;
    if (this.current !== id) this.shownAt = performance.now();
    this.current = id;
    this.pauseBtn.hidden = id !== 'hud';
    this.tutorialEl.style.visibility = id === 'hud' ? 'visible' : 'hidden';
    this.topbar.hidden = !(id === 'title' || id === 'hangar' || id === 'workshop' || id === 'records');
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
    const grace = this.current === 'levelup' ? 350 : this.current === 'results' ? 900 : 0;
    return performance.now() - this.shownAt < grace;
  }

  private onKey(e: KeyboardEvent): void {
    const id = this.current;
    if (id === 'hud') return;
    const s = this.screen(id as ScreenId);
    const activates = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
    if ((id === 'levelup' || id === 'results') && (e.code === 'Space' || (activates && (e.repeat || this.inGrace())))) {
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
      else if (id === 'hangar' || id === 'workshop' || id === 'records') this.cb.toTitle();
      return;
    }
    if (id === 'title' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement === document.body) {
      e.preventDefault();
      this.cb.play(false);
      return;
    }
    if (id === 'results' && e.code === 'Enter' && document.activeElement === document.body) {
      e.preventDefault();
      this.cb.play(this.lastRunDaily);
    }
  }

  /** Gamepad navigation for menus. */
  padNav(nav: { up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; back: boolean; alt: boolean }): void {
    const id = this.current;
    if (id === 'hud') return;
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
    if (nav.back) {
      if (id === 'pause') this.cb.resume();
      else if (id === 'settings') this.back();
      else if (id === 'hangar' || id === 'workshop' || id === 'records') this.cb.toTitle();
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

  showTitle(save: SaveData, daily: DailyInfo, touch: boolean): void {
    const s = this.screen('title');
    const streak = currentStreak(save);
    const played = playedDailyToday(save);
    const need = rankXpNeeded(save.rank);
    const affordable = affordableUpgrades(save);
    const ship = SHIPS[save.ship];
    const best = save.stats.bestScore;
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
        <h1 class="logo"><span>NEON SURVIVAL</span>SHARD<br/>STORM</h1>
        <p class="tagline">Weapons fire on their own. You steer, dash straight through the swarm, and chain kills into a combo. Survive 10:00.</p>
        <button class="btn btn-primary" data-act="play">Play <span class="key">${touch ? 'TAP' : 'ENTER'}</span></button>
        <div class="menu-grid">
          <button class="btn btn-gold wide" data-act="daily">
            <span>Daily Run</span>
            <span class="meta">${esc(daily.modifier.name)} · ${played ? `best ${formatNumber(save.daily.best[daily.date] ?? 0)}` : `+${dailyBonus(streak + 1)} ◈`}${streak > 0 ? ` · <span class="streak">🔥 ${streak}</span>` : ''}</span>
          </button>
          <button class="btn" data-act="hangar"><span>Hangar</span><span class="meta">${esc(ship.name)}</span></button>
          <button class="btn" data-act="workshop"><span>Workshop</span><span class="meta">${affordable > 0 ? `<span class="badge">${affordable} READY</span>` : `◈ ${formatNumber(save.cores)}`}</span></button>
          <button class="btn" data-act="records"><span>Records</span><span class="meta">${Object.keys(save.achievements).length}/${ACHIEVEMENTS.length}</span></button>
          <button class="btn" data-act="settings"><span>Settings</span><span class="meta"></span></button>
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
    this.bind(s, '[data-act="hangar"]', () => this.showHangar(save));
    this.bind(s, '[data-act="workshop"]', () => this.showWorkshop(save));
    this.bind(s, '[data-act="records"]', () => this.showRecords(save));
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
      return `<div class="panel card ship-card${save.ship === id ? ' selected' : ''}${unlocked ? '' : ' locked'}" data-ship="${id}">
        <div class="ship-art" data-art="${id}"></div>
        <div class="row"><h3 style="color:${def.color}">${esc(def.name)}</h3>${save.ship === id ? '<span class="badge badge-ice">SELECTED</span>' : ''}</div>
        <div class="desc">${esc(def.trait)}<br/><span class="dim">Starts with <b style="color:${w.color}">${esc(w.name)}</b></span></div>
        ${
          unlocked
            ? `<button class="btn btn-sm" data-select="${id}" ${save.ship === id ? 'disabled' : ''}>${save.ship === id ? 'Selected' : 'Select'}</button>`
            : `<div class="dim">🔒 ${esc(def.unlockText)}${prog ? ` <span class="num">(${prog[0]}/${prog[1]})</span>` : ''}</div>`
        }
      </div>`;
    }).join('');
    s.innerHTML = `<div class="sub">
      <div class="sub-head"><div><div class="eyebrow">Choose your ship</div><h2>Hangar</h2></div><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div>
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
      ['Longest run', formatTime(st.bestTime)],
      ['Best combo', formatNumber(st.bestCombo)],
      ['Highest level', String(st.bestLevel)],
      ['Enemies destroyed', formatNumber(st.kills)],
      ['Bosses defeated', formatNumber(st.bossKills)],
      ['Perfect dashes', formatNumber(st.perfects)],
      ['Weapons evolved', formatNumber(st.evolutions)],
      ['Victories', formatNumber(st.victories)],
      ['Cores earned', formatNumber(st.coresEarned)],
      ['Time in the storm', formatTime(st.timePlayed)],
    ];
    const ach = ACHIEVEMENTS.map((a) => {
      const got = !!save.achievements[a.id];
      const prog = !got && a.progress ? a.progress(save) : null;
      return `<div class="panel ach ${got ? 'unlocked' : 'locked'}"><div class="glyph">${got ? '★' : '☆'}</div><div><h3>${esc(a.name)}</h3><div class="dim">${esc(a.text)}${prog ? ` <span class="num">(${formatNumber(prog[0])}/${formatNumber(prog[1])})</span>` : ''}</div></div></div>`;
    }).join('');
    const hist = save.history.slice(-24);
    const maxScore = Math.max(1, ...hist.map((h) => h.score));
    const bars = hist.map((h, i) => `<i class="${i === hist.length - 1 ? 'last' : ''}" style="height:${Math.max(4, (h.score / maxScore) * 100)}%" title="${formatNumber(h.score)}"></i>`).join('');
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
    s.innerHTML = `<div class="sub">
      <div class="sub-head"><div><div class="eyebrow">Options</div><h2>Settings</h2></div><button class="btn btn-sm" data-act="back">Back <span class="key">ESC</span></button></div>
      <div class="panel settings-list">
        ${slider('master', 'Master volume', st.master)}
        ${slider('music', 'Music', st.music)}
        ${slider('sfx', 'Sound effects', st.sfx)}
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

  showLevelUp(offers: Offer[], opts: { cache: boolean; rerolls: number; level: number; world: World; reroll?: boolean }): void {
    this.offers = offers;
    if (!opts.reroll) this.shownAt = performance.now();
    const s = this.screen('levelup');
    s.className = 'screen scrim-heavy';
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
            const owned = (opts.world.build.passives[partner as PassiveId] ?? 0) > 0;
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
          <div class="o-foot">${foot}<span class="key">${i + 1}</span></div>
        </button>`;
      })
      .join('');
    s.innerHTML = `
      <div class="lu-head${opts.cache ? ' cache' : ''}"><div class="eyebrow">${opts.cache ? 'Elite cache opened' : `Level ${opts.level}`}</div><h2>${opts.cache ? 'CACHE' : 'LEVEL UP'}</h2></div>
      <div class="offers">${cards}</div>
      <div class="lu-actions">
        <button class="btn btn-sm btn-violet" data-act="reroll" ${opts.rerolls > 0 ? '' : 'disabled'}><span>Reroll (${opts.rerolls})</span><span class="key">R</span></button>
      </div>`;
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

  offerAt(i: number): Offer | undefined {
    return this.offers[i];
  }

  // ───────────────────────── Pause / victory ─────────────────────────

  showPause(world: World, save: SaveData): void {
    const s = this.screen('pause');
    s.className = 'screen modal scrim-heavy';
    const build = [
      ...world.build.weapons.map((w) => `<span style="color:${w.evolved ? 'var(--gold)' : WEAPONS[w.id].color}">${esc(w.evolved ? WEAPONS[w.id].evolvedName : WEAPONS[w.id].name)} ${w.evolved ? '★' : `LV${w.level}`}</span>`),
      ...(Object.keys(world.build.passives) as PassiveId[]).map((id) => `<span style="color:${PASSIVES[id].color}">${esc(PASSIVES[id].name)} LV${world.build.passives[id]}</span>`),
      ...world.build.relics.map((id) => `<span style="color:${RARITY_COLOR[RELICS[id].rarity]}">${esc(RELICS[id].name)}</span>`),
    ].join('');
    s.innerHTML = `<div class="panel modal-box">
      <div><div class="eyebrow">${formatTime(world.time)} · Level ${world.level} · ${formatNumber(world.score)} pts</div><h2>Paused</h2></div>
      <div class="build-list">${build}</div>
      <div class="modal-actions">
        <button class="btn btn-primary" data-act="resume">Resume <span class="key">ESC</span></button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn btn-rose" data-act="quit">End run</button>
      </div>
    </div>`;
    this.bind(s, '[data-act="resume"]', () => this.cb.resume());
    this.bind(s, '[data-act="settings"]', () => this.showSettings(save, 'pause'));
    this.bind(s, '[data-act="quit"]', () => this.cb.quitRun());
    this.show('pause');
    this.focusFirst('pause', '[data-act="resume"]');
  }

  showVictory(world: World): void {
    const s = this.screen('victory');
    s.className = 'screen modal scrim-heavy';
    s.innerHTML = `<div class="panel modal-box">
      <div><div class="eyebrow">10:00 survived</div><h2 style="color:var(--gold)">Victory</h2></div>
      <p>You outlasted the storm with <b class="num">${formatNumber(world.score)}</b> points. Keep going into <b>Overtime</b> for more score, or cash out now.</p>
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

  showResults(sum: RunSummary, save: SaveData, touch: boolean): void {
    for (const t of this.resultTimers) window.clearTimeout(t);
    this.resultTimers = [];
    const r = sum.result;
    const s = this.screen('results');
    s.className = 'screen scrim-heavy';
    const killedBoss = r.bossesKilled.map((k) => ENEMIES[k].name).join(', ');
    const head = r.victory ? 'Victory' : 'Run over';
    const stamps = [
      sum.newBest.score ? 'NEW BEST SCORE' : '',
      sum.daily?.best && r.daily ? 'DAILY BEST' : '',
      sum.newBest.time && !sum.newBest.score ? 'LONGEST RUN' : '',
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
      ...sum.rankUps.map((u) => `<div class="unlock"><b>RANK ${u.rank}</b><span>${esc(u.reward)}</span></div>`),
      ...sum.unlockedShips.map((id) => `<div class="unlock"><b>NEW SHIP</b><span>${esc(SHIPS[id].name)} is ready in the Hangar</span></div>`),
      ...sum.achievements.map((a) => `<div class="unlock"><b>★</b><span>${esc(a.name)}: ${esc(a.text)}</span></div>`),
      ...sum.missionsCompleted.map((m) => `<div class="unlock"><b>✓</b><span>Mission complete: ${esc(m.text)}</span></div>`),
    ].join('');

    s.innerHTML = `<div class="sub">
      <div class="results-head">
        <div>
          <div class="eyebrow">${head} · ${formatTime(r.time)}${r.daily ? ' · Daily Run' : ''}${r.hard ? ' · Nightmare' : ''}</div>
          <div class="big-score" id="res-score">0</div>
          <div class="dim">${sum.prevBest.score > 0 ? `Best ${formatNumber(Math.max(sum.prevBest.score, r.score))}` : 'Your first score on the board'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${stamps.map((t, i) => `<span class="stamp" style="animation-delay:${1.2 + i * 0.25}s">${t}</span>`).join('')}</div>
      </div>
      ${sum.nearMiss ? `<div class="near-miss">${esc(sum.nearMiss)}</div>` : ''}
      <div class="result-actions">
        <button class="btn btn-primary" data-act="again">Play again <span class="key">${touch ? 'TAP' : 'ENTER'}</span></button>
        <button class="btn btn-gold" data-act="workshop"><span>Workshop</span><span class="meta">${affordable > 0 ? `<span class="badge">${affordable} READY</span>` : goal ? `${formatNumber(goal.missing)} ◈ to go` : ''}</span></button>
        <button class="btn" data-act="menu">Menu</button>
      </div>
      <div class="results-grid">
        <div class="panel">
          <div class="kpis">
            <div class="kpi"><b>${formatTime(r.time)}</b><span>Survived</span></div>
            <div class="kpi"><b>${r.level}</b><span>Level</span></div>
            <div class="kpi"><b>${formatNumber(r.kills)}</b><span>Destroyed</span></div>
            <div class="kpi"><b>${formatNumber(r.maxCombo)}</b><span>Best combo</span></div>
            <div class="kpi"><b>${r.perfects}</b><span>Perfect dashes</span></div>
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
    this.bind(s, '[data-act="again"]', () => {
      if (!this.inGrace()) this.cb.play(r.daily);
    });
    this.bind(s, '[data-act="workshop"]', () => this.showWorkshop(save));
    this.bind(s, '[data-act="menu"]', () => this.cb.toTitle());
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

  setCoresTopbar(save: SaveData): void {
    this.renderTopbar(save);
  }
}
