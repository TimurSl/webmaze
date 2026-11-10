// Server-run monsters. Pure simulation: each Mob updates against a World interface the room implements.
import {
  EvMsg, FloorData, FloorParams, Grid, ItemId, MonsterKind, SILHOUETTE, TILE, Vec2, centerOf, collide, dist, findPath,
  los, pathToWorld, tileOf,
} from '@webmaze/shared';
import type { Look } from '@webmaze/shared';

export interface PlayerRT {
  id: string;
  name: string;
  look: Look;
  reroll: number;
  userId: number | null;
  x: number;
  z: number;
  yaw: number;
  flags: number;
  /** measured speed this tick, m/s */
  speed: number;
  st: number; // ST_ALIVE | ST_DOWNED | ST_GHOST
  hidden: string | null; // hide spot id
  popupUntil: number;
  downedAt: number;
  bleedLeft: number;
  reviveProg: number;
  reviveBy: string | null;
  reviveLast: number;
  battery: number;
  inv: (ItemId | null)[];
  glow: number;
  disks: number;
  passives: { sprint: number; shoes: boolean; scanner: boolean; ctrlz: boolean };
  transitUntil: number; // >0: left behind, pulled through at this time
  disconnected: boolean;
  scanReady: number;
  lastPosAt: number;
  noise: number; // noise radius this tick
  seenKinds: Set<string>;
  downedThisFloor: boolean;
  holdPrompt: number;
}

export interface World {
  grid: Grid;
  floor: FloorData;
  params: FloorParams;
  now: number;
  speedMult: number;
  players: PlayerRT[];
  mobs: Mob[];
  radios: { x: number; z: number; until: number }[];
  noises: { x: number; z: number; until: number }[];
  hideUse: Map<string, number>;
  hearingMult: number;
  alive(): PlayerRT[];
  down(p: PlayerRT, by: string): void;
  emit(ev: EvMsg): void;
  rnd(): number;
}

export const ST_WANDER = 0;
export const ST_STALK = 1;
export const ST_HUNT = 2;
export const ST_SEARCH = 3;
export const ST_RETREAT = 4;

const RADIUS = 0.35;

export abstract class Mob {
  yaw = 0;
  state = ST_WANDER;
  path: Vec2[] = [];
  repath = 0;
  /** copied player (mimic) */
  copy?: string;
  constructor(public id: string, public kind: MonsterKind, public x: number, public z: number) {}

  abstract update(w: World, dt: number): void;

  protected plan(w: World, tx: number, tz: number): void {
    const p = findPath(w.grid, tileOf(this.x), tileOf(this.z), tileOf(tx), tileOf(tz));
    if (!p) { this.path = []; return; }
    const pts = pathToWorld(w.grid, p);
    pts.shift();
    if (pts.length) pts[pts.length - 1] = { x: tx, z: tz };
    this.path = pts;
  }

  /** walk along the planned path; returns true when the path is finished */
  protected follow(w: World, speed: number, dt: number): boolean {
    let step = speed * dt;
    while (this.path.length && step > 0) {
      // string-pull: skip a waypoint if the one after it is directly visible
      while (this.path.length > 1 && los(w.grid, this.x, this.z, this.path[1].x, this.path[1].z)) this.path.shift();
      const t = this.path[0];
      const dx = t.x - this.x, dz = t.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d <= step) {
        this.x = t.x; this.z = t.z; this.path.shift(); step -= d;
      } else {
        this.x += (dx / d) * step; this.z += (dz / d) * step;
        this.yaw = Math.atan2(-dx, -dz);
        step = 0;
      }
    }
    const c = collide(w.grid, this.x, this.z, RADIUS);
    this.x = c.x; this.z = c.z;
    return this.path.length === 0;
  }

  protected randomTarget(w: World, minTiles = 6): Vec2 {
    const f = w.floor;
    for (let i = 0; i < 20; i++) {
      const i2 = Math.floor(w.rnd() * f.cells), j2 = Math.floor(w.rnd() * f.cells);
      const tx = 2 * i2 + 1, tz = 2 * j2 + 1;
      if (Math.abs(tx - tileOf(this.x)) + Math.abs(tz - tileOf(this.z)) >= minTiles) return { x: centerOf(tx), z: centerOf(tz) };
    }
    return { x: this.x, z: this.z };
  }
}

function forward(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function angleBetween(yaw: number, dx: number, dz: number): number {
  const f = forward(yaw);
  const l = Math.hypot(dx, dz) || 1;
  const dot = (f.x * dx + f.z * dz) / l;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Is monster (mx,mz) inside any living player's field of view? */
export function watchedBy(w: World, mx: number, mz: number, range = 45, halfFov = 0.95): PlayerRT | null {
  for (const p of w.alive()) {
    if (p.hidden) continue;
    const dx = mx - p.x, dz = mz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    if (d > 1.2 && angleBetween(p.yaw, dx, dz) > halfFov) continue;
    if (los(w.grid, p.x, p.z, mx, mz)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------

export class Silhouette extends Mob {
  target: PlayerRT | null = null;
  lastSeen: { x: number; z: number } | null = null;
  heard: { x: number; z: number } | null = null;
  loseT = 0;
  searchT = 0;
  searchPts: Vec2[] = [];
  distractUntil = 0;
  distractAt: Vec2 | null = null;
  retreatUntil = 0;
  wasHunting = false;

  constructor(id: string, x: number, z: number) {
    super(id, 'silhouette', x, z);
  }

  retreat(w: World, secs: number): void {
    this.retreatUntil = w.now + secs;
    this.state = ST_RETREAT;
    this.target = null;
    this.path = [];
  }

  private huntSpeed(w: World): number {
    return w.params.huntSpeed * w.speedMult;
  }

  private sees(w: World, p: PlayerRT): boolean {
    const lit = (p.flags & 4) !== 0 && p.battery > 0;
    const range = lit ? SILHOUETTE.sightLitRange : SILHOUETTE.sightRange;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > 3 && angleBetween(this.yaw, dx, dz) > SILHOUETTE.sightHalfAngle) return false;
    return los(w.grid, this.x, this.z, p.x, p.z);
  }

  private hears(w: World, p: PlayerRT): boolean {
    if (p.noise <= 0) return false;
    return dist(this.x, this.z, p.x, p.z) <= p.noise * w.hearingMult;
  }

  update(w: World, dt: number): void {
    const alive = w.alive();

    // catch anyone within reach (hunting or stalking)
    if (this.state === ST_HUNT || this.state === ST_STALK) {
      for (const p of alive) {
        if (p.hidden) continue;
        if (dist(this.x, this.z, p.x, p.z) <= SILHOUETTE.catchRange) { w.down(p, this.id); this.onCatch(w); break; }
      }
    }

    // radio distraction overrides everything for 10 s
    for (const r of w.radios) {
      if (r.until > w.now && dist(this.x, this.z, r.x, r.z) < 60 && this.distractUntil < r.until) {
        this.distractUntil = r.until;
        this.distractAt = { x: r.x, z: r.z };
        this.plan(w, r.x, r.z);
        this.state = ST_STALK;
        this.target = null;
      }
    }
    if (this.distractUntil > w.now && this.distractAt) {
      if (this.path.length) this.follow(w, this.state === ST_HUNT ? this.huntSpeed(w) : SILHOUETTE.stalk * 1.4, dt);
      return;
    }

    if (this.state === ST_RETREAT) {
      if (w.now >= this.retreatUntil) { this.state = ST_WANDER; this.path = []; return; }
      if (!this.path.length) {
        const far = this.farFromPlayers(w);
        this.plan(w, far.x, far.z);
      }
      this.follow(w, SILHOUETTE.search, dt);
      return;
    }

    // ---- senses ----
    let seen: PlayerRT | null = null;
    let heard: PlayerRT | null = null;
    let bestD = Infinity;
    for (const p of alive) {
      if (p.hidden) continue;
      const d = dist(this.x, this.z, p.x, p.z);
      if (this.sees(w, p) && d < bestD) { seen = p; bestD = d; }
    }
    if (!seen) {
      bestD = Infinity;
      for (const p of alive) {
        if (p.hidden) continue;
        const d = dist(this.x, this.z, p.x, p.z);
        if (this.hears(w, p) && d < bestD) { heard = p; bestD = d; }
      }
    }
    // rat squeaks are noises too
    let noisePos: Vec2 | null = null;
    if (!seen && !heard) {
      for (const n of w.noises) {
        if (n.until > w.now && dist(this.x, this.z, n.x, n.z) < 70) { noisePos = { x: n.x, z: n.z }; break; }
      }
    }

    if (seen) {
      if (this.state !== ST_HUNT) w.emit({ k: 'stinger', which: 'modem' });
      this.state = ST_HUNT;
      this.target = seen;
      this.loseT = 0;
      this.lastSeen = { x: seen.x, z: seen.z };
    } else if (this.state === ST_HUNT) {
      this.loseT += dt;
      if (this.loseT >= SILHOUETTE.loseSightTime) {
        this.state = ST_SEARCH;
        this.searchT = 0;
        this.target = null;
        this.buildSearch(w);
      }
    } else if (heard || noisePos) {
      const at = heard ? { x: heard.x, z: heard.z } : noisePos!;
      if (this.state !== ST_STALK || !this.heard || dist(this.heard.x, this.heard.z, at.x, at.z) > 4) {
        this.heard = at;
        this.plan(w, at.x, at.z);
      }
      this.state = ST_STALK;
    }

    // ---- behaviour ----
    switch (this.state) {
      case ST_HUNT: {
        const t = this.target;
        this.repath -= dt;
        const goal = t && this.loseT === 0 ? { x: t.x, z: t.z } : this.lastSeen;
        if (goal && (this.repath <= 0 || !this.path.length)) { this.plan(w, goal.x, goal.z); this.repath = 0.35; }
        this.follow(w, this.huntSpeed(w), dt);
        break;
      }
      case ST_STALK: {
        const done = this.follow(w, SILHOUETTE.stalk, dt);
        if (done) { this.state = ST_SEARCH; this.searchT = 0; this.lastSeen = this.heard; this.buildSearch(w); }
        break;
      }
      case ST_SEARCH: {
        this.searchT += dt;
        // check hiding spots near the last known position; known (used twice) spots first
        if (!this.path.length) {
          const next = this.searchPts.shift();
          if (next) this.plan(w, next.x, next.z);
        }
        this.follow(w, SILHOUETTE.search, dt);
        for (const p of alive) {
          if (p.hidden) {
            const h = w.floor.hides.find((hh) => hh.id === p.hidden);
            if (h && dist(this.x, this.z, h.x, h.z) < 1.6 && this.searchingSpot(h.id)) {
              w.hideUse.set(h.id, (w.hideUse.get(h.id) ?? 0) + 1);
              w.down(p, this.id); this.onCatch(w); break;
            }
          } else if (dist(this.x, this.z, p.x, p.z) < SILHOUETTE.catchRange) {
            w.down(p, this.id); this.onCatch(w); break;
          }
        }
        if (this.searchT > 12) { this.state = ST_WANDER; this.path = []; }
        break;
      }
      default: {
        if (!this.path.length) {
          const t = this.randomTarget(w);
          this.plan(w, t.x, t.z);
        }
        this.follow(w, SILHOUETTE.wander, dt);
      }
    }
  }

  private searchingSpot(_id: string): boolean {
    return true;
  }

  private onCatch(w: World): void {
    this.state = ST_SEARCH;
    this.searchT = 0;
    this.target = null;
    this.path = [];
    this.buildSearch(w);
  }

  private buildSearch(w: World): void {
    const c = this.lastSeen ?? { x: this.x, z: this.z };
    const hides = w.floor.hides
      .filter((h) => dist(h.x, h.z, c.x, c.z) < 12 * TILE)
      .sort((a, b) => (w.hideUse.get(b.id) ?? 0) - (w.hideUse.get(a.id) ?? 0) || dist(a.x, a.z, c.x, c.z) - dist(b.x, b.z, c.x, c.z));
    // spots that were used twice are checked first; unknown spots only sometimes
    const pts: Vec2[] = [];
    for (const h of hides) {
      const uses = w.hideUse.get(h.id) ?? 0;
      if (uses >= 2 || w.rnd() < 0.3) pts.push({ x: h.x, z: h.z });
    }
    pts.push(this.randomAround(w, c));
    this.searchPts = pts.slice(0, 4);
    this.path = [];
  }

  private randomAround(w: World, c: Vec2): Vec2 {
    for (let i = 0; i < 12; i++) {
      const tx = tileOf(c.x) + Math.floor((w.rnd() - 0.5) * 12), tz = tileOf(c.z) + Math.floor((w.rnd() - 0.5) * 12);
      if (tx > 0 && tz > 0 && tx < w.grid.cols && tz < w.grid.rows && !w.grid.solid[tz * w.grid.cols + tx]) return { x: centerOf(tx), z: centerOf(tz) };
    }
    return c;
  }

  private farFromPlayers(w: World): Vec2 {
    let best = this.randomTarget(w), bestD = -1;
    for (let i = 0; i < 8; i++) {
      const t = this.randomTarget(w, 4);
      let d = Infinity;
      for (const p of w.alive()) d = Math.min(d, dist(t.x, t.z, p.x, p.z));
      if (d > bestD) { bestD = d; best = t; }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------

/** Harmless scout. Squeaks when it sees you, which pulls the Silhouette toward you. */
export class Rat extends Mob {
  cooldown = 0;
  fleeUntil = 0;
  constructor(id: string, x: number, z: number) {
    super(id, 'rat', x, z);
  }
  update(w: World, dt: number): void {
    this.cooldown -= dt;
    if (w.now < this.fleeUntil) {
      if (!this.path.length) { const t = this.randomTarget(w, 8); this.plan(w, t.x, t.z); }
      this.follow(w, 4, dt);
      return;
    }
    if (this.cooldown <= 0) {
      for (const p of w.alive()) {
        if (p.hidden) continue;
        const crouching = (p.flags & 1) !== 0;
        const d = dist(this.x, this.z, p.x, p.z);
        if (d < (crouching ? 3 : 12) && los(w.grid, this.x, this.z, p.x, p.z)) {
          w.noises.push({ x: p.x, z: p.z, until: w.now + 4 });
          w.emit({ k: 'stinger', which: 'fake-step' });
          this.cooldown = 12;
          this.fleeUntil = w.now + 4;
          this.state = ST_RETREAT;
          this.path = [];
          return;
        }
      }
    }
    this.state = ST_WANDER;
    if (!this.path.length) { const t = this.randomTarget(w, 4); this.plan(w, t.x, t.z); }
    this.follow(w, 1.5, dt);
  }
}

/** Moves only while nobody is looking at it. */
export class Mannequin extends Mob {
  constructor(id: string, x: number, z: number) {
    super(id, 'mannequin', x, z);
  }
  update(w: World, dt: number): void {
    const alive = w.alive();
    if (!alive.length) return;
    // catch
    for (const p of alive) {
      if (!p.hidden && dist(this.x, this.z, p.x, p.z) <= SILHOUETTE.catchRange) { w.down(p, this.id); return; }
    }
    if (watchedBy(w, this.x, this.z)) { this.state = ST_STALK; return; }
    this.state = ST_HUNT;
    this.repath -= dt;
    if (this.repath <= 0) {
      let best: PlayerRT | null = null, bd = Infinity;
      for (const p of alive) {
        if (p.hidden) continue;
        const d = dist(this.x, this.z, p.x, p.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) this.plan(w, best.x, best.z);
      this.repath = 0.5;
    }
    this.follow(w, 4 * w.speedMult, dt);
  }
}

/** Copies a teammate. Walks slightly wrong. Flees when scanned. */
export class Mimic extends Mob {
  fleeUntil = 0;
  constructor(id: string, x: number, z: number, copy: string) {
    super(id, 'mimic', x, z);
    this.copy = copy;
  }
  scare(w: World): void {
    this.fleeUntil = w.now + 8;
    this.path = [];
  }
  update(w: World, dt: number): void {
    const alive = w.alive();
    if (!alive.length) return;
    if (w.now < this.fleeUntil) {
      if (!this.path.length) { const t = this.randomTarget(w, 10); this.plan(w, t.x, t.z); }
      this.follow(w, 5, dt);
      return;
    }
    for (const p of alive) {
      if (!p.hidden && dist(this.x, this.z, p.x, p.z) <= 1.1) { w.down(p, this.id); this.fleeUntil = w.now + 6; return; }
    }
    this.repath -= dt;
    if (this.repath <= 0) {
      let best: PlayerRT | null = null, bd = Infinity;
      for (const p of alive) {
        if (p.hidden) continue;
        const d = dist(this.x, this.z, p.x, p.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) this.plan(w, best.x, best.z);
      this.repath = 0.8;
    }
    this.state = ST_STALK;
    this.follow(w, 2.2, dt);
  }
}
