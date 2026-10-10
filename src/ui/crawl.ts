/**
 * Opening crawl: a paced fleet briefing over the attract-mode battle.
 *
 * Letterbox bars slide in, a "priority briefing" header types on, then each
 * paragraph sweeps in word by word while the column drifts up like a
 * teleprompter (the newest paragraph stays centred, older ones dim). The
 * SHARDSTORM logo and a "Take the helm" button close it out.
 *
 * Any key, click or tap skips it once a short grace period has passed.
 * With prefers-reduced-motion everything is shown at once, without movement.
 */
import { el, esc } from './dom';
import { prefersReducedMotion } from './comms';

export interface CrawlOptions {
  title: string;
  paragraphs: readonly string[];
  /** Called once when the crawl closes (skipped or finished). */
  onDone(): void;
  /** Soft tick per revealed paragraph (optional). */
  tick?(): void;
  /** Label of the closing button. */
  cta?: string;
}

/** Seconds a paragraph holds the stage before the next one starts. */
export function paragraphHold(text: string): number {
  return Math.min(8.5, 2.2 + text.length * 0.042);
}

/** Grace period (ms) before input can skip the crawl. */
export const CRAWL_GRACE_MS = 700;

export class OpeningCrawl {
  readonly root: HTMLElement;
  private timers: number[] = [];
  private done = false;
  private readonly openedAt = performance.now();
  private readonly reduced = prefersReducedMotion();
  private readonly coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  private readonly onKey = (e: KeyboardEvent) => this.input(e);
  private readonly onPointer = (e: Event) => this.input(e);

  constructor(
    parent: HTMLElement,
    private readonly opts: CrawlOptions,
  ) {
    const words = (p: string, delay0: number) =>
      p
        .split(/\s+/)
        .map((w, i) => `<span class="cw" style="animation-delay:${(delay0 + i * 0.045).toFixed(3)}s">${esc(w)}</span>`)
        .join(' ');
    const paras = opts.paragraphs.map((p, i) => `<p class="crawl-p" data-i="${i}">${words(p, 0)}</p>`).join('');
    this.root = el(`<div id="crawl" class="crawl${this.reduced ? ' reduced' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
      <i class="crawl-bar top"></i><i class="crawl-bar bottom"></i>
      <div class="crawl-stage">
        <div class="crawl-col">
          <div class="crawl-head">
            <span class="eyebrow">Allied Beacon Fleet · Priority briefing</span>
            <span class="crawl-meta">All captains · All stations · Battle-day one</span>
          </div>
          <h2 class="crawl-title">${esc(opts.title)}</h2>
          <div class="crawl-paras">${paras}</div>
          <div class="crawl-end">
            <div class="crawl-logo" aria-hidden="true"><span>Versus the crystal armada</span>SHARDSTORM</div>
            <button class="btn btn-primary" data-act="helm">${esc(opts.cta ?? 'Take the helm')} <span class="key">${this.coarse ? 'TAP' : this.reduced ? 'ENTER' : 'ANY KEY'}</span></button>
          </div>
        </div>
      </div>
      <button class="crawl-skip" data-act="skip"><span class="key">${this.coarse ? 'TAP' : this.reduced ? 'ESC' : 'ANY KEY'}</span> Skip briefing</button>
    </div>`);
    parent.appendChild(this.root);
    window.addEventListener('keydown', this.onKey, { capture: true });
    // Close on `click`, not `pointerdown`: on touch screens the click that follows a
    // tap would otherwise land on whatever screen appears underneath the crawl.
    this.root.addEventListener('click', this.onPointer);
    this.run();
  }

  get isOpen(): boolean {
    return !this.done;
  }

  /** Closes the crawl (also used by gamepad confirm/back). */
  skip(): void {
    if (this.done || performance.now() - this.openedAt < CRAWL_GRACE_MS) return;
    this.close();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    for (const t of this.timers) window.clearTimeout(t);
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.root.classList.add('leaving');
    window.setTimeout(() => this.root.remove(), this.reduced ? 0 : 420);
    this.opts.onDone();
  }

  private input(e: Event): void {
    // Reduced motion shows a static, scrollable page: only its buttons close it on touch/click.
    if (this.reduced && !(e instanceof KeyboardEvent) && !(e.target as HTMLElement | null)?.closest?.('button')) return;
    if (e instanceof KeyboardEvent) {
      // Modifier-only presses, browser/OS shortcuts and function keys pass straight through.
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key)) return;
      // The reduced-motion page scrolls with the arrow / page keys.
      if (this.reduced && !['Escape', 'Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
    }
    this.skip();
  }

  private at(sec: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, sec * 1000));
  }

  private run(): void {
    const ps = Array.from(this.root.querySelectorAll<HTMLElement>('.crawl-p'));
    if (this.reduced) {
      this.root.classList.add('on', 'head-on', 'ended');
      ps.forEach((p) => p.classList.add('on'));
      return;
    }
    this.at(0.05, () => this.root.classList.add('on'));
    this.at(0.6, () => this.root.classList.add('head-on'));
    let t = 1.6;
    ps.forEach((_p, i) => {
      this.at(t, () => this.reveal(ps, i));
      t += paragraphHold(this.opts.paragraphs[i] ?? '');
    });
    this.at(t, () => {
      this.root.classList.add('ended');
      this.centre(this.root.querySelector<HTMLElement>('.crawl-end'));
      this.opts.tick?.();
    });
  }

  private reveal(ps: HTMLElement[], i: number): void {
    ps.forEach((p, j) => {
      p.classList.toggle('on', j <= i);
      p.classList.toggle('past', j < i);
    });
    this.centre(ps[i] ?? null);
    this.opts.tick?.();
  }

  /** Drifts the column so `target` sits a little below the middle of the stage. */
  private centre(target: HTMLElement | null): void {
    const col = this.root.querySelector<HTMLElement>('.crawl-col');
    const stage = this.root.querySelector<HTMLElement>('.crawl-stage');
    if (!col || !stage || !target) return;
    const want = stage.clientHeight * 0.56 - (target.offsetTop + target.offsetHeight / 2);
    // Never push the top of the column below its resting place.
    const y = Math.min(0, want);
    col.style.transform = `translateY(${y.toFixed(1)}px)`;
  }
}
