// Seeded floor generator. Client and server both call generateFloor(runSeed, floor) and get
// identical layouts, so only the seed ever crosses the network.
import { TILE, floorParams, isGuestbook } from './config';
import { Look, randomLook } from './character';
import { Grid, bfsDist, centerOf } from './nav';
import { PALETTES } from './palettes';
import { Rng, rngFor } from './rng';
import { generateSecretRoom } from './secret';
import {
  ANOMALIES, FLOOR_ITEMS, FLOOR_TYPES, FloorType, ItemId, MonsterKind, NPC_KINDS, NPC_NAMES, NpcKind, PROP_KINDS, PropKind,
} from './tables';

export interface TilePos { tx: number; tz: number }
export interface Entity extends TilePos { id: string; kind: string; sub?: string; x: number; z: number }
export interface Room { tx0: number; tz0: number; tx1: number; tz1: number }
export interface Prop extends TilePos { id: string; kind: PropKind; scale: number; rot: number; x: number; z: number }
export interface CrowdMember { x: number; z: number; v: number }
export interface Crowd { id: string; room: number; members: CrowdMember[] }
export interface Npc extends TilePos {
  id: string; kind: NpcKind; name: string; mimic: boolean; line: number; item?: ItemId; look: Look; x: number; z: number;
}
export interface HideSpot extends TilePos { id: string; x: number; z: number; face: number }
/** Secret room only: a monster standing still on display. */
export interface Exhibit { kind: MonsterKind; x: number; z: number }

export interface FloorFlags {
  /** peaceful run: every floor type from floor 2, more anomalies and GIFs, no mannequin crowds */
  discovery?: boolean;
  /** the Konami secret room instead of a numbered floor */
  secret?: boolean;
}

export interface FloorData extends Grid {
  seed: string;
  floor: number;
  type: FloorType;
  palette: number;
  wallpaper: number;
  cells: number;
  rooms: Room[];
  entry: TilePos;
  terminal: TilePos | null;
  exit: TilePos;
  vendor: TilePos | null;
  disks: Entity[];
  items: Entity[];
  gifs: Entity[];
  anomalies: Entity[];
  bellTrees: Entity[];
  props: Prop[];
  crowds: Crowd[];
  npcs: Npc[];
  hides: HideSpot[];
  monsterSpawns: TilePos[];
  ratSpawns: TilePos[];
  /** flip maze only: second layout rendered as the ceiling */
  ceilSolid: Uint8Array | null;
  /** true for the Konami secret room (rendered like a guestbook floor) */
  secret?: boolean;
  exhibits?: Exhibit[];
}

export function rollFloorType(rng: Rng, floor: number, discovery = false): FloorType {
  if (floor <= 1) return 'wallpaper';
  // discovery mode shows every kind of floor straight away
  const pool = FLOOR_TYPES.filter((t) => t.weight > 0 && (discovery || t.from <= floor));
  return rng.weighted(pool, (t) => t.weight).id;
}

/** Recursive-backtracker maze on an n*n cell grid, returned as a (2n+1)^2 tile mask (1 = wall). */
function carveMaze(n: number, rng: Rng): Uint8Array {
  const cols = 2 * n + 1;
  const solid = new Uint8Array(cols * cols).fill(1);
  const visited = new Uint8Array(n * n);
  const sx = rng.int(0, n - 1), sz = rng.int(0, n - 1);
  const stack: number[] = [sz * n + sx];
  visited[sz * n + sx] = 1;
  solid[(2 * sz + 1) * cols + (2 * sx + 1)] = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const cx = cur % n, cz = (cur / n) | 0;
    const opts: number[][] = [];
    for (const d of dirs) {
      const nx = cx + d[0], nz = cz + d[1];
      if (nx >= 0 && nz >= 0 && nx < n && nz < n && !visited[nz * n + nx]) opts.push(d);
    }
    if (!opts.length) { stack.pop(); continue; }
    const d = rng.pick(opts);
    const nx = cx + d[0], nz = cz + d[1];
    solid[(2 * cz + 1 + d[1]) * cols + (2 * cx + 1 + d[0])] = 0;
    solid[(2 * nz + 1) * cols + (2 * nx + 1)] = 0;
    visited[nz * n + nx] = 1;
    stack.push(nz * n + nx);
  }
  return solid;
}

export function generateFloor(runSeed: string, floor: number, flags: FloorFlags = {}): FloorData {
  if (flags.secret) return generateSecretRoom(runSeed);
  const discovery = !!flags.discovery;
  const rng = rngFor(runSeed, floor, 'layout');
  const guest = isGuestbook(floor);
  const type: FloorType = guest ? 'guestbook' : rollFloorType(rng, floor, discovery);
  const palette = rng.int(0, PALETTES.length - 1);
  const wallpaper = rng.int(0, 3);
  const n = guest ? 7 : floorParams(floor).cells;
  const cols = 2 * n + 1;
  const rows = cols;
  const solid = carveMaze(n, rng);
  const at = (tx: number, tz: number): number => tz * cols + tx;

  // ---- rooms ----
  const rooms: Room[] = [];
  const carveRoom = (ci: number, cj: number, w: number, h: number): void => {
    const r: Room = { tx0: 2 * ci + 1, tz0: 2 * cj + 1, tx1: 2 * (ci + w) - 1, tz1: 2 * (cj + h) - 1 };
    for (let z = r.tz0; z <= r.tz1; z++) for (let x = r.tx0; x <= r.tx1; x++) solid[at(x, z)] = 0;
    rooms.push(r);
  };
  const roomsOverlap = (ci: number, cj: number, w: number, h: number): boolean =>
    rooms.some((r) => {
      const a0 = (r.tx0 - 1) / 2, b0 = (r.tz0 - 1) / 2, a1 = (r.tx1 - 1) / 2, b1 = (r.tz1 - 1) / 2;
      return !(ci + w - 1 < a0 - 1 || ci > a1 + 1 || cj + h - 1 < b0 - 1 || cj > b1 + 1);
    });
  let vendor: TilePos | null = null;
  if (guest) {
    const c = Math.floor((n - 3) / 2);
    carveRoom(c, c, 3, 3);
    // tent against the hub's north wall, centred
    vendor = { tx: 2 * c + 3, tz: 2 * c + 1 };
  } else {
    let target = rng.int(2, Math.min(5, 1 + Math.floor(n / 4)));
    if (type === 'geocities') target = Math.min(target + 2, 6);
    for (let attempt = 0; attempt < 60 && rooms.length < target; attempt++) {
      const w = rng.int(2, 3), h = rng.int(2, 3);
      const ci = rng.int(0, n - w), cj = rng.int(0, n - h);
      if (!roomsOverlap(ci, cj, w, h)) carveRoom(ci, cj, w, h);
    }
  }

  // ---- loops: knock out 10-15% of the remaining interior walls ----
  const walls: number[] = [];
  for (let z = 1; z < rows - 1; z++) {
    for (let x = 1; x < cols - 1; x++) {
      if (!solid[at(x, z)]) continue;
      const ox = x & 1, oz = z & 1;
      if (ox === oz) continue; // pillar, not a wall between two cells
      const a = ox ? solid[at(x, z - 1)] : solid[at(x - 1, z)];
      const b = ox ? solid[at(x, z + 1)] : solid[at(x + 1, z)];
      if (!a && !b) walls.push(at(x, z));
    }
  }
  rng.shuffle(walls);
  const knock = Math.floor(walls.length * rng.range(0.1, 0.15));
  for (let i = 0; i < knock; i++) solid[walls[i]] = 0;

  const grid: Grid = { cols, rows, solid };

  // ---- cell helpers ----
  const cellCenters: TilePos[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cellCenters.push({ tx: 2 * i + 1, tz: 2 * j + 1 });
  const openNeighbours = (tx: number, tz: number): number =>
    (solid[at(tx + 1, tz)] ? 0 : 1) + (solid[at(tx - 1, tz)] ? 0 : 1) + (solid[at(tx, tz + 1)] ? 0 : 1) + (solid[at(tx, tz - 1)] ? 0 : 1);
  const inRoom = (p: TilePos): boolean => rooms.some((r) => p.tx >= r.tx0 && p.tx <= r.tx1 && p.tz >= r.tz0 && p.tz <= r.tz1);
  const used = new Set<number>();
  const take = (p: TilePos): void => { used.add(at(p.tx, p.tz)); };
  const free = (p: TilePos): boolean => !used.has(at(p.tx, p.tz));

  // ---- entry, exit, terminal ----
  const corners: TilePos[] = [
    { tx: 1, tz: 1 }, { tx: cols - 2, tz: 1 }, { tx: 1, tz: rows - 2 }, { tx: cols - 2, tz: rows - 2 },
  ];
  const entry = rng.pick(corners);
  const dEntry = bfsDist(grid, entry.tx, entry.tz);
  let exit = cellCenters[0];
  let best = -1;
  for (const c of cellCenters) {
    const d = dEntry[at(c.tx, c.tz)];
    if (d > best) { best = d; exit = c; }
  }
  const maxD = best;
  const dExit = bfsDist(grid, exit.tx, exit.tz);
  take(entry); take(exit);

  let terminal: TilePos | null = null;
  if (!guest) {
    const ranked = cellCenters
      .filter((c) => free(c))
      .map((c) => ({ c, s: Math.min(dEntry[at(c.tx, c.tz)], dExit[at(c.tx, c.tz)]) }))
      .sort((a, b) => b.s - a.s);
    terminal = rng.pick(ranked.slice(0, 3)).c;
    take(terminal);
  }
  if (vendor) take(vendor);

  const jitter = (p: TilePos, amt: number): { x: number; z: number } => ({
    x: centerOf(p.tx) + rng.range(-amt, amt) * TILE,
    z: centerOf(p.tz) + rng.range(-amt, amt) * TILE,
  });
  const mk = (id: string, kind: string, p: TilePos, sub?: string, amt = 0.25): Entity => {
    const j = jitter(p, amt);
    return { id, kind, sub, tx: p.tx, tz: p.tz, x: j.x, z: j.z };
  };

  const disks: Entity[] = [];
  const items: Entity[] = [];
  const gifs: Entity[] = [];
  const anomalies: Entity[] = [];
  const bellTrees: Entity[] = [];
  const props: Prop[] = [];
  const crowds: Crowd[] = [];
  const npcs: Npc[] = [];
  const hides: HideSpot[] = [];
  const monsterSpawns: TilePos[] = [];
  const ratSpawns: TilePos[] = [];

  if (!guest) {
    // ---- 3 disks in dead ends or rooms, spaced apart ----
    const cand = rng.shuffle(
      cellCenters.filter((c) => free(c) && dEntry[at(c.tx, c.tz)] >= 8 && (openNeighbours(c.tx, c.tz) === 1 || inRoom(c))),
    );
    const cand2 = rng.shuffle(cellCenters.filter((c) => free(c) && dEntry[at(c.tx, c.tz)] >= 4));
    const chosen: TilePos[] = [];
    for (let spacing = 8; spacing >= 0 && chosen.length < 3; spacing--) {
      for (const c of cand.concat(cand2)) {
        if (chosen.length >= 3) break;
        if (chosen.includes(c)) continue;
        if (chosen.every((o) => (Math.abs(o.tx - c.tx) + Math.abs(o.tz - c.tz)) / 2 >= spacing)) chosen.push(c);
      }
    }
    chosen.forEach((c, i) => { take(c); disks.push(mk(`d${i}`, 'disk', c, undefined, 0.2)); });

    // ---- bell trees ----
    const bt = rng.int(2, 6);
    const btCand = rng.shuffle(cellCenters.filter((c) => free(c) && dEntry[at(c.tx, c.tz)] >= 6));
    for (let i = 0; i < Math.min(bt, btCand.length); i++) { take(btCand[i]); bellTrees.push(mk(`b${i}`, 'belltree', btCand[i], undefined, 0.2)); }

    // ---- props in rooms ----
    let pid = 0;
    rooms.forEach((r) => {
      const count = rng.int(1, 4);
      for (let i = 0; i < count; i++) {
        const tx = rng.int(r.tx0, r.tx1), tz = rng.int(r.tz0, r.tz1);
        const j = jitter({ tx, tz }, 0.3);
        props.push({ id: `p${pid++}`, kind: rng.pick(PROP_KINDS), tx, tz, scale: rng.range(0.8, 1.4), rot: rng.range(0, Math.PI * 2), x: j.x, z: j.z });
      }
    });

    // ---- mannequin crowd (floor 3+) ----
    if (floor >= 3 && !discovery && rooms.length && type !== 'chatroom' && rng.chance(0.6)) {
      let ri = 0;
      rooms.forEach((r, i) => {
        const a = (r.tx1 - r.tx0 + 1) * (r.tz1 - r.tz0 + 1), b = (rooms[ri].tx1 - rooms[ri].tx0 + 1) * (rooms[ri].tz1 - rooms[ri].tz0 + 1);
        if (a > b) ri = i;
      });
      const r = rooms[ri];
      const count = rng.int(10, 40);
      const spots: CrowdMember[] = [];
      const x0 = r.tx0 * TILE + 1, x1 = (r.tx1 + 1) * TILE - 1, z0 = r.tz0 * TILE + 1, z1 = (r.tz1 + 1) * TILE - 1;
      for (let tries = 0; tries < 400 && spots.length < count; tries++) {
        const x = rng.range(x0, x1), z = rng.range(z0, z1);
        if (spots.every((s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) > 0.9 * 0.9)) spots.push({ x, z, v: rng.int(0, 4) });
      }
      crowds.push({ id: 'c0', room: ri, members: spots });
    }

    // ---- NPCs (0-2) ----
    const npcCount = type === 'chatroom' ? 2 : rng.int(0, 2);
    const npcCand = rng.shuffle(cellCenters.filter((c) => free(c) && dEntry[at(c.tx, c.tz)] >= 3));
    for (let i = 0; i < Math.min(npcCount, npcCand.length); i++) {
      const p = npcCand[i];
      take(p);
      const j = jitter(p, 0.2);
      const kind = rng.pick(NPC_KINDS);
      npcs.push({
        id: `n${i}`, kind, name: rng.pick(NPC_NAMES), mimic: rng.chance(1 / 8), line: rng.int(0, 5),
        item: kind === 'trade' ? rng.pick(FLOOR_ITEMS) : undefined, look: randomLook(rng), tx: p.tx, tz: p.tz, x: j.x, z: j.z,
      });
    }

    // ---- floor items, hidden GIFs, anomalies ----
    const loose = rng.shuffle(cellCenters.filter((c) => free(c) && dEntry[at(c.tx, c.tz)] >= 2));
    let li = 0;
    const nextLoose = (): TilePos | null => (li < loose.length ? loose[li++] : null);
    const itemCount = rng.int(2, 5) + (type === 'geocities' ? 2 : 0);
    for (let i = 0; i < itemCount; i++) {
      const p = nextLoose(); if (!p) break;
      items.push(mk(`i${i}`, 'item', p, rng.pick(FLOOR_ITEMS)));
    }
    const gifCount = rng.int(1, 3) + (type === 'geocities' || discovery ? 2 : 0);
    for (let i = 0; i < gifCount; i++) {
      const p = nextLoose(); if (!p) break;
      gifs.push(mk(`g${i}`, 'gif', p));
    }
    const anCount = discovery ? rng.int(3, 5) : rng.int(1, 3);
    for (let i = 0; i < anCount; i++) {
      const p = nextLoose(); if (!p) break;
      anomalies.push(mk(`a${i}`, 'anomaly', p, rng.pick(ANOMALIES).id, 0.15));
    }

    // ---- hiding spots: dead ends first ----
    const deadEnds = cellCenters.filter((c) => openNeighbours(c.tx, c.tz) === 1 && dEntry[at(c.tx, c.tz)] >= 3);
    const hideCand = rng.shuffle(deadEnds.slice()).concat(rng.shuffle(cellCenters.filter((c) => !deadEnds.includes(c) && dEntry[at(c.tx, c.tz)] >= 3)));
    const hideCount = rng.int(3, 6);
    for (let i = 0; i < Math.min(hideCount, hideCand.length); i++) {
      const p = hideCand[i];
      hides.push({ id: `h${i}`, tx: p.tx, tz: p.tz, x: centerOf(p.tx), z: centerOf(p.tz), face: rng.int(0, 3) });
    }

    // ---- monster spawns: far from the entry ----
    const far = rng.shuffle(cellCenters.filter((c) => dEntry[at(c.tx, c.tz)] >= Math.max(10, maxD * 0.6) && free(c) || (c.tx === exit.tx && c.tz === exit.tz)));
    const fp = far.length ? far : cellCenters.filter((c) => dEntry[at(c.tx, c.tz)] >= maxD * 0.4);
    const spawnCount = 1 + floorParams(floor).extraMonsters;
    for (let i = 0; i < spawnCount; i++) monsterSpawns.push(fp[i % fp.length]);
    const mid = rng.shuffle(cellCenters.filter((c) => dEntry[at(c.tx, c.tz)] >= 8));
    for (let i = 0; i < Math.min(2, mid.length); i++) ratSpawns.push(mid[i]);
  }

  // flip maze: a second layout as the ceiling
  let ceilSolid: Uint8Array | null = null;
  if (type === 'flip') ceilSolid = carveMaze(n, rngFor(runSeed, floor, 'ceiling'));

  return {
    cols, rows, solid, seed: runSeed, floor, type, palette, wallpaper, cells: n, rooms, entry, terminal, exit, vendor,
    disks, items, gifs, anomalies, bellTrees, props, crowds, npcs, hides, monsterSpawns, ratSpawns, ceilSolid,
  };
}

/** World position of a tile centre. */
export function tileCenter(p: TilePos): { x: number; z: number } {
  return { x: centerOf(p.tx), z: centerOf(p.tz) };
}
