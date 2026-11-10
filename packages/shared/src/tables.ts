// Static content tables: vendor stock, floor types, monsters, anomalies, NPC dialogue.

export type ItemId =
  | 'battery' | 'glowsticks' | 'radio' | 'sprintchip' | 'softshoes' | 'scannerrange'
  | 'floortip' | 'monstertip' | 'ghost' | 'ctrlz' | 'soda';

export interface ItemDef {
  id: ItemId;
  name: string;
  cost: number;
  desc: string;
  /** 'inv' occupies an inventory slot, 'passive' applies at once, 'special' is handled by the server */
  kind: 'inv' | 'passive' | 'special';
  icon: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  battery: { id: 'battery', name: 'Battery', cost: 20, desc: '+60 s flashlight', kind: 'inv', icon: '🔋' },
  glowsticks: { id: 'glowsticks', name: 'Glowsticks x3', cost: 15, desc: 'Mark your path', kind: 'inv', icon: '🟢' },
  radio: { id: 'radio', name: 'Static radio', cost: 35, desc: 'Distracts monsters for 10 s', kind: 'inv', icon: '📻' },
  sprintchip: { id: 'sprintchip', name: 'Sprint chip', cost: 60, desc: '+1 s sprint (stacks to +3 s)', kind: 'passive', icon: '👟' },
  softshoes: { id: 'softshoes', name: 'Soft shoes', cost: 80, desc: 'Footstep noise radius -25%', kind: 'passive', icon: '🧦' },
  scannerrange: { id: 'scannerrange', name: 'Scanner range', cost: 100, desc: 'Scanner reach 20 → 30 m', kind: 'passive', icon: '📡' },
  floortip: { id: 'floortip', name: 'Floor tip', cost: 50, desc: "Shows the next floor's type", kind: 'special', icon: '💡' },
  monstertip: { id: 'monstertip', name: 'Monster tip', cost: 120, desc: "Shows the main monster's weakness", kind: 'special', icon: '👁' },
  ghost: { id: 'ghost', name: 'Buy back a ghost', cost: 150, desc: 'Revives a dead teammate', kind: 'special', icon: '👻' },
  ctrlz: { id: 'ctrlz', name: 'Ctrl+Z', cost: 200, desc: 'Rewind yourself 5 s, once', kind: 'inv', icon: '↩' },
  soda: { id: 'soda', name: 'Fizzy soda', cost: 40, desc: 'Shake and pop: shoves monsters away and stuns them', kind: 'inv', icon: '🥤' },
};

export const VENDOR_STOCK: ItemId[] = [
  'battery', 'glowsticks', 'radio', 'soda', 'sprintchip', 'softshoes', 'scannerrange',
  'floortip', 'monstertip', 'ghost', 'ctrlz',
];

/** Items that can lie around on a floor. */
export const FLOOR_ITEMS: ItemId[] = ['battery', 'glowsticks', 'radio', 'soda'];

export type FloorType =
  | 'wallpaper' | 'geocities' | 'chatroom' | 'desktop' | 'flip' | 'park' | 'server' | 'corrupted' | 'guestbook';

export interface FloorTypeDef {
  id: FloorType;
  name: string;
  from: number;
  weight: number;
  twist: string;
}

export const FLOOR_TYPES: FloorTypeDef[] = [
  { id: 'wallpaper', name: 'Wallpaper maze', from: 1, weight: 30, twist: 'Classic corridors' },
  { id: 'geocities', name: 'GeoCities home', from: 2, weight: 15, twist: 'Cluttered rooms full of GIFs and secrets' },
  { id: 'chatroom', name: 'Chatroom', from: 4, weight: 10, twist: 'Dark room of glowing usernames; voice carries 2x further' },
  { id: 'desktop', name: 'Desktop', from: 4, weight: 10, twist: 'Walls are error windows; closing one opens a path but makes noise' },
  { id: 'flip', name: 'Flip maze', from: 6, weight: 10, twist: 'The ceiling is a second layout' },
  { id: 'park', name: 'Pixel park', from: 8, weight: 10, twist: 'Foggy blocky outdoors; dig through hedges' },
  { id: 'server', name: 'Server room', from: 10, weight: 10, twist: 'Fan noise hides footsteps; monsters 10% faster' },
  { id: 'corrupted', name: 'Corrupted', from: 25, weight: 5, twist: 'The map lies' },
  { id: 'guestbook', name: 'Guestbook Room', from: 5, weight: 0, twist: 'Safe floor with the vendor' },
];

export const FLOOR_TYPE_BY_ID: Record<FloorType, FloorTypeDef> = Object.fromEntries(
  FLOOR_TYPES.map((t) => [t.id, t]),
) as Record<FloorType, FloorTypeDef>;

export type MonsterKind = 'silhouette' | 'rat' | 'mannequin' | 'popup' | 'four04' | 'mimic';

export interface MonsterDef {
  id: MonsterKind;
  name: string;
  from: number;
  desc: string;
  counter: string;
}

export const MONSTERS: MonsterDef[] = [
  { id: 'silhouette', name: 'The Silhouette', from: 1, desc: 'Black figure, red dot eyes, too many arms. Hunts by sound and sight.', counter: 'Break line of sight for 4 s, hide, use the radio.' },
  { id: 'rat', name: 'The Rat', from: 1, desc: 'Harmless scout. Squeaks when it sees you and pulls the Silhouette toward you.', counter: 'Crouch past, or let it run.' },
  { id: 'mannequin', name: 'The Mannequin', from: 3, desc: 'Hides in a crowd of grey mannequins. Moves only when nobody is looking.', counter: 'Keep someone watching it.' },
  { id: 'popup', name: 'Pop-up', from: 6, desc: "Covers one player's screen for 3 s.", counter: 'A teammate clicks it away.' },
  { id: 'four04', name: '404', from: 15, desc: 'Erases the corridor behind the group.', counter: 'Keep moving.' },
  { id: 'mimic', name: 'Mimic', from: 20, desc: "Copies a teammate's look and name, walks slightly wrong.", counter: 'The scanner reveals it; it flees when scanned.' },
];

export const MONSTER_BY_ID: Record<MonsterKind, MonsterDef> = Object.fromEntries(
  MONSTERS.map((m) => [m.id, m]),
) as Record<MonsterKind, MonsterDef>;

export interface AnomalyDef {
  id: string;
  name: string;
  desc: string;
}

export const ANOMALIES: AnomalyDef[] = [
  { id: 'smiley', name: 'Smiley bloom', desc: 'A flower that is just a face. It is always facing you.' },
  { id: 'clock', name: 'Backwards clock', desc: 'Runs fast, then slow, then apologises.' },
  { id: 'cursor', name: 'Lost cursor', desc: 'A giant mouse pointer waiting for a click.' },
  { id: 'counter', name: 'Hit counter', desc: 'Reads 000042. Nobody has visited. Nobody ever leaves.' },
  { id: 'phone', name: 'Dial-up phone', desc: 'Screeches quietly to itself.' },
  { id: 'cone', name: 'Under construction', desc: 'A sign for a place that will never be finished.' },
  { id: 'dolphin', name: 'Screensaver dolphin', desc: 'Swims in circles through the wall.' },
  { id: 'envelope', name: 'Spinning envelope', desc: 'You have 1 new message. You have always had 1 new message.' },
];

export const PROP_KINDS = [
  'cars', 'rocks', 'seated', 'house', 'flowers', 'billboard', 'construction', 'counter',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const NPC_KINDS = ['hint', 'trade', 'line'] as const;
export type NpcKind = (typeof NPC_KINDS)[number];

export const NPC_NAMES = ['xX_Gl1tch_Xx', 'Webmaster', 'Guest #4081', 'MIDI_Mike', 'Clippy?', 'sk8r_boi_99', 'Admin', 'Lurker'];

export const NPC_LINES: Record<NpcKind, string[]> = {
  hint: [
    'Psst. Floppy… over there. Check your scanner.',
    'I saw a disk. Or a sandwich. Hard to tell. Look that way.',
    'Heard a click-clack that way. Something shiny.',
  ],
  trade: [
    'Got a thing. You got a face? Take it. No refunds.',
    'Free sample! (Terms and conditions apply.)',
  ],
  line: [
    'Welcome to my homepage! You are visitor number… W-A-S-TE… aw shoot.',
    'Have you signed the guestbook? Everyone signs. Everyone.',
    'This page is best viewed in Netscape 4. And in silence.',
    'Do not look at the tall trees. They are fine. Do not look at the trees.',
    'I like it here. The music never changes.',
    "Don't run. Walking is quieter. Walking is always quieter.",
  ],
};

export const MIMIC_LINES = [
  'Hi. Hi hi. It is me. It is a normal me.',
  'Follow me. This way. The good way. It is the good way.',
];
