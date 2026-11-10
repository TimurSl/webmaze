// Character part generator. A look is a small record of part indices + colours; the client
// draws the parts as flat faceted 2D cut-outs (head, torso, hips, two arms, two legs) that float
// slightly apart. Limbs take the colours of the split face, so every character is two-toned.
// All designs are original.
import { CHAR_COLORS } from './palettes';
import { Rng, hashString } from './rng';

export const PART_COUNTS = {
  head: 6,
  eyes: 6,
  mouth: 4,
  hair: 5,
  body: 5,
  arm: 4,
} as const;

export interface Look {
  head: number;
  faceA: number; // colour of one half of the face
  faceB: number; // colour of the other half
  split: number; // split-line angle, 0-180 degrees
  eyes: number;
  mouth: number;
  hair: number;
  hairCol: number;
  body: number;
  bodyCol: number;
  armL: number;
  armR: number;
  armColL: number;
  armColR: number;
}

/** Extra styling derived from a look (no extra state on the wire, no extra rolls from the floor rng). */
export interface LookStyle {
  eyes2: number;   // the second eye is often a different shape
  legL: number;
  legR: number;
  bottom: number;  // 0 shorts, 1 flared skirt, 2 block hips
  botCol: number;
  bootCol: number;
  accent: number;  // collar / straps / hat band
  shards: number;  // 0-2 floating shards above the head
  mark: number;    // 0 none, 1 cheek triangle, 2 tear line, 3 dots
  flip: boolean;   // mirror limb skin colours
}

export const LEG_KINDS = 3;
export const BOTTOM_KINDS = 3;

const styleCache = new Map<string, LookStyle>();
export function lookStyle(look: Look): LookStyle {
  const key = JSON.stringify(look);
  let st = styleCache.get(key);
  if (st) return st;
  const rng = new Rng(hashString('style|' + key));
  const dark = [0x16302c, 0x1a1a20, 0x2a2a30, 0x33203a, 0x1c2a4a, 0x40201c];
  st = {
    eyes2: rng.chance(0.55) ? rng.int(0, PART_COUNTS.eyes - 1) : look.eyes,
    legL: rng.int(0, LEG_KINDS - 1),
    legR: rng.int(0, LEG_KINDS - 1),
    bottom: rng.int(0, BOTTOM_KINDS - 1),
    botCol: rng.chance(0.5) ? rng.pick(dark) : rng.pick(CHAR_COLORS),
    bootCol: rng.pick(dark),
    accent: rng.pick(CHAR_COLORS),
    shards: rng.chance(0.4) ? rng.int(1, 2) : 0,
    mark: rng.chance(0.5) ? rng.int(1, 3) : 0,
    flip: rng.chance(0.5),
  };
  if (styleCache.size > 256) styleCache.clear();
  styleCache.set(key, st);
  return st;
}

export function randomLook(rng: Rng): Look {
  const faceA = rng.pick(CHAR_COLORS);
  let faceB = rng.pick(CHAR_COLORS);
  if (faceB === faceA) faceB = CHAR_COLORS[(CHAR_COLORS.indexOf(faceA) + 3) % CHAR_COLORS.length];
  return {
    head: rng.int(0, PART_COUNTS.head - 1),
    faceA,
    faceB,
    split: rng.int(0, 180),
    eyes: rng.int(0, PART_COUNTS.eyes - 1),
    mouth: rng.int(0, PART_COUNTS.mouth - 1),
    hair: rng.int(0, PART_COUNTS.hair - 1),
    hairCol: rng.pick([0x1a1a20, 0x2a2a30, 0x5a3a28, 0xf8e71c, 0xe84a3c, 0x7b4ae2, faceB]),
    body: rng.int(0, PART_COUNTS.body - 1),
    bodyCol: rng.pick(CHAR_COLORS),
    armL: rng.int(0, PART_COUNTS.arm - 1),
    armR: rng.int(0, PART_COUNTS.arm - 1),
    armColL: rng.pick(CHAR_COLORS),
    armColR: rng.pick(CHAR_COLORS),
  };
}

/** Each player rolls a look from their name plus the run seed; reroll bumps the counter. */
export function playerLook(name: string, runSeed: string, reroll = 0): Look {
  return randomLook(new Rng(hashString(`${name}|${runSeed}|look${reroll}`)));
}

/** Grey, untextured mannequin variants. */
export const MANNEQUIN_VARIANTS = 5;
