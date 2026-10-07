/**
 * In-run comms panel: shows the StoryDirector's current CommsMessage as a
 * non-blocking DOM overlay (portrait glyph in the speaker's colour, name and
 * role, typewriter text, a thin timer bar).
 *
 * Placement (see style.css, "Comms"): bottom-centre on landscape screens, in
 * the band between the touch joystick (bottom-left) and the DASH button
 * (bottom-right); on portrait screens it docks under the canvas HUD's top rows.
 * It never takes pointer events, so touch steering works straight through it.
 */
import { PRIORITY, type CommsMessage } from '../story/director';
import type { ChatterMode } from '../meta/save';
import type { ShipId } from '../game/types';
import { el, esc } from './dom';

/** Speakers on the Lattice side (hostile styling). */
const HOSTILE = new Set(['facetius', 'warden', 'hydra', 'voidheart']);

/** Characters per second of the typewriter reveal (story lines are a touch slower). */
const TYPE_CPS = [70, 60, 48];

/** "Captain of the Glimmer of Hope (spark)" -> "Captain of the Glimmer of Hope". */
export function shortRole(role: string): string {
  return role.split(';')[0]!.replace(/\s*\([^)]*\)/g, '').trim();
}

/** Whether a message passes the "Crew chatter" setting. */
export function chatterAllows(mode: ChatterMode, msg: Pick<CommsMessage, 'priority'>): boolean {
  if (mode === 'off') return false;
  if (mode === 'important') return msg.priority >= PRIORITY.rare;
  return true;
}

let reducedQuery: MediaQueryList | null | undefined;

/** Live prefers-reduced-motion check (the media query list is created once and stays current). */
export function prefersReducedMotion(): boolean {
  if (reducedQuery === undefined) {
    try {
      reducedQuery = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    } catch {
      reducedQuery = null;
    }
  }
  return !!reducedQuery?.matches;
}

export class CommsPanel {
  readonly root: HTMLElement;
  private shownId: string | null = null;
  private textShown!: HTMLElement;
  private textRest!: HTMLElement;
  private timerEl!: HTMLElement;
  private live: HTMLElement;
  private full = '';
  private typed = -1;
  private hideTimer = 0;
  /** Ships per player index (co-op tags the speaking captain with P1..P4). */
  private ships: readonly ShipId[] = [];
  private coop = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = el('<div id="comms" class="comms" aria-hidden="true" hidden></div>');
    parent.appendChild(this.root);
    // Screen readers get each line once, in full (the typewriter would spam them).
    this.live = el('<div class="sr-only" role="status" aria-live="polite"></div>');
    parent.appendChild(this.live);
  }

  /** The pilots of the current run (call at run start). */
  setRun(ships: readonly ShipId[], coop: boolean): void {
    this.ships = ships;
    this.coop = coop;
  }

  get visibleId(): string | null {
    return this.shownId;
  }

  /**
   * Shows `msg` (idempotent per message id) `elapsed` seconds into its time on
   * screen; drives the typewriter and the timer bar from that clock, so the
   * panel freezes while the run is paused.
   */
  show(msg: CommsMessage, elapsed: number): void {
    if (msg.id !== this.shownId) this.mount(msg);
    const reduced = prefersReducedMotion();
    const cps = TYPE_CPS[msg.priority] ?? 60;
    const n = reduced ? this.full.length : Math.min(this.full.length, Math.floor(Math.max(0, elapsed - 0.12) * cps));
    if (n !== this.typed) {
      this.typed = n;
      // Unrevealed text stays in the layout (invisible), so the panel never reflows while typing.
      const chars = [...this.full];
      this.textShown.textContent = chars.slice(0, n).join('');
      this.textRest.textContent = chars.slice(n).join('');
      this.root.classList.toggle('typing', n < chars.length);
    }
    const k = msg.duration > 0 ? Math.min(1, Math.max(0, elapsed / msg.duration)) : 1;
    this.timerEl.style.transform = `scaleX(${(1 - k).toFixed(3)})`;
  }

  /** Fades the panel out (no-op when nothing is shown). */
  hide(): void {
    if (this.shownId === null) return;
    this.shownId = null;
    this.root.classList.remove('in');
    this.root.classList.add('out');
    document.body.classList.remove('comms-on');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.shownId === null) this.root.hidden = true;
    }, prefersReducedMotion() ? 0 : 260);
  }

  /** Hides immediately (run ended, menus). */
  clear(): void {
    this.shownId = null;
    window.clearTimeout(this.hideTimer);
    this.root.hidden = true;
    this.root.classList.remove('in', 'out');
    document.body.classList.remove('comms-on');
  }

  private mount(msg: CommsMessage): void {
    window.clearTimeout(this.hideTimer);
    this.shownId = msg.id;
    this.full = msg.text;
    this.typed = -1;
    const sp = msg.speaker;
    const hostile = HOSTILE.has(sp.id);
    const prio = msg.priority === PRIORITY.story ? 'story' : msg.priority === PRIORITY.rare ? 'rare' : 'common';
    let tag = '';
    if (this.coop && msg.ship) {
      const idx = this.ships.indexOf(msg.ship);
      if (idx >= 0) tag = `<span class="comms-tag">P${idx + 1}</span>`;
    }
    const eyebrow = prio === 'story' ? `<span class="comms-eyebrow">${hostile ? 'Hostile transmission' : 'Incoming transmission'}</span>` : '';
    this.root.className = `comms prio-${prio}${hostile ? ' hostile' : ''}`;
    this.root.style.setProperty('--cc', sp.color);
    this.root.dataset.speaker = sp.id;
    this.root.dataset.source = msg.source;
    this.root.innerHTML = `
      <div class="comms-portrait"><span class="comms-glyph">${esc(sp.glyph)}</span></div>
      <div class="comms-body">
        ${eyebrow}
        <div class="comms-head"><b class="comms-name">${esc(sp.name)}</b>${tag}<span class="comms-role">${esc(shortRole(sp.role))}</span></div>
        <p class="comms-text"><span class="shown"></span><span class="rest"></span></p>
      </div>
      <i class="comms-timer"></i>`;
    this.textShown = this.root.querySelector('.shown')!;
    this.textRest = this.root.querySelector('.rest')!;
    this.timerEl = this.root.querySelector('.comms-timer')!;
    this.root.hidden = false;
    // Restart the entrance animation for every new line.
    void this.root.offsetWidth;
    this.root.classList.add('in');
    document.body.classList.add('comms-on');
    this.live.textContent = `${sp.name}: ${msg.text}`;
  }
}
