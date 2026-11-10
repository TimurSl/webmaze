// One room = one run. The server owns everything that can kill you or cost you money.
import { Client, Room, matchMaker } from '@colyseus/core';
import {
  ANOMALIES, ASnap, BuyMsg, C, DEFAULT_OPTIONS, EvMsg, F_CROUCH, F_FLASH, F_SPRINT, F_TALK, FLOOR_TYPE_BY_ID, FloorData, FloorMsg,
  FloorParams, GameState, Grid, ITEMS, InteractMsg, ItemId, JoinOptions, LobbyMsg, LobbyOptions, MAX_PLAYERS, MONSTER_BY_ID,
  MSnap, NPC_LINES, MIMIC_LINES, OverMsg, PLAYER, PSnap, PosMsg, RULES, S, ST_ALIVE, ST_DOWNED, ST_GHOST, TICK_HZ, SNAP_HZ, TILE,
  UseMsg, VENDOR_STOCK, bfsDist, centerOf, dist, floorParams, generateFloor, isGuestbook, playerLook, priceMultiplier,
  randomSeedCode, solidAt, tileOf, DIRECTOR, hashString,
} from '@webmaze/shared';
import {
  Mannequin, Mimic, Mob, PlayerRT, Rat, ST_HUNT, Silhouette, World,
} from './ai';
import { ARM_FIST, ARM_IDLE, ARM_OFFER, ARM_RETRACT, Arm, tentPosition } from './vendor';
import type { Db } from './db';

const clampName = (n: unknown): string => {
  const s = String(n ?? 'Guest').replace(/[^\w .\-!?*~]/g, '').trim().slice(0, 16);
  return s || 'Guest';
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Debug switches for headless tests (never set in production).
const NO_MONSTERS = process.env.WEBMAZE_NO_MONSTERS === '1';
const DEBUG = process.env.WEBMAZE_DEBUG === '1';
const START_FLOOR = Math.max(1, Number(process.env.WEBMAZE_START_FLOOR ?? 1) | 0);
const NO_SPEED_CHECK = process.env.WEBMAZE_NO_SPEED_CHECK === '1';
const WAKE_OVERRIDE = Number(process.env.WEBMAZE_WAKE_DELAY ?? 0);
const START_BITS = Math.max(0, Number(process.env.WEBMAZE_START_BITS ?? 0) | 0);

export class GameRoom extends Room<any> implements World {
  static db: Db | null = null;
  maxClients = MAX_PLAYERS;

  code = '';
  seed = '';
  opts: LobbyOptions = { ...DEFAULT_OPTIONS };
  started = false;
  over = false;

  // world (implements World)
  grid!: Grid;
  floor!: FloorData;
  params!: FloorParams;
  now = 0;
  speedMult = 1;
  hearingMult = 1;
  players: PlayerRT[] = [];
  mobs: Mob[] = [];
  radios: { x: number; z: number; until: number }[] = [];
  noises: { x: number; z: number; until: number }[] = [];
  hideUse = new Map<string, number>();

  floorNum = 0;
  wakeAt = Infinity;
  awake = false;
  taken = new Set<string>();
  inserted = 0;
  exitOpen = false;
  exitHold = 0;
  pool = 0;
  wallets: Record<string, number> = {};
  totalBits = 0;
  arms = new Map<string, Arm>();
  tension = 0;
  highT = 0;
  calmT = 0;
  popupT = 20;
  erase404T = 8;
  distExit: Int32Array | null = null;
  snapAcc = 0;
  invAcc = 0;
  gsDirty = false;
  hostId = '';
  debugFloor = 0;
  discovered404 = false;
  discoveredPopup = false;

  rnd(): number { return Math.random(); }
  alive(): PlayerRT[] { return this.players.filter((p) => p.st === ST_ALIVE && p.transitUntil === 0 && !p.disconnected); }

  // ------------------------------------------------------------------ lifecycle

  async onCreate(options: JoinOptions): Promise<void> {
    const wanted = typeof options?.code === 'string' ? options.code.toUpperCase() : '';
    if (/^[A-Z]{6}$/.test(wanted)) {
      let existing: unknown;
      try { existing = await matchMaker.getRoomById(wanted); } catch { existing = undefined; }
      if (existing) throw new Error('That room code is already in use');
      this.roomId = wanted;
    }
    this.code = this.roomId;
    if (DEBUG) this.debugFloor = Math.max(0, Number((options as unknown as { startFloor?: number })?.startFloor ?? 0) | 0);
    const s = typeof options?.seed === 'string' ? options.seed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) : '';
    this.seed = s.length >= 4 ? s : randomSeedCode();
    this.onMessage(C.opts, (c, m: Partial<LobbyOptions>) => this.onOpts(c, m));
    this.onMessage(C.reroll, (c) => this.onReroll(c));
    this.onMessage(C.start, (c) => this.onStart(c));
    this.onMessage(C.pos, (c, m: PosMsg) => this.onPos(c, m));
    this.onMessage(C.interact, (c, m: InteractMsg) => this.onInteract(c, m));
    this.onMessage(C.scan, (c) => this.onScan(c));
    this.onMessage(C.buy, (c, m: BuyMsg) => this.onOrder(c, m));
    this.onMessage(C.use, (c, m: UseMsg) => this.onUse(c, m));
    this.onMessage(C.rewind, (c, m: { x: number; z: number }) => this.onRewind(c, m));
    this.onMessage(C.ping, (c, m: { x: number; z: number }) => this.onPing(c, m));
    this.onMessage(C.say, (c, m: { text: string }) => this.onSay(c, m));
    this.setSimulationInterval((ms) => this.tick(ms / 1000), 1000 / TICK_HZ);
  }

  onJoin(client: Client, options: JoinOptions): void {
    const name = clampName(options?.name);
    const user = GameRoom.db?.userForToken(options?.token) ?? null;
    const p: PlayerRT = {
      id: client.sessionId, name: user?.name ?? name, look: playerLook(name, this.seed, 0), reroll: 0, userId: user?.id ?? null,
      x: 0, z: 0, yaw: 0, flags: 0, speed: 0, st: ST_ALIVE, hidden: null, popupUntil: 0, downedAt: 0, bleedLeft: 0,
      reviveProg: 0, reviveBy: null, reviveLast: 0, battery: PLAYER.flashlight, inv: [null, null, null, null], glow: 0, disks: 0,
      passives: { sprint: 0, shoes: false, scanner: false, ctrlz: false }, transitUntil: 0, disconnected: false, scanReady: 0,
      lastPosAt: 0, noise: 0, seenKinds: new Set(), downedThisFloor: false, holdPrompt: 0,
    };
    p.look = playerLook(p.name, this.seed, 0);
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.wallets[p.id] = 0;
    if (this.started) {
      const e = this.spawnPoint(this.players.length - 1);
      p.x = e.x; p.z = e.z;
      client.send('floor', this.floorMsg(p));
    }
    this.sendLobby();
    this.gsDirty = true;
    if (user) this.loadBookmarks(client, user.id);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const p = this.players.find((x) => x.id === client.sessionId);
    if (!p) return;
    if (!this.started || this.over || consented) { this.removePlayer(p); return; }
    p.disconnected = true;
    const wasAlive = p.st === ST_ALIVE;
    if (wasAlive) { p.st = ST_DOWNED; p.hidden = null; }
    p.bleedLeft = RULES.disconnectKeep;
    this.gsDirty = true;
    try {
      await this.allowReconnection(client, RULES.disconnectKeep);
      p.disconnected = false;
      if (wasAlive && p.st === ST_DOWNED) { p.st = ST_ALIVE; p.bleedLeft = 0; }
      const c = this.clients.getById(p.id);
      if (c) { this.sendLobby(); c.send('floor', this.floorMsg(p)); this.sendInv(p); }
      this.gsDirty = true;
    } catch {
      this.removePlayer(p);
    }
  }

  private removePlayer(p: PlayerRT): void {
    this.players = this.players.filter((x) => x !== p);
    this.arms.delete(p.id);
    if (this.hostId === p.id) this.hostId = this.players.find((x) => !x.disconnected)?.id ?? '';
    if (this.started && !this.over && this.players.every((x) => x.st !== ST_ALIVE || x.disconnected)) this.maybeEnd();
    this.sendLobby();
    this.gsDirty = true;
  }

  // ------------------------------------------------------------------ lobby

  private sendLobby(): void {
    for (const p of this.players) {
      const c = this.clients.getById(p.id);
      if (!c) continue;
      const msg: LobbyMsg = {
        code: this.code, seed: this.seed, youId: p.id, started: this.started, opts: this.opts,
        players: this.players.map((q) => ({ id: q.id, name: q.name, look: q.look, reroll: q.reroll, host: q.id === this.hostId })),
      };
      c.send(S.lobby, msg);
    }
  }

  private playerOf(c: Client): PlayerRT | undefined {
    return this.players.find((p) => p.id === c.sessionId);
  }

  private onOpts(c: Client, m: Partial<LobbyOptions>): void {
    if (c.sessionId !== this.hostId || this.started) return;
    if (typeof m?.sharedWallet === 'boolean') this.opts.sharedWallet = m.sharedWallet;
    if (typeof m?.openMic === 'boolean') this.opts.openMic = m.openMic;
    this.sendLobby();
  }

  private onReroll(c: Client): void {
    const p = this.playerOf(c);
    if (!p || this.started) return;
    p.reroll++;
    p.look = playerLook(p.name, this.seed, p.reroll);
    this.sendLobby();
  }

  private onStart(c: Client): void {
    if (c.sessionId !== this.hostId || this.started) return;
    this.started = true;
    this.lock();
    if (START_BITS) { for (const p of this.players) this.wallets[p.id] = START_BITS; this.pool = START_BITS; }
    this.startFloor(this.debugFloor || START_FLOOR);
    this.sendLobby();
  }

  // ------------------------------------------------------------------ bits

  private cost(item: ItemId): number {
    return Math.round(ITEMS[item].cost * priceMultiplier(this.floorNum));
  }
  private balance(p: PlayerRT): number {
    return this.opts.sharedWallet ? this.pool : this.wallets[p.id] ?? 0;
  }
  private earn(p: PlayerRT | null, amount: number, why: string): void {
    if (amount <= 0) return;
    this.totalBits += amount;
    if (this.opts.sharedWallet) this.pool += amount;
    else if (p) this.wallets[p.id] = (this.wallets[p.id] ?? 0) + amount;
    else for (const q of this.alive()) this.wallets[q.id] = (this.wallets[q.id] ?? 0) + amount;
    const c = p ? this.clients.getById(p.id) : null;
    if (c) c.send(S.ev, { k: 'bits', delta: amount, why } satisfies EvMsg);
    else if (!p) this.broadcast(S.ev, { k: 'bits', delta: amount, why } satisfies EvMsg);
    else if (this.opts.sharedWallet) this.broadcast(S.ev, { k: 'bits', delta: amount, why } satisfies EvMsg);
    this.gsDirty = true;
  }
  private spend(p: PlayerRT, amount: number): boolean {
    if (this.balance(p) < amount) return false;
    if (this.opts.sharedWallet) this.pool -= amount;
    else this.wallets[p.id] -= amount;
    this.gsDirty = true;
    return true;
  }

  // ------------------------------------------------------------------ floors

  private spawnPoint(i: number): { x: number; z: number } {
    const e = this.floor.entry;
    const a = (i / MAX_PLAYERS) * Math.PI * 2;
    return { x: centerOf(e.tx) + Math.cos(a) * 0.7, z: centerOf(e.tz) + Math.sin(a) * 0.7 };
  }

  private floorMsg(p: PlayerRT): FloorMsg {
    return { floor: this.floorNum, seed: this.seed, wakeIn: this.awake || !Number.isFinite(this.wakeAt) ? 0 : Math.max(0, this.wakeAt - this.now), spawn: { x: p.x, z: p.z } };
  }

  private startFloor(n: number): void {
    this.floorNum = n;
    this.floor = generateFloor(this.seed, n);
    this.grid = this.floor;
    this.params = floorParams(n);
    const guest = isGuestbook(n);
    this.taken.clear();
    this.inserted = 0;
    this.exitOpen = guest;
    this.exitHold = 0;
    this.awake = false;
    this.wakeAt = guest || NO_MONSTERS ? Infinity : this.now + (WAKE_OVERRIDE > 0 ? WAKE_OVERRIDE : this.params.wakeDelay);
    this.mobs = [];
    this.radios = [];
    this.noises = [];
    this.hideUse.clear();
    this.arms.clear();
    this.tension = 0; this.highT = 0; this.calmT = 0;
    this.popupT = 15 + Math.random() * 15;
    this.erase404T = 8;
    this.distExit = null;
    this.speedMult = this.floor.type === 'server' ? 1.1 : 1;
    this.hearingMult = 1;
    this.discovered404 = false; this.discoveredPopup = false;

    const anyAlive = this.players.some((p) => p.st === ST_ALIVE && !p.disconnected);
    let i = 0;
    for (const p of this.players) {
      p.downedThisFloor = false; p.hidden = null; p.popupUntil = 0; p.disks = 0; p.reviveProg = 0; p.reviveBy = null; p.glow = p.glow;
      if (p.st === ST_GHOST && guest && anyAlive) p.st = ST_ALIVE; // ghosts respawn free at Guestbook Rooms
      if (p.transitUntil > 0) { i++; continue; }
      const e = this.spawnPoint(i++);
      p.x = e.x; p.z = e.z; p.lastPosAt = this.now; p.speed = 0;
    }

    if (guest) {
      this.unlock();
      // 5% interest on unspent bits
      if (this.opts.sharedWallet) { const b = Math.floor(this.pool * RULES.interest); if (b > 0) { this.pool += b; this.totalBits += b; this.broadcast(S.ev, { k: 'bits', delta: b, why: 'interest' } satisfies EvMsg); } }
      else for (const p of this.players) { const b = Math.floor((this.wallets[p.id] ?? 0) * RULES.interest); if (b > 0) { this.wallets[p.id] += b; this.totalBits += b; this.clients.getById(p.id)?.send(S.ev, { k: 'bits', delta: b, why: 'interest' } satisfies EvMsg); } }
      const tent = tentPosition(this.floor.vendor!);
      const cheap: ItemId[] = ['battery', 'glowsticks', 'radio'];
      for (const p of this.players) {
        if (p.st !== ST_ALIVE) continue;
        const arm = new Arm(p.id, tent);
        arm.offer(cheap[Math.floor(Math.random() * cheap.length)], null);
        this.arms.set(p.id, arm);
      }
    } else {
      this.lock();
      const fl = this.floor;
      fl.monsterSpawns.forEach((t, k) => this.mobs.push(new Silhouette(`s${k}`, centerOf(t.tx), centerOf(t.tz))));
      fl.ratSpawns.forEach((t, k) => this.mobs.push(new Rat(`r${k}`, centerOf(t.tx), centerOf(t.tz))));
      if (fl.crowds.length && n >= 3) {
        const c = fl.crowds[0];
        const m = c.members[Math.floor(Math.random() * c.members.length)];
        this.mobs.push(new Mannequin('m0', m.x, m.z));
      }
      if (n >= 20) {
        const al = this.alive();
        if (al.length) {
          const t = fl.monsterSpawns[0];
          this.mobs.push(new Mimic('x0', centerOf(t.tx), centerOf(t.tz), al[Math.floor(Math.random() * al.length)].id));
        }
      }
    }

    for (const p of this.players) {
      const c = this.clients.getById(p.id);
      if (c && !p.disconnected) { c.send('floor', this.floorMsg(p)); this.sendInv(p); }
    }
    this.gsDirty = true;
  }

  private advance(): void {
    const noneDowned = !this.players.some((p) => p.downedThisFloor);
    if (noneDowned && !isGuestbook(this.floorNum)) {
      this.earn(null, RULES.clearNoDownBonus, 'clean floor');
      this.broadcast(S.ev, { k: 'floor-clear', bonus: RULES.clearNoDownBonus } satisfies EvMsg);
    }
    // downed players are left behind and pulled through after 20 s
    for (const p of this.players) {
      if (p.st === ST_DOWNED && !p.disconnected) p.transitUntil = this.now + RULES.leftBehindPull;
    }
    this.startFloor(this.floorNum + 1);
    // pulled players arrive at the new entry once their timer ends (see updatePlayers)
  }

  private maybeEnd(): void {
    if (this.over || !this.started) return;
    if (this.players.some((p) => p.st === ST_ALIVE && !p.disconnected)) return;
    this.over = true;
    const msg: OverMsg = { floor: this.floorNum, totalBits: this.totalBits, seed: this.seed };
    this.broadcast(S.over, msg);
    this.gsDirty = true;
    const db = GameRoom.db;
    if (db) {
      try {
        const names = this.players.map((p) => p.name).join(', ').slice(0, 60);
        const host = this.players.find((p) => p.id === this.hostId) ?? this.players[0];
        db.addScore(host?.userId ?? null, names, this.floorNum, this.totalBits, this.seed, this.players.length);
      } catch (e) { console.error('score save failed', e); }
    }
    this.clock.setTimeout(() => this.disconnect(), 5 * 60_000);
  }

  down(p: PlayerRT, by: string): void {
    if (p.st !== ST_ALIVE) return;
    p.st = ST_DOWNED;
    p.bleedLeft = RULES.bleedOut;
    p.downedAt = this.now;
    p.downedThisFloor = true;
    p.hidden = null;
    p.reviveProg = 0;
    this.emit({ k: 'down', id: p.id });
    this.emit({ k: 'stinger', which: 'glitch' });
    void by;
    this.gsDirty = true;
    this.maybeEnd();
  }

  emit(ev: EvMsg): void {
    this.broadcast(S.ev, ev);
  }

  // ------------------------------------------------------------------ messages

  private onPos(c: Client, m: PosMsg): void {
    const p = this.playerOf(c);
    if (!p || this.over || !this.started) return;
    const x = num(m?.x), z = num(m?.z), yaw = num(m?.yaw), f = num(m?.f), n = num(m?.n);
    if (x === null || z === null || yaw === null || f === null || n === null) return;
    if (n !== this.floorNum || p.transitUntil > 0) return;
    if (p.st !== ST_ALIVE) return;
    p.yaw = yaw;
    if (p.hidden) return;
    const dt = Math.max(0.02, this.now - p.lastPosAt);
    const d = dist(p.x, p.z, x, z);
    if ((!NO_SPEED_CHECK && d > PLAYER.maxSpeed * dt + 0.8) || solidAt(this.grid, x, z)) {
      c.send(S.ev, { k: 'rewind', x: p.x, z: p.z } satisfies EvMsg);
      return;
    }
    p.speed = p.speed * 0.5 + (d / dt) * 0.5;
    p.x = x; p.z = z; p.flags = f & 31;
    if (p.battery <= 0) p.flags &= ~F_FLASH;
    p.lastPosAt = this.now;
  }

  private onInteract(c: Client, m: InteractMsg): void {
    const p = this.playerOf(c);
    if (!p || this.over || !m || typeof m.id !== 'string') return;
    if (p.st !== ST_ALIVE || p.transitUntil > 0) return;
    const near = (x: number, z: number, r = RULES.interactRange + 0.5): boolean => dist(p.x, p.z, x, z) <= r;
    switch (m.kind) {
      case 'disk': {
        const e = this.floor.disks.find((d) => d.id === m.id);
        if (!e || this.taken.has(e.id) || !near(e.x, e.z)) return;
        this.taken.add(e.id); p.disks++;
        const bits = this.params.diskBits;
        this.emit({ k: 'pickup', id: e.id, by: p.id, kind: 'disk' });
        this.earn(p, bits, 'floppy disk');
        break;
      }
      case 'item': {
        const e = this.floor.items.find((d) => d.id === m.id);
        if (!e || this.taken.has(e.id) || !near(e.x, e.z)) return;
        if (!this.giveItem(p, e.sub as ItemId)) { this.toast(p, 'Inventory full'); return; }
        this.taken.add(e.id);
        this.emit({ k: 'pickup', id: e.id, by: p.id, kind: 'item', sub: e.sub });
        break;
      }
      case 'gif': {
        const e = this.floor.gifs.find((d) => d.id === m.id);
        if (!e || this.taken.has(e.id) || !near(e.x, e.z)) return;
        this.taken.add(e.id);
        this.emit({ k: 'pickup', id: e.id, by: p.id, kind: 'gif' });
        this.earn(p, RULES.gifBits, 'hidden GIF');
        break;
      }
      case 'terminal': {
        const t = this.floor.terminal;
        if (!t || !near(centerOf(t.tx), centerOf(t.tz), 3.5) || p.disks <= 0) return;
        const add = Math.min(p.disks, RULES.disksNeeded - this.inserted);
        if (add <= 0) return;
        p.disks -= add; this.inserted += add;
        this.emit({ k: 'insert', n: this.inserted, by: p.id });
        if (this.inserted >= RULES.disksNeeded) { this.exitOpen = true; this.emit({ k: 'exit-open' }); }
        this.gsDirty = true;
        break;
      }
      case 'revive': {
        const t = this.players.find((q) => q.id === m.id);
        if (!t || t.st !== ST_DOWNED || t.disconnected || t === p) return;
        if (!near(t.x, t.z, RULES.reviveRange + 0.5)) return;
        t.reviveBy = p.id; t.reviveLast = this.now;
        break;
      }
      case 'npc': {
        const n = this.floor.npcs.find((q) => q.id === m.id);
        if (!n || !near(n.x, n.z, 3.2)) return;
        this.talkTo(p, n.id);
        break;
      }
      case 'hide': {
        if (p.hidden) {
          p.hidden = null;
          c.send(S.ev, { k: 'hide', id: '', on: false } satisfies EvMsg);
          return;
        }
        const h = this.floor.hides.find((q) => q.id === m.id);
        if (!h || !near(h.x, h.z, 2.4)) return;
        p.hidden = h.id; p.x = h.x; p.z = h.z;
        this.hideUse.set(h.id, (this.hideUse.get(h.id) ?? 0) + 1);
        c.send(S.ev, { k: 'hide', id: h.id, on: true } satisfies EvMsg);
        break;
      }
      case 'popup': {
        const t = this.players.find((q) => q.id === m.id);
        if (!t || t === p || t.popupUntil <= this.now || !near(t.x, t.z, 3.2)) return;
        t.popupUntil = 0;
        this.emit({ k: 'popup-clear', id: t.id });
        break;
      }
      case 'grab': {
        const arm = this.arms.get(p.id);
        if (!arm || !arm.canGrab(p)) return;
        this.completePurchase(p, arm);
        break;
      }
      default:
    }
  }

  private toast(p: PlayerRT, text: string): void {
    this.clients.getById(p.id)?.send(S.ev, { k: 'text', text } satisfies EvMsg);
  }

  private giveItem(p: PlayerRT, item: ItemId): boolean {
    const idx = p.inv.indexOf(null);
    if (idx < 0) return false;
    p.inv[idx] = item;
    this.sendInv(p);
    return true;
  }

  private talkTo(p: PlayerRT, npcId: string): void {
    const n = this.floor.npcs.find((q) => q.id === npcId)!;
    let text: string;
    if (n.mimic) text = MIMIC_LINES[n.line % MIMIC_LINES.length];
    else {
      const lines = NPC_LINES[n.kind];
      text = lines[n.line % lines.length];
    }
    const c = this.clients.getById(p.id);
    c?.send(S.dlg, { npcId, name: n.name, text, look: n.look, mimic: n.mimic });
    if (!n.mimic && !this.taken.has(`${n.id}:used:${p.id}`)) {
      if (n.kind === 'hint') {
        const d = this.floor.disks.find((q) => !this.taken.has(q.id));
        if (d) { c?.send(S.ev, { k: 'hint', x: d.x, z: d.z } satisfies EvMsg); this.taken.add(`${n.id}:used:${p.id}`); }
      } else if (n.kind === 'trade' && n.item && !this.taken.has(`${n.id}:used`)) {
        if (this.giveItem(p, n.item)) { this.taken.add(`${n.id}:used`); this.taken.add(`${n.id}:used:${p.id}`); }
        else this.toast(p, 'Inventory full');
      }
    }
    if (p.userId !== null) GameRoom.db?.addBookmark(p.userId, 'npc', n.mimic ? 'mimic' : n.kind);
    c?.send(S.ev, { k: 'discover', kind: 'npc', id: n.mimic ? 'mimic' : n.kind } satisfies EvMsg);
  }

  private onScan(c: Client): void {
    const p = this.playerOf(c);
    if (!p || p.st !== ST_ALIVE || this.over) return;
    if (this.now < p.scanReady) return;
    p.scanReady = this.now + RULES.scanCooldown;
    const range = p.passives.scanner ? RULES.scanRangeUpgraded : RULES.scanRange;
    const hits: { id: string; kind: string; sub?: string; x: number; z: number }[] = [];
    const add = (id: string, kind: string, x: number, z: number, sub?: string): void => {
      if (dist(p.x, p.z, x, z) <= range) hits.push({ id, kind, sub, x, z });
    };
    for (const d of this.floor.disks) if (!this.taken.has(d.id)) add(d.id, 'disk', d.x, d.z);
    for (const d of this.floor.gifs) if (!this.taken.has(d.id)) add(d.id, 'gif', d.x, d.z);
    for (const d of this.floor.items) if (!this.taken.has(d.id)) add(d.id, 'item', d.x, d.z, d.sub);
    const t = this.floor.terminal;
    if (t) add('terminal', 'terminal', centerOf(t.tx), centerOf(t.tz));
    for (const a of this.floor.anomalies) {
      if (dist(p.x, p.z, a.x, a.z) > range) continue;
      hits.push({ id: a.id, kind: 'anomaly', sub: a.sub, x: a.x, z: a.z });
      if (!this.taken.has(a.id)) {
        this.taken.add(a.id);
        this.earn(p, RULES.anomalyBits, 'anomaly scanned');
        this.emit({ k: 'pickup', id: a.id, by: p.id, kind: 'anomaly', sub: a.sub });
        if (p.userId !== null && a.sub) GameRoom.db?.addBookmark(p.userId, 'anomaly', a.sub);
        c.send(S.ev, { k: 'discover', kind: 'anomaly', id: a.sub ?? '' } satisfies EvMsg);
      }
    }
    const mimics: string[] = [];
    for (const mob of this.mobs) {
      if (mob instanceof Mimic && dist(p.x, p.z, mob.x, mob.z) <= range) { mimics.push(mob.id); mob.scare(this); }
    }
    c.send(S.ev, { k: 'scan', by: p.id, hits, mimic: mimics } satisfies EvMsg);
    this.gsDirty = true;
  }

  private onOrder(c: Client, m: BuyMsg): void {
    const p = this.playerOf(c);
    if (!p || p.st !== ST_ALIVE || !isGuestbook(this.floorNum) || !this.floor.vendor) return;
    const item = m?.item;
    if (!item || !VENDOR_STOCK.includes(item)) return;
    const arm = this.arms.get(p.id);
    if (!arm) return;
    const tent = arm.tent;
    if (dist(p.x, p.z, tent.x, tent.z) > 45) return;
    if (arm.state !== ARM_IDLE && arm.state !== ARM_OFFER && arm.state !== ARM_FIST) { this.toast(p, 'Wait for the hand to come back'); return; }
    let target: string | null = null;
    if (item === 'ghost') {
      const ghost = this.players.find((q) => q.st === ST_GHOST && q.id === m.target) ?? this.players.find((q) => q.st === ST_GHOST);
      if (!ghost) { this.toast(p, 'Nobody to buy back'); return; }
      target = ghost.id;
    }
    arm.offer(item, target);
  }

  private completePurchase(p: PlayerRT, arm: Arm): void {
    const item = arm.item;
    const cost = this.cost(item);
    if (this.balance(p) < cost) { arm.state = ARM_FIST; this.toast(p, 'Too poor!'); return; }
    // validate that the item can be applied before taking money
    if (ITEMS[item].kind === 'inv' && p.inv.indexOf(null) < 0) { this.toast(p, 'Inventory full'); arm.state = ARM_FIST; return; }
    if (item === 'sprintchip' && p.passives.sprint >= 3) { this.toast(p, 'Sprint chips maxed'); arm.state = ARM_FIST; return; }
    if (item === 'softshoes' && p.passives.shoes) { this.toast(p, 'Already wearing soft shoes'); arm.state = ARM_FIST; return; }
    if (item === 'scannerrange' && p.passives.scanner) { this.toast(p, 'Scanner already upgraded'); arm.state = ARM_FIST; return; }
    let ghost: PlayerRT | undefined;
    if (item === 'ghost') {
      ghost = this.players.find((q) => q.id === arm.target && q.st === ST_GHOST);
      if (!ghost) { this.toast(p, 'They are already back'); arm.state = ARM_FIST; return; }
    }
    this.spend(p, cost);
    switch (item) {
      case 'sprintchip': p.passives.sprint++; break;
      case 'softshoes': p.passives.shoes = true; break;
      case 'scannerrange': p.passives.scanner = true; break;
      case 'floortip': {
        const nf = generateFloor(this.seed, this.floorNum + 1);
        this.clients.getById(p.id)?.send(S.ev, { k: 'tip', text: `Next floor: ${FLOOR_TYPE_BY_ID[nf.type].name}`, floorType: nf.type } satisfies EvMsg);
        break;
      }
      case 'monstertip':
        this.clients.getById(p.id)?.send(S.ev, { k: 'tip', text: `${MONSTER_BY_ID.silhouette.name}: ${MONSTER_BY_ID.silhouette.counter}` } satisfies EvMsg);
        break;
      case 'ghost':
        if (ghost) {
          ghost.st = ST_ALIVE; ghost.hidden = null;
          ghost.x = arm.tent.x; ghost.z = arm.tent.z + 3; ghost.lastPosAt = this.now;
          this.emit({ k: 'respawn', id: ghost.id });
          this.clients.getById(ghost.id)?.send('floor', this.floorMsg(ghost));
          const a2 = new Arm(ghost.id, arm.tent); a2.offer('battery', null); this.arms.set(ghost.id, a2);
        }
        break;
      default: this.giveItem(p, item);
    }
    arm.state = ARM_RETRACT;
    arm.twitched = false;
    this.sendInv(p);
    this.gsDirty = true;
    this.emit({ k: 'text', text: `${p.name} bought ${ITEMS[item].name}` });
  }

  private onUse(c: Client, m: UseMsg): void {
    const p = this.playerOf(c);
    if (!p || p.st !== ST_ALIVE || this.over) return;
    const slot = num(m?.slot);
    if (slot === null || slot < 0 || slot >= p.inv.length) return;
    const item = p.inv[slot];
    if (!item) return;
    switch (item) {
      case 'battery': p.battery += 60; p.inv[slot] = null; break;
      case 'glowsticks':
        if (p.glow <= 0) p.glow = 3;
        this.emit({ k: 'glow', x: p.x, z: p.z, by: p.id });
        p.glow--;
        if (p.glow <= 0) p.inv[slot] = null;
        break;
      case 'radio':
        this.radios.push({ x: p.x, z: p.z, until: this.now + 10 });
        this.emit({ k: 'radio', x: p.x, z: p.z });
        p.inv[slot] = null;
        break;
      default: return; // ctrlz is used through its own message
    }
    this.sendInv(p);
  }

  private onRewind(c: Client, m: { x: number; z: number }): void {
    const p = this.playerOf(c);
    if (!p || p.st !== ST_ALIVE) return;
    const slot = p.inv.indexOf('ctrlz');
    const x = num(m?.x), z = num(m?.z);
    if (slot < 0 || x === null || z === null) return;
    if (solidAt(this.grid, x, z) || dist(p.x, p.z, x, z) > PLAYER.maxSpeed * 6) return;
    p.inv[slot] = null;
    p.x = x; p.z = z; p.lastPosAt = this.now;
    c.send(S.ev, { k: 'rewind', x, z } satisfies EvMsg);
    this.sendInv(p);
  }

  private onPing(c: Client, m: { x: number; z: number }): void {
    const p = this.playerOf(c);
    const x = num(m?.x), z = num(m?.z);
    if (!p || p.st !== ST_ALIVE || x === null || z === null) return;
    this.emit({ k: 'ping', by: p.id, x, z });
  }

  private onSay(c: Client, m: { text: string }): void {
    const p = this.playerOf(c);
    if (!p || typeof m?.text !== 'string') return;
    const text = m.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
    if (text) this.emit({ k: 'say', by: p.id, text });
  }

  private loadBookmarks(client: Client, userId: number): void {
    try {
      const rows = GameRoom.db?.bookmarks(userId) ?? [];
      client.send('bookmarks', rows);
    } catch { /* ignore */ }
  }

  private sendInv(p: PlayerRT): void {
    this.clients.getById(p.id)?.send(S.inv, { slots: p.inv, glow: p.glow, battery: Math.max(0, Math.round(p.battery)) });
  }

  // ------------------------------------------------------------------ simulation

  private tick(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.now += dt;
    if (!this.started || this.over) return;

    this.updatePlayers(dt);
    const guest = isGuestbook(this.floorNum);

    if (!guest) {
      if (!this.awake && this.now >= this.wakeAt) {
        this.awake = true;
        this.emit({ k: 'wake' });
        this.emit({ k: 'stinger', which: 'bell' });
      }
      this.radios = this.radios.filter((r) => r.until > this.now);
      this.noises = this.noises.filter((r) => r.until > this.now);
      for (const m of this.mobs) {
        if (m.kind === 'rat' || this.awake) m.update(this, dt);
      }
      this.popups(dt);
      this.erase404(dt);
      this.director(dt);
      this.discoverMobs();
    } else {
      for (const arm of this.arms.values()) {
        const p = this.players.find((q) => q.id === arm.playerId);
        const ev = arm.update(this, p, dt, (item) => !!p && this.balance(p) >= this.cost(item));
        if (ev === 'snap') this.emit({ k: 'stinger', which: 'bell' });
      }
    }

    // exit: everyone alive within 10 m for 3 s
    const alive = this.alive();
    if (this.exitOpen && alive.length) {
      const ex = centerOf(this.floor.exit.tx), ez = centerOf(this.floor.exit.tz);
      if (alive.every((p) => dist(p.x, p.z, ex, ez) <= RULES.exitRadius)) this.exitHold += dt;
      else this.exitHold = Math.max(0, this.exitHold - dt * 2);
      if (this.exitHold >= RULES.exitHold) this.advance();
    } else this.exitHold = 0;

    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ) { this.snapAcc = 0; this.sendSnap(); }
    this.invAcc += dt;
    if (this.invAcc >= 1) { this.invAcc = 0; for (const p of this.players) this.sendInv(p); }
    if (this.gsDirty) { this.gsDirty = false; this.broadcast(S.gs, this.gameState()); }
  }

  private updatePlayers(dt: number): void {
    for (const p of [...this.players]) {
      // speed decays if no recent position message
      if (this.now - p.lastPosAt > 0.35) p.speed *= 0.5;

      // noise radius for monsters
      const moving = p.speed > 0.6 && !p.hidden;
      let r = 0;
      if (p.hidden || p.st !== ST_ALIVE) r = 0;
      else {
        if (moving) {
          if (p.flags & F_CROUCH) r = 2;
          else if ((p.flags & F_SPRINT) && p.speed > PLAYER.walk + 0.4) r = 20;
          else r = 8;
          if (p.passives.shoes) r *= 0.75;
          if (this.floor.type === 'server') r *= 0.5;
        }
        if (p.flags & F_TALK) r = Math.max(r, 15 * (this.floor.type === 'chatroom' ? 2 : 1));
      }
      p.noise = r;

      // flashlight battery
      if (p.st === ST_ALIVE && (p.flags & F_FLASH) && p.battery > 0) p.battery = Math.max(0, p.battery - dt);

      // pop-up expiry
      if (p.popupUntil > 0 && p.popupUntil <= this.now) { p.popupUntil = 0; this.emit({ k: 'popup-clear', id: p.id }); }

      // left-behind players are pulled through
      if (p.transitUntil > 0 && this.now >= p.transitUntil) {
        p.transitUntil = 0;
        const e = this.spawnPoint(this.players.indexOf(p));
        p.x = e.x; p.z = e.z; p.lastPosAt = this.now;
        this.clients.getById(p.id)?.send('floor', this.floorMsg(p));
      }

      if (p.st === ST_DOWNED) {
        // revive progress: needs the reviver to keep holding
        if (p.reviveBy && this.now - p.reviveLast < 0.4 && !p.disconnected) {
          const rv = this.players.find((q) => q.id === p.reviveBy);
          if (rv && rv.st === ST_ALIVE && dist(rv.x, rv.z, p.x, p.z) <= RULES.reviveRange + 0.6) {
            p.reviveProg += dt;
            if (p.reviveProg >= RULES.reviveTime) {
              p.st = ST_ALIVE; p.reviveProg = 0; p.reviveBy = null; p.bleedLeft = 0;
              this.emit({ k: 'revive', id: p.id, by: rv.id });
              this.gsDirty = true;
              continue;
            }
          } else { p.reviveProg = 0; p.reviveBy = null; }
        } else if (p.reviveProg > 0) {
          p.reviveProg = Math.max(0, p.reviveProg - dt * 2);
          if (p.reviveProg === 0) p.reviveBy = null;
        }
        // bleed out (disconnected players hold for 60 s, then are removed)
        p.bleedLeft -= dt;
        if (p.bleedLeft <= 0) {
          if (p.disconnected) { continue; }
          p.st = ST_GHOST; p.reviveProg = 0;
          this.emit({ k: 'dead', id: p.id });
          this.gsDirty = true;
          this.maybeEnd();
        }
      }
    }
  }

  private popups(dt: number): void {
    if (this.floorNum < 6 || !this.awake) return;
    this.popupT -= dt;
    if (this.popupT > 0) return;
    this.popupT = 20 + Math.random() * 20;
    const al = this.alive().filter((p) => !p.hidden && p.popupUntil === 0);
    if (!al.length) return;
    const p = al[Math.floor(Math.random() * al.length)];
    p.popupUntil = this.now + 3;
    this.emit({ k: 'popup', id: p.id });
    if (!this.discoveredPopup) { this.discoveredPopup = true; this.discoverFor(null, 'popup'); }
  }

  private erase404(dt: number): void {
    if (this.floorNum < 15 || !this.exitOpen) return;
    this.erase404T -= dt;
    if (this.erase404T > 0) return;
    this.erase404T = 6;
    if (!this.distExit) this.distExit = bfsDist(this.grid, this.floor.exit.tx, this.floor.exit.tz);
    const al = this.alive();
    if (!al.length) return;
    let maxP = 0;
    for (const p of al) maxP = Math.max(maxP, this.distExit[tileOf(p.z) * this.grid.cols + tileOf(p.x)]);
    const cand: number[] = [];
    for (let i = 0; i < this.distExit.length; i++) {
      const d = this.distExit[i];
      if (d > maxP + 6) {
        const cx = centerOf(i % this.grid.cols), cz = centerOf((i / this.grid.cols) | 0);
        if (this.mobs.some((m) => dist(m.x, m.z, cx, cz) < 4)) continue;
        cand.push(i);
      }
    }
    cand.sort((a, b) => this.distExit![a] - this.distExit![b]);
    const tiles = cand.slice(0, 14);
    if (!tiles.length) return;
    for (const i of tiles) this.grid.solid[i] = 1;
    this.emit({ k: 'erase', tiles });
    if (!this.discovered404) { this.discovered404 = true; this.discoverFor(null, 'four04'); }
  }

  private director(dt: number): void {
    let nearest = Infinity;
    let hunting = false;
    for (const m of this.mobs) {
      if (m.kind === 'rat') continue;
      if (m.state === ST_HUNT) hunting = true;
      for (const p of this.alive()) nearest = Math.min(nearest, dist(m.x, m.z, p.x, p.z));
    }
    let inc = 0;
    if (nearest < 15) inc = ((15 - nearest) / 15) * 18;
    if (hunting) inc = Math.max(inc, 14);
    if (inc > 0) this.tension += inc * dt; else this.tension -= 5 * dt;
    this.tension = Math.max(0, Math.min(100, this.tension));
    if (this.tension > DIRECTOR.highThreshold) this.highT += dt; else this.highT = 0;
    if (this.highT >= DIRECTOR.highHold) {
      for (const m of this.mobs) if (m instanceof Silhouette) m.retreat(this, DIRECTOR.backoff);
      this.tension = 40; this.highT = 0;
      this.emit({ k: 'text', text: '…it backs off. Breathe.' });
    }
    // fake cues: about 1 in 4 quiet stretches
    if (nearest > 30 && this.awake) {
      this.calmT += dt;
      if (this.calmT > 20) {
        this.calmT = 0;
        if (Math.random() < 0.25) this.emit({ k: 'stinger', which: Math.random() < 0.5 ? 'fake-bell' : 'fake-step' });
      }
    } else this.calmT = 0;
  }

  private discoverMobs(): void {
    for (const p of this.alive()) {
      for (const m of this.mobs) {
        if (!(m.kind === 'rat' || this.awake) || p.seenKinds.has(m.kind)) continue;
        if (dist(m.x, m.z, p.x, p.z) < 15) { p.seenKinds.add(m.kind); this.discoverFor(p, m.kind); }
      }
    }
  }

  private discoverFor(p: PlayerRT | null, kind: string): void {
    const targets = p ? [p] : this.alive();
    for (const q of targets) {
      this.clients.getById(q.id)?.send(S.ev, { k: 'discover', kind: 'monster', id: kind } satisfies EvMsg);
      if (q.userId !== null) GameRoom.db?.addBookmark(q.userId, 'monster', kind);
    }
  }

  // ------------------------------------------------------------------ snapshots

  private gameState(): GameState {
    const states: Record<string, number> = {};
    const passives: GameState['passives'] = {};
    for (const p of this.players) { states[p.id] = p.st; passives[p.id] = p.passives; }
    return {
      floor: this.floorNum, phase: this.over ? 'over' : this.started ? 'floor' : 'lobby', shared: this.opts.sharedWallet,
      pool: this.pool, wallets: { ...this.wallets }, totalBits: this.totalBits, taken: [...this.taken], inserted: this.inserted,
      exitOpen: this.exitOpen, awake: this.awake, states, exitProgress: 0, passives, tension: 0,
    };
  }

  private sendSnap(): void {
    const p: PSnap[] = [];
    for (const q of this.players) {
      if (q.transitUntil > 0) continue;
      p.push({
        i: q.id, x: r2(q.x), z: r2(q.z), r: r2(q.yaw), f: q.flags | 0, s: q.st,
        pu: q.popupUntil > this.now ? 1 : 0, rv: q.st === ST_DOWNED ? r2(q.reviveProg / RULES.reviveTime) : 0,
        bl: q.st === ST_DOWNED ? r2(Math.max(0, q.bleedLeft) / (q.disconnected ? RULES.disconnectKeep : RULES.bleedOut)) : 0,
        h: q.hidden ? 1 : 0,
      });
    }
    const m: MSnap[] = [];
    for (const mob of this.mobs) {
      if (!(mob.kind === 'rat' || this.awake)) continue;
      m.push({ i: mob.id, k: mob.kind, x: r2(mob.x), z: r2(mob.z), r: r2(mob.yaw), s: mob.state, c: mob.copy });
    }
    const a: ASnap[] = [];
    for (const arm of this.arms.values()) if (arm.state !== ARM_IDLE) a.push(arm.snap());
    this.broadcast(S.snap, {
      t: Math.round(this.now * 1000), p, m, a, tn: Math.round(this.tension),
      xp: r2(this.exitHold / RULES.exitHold), wk: this.awake || !Number.isFinite(this.wakeAt) ? 0 : Math.max(0, Math.ceil(this.wakeAt - this.now)),
    });
  }
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
void TILE; void ANOMALIES; void hashString;
