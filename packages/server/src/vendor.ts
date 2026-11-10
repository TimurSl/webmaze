// The vendor's long arms: one per living player. Each arm follows the corridors like a hose.
import {
  ASnap, ItemId, VENDOR, Vec2, centerOf, collide, dist, findPath, pathToWorld, tileOf,
} from '@webmaze/shared';
import type { World, PlayerRT } from './ai';

export const ARM_IDLE = 5;
export const ARM_OFFER = 0;
export const ARM_SNAP = 1;
export const ARM_CHASE = 2;
export const ARM_RETRACT = 3;
export const ARM_FIST = 4;

export class Arm {
  state = ARM_IDLE;
  item: ItemId = 'battery';
  target: string | null = null; // ghost buy-back target
  trail: Vec2[] = [];
  tip: Vec2;
  path: Vec2[] = [];
  repath = 0;
  snapT = 0;
  idleChaseT = 0;
  twitched = false;
  pauseUntil = 0;
  maxLenT = 0;

  constructor(public playerId: string, public tent: Vec2) {
    this.tip = { ...tent };
    this.trail = [{ ...tent }];
  }

  length(): number {
    let l = 0;
    for (let i = 1; i < this.trail.length; i++) l += dist(this.trail[i - 1].x, this.trail[i - 1].z, this.trail[i].x, this.trail[i].z);
    return l + dist(this.trail[this.trail.length - 1].x, this.trail[this.trail.length - 1].z, this.tip.x, this.tip.z);
  }

  offer(item: ItemId, target: string | null): void {
    this.item = item;
    this.target = target;
    this.state = ARM_OFFER;
    this.trail = [{ ...this.tent }];
    this.tip = { x: this.tent.x, z: this.tent.z + VENDOR.offerLen };
    this.path = [];
  }

  /** Advance the arm. Returns events: 'snap' when it shoots out. */
  update(w: World, p: PlayerRT | undefined, dt: number, canAfford: (item: ItemId) => boolean): 'snap' | 'fist' | null {
    let ev: 'snap' | 'fist' | null = null;
    const alive = p && p.st === 0 && p.transitUntil === 0;
    switch (this.state) {
      case ARM_OFFER:
        if (alive && !p!.hidden && dist(this.tent.x, this.tent.z, p!.x, p!.z) <= VENDOR.snapRange) {
          if (!canAfford(this.item)) { this.state = ARM_FIST; ev = 'fist'; break; }
          this.state = ARM_SNAP; this.snapT = 0; this.repath = 0; ev = 'snap';
        }
        break;
      case ARM_SNAP:
      case ARM_CHASE: {
        if (!alive) { this.state = ARM_RETRACT; break; }
        this.snapT += dt;
        if (this.state === ARM_SNAP && this.snapT > 1.2) this.state = ARM_CHASE;
        this.repath -= dt;
        if (this.repath <= 0 || !this.path.length) {
          const f = findPath(w.grid, tileOf(this.tip.x), tileOf(this.tip.z), tileOf(p!.x), tileOf(p!.z));
          if (f) { const pts = pathToWorld(w.grid, f); pts.shift(); if (pts.length) pts[pts.length - 1] = { x: p!.x, z: p!.z }; this.path = pts; }
          this.repath = 0.3;
        }
        const speed = this.state === ARM_SNAP ? VENDOR.snapSpeed : VENDOR.chaseSpeed;
        if (this.length() < VENDOR.maxLen) {
          this.advance(w, speed * dt);
          this.maxLenT = 0;
        } else {
          this.maxLenT += dt;
          if (this.maxLenT > 3) { this.state = ARM_RETRACT; this.twitched = true; }
        }
        // player ran far from the tent: give up
        if (dist(this.tent.x, this.tent.z, p!.x, p!.z) > VENDOR.snapRange + 25) this.state = ARM_RETRACT;
        break;
      }
      case ARM_RETRACT:
      case ARM_FIST: {
        if (w.now < this.pauseUntil) break;
        const speed = this.state === ARM_FIST ? 2 : VENDOR.retractSpeed;
        const total = this.length();
        // twitch once halfway
        if (this.state === ARM_RETRACT && !this.twitched && total < VENDOR.maxLen / 3 + 3) {
          this.twitched = true;
          this.pauseUntil = w.now + 0.7;
          break;
        }
        this.retractBy(speed * dt);
        if (this.trail.length <= 1 && dist(this.tip.x, this.tip.z, this.tent.x, this.tent.z) < 0.5) {
          this.twitched = false;
          if (this.state === ARM_FIST) { this.state = ARM_IDLE; }
          else this.state = ARM_IDLE;
          this.trail = [{ ...this.tent }];
          this.tip = { ...this.tent };
        }
        break;
      }
    }
    return ev;
  }

  private advance(w: World, step: number): void {
    while (this.path.length && step > 0) {
      const t = this.path[0];
      const dx = t.x - this.tip.x, dz = t.z - this.tip.z;
      const d = Math.hypot(dx, dz);
      if (d <= step) { this.tip = { x: t.x, z: t.z }; this.path.shift(); step -= d; } else {
        this.tip = { x: this.tip.x + (dx / d) * step, z: this.tip.z + (dz / d) * step };
        step = 0;
      }
      const last = this.trail[this.trail.length - 1];
      if (dist(last.x, last.z, this.tip.x, this.tip.z) >= 0.8) this.trail.push({ ...this.tip });
    }
    const c = collide(w.grid, this.tip.x, this.tip.z, 0.1);
    this.tip = { x: c.x, z: c.z };
  }

  private retractBy(step: number): void {
    while (step > 0) {
      const target = this.trail.length ? this.trail[this.trail.length - 1] : this.tent;
      const d = dist(this.tip.x, this.tip.z, target.x, target.z);
      if (d <= step) {
        this.tip = { x: target.x, z: target.z };
        step -= d;
        if (this.trail.length > 1) this.trail.pop();
        else { this.trail = [{ ...this.tent }]; this.tip = { ...this.tent }; return; }
      } else {
        this.tip = { x: this.tip.x + ((target.x - this.tip.x) / d) * step, z: this.tip.z + ((target.z - this.tip.z) / d) * step };
        step = 0;
      }
    }
  }

  /** The hand can be grabbed when the fingertips are within reach of the player. */
  canGrab(p: PlayerRT): boolean {
    return (this.state === ARM_SNAP || this.state === ARM_CHASE || this.state === ARM_OFFER) &&
      dist(this.tip.x, this.tip.z, p.x, p.z) <= VENDOR.grabRange + 0.3;
  }

  snap(): ASnap {
    const pts = this.trail.concat([this.tip]);
    // downsample to at most 48 points, always keeping the last
    const step = Math.max(1, Math.ceil(pts.length / 48));
    const t: number[] = [];
    for (let i = 0; i < pts.length; i += step) t.push(round1(pts[i].x), round1(pts[i].z));
    const last = pts[pts.length - 1];
    if (t[t.length - 2] !== round1(last.x) || t[t.length - 1] !== round1(last.z)) t.push(round1(last.x), round1(last.z));
    return { p: this.playerId, s: this.state, item: this.item, t };
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function tentPosition(vendor: { tx: number; tz: number }): Vec2 {
  return { x: centerOf(vendor.tx), z: centerOf(vendor.tz) + 0.4 };
}
