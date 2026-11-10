// Web Audio engine. Sound is the main warning system, so everything passes through a graph whose
// filters and detune follow the distance to the nearest monster.
import { FloorType, Rng, hashString } from '@webmaze/shared';

interface Loop { root: number; scale: number[]; bpm: number; lead: OscillatorType; density: number }

// ~9 lo-fi MIDI-style loops, one flavour per floor type
const LOOPS: Record<FloorType, Loop> = {
  wallpaper: { root: 196, scale: [0, 2, 4, 7, 9], bpm: 92, lead: 'square', density: 0.6 },
  geocities: { root: 220, scale: [0, 4, 7, 9, 12], bpm: 128, lead: 'square', density: 0.85 },
  chatroom: { root: 110, scale: [0, 3, 7, 10], bpm: 60, lead: 'triangle', density: 0.25 },
  desktop: { root: 174.6, scale: [0, 2, 5, 7, 11], bpm: 104, lead: 'square', density: 0.7 },
  flip: { root: 165, scale: [0, 1, 5, 7, 8], bpm: 84, lead: 'triangle', density: 0.5 },
  park: { root: 261.6, scale: [0, 2, 4, 5, 7, 9], bpm: 76, lead: 'triangle', density: 0.45 },
  server: { root: 98, scale: [0, 3, 5, 6, 7], bpm: 120, lead: 'square', density: 0.4 },
  corrupted: { root: 146.8, scale: [0, 1, 3, 6, 8], bpm: 70, lead: 'square', density: 0.55 },
  guestbook: { root: 261.6, scale: [0, 2, 4, 7, 9, 12], bpm: 112, lead: 'triangle', density: 0.8 },
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private timer = 0;
  private nextStep = 0;
  private step = 0;
  private loop: Loop = LOOPS.wallpaper;
  private pattern: number[] = [];
  private bass: number[] = [];
  private detune = 0;
  private danger = 0;
  private hunting = false;
  private duckUntil = 0;
  private ambNodes: AudioNode[] = [];
  volume = 0.8;
  muted = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new Ctor());
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 12000;
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.22;
    this.musicFilter.connect(this.musicGain); this.musicGain.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.25; this.amb.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.1) * 0.98; d[i] = last * 3; }
    this.timer = window.setInterval(() => this.schedule(), 80);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : this.volume;
  }

  setFloor(type: FloorType, seed: string, floor: number): void {
    this.loop = LOOPS[type];
    const rng = new Rng(hashString(`${seed}|${floor}|music`));
    this.pattern = Array.from({ length: 16 }, () => (rng.chance(this.loop.density) ? rng.int(0, this.loop.scale.length * 2 - 1) : -1));
    this.bass = Array.from({ length: 4 }, () => rng.int(0, 3));
    this.step = 0;
    if (this.ctx) this.nextStep = this.ctx.currentTime + 0.1;
    this.setAmbience(type);
  }

  private setAmbience(type: FloorType): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const n of this.ambNodes) { try { (n as AudioScheduledSourceNode).stop?.(); n.disconnect(); } catch { /* */ } }
    this.ambNodes = [];
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    if (type === 'park') { f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6; } else { f.type = 'lowpass'; f.frequency.value = 180; }
    src.connect(f); f.connect(this.amb); src.start();
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = type === 'server' ? 90 : 55;
    const hg = ctx.createGain(); hg.gain.value = type === 'server' ? 0.07 : 0.025;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 240;
    hum.connect(hf); hf.connect(hg); hg.connect(this.amb); hum.start();
    this.ambNodes.push(src, f, hum, hg, hf);
  }

  /** distance (m) to the nearest monster, Infinity when none; hunting silences the music */
  setDanger(dist: number, hunting: boolean): void {
    const d = Math.max(0, Math.min(1, (15 - dist) / 15));
    this.danger = d;
    if (hunting !== this.hunting) this.hunting = hunting;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const cutoff = 12000 * Math.pow(0.03, d);
    this.musicFilter.frequency.setTargetAtTime(Math.max(300, cutoff), t, 0.15);
    this.detune = -50 * Math.max(0, Math.min(1, (10 - dist) / 5)) * (dist < 10 ? 1 : 0);
    const duck = this.ctx.currentTime < this.duckUntil ? 0.5 : 1;
    const base = hunting ? 0 : 0.22 * (1 - d * 0.5) * duck;
    this.musicGain.gain.setTargetAtTime(base, t, hunting ? 0.05 : 0.3);
    this.amb.gain.setTargetAtTime(hunting ? 0.1 : dist < 5 ? 0.12 : 0.25, t, 0.3);
  }

  setListener(x: number, z: number, yaw: number): void {
    const l = this.ctx?.listener;
    if (!l || !l.positionX) return;
    l.positionX.value = x; l.positionY.value = 1.5; l.positionZ.value = z;
    l.forwardX.value = -Math.sin(yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(yaw);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || this.pattern.length === 0) return;
    const spb = 60 / this.loop.bpm / 2; // eighth notes
    if (this.nextStep < ctx.currentTime) this.nextStep = ctx.currentTime + 0.05;
    while (this.nextStep < ctx.currentTime + 0.25) {
      const s = this.step % 16;
      const n = this.pattern[s];
      if (n >= 0) {
        const sc = this.loop.scale;
        const semis = sc[n % sc.length] + 12 * Math.floor(n / sc.length);
        this.note(this.loop.root * Math.pow(2, semis / 12), this.nextStep, spb * 0.9, this.loop.lead, 0.5);
      }
      if (s % 4 === 0) {
        const semis = this.loop.scale[this.bass[(s / 4) | 0] % this.loop.scale.length];
        this.note((this.loop.root / 2) * Math.pow(2, semis / 12), this.nextStep, spb * 3, 'triangle', 0.9);
      }
      this.nextStep += spb;
      this.step++;
    }
  }

  private note(freq: number, when: number, dur: number, type: OscillatorType, vel: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = this.detune + (Math.random() - 0.5) * 4 * this.danger;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.12 * vel, when + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(g); g.connect(this.musicFilter);
    o.start(when); o.stop(when + dur + 0.05);
  }

  private duck(secs: number): void {
    if (!this.ctx) return;
    this.duckUntil = this.ctx.currentTime + secs;
    this.musicGain.gain.setTargetAtTime(this.musicGain.gain.value * 0.5, this.ctx.currentTime, 0.03);
  }

  private out(x?: number, z?: number): AudioNode {
    const ctx = this.ctx!;
    if (x === undefined || z === undefined) return this.sfx;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.2; p.maxDistance = 80;
    p.positionX.value = x; p.positionY.value = 1.5; p.positionZ.value = z;
    p.connect(this.sfx);
    return p;
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, slideTo?: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, dest: AudioNode, lp = 2000, hp = 0, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 1 + Math.random();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = hp;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(f2); f2.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  /** One-shot effect, optionally positional. */
  play(kind: string, x?: number, z?: number): void {
    if (!this.ctx || this.muted) return;
    const dest = this.out(x, z);
    switch (kind) {
      case 'step': this.noise(0.08, 0.5, dest, 420 + Math.random() * 200); break;
      case 'bell':
        this.duck(1.5);
        for (const [f, v] of [[880, 0.3], [1318, 0.2], [1760, 0.12], [2217, 0.07]] as const) this.blip(f * (1 + (Math.random() - 0.5) * 0.01), 1.6, 'sine', v, dest);
        break;
      case 'fake-bell': this.play('bell', x, z); break;
      case 'fake-step': this.noise(0.1, 0.8, dest, 500); this.noise(0.1, 0.8, dest, 500, 0, 0.45); break;
      case 'modem': {
        this.duck(3);
        const ctx = this.ctx;
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const g = ctx.createGain(); g.gain.value = 0.28;
        const t = ctx.currentTime;
        const seq = [1200, 2100, 980, 1700, 2400, 1300, 2200, 1500];
        seq.forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.14));
        g.gain.setValueAtTime(0.28, t); g.gain.linearRampToValueAtTime(0, t + 1.2);
        const m = ctx.createOscillator(); m.frequency.value = 55; const mg = ctx.createGain(); mg.gain.value = 500; m.connect(mg); mg.connect(o.frequency);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.25); m.start(t); m.stop(t + 1.25);
        this.noise(1.2, 0.25, dest, 6000, 800);
        break;
      }
      case 'glitch':
        this.duck(0.8);
        for (let i = 0; i < 7; i++) this.blip(200 + Math.random() * 2000, 0.04, 'square', 0.25, dest, undefined, i * 0.03);
        this.noise(0.3, 0.5, dest, 8000, 1000);
        break;
      case 'pickup': this.blip(880, 0.08, 'square', 0.18, dest); this.blip(1320, 0.12, 'square', 0.18, dest, undefined, 0.07); break;
      case 'coin': this.blip(988, 0.07, 'square', 0.14, dest); this.blip(1568, 0.2, 'square', 0.14, dest, undefined, 0.07); break;
      case 'insert': this.blip(400, 0.25, 'sawtooth', 0.14, dest, 90); this.noise(0.15, 0.3, dest, 1500); break;
      case 'open': [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.4, 'triangle', 0.18, dest, undefined, i * 0.1)); break;
      case 'scan': this.blip(300, 0.7, 'sine', 0.2, dest, 1600); this.blip(1400, 0.6, 'sine', 0.1, dest, undefined, 0.35); break;
      case 'revive': [392, 523, 659, 784].forEach((f, i) => this.blip(f, 0.3, 'triangle', 0.2, dest, undefined, i * 0.08)); break;
      case 'popup': this.blip(1200, 0.12, 'square', 0.2, dest); this.blip(900, 0.2, 'square', 0.2, dest, undefined, 0.12); break;
      case 'click': this.blip(1800, 0.03, 'square', 0.1, dest); break;
      case 'squeak': this.blip(2400, 0.12, 'sine', 0.18, dest, 3600); break;
      case 'creak': this.blip(70, 0.6, 'sawtooth', 0.08, dest, 52); this.blip(110, 0.4, 'square', 0.04, dest, 80, 0.1); break;
      case 'radio': this.noise(2.5, 0.35, dest, 3500, 600); break;
      case 'buy': this.blip(660, 0.08, 'square', 0.16, dest); this.blip(880, 0.08, 'square', 0.16, dest, undefined, 0.08); this.blip(1320, 0.18, 'square', 0.16, dest, undefined, 0.16); break;
      case 'deny': this.blip(220, 0.18, 'square', 0.16, dest, 110); break;
      case 'hide': this.noise(0.12, 0.5, dest, 600); break;
      case 'ping': this.blip(1500, 0.1, 'sine', 0.16, dest); break;
      case 'death': this.blip(300, 1.2, 'sawtooth', 0.2, dest, 40); this.noise(1.0, 0.3, dest, 900); break;
      default:
    }
  }

  /** dialogue babble: one blip per two letters, pitch random per character */
  babble(basePitch: number): void {
    if (!this.ctx || this.muted) return;
    this.blip(basePitch * (0.85 + Math.random() * 0.4), 0.05, 'square', 0.1, this.sfx);
  }
}
