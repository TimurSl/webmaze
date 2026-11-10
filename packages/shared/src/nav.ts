// Grid helpers shared by client (collision, map) and server (monsters, vendor arms, validation).
import { TILE } from './config';

export interface Grid {
  cols: number;
  rows: number;
  solid: Uint8Array;
}

export interface Vec2 {
  x: number;
  z: number;
}

export const tileOf = (v: number): number => Math.floor(v / TILE);
export const centerOf = (t: number): number => (t + 0.5) * TILE;

export function isSolid(g: Grid, tx: number, tz: number): boolean {
  if (tx < 0 || tz < 0 || tx >= g.cols || tz >= g.rows) return true;
  return g.solid[tz * g.cols + tx] === 1;
}

export function solidAt(g: Grid, x: number, z: number): boolean {
  return isSolid(g, tileOf(x), tileOf(z));
}

/** BFS distance in tiles (4-neighbour) from a tile. -1 = unreachable or wall. */
export function bfsDist(g: Grid, sx: number, sz: number): Int32Array {
  const dist = new Int32Array(g.cols * g.rows).fill(-1);
  if (isSolid(g, sx, sz)) return dist;
  const q = new Int32Array(g.cols * g.rows);
  let h = 0;
  let t = 0;
  const s = sz * g.cols + sx;
  dist[s] = 0;
  q[t++] = s;
  while (h < t) {
    const cur = q[h++];
    const cx = cur % g.cols;
    const cz = (cur / g.cols) | 0;
    const d = dist[cur] + 1;
    if (cx > 0 && !g.solid[cur - 1] && dist[cur - 1] < 0) { dist[cur - 1] = d; q[t++] = cur - 1; }
    if (cx < g.cols - 1 && !g.solid[cur + 1] && dist[cur + 1] < 0) { dist[cur + 1] = d; q[t++] = cur + 1; }
    if (cz > 0 && !g.solid[cur - g.cols] && dist[cur - g.cols] < 0) { dist[cur - g.cols] = d; q[t++] = cur - g.cols; }
    if (cz < g.rows - 1 && !g.solid[cur + g.cols] && dist[cur + g.cols] < 0) { dist[cur + g.cols] = d; q[t++] = cur + g.cols; }
  }
  return dist;
}

// ---- A* -------------------------------------------------------------------

class MinHeap {
  keys: number[] = [];
  vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length > 0) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over tiles with 8-way movement and no corner cutting.
 * Returns tile indices (tz*cols+tx) from start to goal inclusive, or null.
 */
export function findPath(g: Grid, sx: number, sz: number, tx: number, tz: number): number[] | null {
  if (isSolid(g, sx, sz) || isSolid(g, tx, tz)) return null;
  const n = g.cols * g.rows;
  const start = sz * g.cols + sx;
  const goal = tz * g.cols + tx;
  if (start === goal) return [start];
  const gScore = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const hfn = (i: number): number => {
    const dx = Math.abs((i % g.cols) - tx);
    const dz = Math.abs(((i / g.cols) | 0) - tz);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  gScore[start] = 0;
  heap.push(hfn(start), start);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      const path: number[] = [];
      for (let c = cur; c !== -1; c = from[c]) path.push(c);
      return path.reverse();
    }
    const cx = cur % g.cols;
    const cz = (cur / g.cols) | 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx, nz = cz + dz;
        if (isSolid(g, nx, nz)) continue;
        if (dx !== 0 && dz !== 0 && (isSolid(g, cx + dx, cz) || isSolid(g, cx, cz + dz))) continue;
        const ni = nz * g.cols + nx;
        if (closed[ni]) continue;
        const ng = gScore[cur] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          from[ni] = cur;
          heap.push(ng + hfn(ni), ni);
        }
      }
    }
  }
  return null;
}

/** Tile-index path -> world-space waypoints (tile centres). */
export function pathToWorld(g: Grid, path: number[]): Vec2[] {
  return path.map((i) => ({ x: centerOf(i % g.cols), z: centerOf((i / g.cols) | 0) }));
}

// ---- line of sight --------------------------------------------------------

/** Grid DDA: true when no solid tile lies between the two world points. */
export function los(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  let x = ax / TILE, z = az / TILE;
  const ex = bx / TILE, ez = bz / TILE;
  let tx = Math.floor(x), tz = Math.floor(z);
  const etx = Math.floor(ex), etz = Math.floor(ez);
  if (isSolid(g, tx, tz)) return false;
  const dx = ex - x, dz = ez - z;
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tDx = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tDz = dz === 0 ? Infinity : Math.abs(1 / dz);
  let tMx = dx === 0 ? Infinity : ((dx > 0 ? tx + 1 - x : x - tx)) * tDx;
  let tMz = dz === 0 ? Infinity : ((dz > 0 ? tz + 1 - z : z - tz)) * tDz;
  let guard = 0;
  while ((tx !== etx || tz !== etz) && guard++ < 512) {
    if (tMx < tMz) { tMx += tDx; tx += sx; } else { tMz += tDz; tz += sz; }
    if (isSolid(g, tx, tz)) return false;
  }
  x = 0; z = 0;
  return true;
}

// ---- collision ------------------------------------------------------------

/** Push a circle out of solid tiles. Returns the corrected position. */
export function collide(g: Grid, x: number, z: number, r: number): Vec2 {
  for (let pass = 0; pass < 2; pass++) {
    const tx0 = tileOf(x), tz0 = tileOf(z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = tx0 + dx, tz = tz0 + dz;
        if (!isSolid(g, tx, tz)) continue;
        const minX = tx * TILE, maxX = minX + TILE, minZ = tz * TILE, maxZ = minZ + TILE;
        const cx = Math.max(minX, Math.min(x, maxX));
        const cz = Math.max(minZ, Math.min(z, maxZ));
        const ox = x - cx, oz = z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-9) {
          // centre is inside the tile: push out through the nearest face
          const l = x - minX, rr = maxX - x, t = z - minZ, b = maxZ - z;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = minX - r; else if (m === rr) x = maxX + r; else if (m === t) z = minZ - r; else z = maxZ + r;
        } else {
          const d = Math.sqrt(d2);
          x = cx + (ox / d) * r;
          z = cz + (oz / d) * r;
        }
      }
    }
  }
  return { x, z };
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.sqrt(dist2(ax, az, bx, bz));
}
