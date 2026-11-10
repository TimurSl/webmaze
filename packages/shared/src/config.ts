// Tunable numbers from the design plan. One place so client prediction and server rules agree.

/** Size of one grid tile in metres. A maze cell is one tile; walls are tiles too. */
export const TILE = 2.5;
export const WALL_H = 3.0;

export const TICK_HZ = 20;
export const SNAP_HZ = 10;
export const MAX_PLAYERS = 6;

export const PLAYER = {
  walk: 3,
  sprint: 5,
  sprintTime: 4,
  sprintRecover: 6,
  crouch: 1.5,
  flashlight: 120,
  slots: 4,
  radius: 0.3,
  eye: 1.55,
  eyeCrouch: 1.0,
  /** server rejects speeds above sprint + 10% */
  maxSpeed: 5 * 1.1,
};

export const RULES = {
  reviveTime: 5,
  reviveRange: 1.5,
  bleedOut: 30,
  ghostBuyBack: 150,
  exitRadius: 10,
  exitHold: 3,
  leftBehindPull: 20,
  disksNeeded: 3,
  guestbookEvery: 5,
  interest: 0.05,
  disconnectKeep: 60,
  interactRange: 2.2,
  scanRange: 20,
  scanRangeUpgraded: 30,
  scanCooldown: 8,
  clearNoDownBonus: 50,
  gifBits: 25,
  anomalyBits: 40,
  diskBitsBase: 10,
};

export interface FloorParams {
  cells: number;
  huntSpeed: number;
  extraMonsters: number;
  diskBits: number;
  wakeDelay: number;
}

export function isGuestbook(floor: number): boolean {
  return floor > 0 && floor % RULES.guestbookEvery === 0;
}

/** Scaling table from the plan (floor numbers start at 1). */
export function floorParams(floor: number): FloorParams {
  const f = Math.max(1, floor);
  return {
    cells: Math.min(41, 13 + 2 * (f - 1)),
    huntSpeed: Math.min(7, 5 * Math.pow(1.03, f - 1)),
    extraMonsters: Math.min(4, Math.floor(f / 10)),
    diskBits: Math.min(40, RULES.diskBitsBase + (f - 1)),
    wakeDelay: Math.max(20, 45 - (f - 1)),
  };
}

/** Vendor prices rise 10% every 10 floors. */
export function priceMultiplier(floor: number): number {
  return Math.pow(1.1, Math.floor(floor / 10));
}

export const SILHOUETTE = {
  wander: 2,
  stalk: 2.5,
  search: 3,
  hearWalk: 8,
  hearSprint: 20,
  hearVoice: 15,
  hearCrouch: 2,
  sightRange: 25,
  sightLitRange: 35,
  sightHalfAngle: Math.PI / 4, // 90° cone
  loseSightTime: 4,
  catchRange: 1.0,
};

export const VENDOR = {
  offerLen: 2,
  snapRange: 20,
  snapSpeed: 12,
  chaseSpeed: 6,
  maxLen: 40,
  grabRange: 1.5,
  retractSpeed: 4,
};

export const DIRECTOR = {
  highThreshold: 85,
  highHold: 30,
  backoff: 20,
};

/** Style-break distances (metres) to the nearest monster. */
export const STYLE_BREAK = { bell: 15, grey: 10, heavy: 5 };
