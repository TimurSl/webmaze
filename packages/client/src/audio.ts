// Web Audio engine. Sound is the main warning system, so everything passes through a graph whose
// filters and detune follow the distance to the nearest monster.
//
// Music and effects are synthesised here from scratch (original compositions, no samples, no licences to track).
// Optional: drop real recordings into packages/client/public/audio/ and list them in manifest.json; they replace
// the matching synth effect or song. See README.md, "Custom sounds".
import { FloorType, Rng, hashString } from '@webmaze/shared';

export type Mood = 'normal' | 'calm' | 'secret';
type SongKey = FloorType | 'calm' | 'secret';
type Voice = 'square' | 'music' | 'flute' | 'bell' | 'pluck' | 'pulse';
type Drums = 'none' | 'soft' | 'beat' | 'four';

interface Song {
  bpm: number;
  /** tonic in Hz of the first chord's root */
  root: number;
  /** one chord per bar, semitones above the root */
  prog: number[][];
  /** melody scale, semitones above the root */
  scale: number[];
  lead: Voice;
  arp: Voice | null;
  /** arpeggio speed: every 2nd or every step */
  arpEvery: 1 | 2;
  pad: boolean;
  drums: Drums;
  /** 0..1 chance a step carries a melody note */
  density: number;
  /** 0..0.5 shove on odd sixteenths */
  swing: number;
  /** echo strength 0..0.6 */
  echo: number;
  /** extra random cents of drift, makes it feel like a bad MIDI file */
  drift: number;
}

// Webcore palette: General-MIDI-ish toy timbres, wide echo, lazy chords. One song per floor flavour.
const SONGS: Record<SongKey, Song> = {
  // dreamy "setup wizard" waltz through a hall of wallpaper
  wallpaper: { bpm: 88, root: 196, prog: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 16]], scale: [0, 2, 4, 7, 9], lead: 'flute', arp: 'music', arpEvery: 2, pad: true, drums: 'soft', density: 0.45, swing: 0.1, echo: 0.35, drift: 3 },
  // bouncy GeoCities MIDI: the one you can't turn off
  geocities: { bpm: 126, root: 220, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], scale: [0, 2, 4, 7, 9], lead: 'square', arp: 'pluck', arpEvery: 2, pad: false, drums: 'beat', density: 0.7, swing: 0, echo: 0.15, drift: 2 },
  // 3 a.m. chatroom: slow, minor, echoing
  chatroom: { bpm: 62, root: 110, prog: [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 19]], scale: [0, 3, 5, 7, 10], lead: 'bell', arp: 'music', arpEvery: 2, pad: true, drums: 'none', density: 0.2, swing: 0, echo: 0.55, drift: 5 },
  // elevator jazz from a system that will not shut down
  desktop: { bpm: 100, root: 174.6, prog: [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [9, 12, 16, 19]], scale: [0, 2, 4, 7, 9, 11], lead: 'flute', arp: 'pluck', arpEvery: 2, pad: false, drums: 'soft', density: 0.5, swing: 0.2, echo: 0.25, drift: 2 },
  // the ceiling is a second floor: seasick phrygian
  flip: { bpm: 84, root: 165, prog: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [10, 14, 17]], scale: [0, 1, 5, 7, 8], lead: 'pulse', arp: 'bell', arpEvery: 2, pad: true, drums: 'none', density: 0.4, swing: 0.15, echo: 0.4, drift: 9 },
  // lydian lawn in the fog
  park: { bpm: 76, root: 261.6, prog: [[0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17], [4, 7, 11, 14]], scale: [0, 2, 4, 6, 7, 9, 11], lead: 'flute', arp: 'music', arpEvery: 2, pad: true, drums: 'none', density: 0.4, swing: 0, echo: 0.4, drift: 3 },
  // fans and sixteenths
  server: { bpm: 122, root: 98, prog: [[0, 3, 7], [0, 3, 7], [8, 12, 15], [10, 14, 17]], scale: [0, 3, 5, 7, 10], lead: 'pluck', arp: 'pluck', arpEvery: 1, pad: false, drums: 'four', density: 0.3, swing: 0, echo: 0.2, drift: 2 },
  // the map lies and so does the song
  corrupted: { bpm: 66, root: 146.8, prog: [[0, 3, 6], [1, 4, 8], [0, 3, 6], [11, 14, 18]], scale: [0, 1, 3, 6, 8], lead: 'square', arp: 'bell', arpEvery: 2, pad: true, drums: 'none', density: 0.45, swing: 0.05, echo: 0.45, drift: 22 },
  // cheerful visitor-counter muzak
  guestbook: { bpm: 110, root: 261.6, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7, 11]], scale: [0, 2, 4, 7, 9, 12], lead: 'bell', arp: 'music', arpEvery: 2, pad: false, drums: 'soft', density: 0.6, swing: 0.12, echo: 0.3, drift: 2 },
  // discovery mode: nothing is coming, so the music can be pretty
  calm: { bpm: 80, root: 220, prog: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 16]], scale: [0, 2, 4, 7, 9], lead: 'music', arp: 'flute', arpEvery: 2, pad: true, drums: 'none', density: 0.35, swing: 0.08, echo: 0.5, drift: 2 },
  // the secret room: fast and shiny
  secret: { bpm: 152, root: 261.6, prog: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [4, 7, 11], [5, 9, 12], [0, 4, 7], [5, 9, 12], [7, 11, 14]], scale: [0, 2, 4, 5, 7, 9, 11, 12], lead: 'pulse', arp: 'square', arpEvery: 1, pad: false, drums: 'four', density: 0.8, swing: 0, echo: 0.2, drift: 0 },
};

const DRUM_PATTERNS: Record<Drums, { kick: number[]; snare: number[]; hat: number[] }> = {
  none: { kick: [], snare: [], hat: [] },
  soft: { kick: [], snare: [], hat: [2, 6, 10, 14] },
  beat: { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  four: { kick: [0, 4, 8, 12], snare: [12], hat: [2, 6, 10, 14] },
};

const sampleBase = (): string => {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private echoSend!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private timer = 0;
  private nextStep = 0;
  private step = 0;
  private song: Song = SONGS.wallpaper;
  private melody: ({ semi: number; len: number } | null)[] = [];
  private bassFifth: boolean[] = [];
  private musicSrc: AudioBufferSourceNode | null = null;
  private detune = 0;
  private danger = 0;
  private hunting = false;
  private duckUntil = 0;
  private ambNodes: AudioNode[] = [];
  private samples = new Map<string, AudioBuffer>();
  private floorKey: SongKey = 'wallpaper';
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
    // tape-style echo on the music bus: the webcore smear
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0.3;
    this.echoSend.connect(delay); delay.connect(dl); dl.connect(fb); fb.connect(delay); dl.connect(this.musicFilter);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.25; this.amb.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.1) * 0.98; d[i] = last * 3; }
    this.timer = window.setInterval(() => this.schedule(), 80);
    void this.loadSamples();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : this.volume;
  }

  // ------------------------------------------------------------------ optional recordings

  /**
   * public/audio/manifest.json maps names to files, e.g. {"pickup":"pickup.ogg","music:wallpaper":"dream.ogg"}.
   * Effect names are the `kind`s passed to play(); music keys are `music:<floor type | calm | secret>`.
   * Missing manifest = pure synth, which is the default.
   */
  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const r = await fetch(`${sampleBase()}audio/manifest.json`);
      if (!r.ok) return;
      const man = (await r.json()) as Record<string, unknown>;
      for (const [key, file] of Object.entries(man)) {
        if (typeof file !== 'string' || !/^[\w.-]+$/.test(file) || file.includes('..')) continue;
        try {
          const res = await fetch(`${sampleBase()}audio/${file}`);
          if (!res.ok) continue;
          this.samples.set(key, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch { /* skip a file that will not decode */ }
      }
      if (this.melody.length) this.setFloor(this.floorType, this.floorSeed, this.floorN, this.mood); // pick up a custom song if there is one
    } catch { /* no manifest */ }
  }
  private floorType: FloorType = 'wallpaper';
  private floorSeed = '';
  private floorN = 1;
  private mood: Mood = 'normal';

  // ------------------------------------------------------------------ floors

  setFloor(type: FloorType, seed: string, floor: number, mood: Mood = 'normal'): void {
    this.floorType = type; this.floorSeed = seed; this.floorN = floor; this.mood = mood;
    const key: SongKey = mood === 'secret' ? 'secret' : mood === 'calm' ? 'calm' : type;
    this.floorKey = key;
    const song = (this.song = SONGS[key]);
    const rng = new Rng(hashString(`${seed}|${floor}|music`));
    // the same seed always gets the same tune, but the progression starts on a different bar per floor
    const rot = rng.int(0, song.prog.length - 1);
    const prog = song.prog.slice(rot).concat(song.prog.slice(0, rot));
    this.song = { ...song, prog };
    const total = prog.length * 16;
    this.melody = new Array(total).fill(null);
    this.bassFifth = Array.from({ length: prog.length * 2 }, () => rng.chance(0.4));
    const sc = song.scale;
    let deg = rng.int(0, sc.length - 1);
    for (let s = 0; s < total; s++) {
      const strong = s % 4 === 0;
      if (!rng.chance(strong ? Math.min(1, song.density + 0.3) : song.density * 0.55)) continue;
      const chord = prog[(s / 16) | 0];
      let semi: number;
      if (strong && rng.chance(0.65)) semi = chord[rng.int(0, chord.length - 1)] + 12;
      else {
        deg = Math.max(0, Math.min(sc.length * 2 - 1, deg + rng.pick([-2, -1, -1, 1, 1, 2])));
        semi = sc[deg % sc.length] + 12 * Math.floor(deg / sc.length) + 12;
      }
      const len = strong ? rng.int(2, 4) : rng.int(1, 2);
      this.melody[s] = { semi, len };
      s += len - 1;
    }
    this.step = 0;
    if (this.ctx) this.nextStep = this.ctx.currentTime + 0.1;
    if (this.ctx) this.echoSend.gain.setTargetAtTime(song.echo, this.ctx.currentTime, 0.2);
    this.startMusicSample(key);
    this.setAmbience(type, mood);
  }

  private startMusicSample(key: SongKey): void {
    try { this.musicSrc?.stop(); this.musicSrc?.disconnect(); } catch { /* */ }
    this.musicSrc = null;
    const buf = this.samples.get(`music:${key}`);
    if (!this.ctx || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(this.musicFilter);
    src.start();
    this.musicSrc = src;
  }

  private setAmbience(type: FloorType, mood: Mood): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const n of this.ambNodes) { try { (n as AudioScheduledSourceNode).stop?.(); n.disconnect(); } catch { /* */ } }
    this.ambNodes = [];
    if (mood === 'secret') return; // just the song
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    if (type === 'park') { f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6; } else { f.type = 'lowpass'; f.frequency.value = 180; }
    src.connect(f); f.connect(this.amb); src.start();
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = type === 'server' ? 90 : 55;
    const hg = ctx.createGain(); hg.gain.value = (type === 'server' ? 0.07 : 0.025) * (mood === 'calm' ? 0.4 : 1);
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

  // ------------------------------------------------------------------ music scheduler

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || this.melody.length === 0 || this.musicSrc) return;
    const song = this.song;
    const sd = 60 / song.bpm / 4; // sixteenth note
    if (this.nextStep < ctx.currentTime) this.nextStep = ctx.currentTime + 0.05;
    while (this.nextStep < ctx.currentTime + 0.25) {
      const total = this.melody.length;
      const s = this.step % total;
      const sb = s % 16;
      const bar = (s / 16) | 0;
      const chord = song.prog[bar];
      const t = this.nextStep + (sb % 2 === 1 ? song.swing * sd : 0);
      const hz = (semi: number): number => song.root * Math.pow(2, semi / 12);

      const m = this.melody[s];
      if (m) this.voice(song.lead, hz(m.semi), t, sd * m.len * 0.92, 0.55);
      if (song.arp && sb % song.arpEvery === 0) {
        const n = (sb / song.arpEvery) | 0;
        const up = chord[n % chord.length], pick = n % (chord.length * 2) < chord.length ? up : chord[chord.length - 1 - (n % chord.length)];
        this.voice(song.arp, hz(pick + 12 * (n % 4 === 3 ? 2 : 1)), t, sd * song.arpEvery * 1.6, 0.28);
      }
      if (sb === 0) {
        if (song.pad) for (const c of chord.slice(0, 3)) this.pad(hz(c), t, sd * 16);
        this.voice('bass', hz(chord[0] - 12), t, sd * 7, 0.8);
      } else if (sb === 8) {
        const fifth = this.bassFifth[bar * 2 + 1];
        this.voice('bass', hz((fifth ? chord[0] + 7 : chord[0]) - 12), t, sd * 7, 0.7);
      }
      this.drums(song.drums, sb, t);

      this.nextStep += sd;
      this.step++;
    }
  }

  private drums(kind: Drums, sb: number, t: number): void {
    const p = DRUM_PATTERNS[kind];
    if (p.kick.includes(sb)) this.tone(t, 150, 0.14, 'sine', 0.55, this.musicFilter, { to: 42 });
    if (p.snare.includes(sb)) { this.hiss(t, 0.12, 0.3, this.musicFilter, { hp: 1400, lp: 7000 }); this.tone(t, 210, 0.07, 'triangle', 0.18, this.musicFilter, { to: 150 }); }
    if (p.hat.includes(sb)) this.hiss(t, 0.035, sb % 4 === 2 ? 0.16 : 0.1, this.musicFilter, { hp: 7500 });
  }

  /** One music note on a toy instrument. Everything goes through the music filter so danger can muffle it. */
  private voice(kind: Voice | 'bass', freq: number, t: number, dur: number, vel: number): void {
    const dest = this.musicFilter;
    const drift = this.song.drift;
    const cents = this.detune + (Math.random() - 0.5) * (4 * this.danger + drift);
    const send = (n: AudioNode, amt = 1): void => { n.connect(dest); if (amt > 0) { const g = this.ctx!.createGain(); g.gain.value = amt; n.connect(g); g.connect(this.echoSend); } };
    const ctx = this.ctx!;
    const env = (g: GainNode, peak: number, attack: number, decay: number): void => {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    };
    const osc = (type: OscillatorType, f: number, stop: number): OscillatorNode => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = cents; o.start(t); o.stop(stop); return o;
    };
    switch (kind) {
      case 'bass': {
        const g = ctx.createGain(); env(g, 0.2 * vel, 0.01, dur);
        osc('triangle', freq, t + dur + 0.05).connect(g);
        const sub = osc('sine', freq / 2, t + dur + 0.05); const sg = ctx.createGain(); sg.gain.value = 0.5; sub.connect(sg); sg.connect(g);
        send(g, 0);
        break;
      }
      case 'square': case 'pulse': {
        const g = ctx.createGain(); env(g, 0.1 * vel, 0.008, Math.max(0.08, dur));
        const o = osc('square', freq, t + dur + 0.1);
        if (kind === 'pulse') { // two slightly detuned squares: the chorus-drenched MIDI lead
          const o2 = osc('square', freq * 1.006, t + dur + 0.1); o2.connect(g);
        }
        o.connect(g); send(g, 0.8);
        break;
      }
      case 'flute': {
        const g = ctx.createGain(); env(g, 0.17 * vel, Math.min(0.08, dur * 0.4), Math.max(0.1, dur));
        const o = osc('triangle', freq, t + dur + 0.2);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2; const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + dur * 0.8); lfo.connect(lg); lg.connect(o.detune); lfo.start(t); lfo.stop(t + dur + 0.2);
        o.connect(g); send(g, 1);
        break;
      }
      case 'music': { // music box
        const g = ctx.createGain(); env(g, 0.2 * vel, 0.004, 1.1);
        osc('sine', freq, t + 1.2).connect(g);
        const h = osc('sine', freq * 2, t + 1.2); const hg = ctx.createGain(); hg.gain.value = 0.3; h.connect(hg); hg.connect(g);
        const h3 = osc('sine', freq * 4.02, t + 0.4); const h3g = ctx.createGain(); h3g.gain.value = 0.08; h3.connect(h3g); h3g.connect(g);
        send(g, 1.2);
        break;
      }
      case 'bell': {
        const g = ctx.createGain(); env(g, 0.17 * vel, 0.003, 1.6);
        for (const [r, a] of [[1, 1], [2.76, 0.4], [5.4, 0.18]] as const) {
          const o = osc('sine', freq * r, t + 1.7); const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(g);
        }
        send(g, 1.2);
        break;
      }
      case 'pluck': {
        const g = ctx.createGain(); env(g, 0.15 * vel, 0.004, 0.25);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
        f.frequency.setValueAtTime(freq * 8, t); f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.22);
        osc('sawtooth', freq, t + 0.35).connect(f); f.connect(g);
        send(g, 0.6);
        break;
      }
      default:
    }
  }

  /** Slow detuned pad held for a bar. */
  private pad(freq: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + dur * 0.3); g.gain.linearRampToValueAtTime(0, t + dur + 0.2);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
    for (const dt of [-9, 8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = dt + this.detune; o.start(t); o.stop(t + dur + 0.25);
      o.connect(f);
    }
    f.connect(g); g.connect(this.musicFilter);
  }

  private duck(secs: number): void {
    if (!this.ctx) return;
    this.duckUntil = this.ctx.currentTime + secs;
    this.musicGain.gain.setTargetAtTime(this.musicGain.gain.value * 0.5, this.ctx.currentTime, 0.03);
  }

  // ------------------------------------------------------------------ effects

  private out(x?: number, z?: number): AudioNode {
    const ctx = this.ctx!;
    if (x === undefined || z === undefined) return this.sfx;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.2; p.maxDistance = 80;
    p.positionX.value = x; p.positionY.value = 1.5; p.positionZ.value = z;
    p.connect(this.sfx);
    return p;
  }

  /** One oscillator note starting at absolute time t, optional pitch slide and lowpass. */
  private tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, o: { to?: number; attack?: number; lp?: number } = {}): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    if (o.attack) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + o.attack); } else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let tail: AudioNode = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); tail = f; }
    tail.connect(g); g.connect(dest); osc.start(t); osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst starting at absolute time t. */
  private hiss(t: number, dur: number, vol: number, dest: AudioNode, o: { lp?: number; hp?: number; bp?: number; q?: number; attack?: number; rate?: number } = {}): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = o.rate ?? 1 + Math.random();
    const chain: BiquadFilterNode[] = [];
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; chain.push(f); }
    if (o.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; chain.push(f); }
    if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.bp; f.Q.value = o.q ?? 1; chain.push(f); }
    const g = ctx.createGain();
    if (o.attack) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + o.attack); } else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    let n: AudioNode = s;
    for (const f of chain) { n.connect(f); n = f; }
    n.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  private playSample(buf: AudioBuffer, dest: AudioNode): void {
    const s = this.ctx!.createBufferSource(); s.buffer = buf;
    s.playbackRate.value = 0.97 + Math.random() * 0.06;
    s.connect(dest); s.start();
  }

  /** One-shot effect, optionally positional. */
  play(kind: string, x?: number, z?: number): void {
    if (!this.ctx || this.muted) return;
    const dest = this.out(x, z);
    const buf = this.samples.get(kind);
    if (buf) { this.playSample(buf, dest); return; }
    const ctx = this.ctx;
    const T = ctx.currentTime;
    const note = (f: number, d: number, type: OscillatorType, v: number, at = 0, to?: number): void => this.tone(T + at, f, d, type, v, dest, { to });
    switch (kind) {
      case 'step': // carpet thud
        this.hiss(T, 0.09, 0.55, dest, { lp: 380 + Math.random() * 220, hp: 60 });
        note(95 + Math.random() * 25, 0.07, 'sine', 0.25, 0, 55);
        break;
      case 'bell': // tubular bell
        this.duck(1.5);
        for (const [r, v] of [[1, 0.3], [2.0, 0.16], [2.76, 0.14], [5.4, 0.07], [8.9, 0.03]] as const) this.tone(T, 880 * r * (1 + (Math.random() - 0.5) * 0.008), 2.2 / Math.sqrt(r), 'sine', v, dest);
        this.hiss(T, 0.03, 0.2, dest, { hp: 3000 });
        break;
      case 'fake-bell': this.play('bell', x, z); break;
      case 'fake-step':
        for (const at of [0, 0.45]) { this.hiss(T + at, 0.1, 0.7, dest, { lp: 460, hp: 70 }); this.tone(T + at, 85, 0.08, 'sine', 0.3, dest, { to: 50 }); }
        break;
      case 'modem': { // dial tones, then the handshake screech
        this.duck(3.6);
        const dtmf: [number, number][] = [[697, 1209], [770, 1336], [852, 1477], [941, 1209], [697, 1336], [770, 1477], [852, 1209]];
        dtmf.forEach(([a, b], i) => { this.tone(T + i * 0.1, a, 0.08, 'sine', 0.1, dest); this.tone(T + i * 0.1, b, 0.08, 'sine', 0.1, dest); });
        const h = T + 0.9;
        this.tone(h, 2100, 0.45, 'sine', 0.12, dest);
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, h + 0.5); g.gain.linearRampToValueAtTime(0.14, h + 0.6); g.gain.linearRampToValueAtTime(0, h + 2.3);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
        const seq = [1200, 2400, 980, 1800, 1650, 2250, 1320, 2100, 1500, 2700];
        for (let i = 0; i < 26; i++) o.frequency.setValueAtTime(seq[(i * 7) % seq.length], h + 0.5 + i * 0.07);
        o.connect(bp); bp.connect(g); g.connect(dest); o.start(h + 0.5); o.stop(h + 2.35);
        this.hiss(h + 0.5, 1.8, 0.2, dest, { bp: 2500, q: 0.7, attack: 0.3 });
        break;
      }
      case 'glitch':
        this.duck(0.8);
        for (let i = 0; i < 9; i++) note(150 + Math.random() * 2400, 0.035, i % 2 ? 'square' : 'sawtooth', 0.2, i * 0.028 + (i > 5 ? 0.06 : 0));
        this.hiss(T, 0.3, 0.45, dest, { lp: 8000, hp: 1000 });
        note(80, 0.45, 'sawtooth', 0.12, 0.05, 700);
        break;
      case 'pickup': [660, 880, 1320].forEach((f, i) => note(f, 0.09 + i * 0.03, 'square', 0.15, i * 0.055)); break;
      case 'coin': note(988, 0.07, 'square', 0.13); note(1568, 0.28, 'square', 0.13, 0.07); note(3136, 0.15, 'sine', 0.05, 0.07); break;
      case 'insert': { // floppy drive
        this.hiss(T, 0.4, 0.28, dest, { lp: 520, hp: 90, rate: 0.6 });
        [0.04, 0.1, 0.16, 0.2].forEach((at) => this.hiss(T + at, 0.012, 0.5, dest, { hp: 2000 }));
        note(180, 0.2, 'square', 0.07, 0.22, 260);
        note(70, 0.2, 'sine', 0.3, 0.45, 45);
        this.hiss(T + 0.45, 0.06, 0.4, dest, { lp: 900 });
        break;
      }
      case 'open': // link opens: little fanfare
        [523, 659, 784, 1046].forEach((f, i) => { note(f, 0.5, 'triangle', 0.17, i * 0.09); note(f * 2, 0.3, 'sine', 0.05, i * 0.09); });
        [523, 659, 784, 1046].forEach((f) => note(f, 0.9, 'triangle', 0.09, 0.4));
        break;
      case 'scan': // sonar sweep and echo
        note(300, 0.7, 'sine', 0.2, 0, 1800); note(1400, 0.6, 'sine', 0.09, 0.35); note(1400, 0.6, 'sine', 0.05, 0.62);
        break;
      case 'revive': [392, 523, 659, 784, 1046].forEach((f, i) => { note(f, 0.4, 'triangle', 0.17, i * 0.07); note(f * 2, 0.3, 'sine', 0.05, i * 0.07); }); break;
      case 'popup': // error ding-dong
        note(1244, 0.14, 'square', 0.12); note(932, 0.3, 'square', 0.12, 0.13); note(2490, 0.08, 'sine', 0.05, 0);
        break;
      case 'click': this.hiss(T, 0.012, 0.35, dest, { hp: 2500 }); note(1800, 0.025, 'square', 0.07); break;
      case 'squeak': note(2400, 0.09, 'sine', 0.16, 0, 3800); note(2900, 0.08, 'sine', 0.12, 0.11, 4200); break;
      case 'creak': note(70, 0.7, 'sawtooth', 0.07, 0, 50); note(112, 0.5, 'square', 0.035, 0.12, 78); this.hiss(T, 0.6, 0.06, dest, { bp: 300, q: 4, rate: 0.5 }); break;
      case 'radio': { // static with garbled voices behind it
        this.hiss(T, 2.5, 0.3, dest, { lp: 3500, hp: 600 });
        for (let i = 0; i < 14; i++) note(220 + Math.random() * 500, 0.1, 'square', 0.04, 0.15 + i * 0.16 + Math.random() * 0.05);
        break;
      }
      case 'buy': // ka-ching
        this.hiss(T, 0.05, 0.3, dest, { hp: 3000 }); note(2093, 0.5, 'sine', 0.13, 0.03); note(2637, 0.7, 'sine', 0.1, 0.1); note(1046, 0.1, 'square', 0.08, 0);
        break;
      case 'deny': note(120, 0.28, 'square', 0.14); note(126, 0.28, 'square', 0.1); break;
      case 'hide': // locker door
        this.hiss(T, 0.16, 0.5, dest, { lp: 600 }); note(180, 0.12, 'triangle', 0.14, 0.02, 120); note(1300, 0.18, 'sine', 0.03, 0.02);
        break;
      case 'ping': note(1500, 0.14, 'sine', 0.15); note(2250, 0.3, 'sine', 0.06, 0.12); break;
      case 'death':
        note(300, 1.4, 'sawtooth', 0.18, 0, 38); note(305, 1.4, 'square', 0.06, 0, 40); this.hiss(T, 1.2, 0.3, dest, { lp: 1200 });
        note(55, 0.6, 'sine', 0.35, 0.05, 30);
        break;
      case 'soda': { // can pop, fizz, bubbles, and the whump that shoves things back
        this.hiss(T, 0.015, 0.7, dest, { hp: 2500 }); note(3200, 0.04, 'square', 0.1, 0, 900);
        this.hiss(T + 0.04, 1.0, 0.33, dest, { hp: 3500, rate: 1.6 });
        for (let i = 0; i < 16; i++) note(600 + Math.random() * 1700, 0.05, 'sine', 0.06, 0.1 + Math.random() * 0.8, 400 + Math.random() * 2400);
        note(90, 0.35, 'sine', 0.4, 0.03, 30); this.hiss(T + 0.03, 0.25, 0.3, dest, { lp: 500 });
        break;
      }
      case 'konami': { // ascending power-up, then a shiny chord
        const lad = [523, 659, 784, 1046, 1318, 1568, 2093];
        lad.forEach((f, i) => { note(f, 0.1, 'square', 0.1, i * 0.06); note(f * 1.5, 0.08, 'triangle', 0.04, i * 0.06 + 0.03); });
        [1046, 1318, 1568, 2093].forEach((f) => note(f, 1.2, 'triangle', 0.09, 0.45));
        note(130, 0.7, 'sine', 0.2, 0.45);
        break;
      }
      default:
    }
  }

  /** dialogue babble: one blip per two letters, pitch random per character */
  babble(basePitch: number): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.tone(t, basePitch * (0.85 + Math.random() * 0.4), 0.05, 'square', 0.1, this.sfx);
  }
}
