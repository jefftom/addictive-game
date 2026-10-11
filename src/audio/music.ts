/**
 * A tiny procedural synthwave sequencer. Layers (pad, bass, arp, drums)
 * fade in with game intensity; boss fights switch to a darker progression.
 * Scheduling uses the standard look-ahead pattern for sample-accurate timing.
 */

const A = 55; // A1
const semis = (n: number) => A * Math.pow(2, n / 12);

// Chord roots (semitones above A1) and minor/major quality.
const PROG_NORMAL: { root: number; minor: boolean }[] = [
  { root: 0, minor: true }, // Am
  { root: 8, minor: false }, // F
  { root: 3, minor: false }, // C
  { root: 10, minor: false }, // G
];
const PROG_BOSS: { root: number; minor: boolean }[] = [
  { root: 0, minor: true }, // Am
  { root: 1, minor: false }, // Bb
  { root: 0, minor: true }, // Am
  { root: 7, minor: false }, // E
];
const PROG_MENU: { root: number; minor: boolean }[] = [
  { root: 0, minor: true },
  { root: 5, minor: true }, // Dm
  { root: 8, minor: false },
  { root: 7, minor: false },
];

const ARP = [0, 2, 1, 2, 0, 2, 1, 3];
const BASS = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0.6, 1];

export type MusicMode = 'menu' | 'game';

export class Music {
  private readonly ctx: AudioContext;
  private readonly noise: AudioBuffer;
  private layers: { pad: GainNode; bass: GainNode; arp: GainNode; drums: GainNode };
  private arpFilter: BiquadFilterNode;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bpm = 118;
  private mode: MusicMode = 'menu';
  private boss = false;
  private intensity = 0;
  private startTime = 0;
  playing = false;

  constructor(ctx: AudioContext, out: GainNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.noise = noise;
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      return g;
    };
    this.layers = { pad: mk(), bass: mk(), arp: mk(), drums: mk() };
    this.arpFilter = ctx.createBiquadFilter();
    this.arpFilter.type = 'lowpass';
    this.arpFilter.frequency.value = 1200;
    this.arpFilter.Q.value = 6;
    this.arpFilter.connect(this.layers.arp);
  }

  start(mode: MusicMode): void {
    this.mode = mode;
    this.boss = false;
    this.bpm = mode === 'menu' ? 96 : 118;
    if (!this.playing) {
      this.playing = true;
      this.nextTime = this.ctx.currentTime + 0.06;
      this.startTime = this.nextTime;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    this.applyMix();
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    for (const g of Object.values(this.layers)) g.gain.setTargetAtTime(0, t, 0.3);
  }

  setBoss(on: boolean): void {
    if (this.boss === on) return;
    this.boss = on;
    this.bpm = on ? 128 : this.mode === 'menu' ? 96 : 118;
    this.applyMix();
  }

  /** 0..1, how hectic the game currently is. */
  setIntensity(v: number): void {
    const next = Math.max(0, Math.min(1, v));
    if (Math.abs(next - this.intensity) < 0.03) return;
    this.intensity = next;
    this.applyMix();
  }

  /** Phase within the current beat (1 at the beat, decaying to 0). */
  beatPulse(): number {
    if (!this.playing) return 0;
    const spb = 60 / this.bpm;
    const t = this.ctx.currentTime - this.startTime;
    const phase = (t / spb) % 1;
    return Math.pow(1 - phase, 4);
  }

  private applyMix(): void {
    const t = this.ctx.currentTime;
    const i = this.intensity;
    const menu = this.mode === 'menu';
    const set = (g: GainNode, v: number) => g.gain.setTargetAtTime(v, t, 0.6);
    set(this.layers.pad, menu ? 0.5 : 0.25 * (1 - i * 0.5));
    set(this.layers.bass, menu ? 0.18 : 0.42 + i * 0.15);
    set(this.layers.arp, menu ? 0.22 : 0.16 + i * 0.22);
    set(this.layers.drums, menu ? 0 : this.boss ? 0.6 : 0.25 + i * 0.4);
    this.arpFilter.frequency.setTargetAtTime(menu ? 900 : 1100 + i * 3200 + (this.boss ? 1500 : 0), t, 0.5);
  }

  private schedule(): void {
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, len: number): void {
    const prog = this.boss ? PROG_BOSS : this.mode === 'menu' ? PROG_MENU : PROG_NORMAL;
    const chord = prog[Math.floor(step / 16) % prog.length]!;
    const s16 = step % 16;
    const third = chord.minor ? 3 : 4;
    const tones = [0, third, 7, 12];

    // Pad: one long chord per bar.
    if (s16 === 0) {
      for (const n of [0, third, 7]) {
        this.voice(this.layers.pad, 'sawtooth', semis(chord.root + n + 24), t, len * 16, 0.05, 0.4, 7);
        this.voice(this.layers.pad, 'sawtooth', semis(chord.root + n + 24), t, len * 16, 0.05, 0.4, -7);
      }
    }
    // Bass: driving 16ths with root/octave movement.
    const bassVel = BASS[s16]!;
    if (bassVel > 0 && (this.mode !== 'menu' || s16 % 4 === 0)) {
      const oct = s16 % 8 === 6 ? 12 : 0;
      this.voice(this.layers.bass, 'sawtooth', semis(chord.root + oct + 12), t, len * 0.9, 0.18 * bassVel, 0.003, 0, 600);
    }
    // Arp: chord tones two octaves up.
    if (this.mode !== 'menu' || s16 % 2 === 0) {
      const idx = ARP[s16 % ARP.length]!;
      const n = tones[idx]! + (step % 32 >= 16 && idx === 3 ? 12 : 0);
      this.voice(this.arpFilter, 'square', semis(chord.root + n + 36), t, len * 0.8, 0.08, 0.002);
    }
    // Drums.
    if (this.mode !== 'menu') {
      if (s16 % 4 === 0) this.kick(t);
      if (s16 % 8 === 4) this.snare(t);
      if (s16 % 2 === 1 || this.boss) this.hat(t, s16 % 4 === 2 ? 0.06 : 0.035);
    }
  }

  private voice(
    dest: AudioNode,
    type: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    vol: number,
    attack: number,
    detune = 0,
    cutoff = 0,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff * 2.5, t);
      f.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g);
    g.connect(this.layers.drums);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  private snare(t: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f);
    f.connect(g);
    g.connect(this.layers.drums);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.18);
  }

  private hat(t: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f);
    f.connect(g);
    g.connect(this.layers.drums);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.06);
  }
}
