// The client game: local movement, interpolated remote entities, interactions, style-break effects.
import * as THREE from 'three';
import {
  ANOMALIES, ASnap, DlgMsg, EvMsg, F_CROUCH, F_FLASH, F_SPRINT, F_TALK, F_WEBCAM, FLOOR_TYPE_BY_ID, FloorData, FloorMsg, GameState,
  ITEMS, InvMsg, ItemId, Look, LobbyMsg, MONSTER_BY_ID, MSnap, OverMsg, PLAYER, PSnap, RULES, SNAP_HZ, STYLE_BREAK, Snap, ST_ALIVE, ST_DOWNED,
  ST_GHOST, TICK_HZ, TILE, WALL_H, centerOf, collide, dist, generateFloor, isGuestbook, los, tileOf, playerLook,
} from '@webmaze/shared';
import { AudioEngine } from './audio';
import { Input } from './input';
import { Net } from './net';
import { PixelRenderer } from './render/renderer';
import {
  CharacterSprite, bellTreeTexture, mannequinTexture, ratTexture, silhouetteTexture,
} from './render/sprites';
import { FloorView } from './render/world';
import { Bookmarks, HudState, UI } from './ui';

interface Buffered { at: number; s: Snap }
interface Remote { id: string; name: string; look: Look; sprite: CharacterSprite; x: number; z: number; r: number; f: number; st: number; pu: number; h: number; rv: number; bl: number; lastX: number; lastZ: number; stepAcc: number }
interface MobView { id: string; kind: string; mesh: THREE.Object3D; sprite?: CharacterSprite; x: number; z: number; r: number; s: number; lastX: number; lastZ: number; still: number; copy?: string }
interface Mark { kind: string; x: number; z: number; until: number; sub?: string; id: string }

const EMOJI: Record<string, string> = { disk: '💾', gif: '🌀', item: '🎁', terminal: '🖥', anomaly: '❓' };

export class Game {
  gl: PixelRenderer;
  playing = false;
  youId = '';
  lobby: LobbyMsg | null = null;
  gs: GameState | null = null;
  inv: InvMsg = { slots: [null, null, null, null], glow: 0, battery: 120 };
  floor: FloorData | null = null;
  view: FloorView | null = null;
  floorNum = 0;
  over = false;

  // local player
  px = 0; pz = 0; yaw = 0; pitch = 0;
  stamina = PLAYER.sprintTime;
  private tired = false;
  private eye: number = PLAYER.eye;
  private stepAcc = 0;
  private flashOn = false;
  private webcamOn = false;
  private hidden = false;
  private held = 0;
  private lastInserted = 0;
  private sendAcc = 0;
  private reviveSend = 0;
  private history: { t: number; x: number; z: number }[] = [];
  private histAcc = 0;
  private scanCd = 0;
  private specIdx = 0;
  private myPopup = false;
  private dmg = 0;
  private lastState = ST_ALIVE;
  private dlgNpc: { x: number; z: number } | null = null;
  private speakerlessAt = 0;
  private lastNear = 99;

  // world state
  private snaps: Buffered[] = [];
  private remotes = new Map<string, Remote>();
  private mobs = new Map<string, MobView>();
  private marks: Mark[] = [];
  private pings: { x: number; z: number; until: number; by: string }[] = [];
  private explored = new Uint8Array(0);
  private exploreAcc = 0;
  private taken = new Set<string>();
  private glowSticks: { x: number; z: number }[] = [];
  private treeCool = new Map<string, number>();
  private silTex = [silhouetteTexture(true, 0), silhouetteTexture(true, 1), silhouetteTexture(false, 0)];
  private ratTex = ratTexture();
  private clock = 0;
  private lastFrame = 0;
  private bookmarks: Bookmarks = { monster: [], anomaly: [], npc: [] };
  private tmpV = new THREE.Vector3();
  private lastHunt = false;
  private hurtFlash = 0;

  constructor(private canvas: HTMLCanvasElement, public ui: UI, public input: Input, public audio: AudioEngine, public net: Net) {
    this.gl = new PixelRenderer(canvas);
    this.loadBookmarks();
    canvas.addEventListener('pointerdown', () => { if (this.myState === ST_GHOST) this.specIdx++; });
    requestAnimationFrame((t) => this.frame(t));
  }

  get myState(): number {
    return this.gs?.states[this.youId] ?? ST_ALIVE;
  }

  // ------------------------------------------------------------------ bookmarks

  private loadBookmarks(): void {
    try {
      const raw = localStorage.getItem('webmaze.bookmarks');
      if (raw) this.bookmarks = { monster: [], anomaly: [], npc: [], ...JSON.parse(raw) };
    } catch { /* ignore */ }
  }
  mergeBookmarks(rows: { kind: string; key: string }[]): void {
    for (const r of rows) this.addBookmark(r.kind, r.key, false);
  }
  sensitivity = (() => { try { const v = parseFloat(localStorage.getItem('webmaze.sens') ?? ''); return v > 0 ? v : 1; } catch { return 1; } })();
  setSensitivity(v: number): void {
    this.sensitivity = Math.max(0.05, Math.min(3, v));
    try { localStorage.setItem('webmaze.sens', String(this.sensitivity)); } catch { /* ignore */ }
  }

  private openPause(): void {
    this.ui.openHelp({
      sensitivity: this.sensitivity,
      raw: this.input.rawInput,
      setSensitivity: (v) => this.setSensitivity(v),
      setRaw: (on) => { this.input.setRawInput(on); this.input.releasePointer(); },
    });
  }

  private addBookmark(kind: string, key: string, announce = true): void {
    const list = (this.bookmarks as unknown as Record<string, string[]>)[kind];
    if (!list || !key || list.includes(key)) return;
    list.push(key);
    try { localStorage.setItem('webmaze.bookmarks', JSON.stringify(this.bookmarks)); } catch { /* ignore */ }
    if (announce) {
      const name = kind === 'monster' ? MONSTER_BY_ID[key as keyof typeof MONSTER_BY_ID]?.name : kind === 'anomaly' ? ANOMALIES.find((a) => a.id === key)?.name : key;
      this.ui.toast(`📖 New bookmark: ${name ?? key}`);
    }
  }

  // ------------------------------------------------------------------ server messages

  onLobby(m: LobbyMsg): void {
    this.lobby = m;
    this.youId = m.youId;
    if (!m.started && !this.playing) this.ui.showLobby(m);
  }

  onFloor(m: FloorMsg): void {
    this.input.clearPressed();
    this.over = false;
    if (this.view) { this.gl.scene.remove(this.view.group); this.view.dispose(); }
    for (const r of this.remotes.values()) { this.gl.scene.remove(r.sprite.group); r.sprite.dispose(); }
    for (const mv of this.mobs.values()) this.gl.scene.remove(mv.mesh);
    this.remotes.clear(); this.mobs.clear(); this.snaps = []; this.marks = []; this.pings = []; this.taken.clear(); this.glowSticks = [];
    this.floorNum = m.floor;
    this.floor = generateFloor(m.seed, m.floor);
    this.view = new FloorView(this.floor);
    this.gl.scene.add(this.view.group);
    this.gl.scene.fog = this.view.fog;
    this.gl.scene.background = new THREE.Color(this.view.clearColor);
    this.px = m.spawn.x; this.pz = m.spawn.z;
    // face the first open neighbour so the player starts looking down a corridor
    const e = this.floor.entry;
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (!this.floor.solid[(e.tz + dz) * this.floor.cols + (e.tx + dx)]) { this.yaw = Math.atan2(-dx, -dz); break; }
    }
    this.pitch = 0; this.stamina = this.maxStamina(); this.tired = false; this.hidden = false; this.held = 0; this.lastInserted = 0;
    this.history = []; this.myPopup = false; this.ui.popup(false);
    this.explored = new Uint8Array(this.floor.cols * this.floor.rows);
    this.audio.setFloor(this.floor.type, m.seed, m.floor);
    this.playing = true;
    this.ui.showHud();
    this.input.enabled = true;
    this.input.setTouchVisible(true);
    this.ui.toast(`Floor ${m.floor}: ${FLOOR_TYPE_BY_ID[this.floor.type].name}`);
    this.view.setExitOpen(this.floor.type === 'guestbook');
    if (this.gs) this.view.setTakenIds(this.taken);
    if (!this.input.touch && !this.input.locked) this.ui.toast('Click the game to capture the mouse');
  }

  onSnap(s: Snap): void {
    this.snaps.push({ at: performance.now(), s });
    if (this.snaps.length > 12) this.snaps.shift();
    this.view?.setArms(s.a);
    this.tension = s.tn;
    this.wakeIn = s.wk;
    this.exitProg = s.xp;
  }
  private tension = 0;
  private wakeIn = 0;
  private exitProg = 0;

  onGs(g: GameState): void {
    const prev = this.gs;
    this.gs = g;
    this.taken = new Set(g.taken);
    this.view?.setTakenIds(this.taken);
    if (this.view && g.exitOpen !== (prev?.exitOpen ?? false)) this.view.setExitOpen(g.exitOpen || this.floor?.type === 'guestbook');
    if (g.states[this.youId] !== undefined && prev && prev.states[this.youId] !== g.states[this.youId]) this.onMyStateChange(g.states[this.youId]);
  }

  private onMyStateChange(st: number): void {
    if (st === ST_DOWNED) { this.hurtFlash = 1; this.hidden = false; }
    if (st === ST_ALIVE && this.lastState !== ST_ALIVE) this.ui.toast('You are back on your feet');
    this.lastState = st;
  }

  onInv(m: InvMsg): void {
    this.inv = m;
    if (m.battery <= 0 && this.flashOn) this.flashOn = false;
  }

  onDlg(m: DlgMsg): void {
    if (!this.lobby) return;
    const me = this.lobby.players.find((p) => p.id === this.youId);
    if (!me) return;
    const npc = this.floor?.npcs.find((n) => n.id === m.npcId);
    this.dlgNpc = npc ? { x: npc.x, z: npc.z } : null;
    this.input.releasePointer();
    this.ui.openDialogue(m.name, m.text, me.look, m.look, m.mimic, () => this.audio.babble(130 + (m.name.charCodeAt(0) % 9) * 40));
  }

  onOver(m: OverMsg): void {
    this.over = true;
    this.input.enabled = false;
    this.input.setTouchVisible(false);
    this.input.releasePointer();
    this.audio.play('death');
    this.ui.hideAll();
    const me = this.lobby?.players.find((p) => p.id === this.youId);
    this.ui.showOver(m, me?.name ?? 'Player');
  }

  private nameOf(id: string): string {
    return this.lobby?.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  onEv(e: EvMsg): void {
    const view = this.view;
    switch (e.k) {
      case 'pickup':
        this.taken.add(e.id);
        view?.setTakenIds(this.taken);
        if (e.by === this.youId) {
          if (e.kind === 'disk') { this.held++; }
          this.audio.play('pickup');
          if (e.kind === 'item') this.ui.toast(`Picked up ${ITEMS[e.sub as ItemId]?.name ?? 'item'}`);
        } else if (this.floor) {
          const ent = [...this.floor.disks, ...this.floor.items, ...this.floor.gifs].find((x) => x.id === e.id);
          if (ent) this.audio.play('pickup', ent.x, ent.z);
        }
        break;
      case 'bits':
        this.ui.toast(`${e.delta > 0 ? '+' : ''}${e.delta} bits · ${e.why}`);
        this.audio.play('coin');
        break;
      case 'down':
        this.ui.toast(`${this.nameOf(e.id)} is down!`);
        if (e.id === this.youId) { this.hurtFlash = 1; this.audio.play('glitch'); }
        break;
      case 'revive':
        this.ui.toast(`${this.nameOf(e.by)} revived ${this.nameOf(e.id)}`);
        this.audio.play('revive');
        break;
      case 'dead':
        this.ui.toast(`${this.nameOf(e.id)} became a ghost cursor`);
        this.audio.play('death');
        break;
      case 'respawn': this.ui.toast(`${this.nameOf(e.id)} was bought back!`); this.audio.play('revive'); break;
      case 'insert':
        if (e.by === this.youId) this.held = Math.max(0, this.held - Math.max(1, e.n - this.lastInserted));
        this.lastInserted = e.n;
        this.audio.play('insert');
        this.ui.toast(`Floppy inserted (${e.n}/3)`);
        break;
      case 'exit-open': this.audio.play('open'); this.ui.toast('The link is open! Everyone go to the exit.'); view?.setExitOpen(true); break;
      case 'wake': this.ui.toast('…it is awake.'); break;
      case 'scan': {
        if (e.by !== this.youId) break;
        this.audio.play('scan');
        const until = performance.now() + 7000;
        for (const h of e.hits) this.marks.push({ kind: h.kind, x: h.x, z: h.z, until, sub: h.sub, id: h.id });
        this.ui.toast(e.hits.length ? `Scanner: ${e.hits.length} signal${e.hits.length === 1 ? '' : 's'}` : 'Scanner: nothing nearby');
        if (e.mimic?.length) this.ui.toast('MIMIC detected. It runs.');
        break;
      }
      case 'popup':
        if (e.id === this.youId) { this.myPopup = true; this.ui.popup(true); this.audio.play('popup'); this.input.interactHeld = false; }
        break;
      case 'popup-clear':
        if (e.id === this.youId) { this.myPopup = false; this.ui.popup(false); this.audio.play('click'); }
        break;
      case 'radio': this.audio.play('radio', e.x, e.z); break;
      case 'glow': view?.addGlowStick(e.x, e.z); this.glowSticks.push({ x: e.x, z: e.z }); break;
      case 'hint': this.marks.push({ kind: 'disk', x: e.x, z: e.z, until: performance.now() + 30000, id: 'hint' }); this.ui.toast('They pointed somewhere. Check the map (M).'); break;
      case 'tip': this.ui.toast(e.text); break;
      case 'stinger': this.audio.play(e.which); break;
      case 'text': this.ui.toast(e.text); break;
      case 'erase':
        if (this.floor && view) {
          for (const i of e.tiles) this.floor.solid[i] = 1;
          view.rebuildWalls();
          this.ui.toast('404: the corridor behind you is gone.');
          this.audio.play('glitch');
        }
        break;
      case 'rewind': this.px = e.x; this.pz = e.z; this.history = []; break;
      case 'ping': this.pings.push({ x: e.x, z: e.z, until: performance.now() + 8000, by: this.nameOf(e.by) }); this.audio.play('ping', e.x, e.z); break;
      case 'say': this.ui.toast(`${this.nameOf(e.by)}: ${e.text}`); break;
      case 'hide':
        this.hidden = e.on;
        this.audio.play('hide');
        if (e.on) this.ui.toast('Hiding. Stay quiet. [E] to come out.');
        break;
      case 'floor-clear': this.ui.toast(`Clean floor! +${e.bonus} bits`); break;
      case 'discover': this.addBookmark(e.kind, e.id); break;
      default:
    }
  }

  // ------------------------------------------------------------------ helpers

  private maxStamina(): number {
    return PLAYER.sprintTime + (this.gs?.passives[this.youId]?.sprint ?? 0);
  }

  private balance(): number {
    if (!this.gs) return 0;
    return this.gs.shared ? this.gs.pool : this.gs.wallets[this.youId] ?? 0;
  }

  private sampleSnap(): { a: Snap; b: Snap; k: number } | null {
    if (!this.snaps.length) return null;
    const t = performance.now() - 100; // 100 ms interpolation delay
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i].at > t) i--;
    const a = this.snaps[i], b = this.snaps[Math.min(i + 1, this.snaps.length - 1)];
    const span = b.at - a.at;
    const k = span > 0 ? Math.max(0, Math.min(1, (t - a.at) / span)) : 1;
    return { a: a.s, b: b.s, k };
  }

  private lerpAngle(a: number, b: number, k: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  // ------------------------------------------------------------------ frame

  private frame(ms: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (ms - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = ms;
    this.clock += dt;
    this.ui.tick(dt);
    if (this.playing && this.floor && this.view && !this.over) this.update(dt);
    else this.input.takeLook(); // don't let mouse movement pile up while menus/lobby are showing
    this.gl.render(this.clock);
  }

  private update(dt: number): void {
    const f = this.floor!, view = this.view!;
    const input = this.input;
    input.poll();
    const st = this.myState;
    const alive = st === ST_ALIVE;
    const blocked = this.ui.blocking || this.myPopup;

    // ---- edge actions ----
    if (input.consume('esc')) {
      if (this.ui.dialogueOpen) this.ui.closeDialogue();
      else if (this.ui.overlayKind) this.ui.closeOverlay();
      else { this.openPause(); input.releasePointer(); }
    }
    if (!this.ui.chatEl) {
      if (input.consume('map')) this.toggleMap();
      if (input.consume('book')) { if (this.ui.overlayKind === 'book') this.ui.closeOverlay(); else if (!this.ui.overlayKind) { this.ui.openBookmarks(this.bookmarks); input.releasePointer(); } }
      if (input.consume('shop')) this.toggleShop();
      if (input.consume('chat') && !this.ui.overlayKind) { input.releasePointer(); this.ui.openChat((t) => this.net.say(t)); }
    } else input.clearPressed();
    if (alive && !blocked) {
      if (input.consume('flash') && this.inv.battery > 0) { this.flashOn = !this.flashOn; this.audio.play('click'); }
      if (input.consume('webcam')) { this.webcamOn = !this.webcamOn; this.audio.play('click'); }
      if (input.consume('scan') && this.scanCd <= 0 && !this.hidden) { this.net.scan(); this.scanCd = RULES.scanCooldown; }
      for (let i = 0; i < 4; i++) if (input.consume(`use${i}`) && this.inv.slots[i]) this.useSlot(i);
      if (input.consume('rewind') && this.inv.slots.includes('ctrlz') && this.history.length) { const h = this.history[0]; this.net.rewind(h.x, h.z); }
      if (input.consume('ping')) this.sendPing();
    } else { for (const k of ['flash', 'webcam', 'scan', 'use0', 'use1', 'use2', 'use3', 'rewind', 'ping']) input.consume(k); }
    if (this.inv.battery <= 0) this.flashOn = false;
    this.scanCd = Math.max(0, this.scanCd - dt);

    // ---- look ----
    if (input.consume('sensDown')) { this.setSensitivity(this.sensitivity / 1.25); this.ui.toast(`Look sensitivity ${Math.round(this.sensitivity * 100)}%`); }
    if (input.consume('sensUp')) { this.setSensitivity(this.sensitivity * 1.25); this.ui.toast(`Look sensitivity ${Math.round(this.sensitivity * 100)}%`); }
    const [ldx, ldy] = input.takeLook();
    if (!blocked || this.ui.overlayKind === null) {
      const k = 0.0011 * this.sensitivity;
      this.yaw -= ldx * k;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - ldy * k));
    }

    // ---- movement ----
    let moving = false, sprinting = false;
    const crouch = alive && input.crouch && !this.hidden;
    if (alive && !blocked && !this.hidden) {
      const mx = input.moveX, mz = input.moveZ;
      const mag = Math.min(1, Math.hypot(mx, mz));
      moving = mag > 0.05;
      const max = this.maxStamina();
      if (moving && input.sprint && !crouch && !this.tired && this.stamina > 0) {
        sprinting = true;
        this.stamina = Math.max(0, this.stamina - dt);
        if (this.stamina <= 0) this.tired = true;
      } else {
        this.stamina = Math.min(max, this.stamina + (max / PLAYER.sprintRecover) * dt);
        if (this.tired && this.stamina >= Math.min(max, 1.5)) this.tired = false;
      }
      const speed = crouch ? PLAYER.crouch : sprinting ? PLAYER.sprint : PLAYER.walk;
      if (moving) {
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        const dx = (fx * mz + rx * mx) / Math.max(mag, 0.001), dz = (fz * mz + rz * mx) / Math.max(mag, 0.001);
        const step = speed * mag * dt;
        const c = collide(f, this.px + dx * step, this.pz + dz * step, PLAYER.radius);
        this.px = c.x; this.pz = c.z;
        this.stepAcc += step;
        if (this.stepAcc > (sprinting ? 2.4 : crouch ? 1.4 : 1.8)) { this.stepAcc = 0; if (!crouch) this.audio.play('step'); }
      }
    } else if (!alive) {
      this.stamina = this.maxStamina();
    } else {
      this.stamina = Math.min(this.maxStamina(), this.stamina + dt);
    }

    // interact hold needs E or touch button
    this.handleInteract(dt, alive && !blocked);

    // ---- history for Ctrl+Z (5 s) ----
    this.histAcc += dt;
    if (this.histAcc > 0.25) { this.histAcc = 0; this.history.push({ t: this.clock, x: this.px, z: this.pz }); while (this.history.length && this.clock - this.history[0].t > 5) this.history.shift(); }

    // ---- send position ----
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / TICK_HZ && alive && !this.hidden) {
      this.sendAcc = 0;
      const flags = (crouch ? F_CROUCH : 0) | (sprinting ? F_SPRINT : 0) | (this.flashOn ? F_FLASH : 0) | (input.talkHeld ? F_TALK : 0) | (this.webcamOn ? F_WEBCAM : 0);
      this.net.pos({ n: this.floorNum, x: this.px, z: this.pz, yaw: this.yaw, f: flags });
    } else if (this.hidden && this.sendAcc > 0.5) {
      this.sendAcc = 0;
      this.net.pos({ n: this.floorNum, x: this.px, z: this.pz, yaw: this.yaw, f: 0 });
    }

    // ---- remote entities ----
    this.updateRemotes(dt);
    this.updateMobs(dt);

    // ---- camera ----
    const cam = this.gl.camera;
    let cx = this.px, cz = this.pz, cy: number, cyaw = this.yaw, cpitch = this.pitch, roll = 0;
    if (st === ST_GHOST) {
      const targets = [...this.remotes.values()].filter((r) => r.st === ST_ALIVE);
      if (targets.length) {
        const t = targets[((this.specIdx % targets.length) + targets.length) % targets.length];
        cx = t.x - Math.sin(t.r) * -0.1; cz = t.z; cyaw = t.r; cpitch = 0;
        this.px = t.x; this.pz = t.z;
        cy = PLAYER.eye;
      } else cy = PLAYER.eye;
    } else if (st === ST_DOWNED) { cy = 0.35; roll = 0.5; cpitch = Math.min(cpitch, 0.3); }
    else {
      const target = crouch || this.hidden ? PLAYER.eyeCrouch : PLAYER.eye;
      this.eye += (target - this.eye) * Math.min(1, dt * 10);
      cy = this.eye;
    }
    cam.position.set(cx, cy, cz);
    cam.rotation.set(cpitch, cyaw, roll);
    const fov = this.webcamOn ? 58 : 72;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    this.audio.setListener(cx, cz, cyaw);

    // ---- world view ----
    view.update(dt, cx, cz, this.webcamOn);
    const lightOn = this.flashOn && this.inv.battery > 0 && alive;
    const baseFar = f.type === 'park' ? 38 : f.type === 'chatroom' ? 16 : 24;
    const farTarget = lightOn ? baseFar + 10 : baseFar * 0.55;
    view.fog.far += (farTarget - view.fog.far) * Math.min(1, dt * 4);
    view.fog.near = lightOn ? 4 : 1.5;

    this.updateStyleBreak(dt, cx, cz);
    this.updateExplore(dt);
    this.updateOverlays(cam);

    // dialogue distance rule
    if (this.ui.dialogueOpen && this.dlgNpc && dist(this.px, this.pz, this.dlgNpc.x, this.dlgNpc.z) > 4) this.ui.closeDialogue();

    // ---- HUD ----
    this.hudUpdate(st, crouch);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.4);
    this.gl.fx.flash = this.hurtFlash * 0.7;
    this.ui.setFx(st === ST_DOWNED ? 0.6 + Math.sin(this.clock * 6) * 0.2 : this.hurtFlash * 0.6);
  }

  private toggleMap(): void {
    if (this.ui.overlayKind === 'map') { this.ui.closeOverlay(); return; }
    if (this.ui.overlayKind || !this.floor) return;
    this.input.releasePointer();
    this.ui.openMap(this.floor.cols * 6);
  }

  private toggleShop(): void {
    if (this.ui.overlayKind === 'shop') { this.ui.closeOverlay(); return; }
    if (this.ui.overlayKind || !this.floor || !isGuestbook(this.floorNum)) return;
    if (this.myState !== ST_ALIVE) return;
    const ghosts = Object.values(this.gs?.states ?? {}).filter((s) => s === ST_GHOST).length;
    this.input.releasePointer();
    this.ui.openShop(this.floorNum, this.balance(), ghosts);
  }

  private useSlot(i: number): void {
    const item = this.inv.slots[i];
    if (!item) return;
    if (item === 'ctrlz') { if (this.history.length) this.net.rewind(this.history[0].x, this.history[0].z); return; }
    this.net.use({ slot: i });
    this.audio.play('click');
  }

  private sendPing(): void {
    const cam = this.gl.camera;
    const fx = -Math.sin(this.yaw) * Math.cos(this.pitch), fz = -Math.cos(this.yaw) * Math.cos(this.pitch);
    // walk a ray until it hits a wall
    let d = 1;
    for (; d < 40; d += 0.5) { if (!this.floor || this.floor.solid[tileOf(this.pz + fz * d) * this.floor.cols + tileOf(this.px + fx * d)]) break; }
    void cam;
    this.net.ping(this.px + fx * (d - 0.4), this.pz + fz * (d - 0.4));
  }

  // ------------------------------------------------------------------ interaction

  private interactTarget(): { kind: string; id: string; label: string; hold?: boolean } | null {
    const f = this.floor!;
    const p = { x: this.px, z: this.pz };
    let best: { kind: string; id: string; label: string; hold?: boolean; d: number; pri: number } | null = null;
    const consider = (kind: string, id: string, label: string, d: number, range: number, pri: number, hold = false): void => {
      if (d > range) return;
      if (!best || pri > best.pri || (pri === best.pri && d < best.d)) best = { kind, id, label, hold, d, pri };
    };
    if (this.hidden) return { kind: 'hide', id: '', label: '[E] Leave hiding spot' };
    // vendor hand
    const arm = this.lastSnapArms().find((a) => a.p === this.youId);
    if (arm && arm.t.length >= 2 && arm.s !== 4 && arm.s !== 3) {
      const tx = arm.t[arm.t.length - 2], tz = arm.t[arm.t.length - 1];
      consider('grab', this.youId, `[E] GRAB ${ITEMS[arm.item].name}!`, dist(p.x, p.z, tx, tz), 1.9, 10);
    }
    for (const r of this.remotes.values()) {
      const d = dist(p.x, p.z, r.x, r.z);
      if (r.st === ST_DOWNED) consider('revive', r.id, `Hold [E] to revive ${r.name}`, d, 2.0, 8, true);
      if (r.pu) consider('popup', r.id, `[E] Click away ${r.name}'s pop-up`, d, 3.0, 9);
    }
    for (const x of f.disks) if (!this.taken.has(x.id)) consider('disk', x.id, '[E] Pick up floppy disk', dist(p.x, p.z, x.x, x.z), 2.4, 5);
    for (const x of f.items) if (!this.taken.has(x.id)) consider('item', x.id, `[E] Pick up ${ITEMS[x.sub as ItemId]?.name ?? 'item'}`, dist(p.x, p.z, x.x, x.z), 2.4, 4);
    if (this.webcamOn) for (const x of f.gifs) if (!this.taken.has(x.id)) consider('gif', x.id, '[E] Grab hidden GIF', dist(p.x, p.z, x.x, x.z), 2.6, 5);
    if (f.terminal && this.held > 0) consider('terminal', 'terminal', `[E] Insert floppy (${this.held})`, dist(p.x, p.z, centerOf(f.terminal.tx), centerOf(f.terminal.tz)), 3.4, 6);
    for (const n of f.npcs) consider('npc', n.id, `[E] Talk to ${n.name}`, dist(p.x, p.z, n.x, n.z), 3.0, 3);
    for (const h of f.hides) consider('hide', h.id, '[E] Hide', dist(p.x, p.z, h.x, h.z), 2.2, 2);
    return best ? { kind: (best as { kind: string }).kind, id: (best as { id: string }).id, label: (best as { label: string }).label, hold: (best as { hold?: boolean }).hold } : null;
  }

  private lastSnapArms(): ASnap[] {
    return this.snaps.length ? this.snaps[this.snaps.length - 1].s.a : [];
  }

  private handleInteract(dt: number, can: boolean): void {
    const press = this.input.consume('interact');
    if (!can && !this.hidden) { this.ui.prompt(null); return; }
    if (this.ui.blocking && !this.hidden) { this.ui.prompt(null); return; }
    const t = this.interactTarget();
    this.ui.prompt(t ? t.label : null);
    if (!t) return;
    if (t.hold) {
      this.reviveSend -= dt;
      if (this.input.interactHeld && this.reviveSend <= 0) { this.net.interact({ kind: 'revive', id: t.id }); this.reviveSend = 0.08; }
    } else if (press) {
      this.net.interact({ kind: t.kind as 'disk', id: t.id });
    }
  }

  // ------------------------------------------------------------------ entities

  private updateRemotes(dt: number): void {
    const s = this.sampleSnap();
    const seen = new Set<string>();
    if (s) {
      for (const pb of s.b.p) {
        if (pb.i === this.youId) {
          // server-side state mirrors for the HUD
          continue;
        }
        const pa = s.a.p.find((q) => q.i === pb.i) ?? pb;
        let r = this.remotes.get(pb.i);
        if (!r) {
          const info = this.lobby?.players.find((q) => q.id === pb.i);
          const look = info?.look ?? playerLook(pb.i, 'x');
          const sprite = new CharacterSprite(look, info?.name ?? 'Player');
          this.gl.scene.add(sprite.group);
          r = { id: pb.i, name: info?.name ?? 'Player', look, sprite, x: pb.x, z: pb.z, r: pb.r, f: 0, st: 0, pu: 0, h: 0, rv: 0, bl: 0, lastX: pb.x, lastZ: pb.z, stepAcc: 0 };
          this.remotes.set(pb.i, r);
        }
        seen.add(pb.i);
        r.x = pa.x + (pb.x - pa.x) * s.k; r.z = pa.z + (pb.z - pa.z) * s.k; r.r = this.lerpAngle(pa.r, pb.r, s.k);
        r.f = pb.f; r.st = pb.s; r.pu = pb.pu; r.h = pb.h; r.rv = pb.rv; r.bl = pb.bl;
      }
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) { this.gl.scene.remove(r.sprite.group); r.sprite.dispose(); this.remotes.delete(id); continue; }
      const moved = Math.hypot(r.x - r.lastX, r.z - r.lastZ) / Math.max(dt, 0.001);
      r.stepAcc += Math.hypot(r.x - r.lastX, r.z - r.lastZ);
      if (r.stepAcc > 2 && r.st === ST_ALIVE && !(r.f & F_CROUCH)) { r.stepAcc = 0; this.audio.play('step', r.x, r.z); }
      r.lastX = r.x; r.lastZ = r.z;
      const g = r.sprite.group;
      g.visible = r.st !== ST_GHOST && !r.h;
      g.position.set(r.x, 0, r.z);
      r.sprite.showPopup(!!r.pu);
      r.sprite.update(dt, this.gl.camera.position.x, this.gl.camera.position.z, moved > 0.6, (r.f & F_TALK) !== 0, r.st === ST_DOWNED);
    }
  }

  private updateMobs(dt: number): void {
    const s = this.sampleSnap();
    const seen = new Set<string>();
    const cam = this.gl.camera.position;
    if (s) {
      for (const mb of s.b.m) {
        const ma = s.a.m.find((q) => q.i === mb.i) ?? mb;
        let mv = this.mobs.get(mb.i);
        if (!mv) mv = this.createMob(mb);
        seen.add(mb.i);
        const jump = Math.hypot(mb.x - ma.x, mb.z - ma.z) > 6;
        mv.x = jump ? mb.x : ma.x + (mb.x - ma.x) * s.k;
        mv.z = jump ? mb.z : ma.z + (mb.z - ma.z) * s.k;
        mv.r = mb.r; mv.s = mb.s;
      }
    }
    for (const [id, mv] of this.mobs) {
      if (!seen.has(id)) { this.gl.scene.remove(mv.mesh); this.mobs.delete(id); continue; }
      const moved = Math.hypot(mv.x - mv.lastX, mv.z - mv.lastZ) / Math.max(dt, 0.001);
      mv.still = moved < 0.25 ? mv.still + dt : 0;
      mv.lastX = mv.x; mv.lastZ = mv.z;
      mv.mesh.position.x = mv.x; mv.mesh.position.z = mv.z;
      if (mv.sprite) {
        mv.sprite.update(dt, cam.x, cam.z, moved > 0.5, false, false);
        if (moved > 0.5 && Math.random() < dt * 0.5) this.audio.play('step', mv.x, mv.z);
      } else {
        mv.mesh.rotation.y = Math.atan2(cam.x - mv.x, cam.z - mv.z);
        if (mv.kind === 'silhouette') {
          // standing still among bell trees it looks like one; the webcam, or moving, gives it away
          const mesh = mv.mesh as THREE.Mesh;
          const mat = mesh.material as THREE.MeshBasicMaterial;
          const treeLike = mv.s === 0 && mv.still > 0.6 && !this.webcamOn;
          const tex = treeLike ? this.silTex[2] : this.silTex[Math.floor(this.clock * 3) % 2];
          if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
        }
        if (mv.kind === 'mannequin') mv.mesh.scale.y = 1 + Math.sin(this.clock * 2) * 0.005;
      }
    }
  }

  private createMob(m: MSnap): MobView {
    let mesh: THREE.Object3D;
    let sprite: CharacterSprite | undefined;
    const mat = (map: THREE.Texture): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
    switch (m.k) {
      case 'rat': { const o = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.44), mat(this.ratTex)); o.geometry.translate(0, 0.22, 0); mesh = o; break; }
      case 'mannequin': {
        const o = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), mat(mannequinTexture(2))); o.geometry.translate(0, 0.9, 0); mesh = o;
        this.view?.hideMannequin(this.view.nearestCrowdIndex(m.x, m.z));
        break;
      }
      case 'mimic': {
        const info = this.lobby?.players.find((q) => q.id === m.c);
        sprite = new CharacterSprite(info?.look ?? playerLook('mimic', 'x'), info?.name ?? 'Player');
        sprite.wrong = true;
        mesh = sprite.group;
        break;
      }
      default: { const o = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.85), mat(this.silTex[2])); o.geometry.translate(0, 1.42, 0); mesh = o; }
    }
    this.gl.scene.add(mesh);
    const mv: MobView = { id: m.i, kind: m.k, mesh, sprite, x: m.x, z: m.z, r: m.r, s: m.s, lastX: m.x, lastZ: m.z, still: 0, copy: m.c };
    mesh.position.set(m.x, 0, m.z);
    this.mobs.set(m.i, mv);
    return mv;
  }

  // ------------------------------------------------------------------ style break

  private updateStyleBreak(dt: number, cx: number, cz: number): void {
    let nearest = Infinity;
    let hunting = false;
    for (const mv of this.mobs.values()) {
      if (mv.kind === 'rat') continue;
      const d = dist(cx, cz, mv.x, mv.z);
      if (d < nearest) nearest = d;
      if (mv.s === 2 && d < 60) hunting = true;
    }
    this.audio.setDanger(nearest, hunting && this.myState === ST_ALIVE);
    const fx = this.gl.fx;
    const grey = nearest < STYLE_BREAK.grey ? Math.min(1, (STYLE_BREAK.grey - nearest) / 5) : 0;
    const art = nearest < STYLE_BREAK.heavy ? (STYLE_BREAK.heavy - nearest) / STYLE_BREAK.heavy : 0;
    fx.grey += (grey - fx.grey) * Math.min(1, dt * 4);
    fx.art += ((hunting ? Math.max(art, 0.25) : art) - fx.art) * Math.min(1, dt * 4);
    fx.light = this.flashOn && this.inv.battery > 0 ? 1 : 0;
    fx.vig = this.webcamOn ? 0.9 : 0.55;
    fx.dither = this.webcamOn ? 2.2 : 1;
    this.lastHunt = hunting;
    // a dialogue box with no speaker opens when something is very close
    const now = this.clock;
    if (nearest < 5 && this.lastNear >= 5 && now - this.speakerlessAt > 25 && !this.ui.blocking && this.myState === ST_ALIVE) {
      this.speakerlessAt = now;
      const me = this.lobby?.players.find((p) => p.id === this.youId);
      const lines = ['it is behind you.', "don't turn around.", 'you can hear it breathing.', 'hello?', 'WHY ARE YOU STILL HERE'];
      if (me) this.ui.openDialogue('', lines[Math.floor(Math.random() * lines.length)], me.look, null, false, () => this.audio.babble(70));
      setTimeout(() => { if (this.ui.dialogueOpen && !this.dlgNpc) this.ui.closeDialogue(); }, 2600);
      this.dlgNpc = null;
    }
    this.lastNear = nearest;
    // bell trees ring when any monster is within 15 m of the tree
    if (this.view) {
      for (const bt of this.view.bellTrees) {
        let near = false;
        for (const mv of this.mobs.values()) if (mv.kind !== 'rat' && dist(bt.x, bt.z, mv.x, mv.z) < STYLE_BREAK.bell) { near = true; break; }
        const cd = this.treeCool.get(bt.id) ?? 0;
        if (near && now > cd) { this.treeCool.set(bt.id, now + 5); this.view.ringTree(bt.id); this.audio.play('bell', bt.x, bt.z); }
      }
    }
  }

  // ------------------------------------------------------------------ map & overlays

  private updateExplore(dt: number): void {
    this.exploreAcc += dt;
    if (this.exploreAcc < 0.3 || !this.floor) return;
    this.exploreAcc = 0;
    const f = this.floor;
    const sources: [number, number][] = [[this.px, this.pz]];
    for (const r of this.remotes.values()) if (r.st === ST_ALIVE) sources.push([r.x, r.z]);
    for (const [sx, sz] of sources) {
      const tx0 = tileOf(sx), tz0 = tileOf(sz);
      for (let dz = -7; dz <= 7; dz++) {
        for (let dx = -7; dx <= 7; dx++) {
          if (dx * dx + dz * dz > 49) continue;
          const tx = tx0 + dx, tz = tz0 + dz;
          if (tx < 0 || tz < 0 || tx >= f.cols || tz >= f.rows) continue;
          const i = tz * f.cols + tx;
          if (this.explored[i]) continue;
          if (los(f, sx, sz, centerOf(tx), centerOf(tz)) || (dx * dx + dz * dz <= 2)) this.explored[i] = 1;
        }
      }
    }
  }

  private updateOverlays(cam: THREE.PerspectiveCamera): void {
    const f = this.floor!;
    const now = performance.now();
    this.marks = this.marks.filter((m) => m.until > now);
    this.pings = this.pings.filter((p) => p.until > now);
    // projected labels for pings and scan marks
    const out: { x: number; y: number; text: string }[] = [];
    const proj = (x: number, y: number, z: number, text: string): void => {
      this.tmpV.set(x, y, z).project(cam);
      if (this.tmpV.z > 1 || this.tmpV.z < -1) return;
      const sx = (this.tmpV.x * 0.5 + 0.5) * innerWidth, sy = (-this.tmpV.y * 0.5 + 0.5) * innerHeight;
      if (sx < -20 || sx > innerWidth + 20 || sy < -20 || sy > innerHeight + 20) return;
      out.push({ x: sx, y: sy, text });
    };
    for (const m of this.marks) proj(m.x, 1.0, m.z, `${EMOJI[m.kind] ?? '•'}<br><small>${Math.round(dist(this.px, this.pz, m.x, m.z))}m</small>`);
    for (const p of this.pings) proj(p.x, 1.4, p.z, `📍<br><small>${p.by}</small>`);
    this.ui.setPings(out);

    if (this.ui.mapCtx) this.drawMap(this.ui.mapCtx, f);
  }

  private drawMap(ctx: CanvasRenderingContext2D, f: FloorData): void {
    const S = 6;
    const lies = f.type === 'corrupted';
    const seed = Math.floor(this.clock / 2);
    const jit = (id: number): number => (lies ? ((Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453) % 1) * 5 : 0);
    ctx.fillStyle = '#05050a'; ctx.fillRect(0, 0, f.cols * S, f.rows * S);
    for (let z = 0; z < f.rows; z++) {
      for (let x = 0; x < f.cols; x++) {
        const i = z * f.cols + x;
        if (!this.explored[i]) continue;
        ctx.fillStyle = f.solid[i] ? '#2a2a50' : '#8a8ab8';
        const lx = lies ? Math.round(jit(i)) : 0;
        ctx.fillRect((x + lx) * S, z * S, S, S);
      }
    }
    const at = (wx: number, wz: number, key: number): [number, number] => [(wx / TILE) * S + jit(key) * S * 0.5, (wz / TILE) * S + jit(key + 7) * S * 0.5];
    const dot = (wx: number, wz: number, col: string, r = 3, key = 1): void => { const [x, y] = at(wx, wz, key); ctx.fillStyle = col; ctx.fillRect(x - r, y - r, r * 2, r * 2); };
    const seenTile = (wx: number, wz: number): boolean => this.explored[tileOf(wz) * f.cols + tileOf(wx)] === 1;
    if (seenTile(centerOf(f.exit.tx), centerOf(f.exit.tz))) dot(centerOf(f.exit.tx), centerOf(f.exit.tz), '#40ff80', 4, 11);
    if (f.terminal && seenTile(centerOf(f.terminal.tx), centerOf(f.terminal.tz))) dot(centerOf(f.terminal.tx), centerOf(f.terminal.tz), '#ffe030', 4, 12);
    if (f.vendor) dot(centerOf(f.vendor.tx), centerOf(f.vendor.tz), '#ff30c0', 4, 13);
    for (const m of this.marks) dot(m.x, m.z, m.kind === 'disk' ? '#3070ff' : '#ff9030', 3, 20);
    for (const p of this.pings) dot(p.x, p.z, '#ff30c0', 3, 30);
    for (const g of this.glowSticks) dot(g.x, g.z, '#40ff70', 2, 40);
    for (const r of this.remotes.values()) if (r.st !== ST_GHOST) dot(r.x, r.z, r.st === ST_DOWNED ? '#ff4040' : '#30e8ff', 3, 50);
    const [mx, my] = at(this.px, this.pz, 99);
    ctx.fillStyle = '#ffe030'; ctx.beginPath();
    ctx.moveTo(mx - Math.sin(this.yaw) * 6, my - Math.cos(this.yaw) * 6);
    ctx.lineTo(mx - Math.sin(this.yaw + 2.5) * 5, my - Math.cos(this.yaw + 2.5) * 5);
    ctx.lineTo(mx - Math.sin(this.yaw - 2.5) * 5, my - Math.cos(this.yaw - 2.5) * 5);
    ctx.closePath(); ctx.fill();
    void WALL_H;
  }

  private hudUpdate(st: number, crouch: boolean): void {
    const f = this.floor!;
    const team = (this.lobby?.players ?? []).map((p) => ({ id: p.id, name: p.name, st: this.gs?.states[p.id] ?? 0, me: p.id === this.youId }));
    const me = [...this.remotes.values()].find(() => false);
    void me; void crouch;
    const pm = this.snaps.length ? this.snaps[this.snaps.length - 1].s.p.find((q) => q.i === this.youId) : undefined;
    const hs: HudState = {
      floor: this.floorNum, bits: this.balance(), held: this.held, inserted: this.gs?.inserted ?? 0, wakeIn: this.wakeIn,
      awake: this.gs?.awake ?? false, guest: f.type === 'guestbook', battery: this.inv.battery, stamina: this.stamina / this.maxStamina(),
      slots: this.inv.slots, glow: this.inv.glow, team,
      downed: st === ST_DOWNED ? { bleed: pm?.bl ?? 1, rv: pm?.rv ?? 0 } : null, ghost: st === ST_GHOST,
      exitOpen: this.gs?.exitOpen ?? f.type === 'guestbook', exitProgress: this.exitProg, scanCd: this.scanCd, webcam: this.webcamOn,
      type: FLOOR_TYPE_BY_ID[f.type].name, shared: this.gs?.shared ?? false,
    };
    this.ui.setHud(hs);
    void SNAP_HZ;
    void bellTreeTexture;
  }
}
