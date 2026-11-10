// Network message types shared by client and server. Floors never travel: only seed + floor number.
import type { Look } from './character';
import type { FloorType, ItemId, MonsterKind } from './tables';

export interface LobbyOptions {
  /** one pool of bits for everyone (false = one wallet per player) */
  sharedWallet: boolean;
  openMic: boolean;
}

export const DEFAULT_OPTIONS: LobbyOptions = { sharedWallet: false, openMic: false };

export interface PlayerInfo {
  id: string;
  name: string;
  look: Look;
  reroll: number;
  host: boolean;
}

/** player flag bits */
export const F_CROUCH = 1;
export const F_SPRINT = 2;
export const F_FLASH = 4;
export const F_TALK = 8;
export const F_WEBCAM = 16;

export type InteractKind = 'disk' | 'item' | 'gif' | 'terminal' | 'revive' | 'npc' | 'hide' | 'popup' | 'grab' | 'ghost';

export interface PosMsg {
  /** floor number this position belongs to (stale messages are dropped) */
  n: number;
  x: number;
  z: number;
  yaw: number;
  f: number;
}

// ---- client -> server ----
export const C = {
  opts: 'opts',
  reroll: 'reroll',
  start: 'start',
  pos: 'pos',
  interact: 'interact',
  scan: 'scan',
  buy: 'buy',
  use: 'use',
  talk: 'talk',
  ping: 'ping',
  rewind: 'rewind',
  say: 'say',
} as const;

export interface InteractMsg { kind: InteractKind; id: string }
export interface BuyMsg { item: ItemId; target?: string }
export interface UseMsg { slot: number; x?: number; z?: number }

// ---- server -> client ----
export const S = {
  lobby: 'lobby',
  floor: 'floor',
  snap: 'snap',
  gs: 'gs',
  inv: 'inv',
  ev: 'ev',
  dlg: 'dlg',
  over: 'over',
} as const;

export interface LobbyMsg {
  code: string;
  seed: string;
  youId: string;
  players: PlayerInfo[];
  opts: LobbyOptions;
  started: boolean;
}

export interface FloorMsg {
  floor: number;
  seed: string;
  /** seconds until the main monster wakes (0 on safe floors) */
  wakeIn: number;
  spawn: { x: number; z: number };
}

export interface GameState {
  floor: number;
  phase: 'lobby' | 'floor' | 'over';
  shared: boolean;
  /** bits: shared pool, or per-player wallet map */
  pool: number;
  wallets: Record<string, number>;
  totalBits: number;
  taken: string[]; // entity ids already picked up / scanned
  inserted: number;
  exitOpen: boolean;
  awake: boolean;
  /** player id -> 'alive' | 'downed' | 'ghost' */
  states: Record<string, number>;
  exitProgress: number; // 0..1 hold
  passives: Record<string, { sprint: number; shoes: boolean; scanner: boolean; ctrlz: boolean }>;
  tension: number;
}

export const ST_ALIVE = 0;
export const ST_DOWNED = 1;
export const ST_GHOST = 2;

export interface PSnap {
  i: string;
  x: number;
  z: number;
  r: number;
  f: number;
  s: number;
  /** pop-up covering this player */
  pu: number;
  /** revive progress 0..1 while a downed player is being revived */
  rv: number;
  /** bleed-out remaining 0..1 while downed */
  bl: number;
  /** hidden in a locker */
  h: number;
}

export interface MSnap {
  i: string;
  k: MonsterKind;
  x: number;
  z: number;
  r: number;
  /** 0 wander, 1 stalk, 2 hunt, 3 search, 4 retreat */
  s: number;
  /** mimic only: player id whose look/name is copied */
  c?: string;
}

export interface ASnap {
  p: string;
  /** 0 offer, 1 snap, 2 chase, 3 retract, 4 fist */
  s: number;
  item: ItemId;
  /** flat polyline x0,z0,x1,z1,... from the tent to the fingertips */
  t: number[];
}

export interface Snap {
  t: number;
  p: PSnap[];
  m: MSnap[];
  a: ASnap[];
  /** director tension 0-100 */
  tn: number;
  /** exit hold progress 0-1 */
  xp: number;
  /** seconds until the main monster wakes (0 = awake / safe floor) */
  wk: number;
}

export interface InvMsg {
  slots: (ItemId | null)[];
  glow: number;
  battery: number; // seconds of flashlight left
}

export type EvMsg =
  | { k: 'pickup'; id: string; by: string; kind: string; sub?: string; bits?: number }
  | { k: 'bits'; delta: number; why: string }
  | { k: 'down'; id: string }
  | { k: 'revive'; id: string; by: string }
  | { k: 'dead'; id: string }
  | { k: 'respawn'; id: string }
  | { k: 'insert'; n: number; by: string }
  | { k: 'exit-open' }
  | { k: 'wake' }
  | { k: 'scan'; by: string; hits: { id: string; kind: string; sub?: string; x: number; z: number }[]; mimic?: string[] }
  | { k: 'popup'; id: string }
  | { k: 'popup-clear'; id: string }
  | { k: 'radio'; x: number; z: number }
  | { k: 'hint'; x: number; z: number }
  | { k: 'tip'; text: string; floorType?: FloorType }
  | { k: 'stinger'; which: 'modem' | 'bell' | 'glitch' | 'fake-bell' | 'fake-step' }
  | { k: 'text'; text: string }
  | { k: 'erase'; tiles: number[] }
  | { k: 'rewind'; x: number; z: number }
  | { k: 'glow'; x: number; z: number; by: string }
  | { k: 'hide'; id: string; on: boolean }
  | { k: 'floor-clear'; bonus: number }
  | { k: 'bleed'; id: string }
  | { k: 'ping'; by: string; x: number; z: number }
  | { k: 'say'; by: string; text: string }
  | { k: 'discover'; kind: 'monster' | 'anomaly' | 'npc'; id: string };

export interface DlgMsg {
  npcId: string;
  name: string;
  text: string;
  look: Look;
  mimic: boolean;
}

export interface OverMsg {
  floor: number;
  totalBits: number;
  seed: string;
}

export interface JoinOptions {
  name: string;
  code?: string;
  token?: string;
  seed?: string;
}
