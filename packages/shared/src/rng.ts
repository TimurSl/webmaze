// Deterministic seeded RNG. Everything that generates a floor goes through here so
// the browser and the server produce byte-identical worlds from the same seed.

/** 32-bit string hash (xmur3 style). */
export function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private f: () => number;
  constructor(seed: number) {
    this.f = mulberry32(seed);
  }
  /** float in [0,1) */
  next(): number {
    return this.f();
  }
  /** float in [a,b) */
  range(a: number, b: number): number {
    return a + (b - a) * this.f();
  }
  /** integer in [min,max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.f() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.f() * arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += weight(it);
    let r = this.f() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}

/** RNG for one floor of one run. `salt` splits independent streams (layout, props, ...). */
export function rngFor(runSeed: string, floor: number, salt = ''): Rng {
  return new Rng(hashString(`${runSeed}|${floor}|${salt}`));
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-friendly shareable seed code, e.g. "K7QX2MPA". */
export function randomSeedCode(len = 8, rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += SEED_ALPHABET[Math.floor(rnd() * SEED_ALPHABET.length)];
  return s;
}

/** 6-letter room code. */
export function randomRoomCode(rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(rnd() * 24)];
  return s;
}
