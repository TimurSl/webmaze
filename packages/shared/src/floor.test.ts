import { describe, expect, it } from 'vitest';
import { ANOMALIES, FLOOR_TYPES, ITEMS, NPC_KINDS, PROP_KINDS, VENDOR_STOCK, bfsDist, findPath, floorParams, generateFloor, isGuestbook, los, TILE } from './index';

const SEEDS = ['ABCDEFGH', 'K7QX2MPA', 'WEBMAZE1', 'ZZZZZZZZ'];

describe('floor generator', () => {
  it('is deterministic for the same seed and floor', () => {
    for (const s of SEEDS) {
      for (const f of [1, 2, 7, 10, 15, 30]) {
        const a = generateFloor(s, f);
        const b = generateFloor(s, f);
        expect(Buffer.from(a.solid).equals(Buffer.from(b.solid))).toBe(true);
        expect(a.disks).toEqual(b.disks);
        expect(a.type).toBe(b.type);
        expect(a.exit).toEqual(b.exit);
      }
    }
  });

  it('differs between seeds', () => {
    const a = generateFloor('AAAAAAAA', 3);
    const b = generateFloor('BBBBBBBB', 3);
    expect(Buffer.from(a.solid).equals(Buffer.from(b.solid))).toBe(false);
  });

  it('floor 1 is always a 13x13 wallpaper maze', () => {
    for (const s of SEEDS) {
      const f = generateFloor(s, 1);
      expect(f.type).toBe('wallpaper');
      expect(f.cells).toBe(13);
      expect(f.cols).toBe(27);
    }
  });

  it('every key object is reachable from the entry', () => {
    for (const s of SEEDS) {
      for (let floor = 1; floor <= 12; floor++) {
        const f = generateFloor(s, floor);
        const d = bfsDist(f, f.entry.tx, f.entry.tz);
        const reach = (p: { tx: number; tz: number }) => d[p.tz * f.cols + p.tx] >= 0;
        expect(reach(f.exit), `exit ${s}/${floor}`).toBe(true);
        if (f.terminal) expect(reach(f.terminal)).toBe(true);
        f.disks.forEach((x) => expect(reach(x)).toBe(true));
        f.items.forEach((x) => expect(reach(x)).toBe(true));
        f.hides.forEach((x) => expect(reach(x)).toBe(true));
        f.monsterSpawns.forEach((x) => expect(reach(x)).toBe(true));
      }
    }
  });

  it('places 3 disks on normal floors and none on guestbook floors', () => {
    for (const s of SEEDS) {
      for (let floor = 1; floor <= 15; floor++) {
        const f = generateFloor(s, floor);
        if (isGuestbook(floor)) {
          expect(f.type).toBe('guestbook');
          expect(f.disks.length).toBe(0);
          expect(f.vendor).not.toBeNull();
          expect(f.monsterSpawns.length).toBe(0);
        } else {
          expect(f.disks.length).toBe(3);
          expect(f.terminal).not.toBeNull();
        }
      }
    }
  });

  it('follows the scaling table', () => {
    expect(floorParams(1)).toMatchObject({ cells: 13, huntSpeed: 5, extraMonsters: 0, diskBits: 10, wakeDelay: 45 });
    expect(floorParams(2).cells).toBe(15);
    expect(floorParams(50).cells).toBe(41);
    expect(floorParams(50).huntSpeed).toBe(7);
    expect(floorParams(50).extraMonsters).toBe(4);
    expect(floorParams(10).extraMonsters).toBe(1);
    expect(floorParams(100).diskBits).toBe(40);
    expect(floorParams(100).wakeDelay).toBe(20);
  });

  it('A* finds a path between entry and exit and LOS respects walls', () => {
    const f = generateFloor('WEBMAZE1', 1);
    const p = findPath(f, f.entry.tx, f.entry.tz, f.exit.tx, f.exit.tz);
    expect(p).not.toBeNull();
    expect(p![0]).toBe(f.entry.tz * f.cols + f.entry.tx);
    // a wall tile blocks a straight line through it
    const mid = Math.floor(f.cols / 2);
    let wallTz = -1;
    for (let z = 0; z < f.rows; z++) if (f.solid[z * f.cols + mid]) { wallTz = z; break; }
    expect(wallTz).toBeGreaterThanOrEqual(0);
    expect(los(f, mid * TILE + 1, 1.2, mid * TILE + 1, (f.rows - 1) * TILE)).toBe(false);
  });

  it('disks are spaced apart where the maze allows it', () => {
    const f = generateFloor('K7QX2MPA', 5 + 1);
    const ds = f.disks;
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        expect(Math.abs(ds[i].tx - ds[j].tx) + Math.abs(ds[i].tz - ds[j].tz)).toBeGreaterThan(0);
      }
    }
  });

  it('discovery floors are deterministic, show every floor type early and carry more anomalies', () => {
    const types = new Set<string>();
    for (const s of SEEDS) {
      for (let floor = 2; floor <= 40; floor++) {
        if (isGuestbook(floor)) continue;
        const a = generateFloor(s, floor, { discovery: true });
        const b = generateFloor(s, floor, { discovery: true });
        expect(Buffer.from(a.solid).equals(Buffer.from(b.solid))).toBe(true);
        expect(a.anomalies.length).toBeGreaterThanOrEqual(3);
        expect(a.crowds.length).toBe(0);
        types.add(a.type);
      }
    }
    // corrupted normally needs floor 25
    for (const t of FLOOR_TYPES.filter((x) => x.weight > 0)) expect(types.has(t.id), t.id).toBe(true);
    expect(generateFloor('ABCDEFGH', 1, { discovery: true }).type).toBe('wallpaper');
  });

  it('the Konami secret room has everything and all of it is reachable', () => {
    const f = generateFloor('ABCDEFGH', 7, { secret: true });
    const g = generateFloor('ZZZZZZZZ', 3, { secret: true });
    expect(f.secret).toBe(true);
    expect(f.vendor).not.toBeNull();
    expect(f.terminal).not.toBeNull();
    expect(f.disks.length).toBe(3);
    for (const a of ANOMALIES) expect(f.anomalies.some((x) => x.sub === a.id), a.id).toBe(true);
    for (const k of PROP_KINDS) expect(f.props.some((x) => x.kind === k), k).toBe(true);
    for (const k of NPC_KINDS) expect(f.npcs.some((x) => x.kind === k), k).toBe(true);
    expect(f.npcs.some((x) => x.mimic)).toBe(true);
    expect(f.exhibits!.map((e) => e.kind).sort()).toEqual(['mannequin', 'mimic', 'rat', 'silhouette']);
    expect(f.crowds[0].members.length).toBeGreaterThan(5);
    expect(f.bellTrees.length).toBeGreaterThan(0);
    expect(f.hides.length).toBeGreaterThan(0);
    expect(f.gifs.length).toBeGreaterThan(0);
    // every inventory item is lying around, every other vendor item is on the vendor's list
    const invItems = Object.values(ITEMS).filter((i) => i.kind === 'inv').map((i) => i.id);
    for (const id of invItems) expect(f.items.some((x) => x.sub === id), id).toBe(true);
    for (const id of Object.keys(ITEMS)) expect(VENDOR_STOCK.includes(id as never), id).toBe(true);
    // it does not depend on the seed's layout, only on flavour
    expect(Buffer.from(f.solid).equals(Buffer.from(g.solid))).toBe(true);
    const d = bfsDist(f, f.entry.tx, f.entry.tz);
    const reach = (p: { tx: number; tz: number }): boolean => d[p.tz * f.cols + p.tx] >= 0;
    for (const e of [...f.disks, ...f.items, ...f.gifs, ...f.anomalies, ...f.bellTrees, ...f.props, ...f.npcs, ...f.hides]) expect(reach(e), e.id).toBe(true);
    expect(reach(f.exit)).toBe(true);
    expect(reach(f.terminal!)).toBe(true);
    expect(reach(f.vendor!) || d[(f.vendor!.tz + 1) * f.cols + f.vendor!.tx] >= 0).toBe(true);
    for (const ex of f.exhibits!) expect(d[Math.floor(ex.z / TILE) * f.cols + Math.floor(ex.x / TILE)]).toBeGreaterThanOrEqual(0);
  });
});
