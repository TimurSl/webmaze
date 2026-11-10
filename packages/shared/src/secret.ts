// The Konami secret room: one big open hall with a sample of everything the game has. Same on client and server.
import { TILE } from './config';
import { randomLook } from './character';
import type { Crowd, Entity, Exhibit, FloorData, HideSpot, Npc, Prop, TilePos } from './floor';
import { centerOf } from './nav';
import { rngFor } from './rng';
import { ANOMALIES, ItemId, NpcKind, PROP_KINDS } from './tables';

const N = 11; // cells per side -> 23 x 23 tiles, about 57 m across
const COLS = 2 * N + 1;

/** Items lying around the hall. The vendor has the rest for free. */
export const SECRET_ITEMS: ItemId[] = ['battery', 'glowsticks', 'radio', 'soda', 'ctrlz', 'soda', 'radio', 'battery'];

export function generateSecretRoom(runSeed: string): FloorData {
  const rng = rngFor(runSeed, 0, 'secret');
  const solid = new Uint8Array(COLS * COLS).fill(1);
  for (let z = 1; z < COLS - 1; z++) for (let x = 1; x < COLS - 1; x++) solid[z * COLS + x] = 0;
  // a few pillars so the hall is not one flat box
  for (const [x, z] of [[6, 11], [16, 11], [6, 19], [16, 19]]) solid[z * COLS + x] = 1;

  const tile = (tx: number, tz: number): TilePos => ({ tx, tz });
  const ent = (id: string, kind: string, tx: number, tz: number, sub?: string): Entity => ({
    id, kind, sub, tx, tz, x: centerOf(tx), z: centerOf(tz),
  });

  const entry = tile(3, 20);
  const exit = tile(19, 20);
  const terminal = tile(11, 20);
  const vendor = tile(11, 1);

  const disks = [5, 11, 17].map((tx, i) => ent(`d${i}`, 'disk', tx, 15));
  const gifs = [3, 19, 11].map((tx, i) => ent(`g${i}`, 'gif', tx, i === 2 ? 13 : 15));
  const items = SECRET_ITEMS.map((sub, i) => ent(`i${i}`, 'item', 3 + i * 2, 17, sub));
  const anomalies = ANOMALIES.map((a, i) => ent(`a${i}`, 'anomaly', 3 + i * 2, 12, a.id));
  const bellTrees = [ent('b0', 'belltree', 3, 7), ent('b1', 'belltree', 19, 7)];

  const props: Prop[] = PROP_KINDS.map((kind, i) => ({
    id: `p${i}`, kind, tx: 3 + i * 2, tz: 9, scale: 1, rot: rng.range(0, Math.PI * 2), x: centerOf(3 + i * 2), z: centerOf(9),
  }));

  const npcDefs: { kind: NpcKind; mimic: boolean; tx: number; item?: ItemId }[] = [
    { kind: 'hint', mimic: false, tx: 7 },
    { kind: 'trade', mimic: false, tx: 9, item: 'soda' },
    { kind: 'line', mimic: false, tx: 13 },
    { kind: 'line', mimic: true, tx: 15 },
  ];
  const npcs: Npc[] = npcDefs.map((d, i) => ({
    id: `n${i}`, kind: d.kind, name: ['Webmaster', 'xX_Gl1tch_Xx', 'Guest #4081', 'Clippy?'][i], mimic: d.mimic, line: i, item: d.item,
    look: randomLook(rng), tx: d.tx, tz: 6, x: centerOf(d.tx), z: centerOf(6),
  }));

  const hides: HideSpot[] = [[1, 5, 1], [1, 10, 1], [21, 5, 3], [21, 10, 3]].map(([tx, tz, face], i) => ({
    id: `h${i}`, tx, tz, x: centerOf(tx), z: centerOf(tz), face,
  }));

  // a small mannequin crowd; the mannequin on display is its first member
  const members = Array.from({ length: 10 }, (_, i) => ({ x: centerOf(17) + (i % 4) * 1.1 + rng.range(-0.2, 0.2), z: centerOf(3) + Math.floor(i / 4) * 1.1 + rng.range(-0.2, 0.2), v: i % 5 }));
  const crowds: Crowd[] = [{ id: 'c0', room: 0, members }];

  const exhibits: Exhibit[] = [
    { kind: 'silhouette', x: centerOf(4), z: centerOf(3) },
    { kind: 'rat', x: centerOf(7), z: centerOf(3) },
    { kind: 'mimic', x: centerOf(14), z: centerOf(3) },
    { kind: 'mannequin', x: members[0].x, z: members[0].z },
  ];

  return {
    cols: COLS, rows: COLS, solid, seed: runSeed, floor: 0, type: 'guestbook', palette: 4, wallpaper: 1, cells: N,
    rooms: [{ tx0: 1, tz0: 1, tx1: COLS - 2, tz1: COLS - 2 }], entry, terminal, exit, vendor, disks, items, gifs, anomalies,
    bellTrees, props, crowds, npcs, hides, monsterSpawns: [], ratSpawns: [], ceilSolid: null, secret: true, exhibits,
  };
}

void TILE;
