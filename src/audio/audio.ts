import type { GameEvent } from '../game/types';
import { Music } from './music';

/** Pentatonic scale (A minor pentatonic, two octaves) for the pickup streak. */
const PICKUP_SCALE = [880, 1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349.3, 2637, 3136, 3520];

type Wave = OscillatorType;

/**
 * Procedural sound effects: every sound is synthesised with WebAudio, so
 * there are no audio assets to load. Rate limiting keeps big fights from
 * turning into noise.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private pickupIdx = 0;
  private lastPickup = 0;
  private killsThisFrame = 0;
  music: Music | null = null;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8 };

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.music = new Music(ctx, this.musicBus, this.noise);
    this.applyVolumes();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx * 0.9, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.02);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private ok(key: string, gap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const prev = this.last.get(key) ?? -1;
    if (now - prev < gap) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; vol?: number; to?: number; delay?: number; attack?: number; detune?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.detune) osc.detune.value = opts.detune;
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    const vol = opts.vol ?? 0.2;
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** `attack` > 0 swells in over that many seconds (a riser) instead of starting at full volume. */
  private noiseBurst(dur: number, opts: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; vol?: number; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const vol = opts.vol ?? 0.25;
    if (opts.attack) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + opts.attack);
    } else {
      g.gain.setValueAtTime(vol, t);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ───────────── Named sounds ─────────────

  uiHover(): void {
    if (this.ok('hover', 0.03)) this.tone(1800, 0.04, { type: 'triangle', vol: 0.04 });
  }

  uiClick(): void {
    if (this.ok('click', 0.03)) {
      this.tone(1200, 0.06, { type: 'triangle', vol: 0.1, to: 1600 });
    }
  }

  uiBuy(): void {
    this.tone(988, 0.1, { type: 'triangle', vol: 0.14 });
    this.tone(1318, 0.18, { type: 'triangle', vol: 0.14, delay: 0.07 });
    this.tone(1976, 0.3, { type: 'sine', vol: 0.1, delay: 0.14 });
  }

  uiDeny(): void {
    this.tone(220, 0.15, { type: 'square', vol: 0.06, to: 180 });
  }

  /** A short "tick" used while results count up. */
  tick(pitch = 1): void {
    if (this.ok('tick', 0.025)) this.tone(1400 * pitch, 0.03, { type: 'square', vol: 0.035 });
  }

  pick(rarity: string): void {
    const base = rarity === 'legendary' ? 1.5 : rarity === 'epic' ? 1.26 : rarity === 'rare' ? 1.12 : 1;
    this.tone(660 * base, 0.12, { type: 'triangle', vol: 0.16 });
    this.tone(990 * base, 0.2, { type: 'triangle', vol: 0.14, delay: 0.06 });
    this.tone(1320 * base, 0.35, { type: 'sine', vol: 0.12, delay: 0.12 });
    if (rarity === 'legendary' || rarity === 'epic') {
      for (let i = 0; i < 5; i++) this.tone(2000 + i * 300, 0.12, { type: 'sine', vol: 0.05, delay: 0.18 + i * 0.04 });
    }
  }

  reveal(rarity: string): void {
    if (rarity === 'legendary') {
      this.tone(523, 0.6, { type: 'sawtooth', vol: 0.05, to: 1046 });
      this.tone(1568, 0.5, { type: 'sine', vol: 0.1, delay: 0.1 });
    } else if (rarity === 'epic') {
      this.tone(784, 0.4, { type: 'triangle', vol: 0.08, to: 1175 });
    }
  }

  countUp(pitch: number): void {
    if (this.ok('count', 0.04)) this.tone(600 + pitch * 900, 0.05, { type: 'triangle', vol: 0.06 });
  }

  fanfare(): void {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.09 }));
    this.tone(1568, 0.8, { type: 'sine', vol: 0.12, delay: notes.length * 0.09 });
  }

  /**
   * Galaxy warp spool: a rising whoosh (swept band-passed noise) over a
   * climbing detuned saw pair that swells into the punch `dur` seconds later.
   */
  warpRiser(dur: number): void {
    if (!this.ok('warp', 0.5)) return;
    const d = Math.max(0.3, dur);
    this.noiseBurst(d + 0.08, { type: 'bandpass', freq: 300, to: 5200, q: 2.5, vol: 0.16, attack: d * 0.85 });
    this.tone(70, d, { type: 'sawtooth', vol: 0.05, to: 560, attack: d * 0.9 });
    this.tone(70, d, { type: 'sawtooth', vol: 0.05, to: 560, attack: d * 0.9, detune: 18 });
    this.tone(140, d, { type: 'sine', vol: 0.07, to: 1120, attack: d * 0.9 });
  }

  /** Galaxy warp punch: a deep sub drop, a low noise blast and a bright shimmer. */
  warpBoom(): void {
    this.tone(95, 1.3, { type: 'sine', vol: 0.32, to: 28 });
    this.tone(190, 0.5, { type: 'triangle', vol: 0.1, to: 60 });
    this.noiseBurst(1.1, { freq: 1600, to: 50, vol: 0.4 });
    this.noiseBurst(0.35, { type: 'highpass', freq: 5000, to: 2500, vol: 0.08, delay: 0.03 });
    [1318, 1760, 2637].forEach((n, i) => this.tone(n, 0.7, { type: 'sine', vol: 0.035, delay: 0.05 + i * 0.04 }));
  }

  rankUp(): void {
    [392, 523, 659, 784, 1046].forEach((n, i) => this.tone(n, 0.3, { type: 'square', vol: 0.05, delay: i * 0.07 }));
    this.tone(1318, 0.9, { type: 'triangle', vol: 0.12, delay: 0.38 });
  }

  /** Turns simulation events into sound. */
  consume(events: readonly GameEvent[]): void {
    if (!this.ctx) return;
    this.killsThisFrame = 0;
    for (const ev of events) {
      switch (ev.t) {
        case 'shoot':
          if (ev.weapon === 'pulse' && this.ok('pulse', 0.07)) this.tone(1320, 0.05, { type: 'square', vol: 0.025, to: 880 });
          else if (ev.weapon === 'seeker' && this.ok('seeker', 0.1)) this.noiseBurst(0.15, { type: 'bandpass', freq: 900, to: 2400, q: 3, vol: 0.12 });
          else if (ev.weapon === 'mines' && this.ok('mines', 0.1)) this.tone(300, 0.08, { type: 'square', vol: 0.04 });
          else if (ev.weapon === 'lance' && this.ok('lance', 0.1)) this.tone(220, 0.3, { type: 'sawtooth', vol: 0.06, to: 880 });
          break;
        case 'hit':
          if (this.ok('hit', 0.035)) this.noiseBurst(0.03, { type: 'highpass', freq: 3000, vol: ev.crit ? 0.12 : 0.06 });
          if (ev.crit && this.ok('crit', 0.06)) this.tone(2400, 0.05, { type: 'square', vol: 0.03 });
          break;
        case 'kill':
          this.killsThisFrame++;
          if (ev.boss) {
            this.noiseBurst(1.6, { freq: 900, to: 60, vol: 0.6 });
            this.tone(110, 1.2, { type: 'sawtooth', vol: 0.2, to: 30 });
            this.fanfare();
          } else if (ev.elite) {
            this.noiseBurst(0.5, { freq: 1200, to: 100, vol: 0.35 });
            this.tone(196, 0.4, { type: 'square', vol: 0.08, to: 98 });
            this.tone(1568, 0.3, { type: 'triangle', vol: 0.1, delay: 0.05 });
          } else if (this.killsThisFrame <= 3 && this.ok('kill', 0.028)) {
            const p = 0.85 + Math.random() * 0.3;
            this.tone(320 * p, 0.09, { type: 'sine', vol: 0.12, to: 70 });
            this.noiseBurst(0.06, { freq: 2400, to: 400, vol: 0.06 });
          }
          break;
        case 'pickup':
          if (ev.kind === 'xp') {
            const now = this.ctx.currentTime;
            if (now - this.lastPickup > 0.45) this.pickupIdx = 0;
            this.lastPickup = now;
            if (this.ok('xp', 0.032)) {
              const f = PICKUP_SCALE[Math.min(PICKUP_SCALE.length - 1, this.pickupIdx)]!;
              this.tone(f, 0.09, { type: 'sine', vol: 0.07 });
              this.pickupIdx++;
              if (this.pickupIdx >= PICKUP_SCALE.length) this.pickupIdx = PICKUP_SCALE.length - 4;
            }
          } else if (ev.kind === 'core') {
            this.tone(988, 0.08, { type: 'square', vol: 0.06 });
            this.tone(1318, 0.25, { type: 'square', vol: 0.06, delay: 0.07 });
          } else if (ev.kind === 'heart') {
            this.tone(523, 0.2, { type: 'triangle', vol: 0.12 });
            this.tone(659, 0.3, { type: 'triangle', vol: 0.12, delay: 0.08 });
          } else if (ev.kind === 'cache') {
            [784, 988, 1175, 1568, 1976].forEach((n, i) => this.tone(n, 0.18, { type: 'triangle', vol: 0.1, delay: i * 0.05 }));
          }
          break;
        case 'levelup':
          [523, 659, 784, 1046].forEach((n, i) => this.tone(n, 0.16, { type: 'triangle', vol: 0.13, delay: i * 0.055 }));
          this.tone(1568, 0.4, { type: 'sine', vol: 0.08, delay: 0.22 });
          break;
        case 'dash':
          this.noiseBurst(0.18, { type: 'bandpass', freq: 500, to: 2600, q: 1.5, vol: 0.25 });
          break;
        case 'dashready':
          this.tone(1760, 0.06, { type: 'sine', vol: 0.05 });
          break;
        case 'perfect':
          this.tone(1318, 0.5, { type: 'sine', vol: 0.16 });
          this.tone(1976, 0.6, { type: 'sine', vol: 0.12, delay: 0.03 });
          this.tone(2637, 0.4, { type: 'triangle', vol: 0.06, delay: 0.06 });
          break;
        case 'hurt':
          this.tone(140, 0.25, { type: 'sawtooth', vol: 0.22, to: 50 });
          this.noiseBurst(0.18, { freq: 900, vol: 0.3 });
          break;
        case 'shieldbreak':
          this.tone(1200, 0.3, { type: 'triangle', vol: 0.12, to: 300 });
          this.noiseBurst(0.2, { type: 'highpass', freq: 2000, vol: 0.12 });
          break;
        case 'combo': {
          const base = 330 * Math.pow(1.122, ev.tier * 2);
          this.tone(base, 0.3, { type: 'sawtooth', vol: 0.05 });
          this.tone(base * 1.25, 0.3, { type: 'sawtooth', vol: 0.05, delay: 0.03 });
          this.tone(base * 1.5, 0.45, { type: 'triangle', vol: 0.1, delay: 0.06 });
          this.noiseBurst(0.25, { type: 'bandpass', freq: 800, to: 4000, q: 2, vol: 0.1 });
          break;
        }
        case 'combobreak':
          if (ev.combo >= 10) this.tone(440, 0.3, { type: 'triangle', vol: 0.07, to: 220 });
          break;
        case 'milestone':
          this.tone(220, 0.6, { type: 'sawtooth', vol: 0.08, to: 880 });
          [880, 1108, 1318].forEach((n, i) => this.tone(n, 0.3, { type: 'triangle', vol: 0.1, delay: 0.2 + i * 0.06 }));
          break;
        case 'boss':
          for (let i = 0; i < 3; i++) {
            this.tone(440, 0.28, { type: 'sawtooth', vol: 0.09, delay: i * 0.6 });
            this.tone(330, 0.28, { type: 'sawtooth', vol: 0.09, delay: i * 0.6 + 0.3 });
          }
          break;
        case 'death':
          this.tone(440, 1.2, { type: 'sawtooth', vol: 0.15, to: 40 });
          this.noiseBurst(1, { freq: 1500, to: 80, vol: 0.35 });
          break;
        case 'revive':
          [262, 330, 392, 523, 659, 784].forEach((n, i) => this.tone(n, 0.4, { type: 'triangle', vol: 0.1, delay: i * 0.05 }));
          break;
        case 'ring':
          if (this.ok('ring', 0.15)) this.tone(130, 0.35, { type: 'sine', vol: 0.18, to: 45 });
          break;
        case 'arc':
          if (this.ok('arc', 0.06)) {
            this.tone(180 + Math.random() * 120, 0.09, { type: 'square', vol: 0.05, to: 1200 });
            this.noiseBurst(0.08, { type: 'highpass', freq: 4000, vol: 0.08 });
          }
          break;
        case 'explode':
          if (this.ok('explode', 0.05)) this.noiseBurst(0.3, { freq: 900, to: 90, vol: 0.28 });
          break;
        case 'elite':
          this.tone(98, 0.8, { type: 'sawtooth', vol: 0.08, to: 73 });
          break;
        case 'surge':
          this.tone(110, 1, { type: 'sawtooth', vol: 0.07, to: 220 });
          break;
        case 'bomb':
          this.noiseBurst(1.2, { freq: 2000, to: 50, vol: 0.5 });
          this.tone(80, 0.8, { type: 'sine', vol: 0.3, to: 30 });
          break;
        case 'magnet':
          this.tone(300, 0.5, { type: 'sine', vol: 0.12, to: 1800 });
          break;
        case 'newbest':
          this.fanfare();
          break;
        case 'victory':
          this.fanfare();
          this.rankUp();
          break;
        case 'enemyshoot':
          if (this.ok('eshoot', 0.09)) this.tone(520, 0.08, { type: 'triangle', vol: 0.035, to: 300 });
          break;
        case 'heal':
          break;
      }
    }
  }
}
