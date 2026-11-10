// Character part generator. A look is a small record of part indices + colours; the client
// draws the parts as flat 2D cut-outs (head, body, left arm, right arm). All designs are original.
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
