// DOM user interface: menu, lobby, HUD, dialogue letterbox, map, shop, bookmarks, results.
import {
  ANOMALIES, ITEMS, ItemId, Look, LobbyMsg, MONSTERS, NPC_KINDS, OverMsg, VENDOR_STOCK, priceMultiplier,
} from '@webmaze/shared';
import { lookPortrait } from './render/sprites';

export interface UiHandlers {
  solo(name: string, seed: string): void;
  create(name: string, seed: string): void;
  join(name: string, code: string): void;
  login(name: string, pw: string): Promise<void>;
  register(name: string, pw: string): Promise<void>;
  logout(): void;
  start(): void;
  reroll(): void;
  setOpts(o: { sharedWallet?: boolean; openMic?: boolean }): void;
  leave(): void;
  order(item: ItemId): void;
  again(): void;
}

export interface HudState {
  floor: number;
  bits: number;
  held: number;
  inserted: number;
  wakeIn: number;
  awake: boolean;
  guest: boolean;
  battery: number;
  stamina: number;
  slots: (ItemId | null)[];
  glow: number;
  team: { id: string; name: string; st: number; me: boolean }[];
  downed: { bleed: number; rv: number } | null;
  ghost: boolean;
  exitOpen: boolean;
  exitProgress: number;
  scanCd: number;
  webcam: boolean;
  type: string;
  shared: boolean;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Bookmarks { monster: string[]; anomaly: string[]; npc: string[] }

export class UI {
  private menu: HTMLElement;
  private lobby: HTMLElement;
  private hud: HTMLElement;
  private over: HTMLElement;
  private overlay: HTMLElement;
  private dlg: HTMLElement;
  private popupEl: HTMLElement;
  private toastsEl!: HTMLElement;
  private pingsEl!: HTMLElement;
  private last = new Map<string, string>();
  private typing = { text: '', shown: 0, acc: 0, timer: 0, onBlip: (): void => {} };
  dialogueOpen = false;
  overlayKind: 'map' | 'shop' | 'book' | 'help' | null = null;
  chatEl: HTMLInputElement | null = null;
  mapCtx: CanvasRenderingContext2D | null = null;

  constructor(private root: HTMLElement, private h: UiHandlers) {
    const mk = (id: string, cls = ''): HTMLElement => { const e = document.createElement('div'); e.id = id; e.className = cls; root.appendChild(e); return e; };
    this.menu = mk('menu', 'screen');
    this.lobby = mk('lobby', 'screen hidden');
    this.hud = mk('hud', 'hidden');
    this.over = mk('over', 'screen clear hidden');
    this.overlay = mk('overlay', 'overlay hidden');
    this.dlg = mk('dialogue', 'hidden');
    this.popupEl = mk('popup', 'hidden');
    this.buildHud();
    this.popupEl.innerHTML = '<div class="tb"><span>CONGRATULATIONS!!!</span><span>x</span></div><div class="bd">YOU ARE THE 1,000,000th VISITOR!!!<br><small>(click to claim)</small></div>';
  }

  // ------------------------------------------------------------------ menu

  showMenu(account: { name: string } | null, board: { name: string; floor: number; bits: number; seed: string; players: number }[], saved: { name: string }, err = ''): void {
    this.hideAll();
    this.menu.classList.remove('hidden');
    const rows = board.length
      ? board.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.floor}</td><td>${r.bits}</td><td>${esc(r.seed)}</td></tr>`).join('')
      : '<tr><td colspan="5">No runs recorded yet. Be the first to get lost.</td></tr>';
    this.menu.innerHTML = `
      <h1 class="logo">WEBMAZE</h1>
      <div class="marquee"><span>~*~ Welcome to my homepage!! ~*~ 1-6 players ~*~ Find 3 floppy disks, find the link, go deeper ~*~ Best viewed with the lights off ~*~ Please sign the guestbook ~*~</span></div>
      <div class="panel"><h3>Play</h3><div class="body">
        <div class="row">
          <label class="f">Your name<input id="m-name" type="text" maxlength="16" value="${esc(account?.name ?? saved.name)}" ${account ? 'disabled' : ''} /></label>
          <label class="f">Seed (optional, to replay a world)<input id="m-seed" type="text" maxlength="16" placeholder="random" /></label>
        </div>
        <div class="row">
          <button class="big" id="b-solo">Solo run</button>
          <button class="big pink" id="b-create">Create room</button>
        </div>
        <div class="row">
          <label class="f">Room code<input id="m-code" type="text" maxlength="6" placeholder="ABCDEF" style="text-transform:uppercase" /></label>
          <button id="b-join">Join room</button>
        </div>
        <div class="err" id="m-err">${esc(err)}</div>
      </div></div>
      <div class="panel"><h3>Account (keeps your Bookmarks between runs)</h3><div class="body">
        ${account
          ? `<div class="row">Signed in as <b>${esc(account.name)}</b> <button id="b-logout">Sign out</button></div>`
          : `<div class="row"><label class="f">Name<input id="a-name" type="text" maxlength="20" autocomplete="username"/></label><label class="f">Password<input id="a-pw" type="password" autocomplete="current-password"/></label></div>
             <div class="row"><button id="b-login">Sign in</button><button id="b-reg">Create account</button><span class="smallnote">Optional. Guests keep Bookmarks in this browser only.</span></div><div class="err" id="a-err"></div>`}
      </div></div>
      <div class="panel"><h3>How to play</h3><div class="body smallnote">
        WASD move · Shift sprint · C crouch · E interact (hold to revive) · F flashlight · Q webcam (reveals hidden things) · R scanner · M map · Tab bookmarks · B vendor menu on safe floors · 1-4 use item · Z Ctrl+Z · G ping · V push to talk · Enter chat. On a phone: left stick to move, drag to look, buttons on the right.<br>
        Never fight. Walking is quieter than running. Listen to the music: when it thins out, something is near.
      </div></div>
      <div class="panel"><h3>Deepest runs</h3><div class="body"><table class="lb"><tr><th>#</th><th>Team</th><th>Floor</th><th>Bits</th><th>Seed</th></tr>${rows}</table></div></div>
      <div class="under">~ UNDER CONSTRUCTION ~</div>
      <div class="counter">You are visitor number <b>000042</b></div>`;
    const val = (id: string): string => (this.menu.querySelector<HTMLInputElement>(id)?.value ?? '').trim();
    const name = (): string => val('#m-name') || 'Guest';
    this.menu.querySelector('#b-solo')?.addEventListener('click', () => this.h.solo(name(), val('#m-seed')));
    this.menu.querySelector('#b-create')?.addEventListener('click', () => this.h.create(name(), val('#m-seed')));
    this.menu.querySelector('#b-join')?.addEventListener('click', () => this.h.join(name(), val('#m-code')));
    this.menu.querySelector('#b-logout')?.addEventListener('click', () => this.h.logout());
    const authErr = (e: unknown): void => { const el = this.menu.querySelector('#a-err'); if (el) el.textContent = e instanceof Error ? e.message : String(e); };
    this.menu.querySelector('#b-login')?.addEventListener('click', () => this.h.login(val('#a-name'), val('#a-pw')).catch(authErr));
    this.menu.querySelector('#b-reg')?.addEventListener('click', () => this.h.register(val('#a-name'), val('#a-pw')).catch(authErr));
  }

  menuError(msg: string): void {
    const el = this.menu.querySelector('#m-err');
    if (el) el.textContent = msg;
  }

  // ------------------------------------------------------------------ lobby

  showLobby(m: LobbyMsg): void {
    this.menu.classList.add('hidden');
    this.over.classList.add('hidden');
    this.lobby.classList.remove('hidden');
    this.hud.classList.add('hidden');
    const me = m.players.find((p) => p.id === m.youId);
    const host = !!me?.host;
    this.lobby.innerHTML = `
      <h1 class="logo" style="font-size:clamp(28px,6vw,52px)">LOBBY</h1>
      <div class="panel"><h3>Room</h3><div class="body">
        <div class="code" id="l-code" title="click to copy the invite link">${esc(m.code)}</div>
        <div class="smallnote" style="text-align:center">Share the code or <a href="#" id="l-link">copy the invite link</a>. Seed: <b>${esc(m.seed)}</b> (friends can replay this exact world)</div>
      </div></div>
      <div class="panel"><h3>Players (${m.players.length}/6)</h3><div class="body"><div class="players" id="l-players"></div>
        <div class="row" style="justify-content:center"><button id="l-reroll">Reroll my look</button></div>
      </div></div>
      <div class="panel"><h3>Options ${host ? '' : '(host only)'}</h3><div class="body">
        <label><input type="checkbox" id="o-shared" ${m.opts.sharedWallet ? 'checked' : ''} ${host ? '' : 'disabled'}/> Shared wallet (one pool of bits for everyone)</label><br>
        <label><input type="checkbox" id="o-mic" ${m.opts.openMic ? 'checked' : ''} ${host ? '' : 'disabled'}/> Open mic (otherwise push-to-talk with V)</label>
      </div></div>
      <div class="row" style="justify-content:center">
        <button class="big pink" id="l-start" ${host ? '' : 'disabled'}>${host ? 'Start run' : 'Waiting for host…'}</button>
        <button id="l-leave">Leave</button>
      </div>`;
    const list = this.lobby.querySelector('#l-players')!;
    for (const p of m.players) {
      const card = document.createElement('div');
      card.className = 'pcard';
      card.appendChild(lookPortrait(p.look, 100));
      const n = document.createElement('div'); n.className = 'nm'; n.textContent = p.name + (p.id === m.youId ? ' (you)' : '');
      card.appendChild(n);
      if (p.host) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = '👑'; card.appendChild(c); }
      list.appendChild(card);
    }
    const $ = <T extends HTMLElement>(s: string): T => this.lobby.querySelector<T>(s)!;
    $('#l-reroll').onclick = () => this.h.reroll();
    $('#l-start').onclick = () => this.h.start();
    $('#l-leave').onclick = () => this.h.leave();
    $<HTMLInputElement>('#o-shared').onchange = (e) => this.h.setOpts({ sharedWallet: (e.target as HTMLInputElement).checked });
    $<HTMLInputElement>('#o-mic').onchange = (e) => this.h.setOpts({ openMic: (e.target as HTMLInputElement).checked });
    const link = `${location.origin}${location.pathname}?room=${m.code}`;
    const copy = (e: Event): void => { e.preventDefault(); void navigator.clipboard?.writeText(link); this.toast('Invite link copied'); };
    $('#l-link').onclick = copy; $('#l-code').onclick = copy;
  }

  hideAll(): void {
    for (const e of [this.menu, this.lobby, this.hud, this.over, this.overlay, this.dlg, this.popupEl]) e.classList.add('hidden');
    this.overlayKind = null; this.dialogueOpen = false;
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="tl"><div id="h-floor"></div><div id="h-bits"></div><div id="h-type" style="font-size:12px;opacity:.8"></div></div>
      <div class="tc"><div id="h-disks"></div><div id="h-wake"></div></div>
      <div class="tr" id="h-team"></div>
      <div class="bl"><div class="bar"><i id="h-stam"></i></div><div class="bar bat"><i id="h-bat"></i></div><div id="h-bat-t" style="font-size:11px"></div></div>
      <div class="bc" id="h-slots"></div>
      <div class="crosshair" id="h-cross"></div>
      <div class="prompt hidden" id="h-prompt"></div>
      <div class="toasts" id="h-toasts"></div>
      <div class="pings" id="h-pings"></div>
      <div class="center" id="h-center"></div>`;
    this.toastsEl = this.hud.querySelector('#h-toasts')!;
    this.pingsEl = this.hud.querySelector('#h-pings')!;
  }

  showHud(): void {
    this.menu.classList.add('hidden'); this.lobby.classList.add('hidden'); this.over.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  private set(id: string, html: string): void {
    if (this.last.get(id) === html) return;
    this.last.set(id, html);
    const el = this.hud.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  setHud(s: HudState): void {
    this.set('h-floor', `FLOOR ${s.floor}${s.guest ? ' · GUESTBOOK' : ''}`);
    this.set('h-bits', `◆ ${s.bits} bits${s.shared ? ' (shared)' : ''}`);
    this.set('h-type', s.type);
    this.set('h-disks', s.guest ? 'Safe floor. Shop (B) then find the link.' : `💾 ${s.inserted}/3 inserted${s.held ? ` · carrying ${s.held}` : ''}${s.exitOpen ? ' · LINK OPEN' : ''}`);
    this.set('h-wake', s.guest || (!s.awake && s.wakeIn <= 0) ? '' : s.awake ? '<span style="color:#ff6060">IT IS AWAKE</span>' : `it wakes in ${s.wakeIn}s`);
    this.set('h-team', s.team.map((t) => `<div class="pill ${t.st === 1 ? 'down' : t.st === 2 ? 'ghost' : ''} ${t.me ? 'me' : ''}">${t.st === 1 ? '⚠ ' : t.st === 2 ? '👻 ' : ''}${esc(t.name)}</div>`).join(''));
    const stam = this.hud.querySelector<HTMLElement>('#h-stam'); if (stam) stam.style.width = `${Math.round(s.stamina * 100)}%`;
    const bat = this.hud.querySelector<HTMLElement>('#h-bat'); if (bat) bat.style.width = `${Math.min(100, Math.round((s.battery / 120) * 100))}%`;
    this.set('h-bat-t', `🔦 ${Math.round(s.battery)}s${s.webcam ? ' · 📹 REC' : ''}${s.scanCd > 0 ? ` · scan ${Math.ceil(s.scanCd)}s` : ''}`);
    this.set('h-slots', s.slots.map((it, i) => `<div class="slot"><b>${i + 1}</b>${it ? ITEMS[it].icon : ''}${it === 'glowsticks' ? `<i>${s.glow || 3}</i>` : ''}</div>`).join(''));
    let center = '';
    if (s.downed) center = `<div class="big-msg">DOWN</div><div class="bar red" style="width:220px;margin:6px auto"><i style="width:${Math.round(s.downed.bleed * 100)}%"></i></div><div>${s.downed.rv > 0 ? `being revived ${Math.round(s.downed.rv * 100)}%` : 'hold on… a teammate can revive you'}</div>`;
    else if (s.ghost) center = '<div class="big-msg" style="font-size:28px">YOU ARE A GHOST</div><div>spectating · click / tap to switch · a teammate can buy you back at the vendor</div>';
    else if (s.exitProgress > 0) center = `<div>everyone stay close… ${Math.round(s.exitProgress * 100)}%</div>`;
    this.set('h-center', center);
    this.hud.querySelector('#h-cross')?.classList.toggle('hidden', !!s.downed || s.ghost);
  }

  prompt(text: string | null): void {
    const p = this.hud.querySelector<HTMLElement>('#h-prompt')!;
    if (text === null) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    if (p.textContent !== text) p.textContent = text;
  }

  toast(text: string): void {
    if (this.toastsEl.children.length > 4) this.toastsEl.firstChild?.remove();
    const d = document.createElement('div');
    d.textContent = text;
    this.toastsEl.appendChild(d);
    setTimeout(() => d.remove(), 3900);
  }

  /** Screen-space ping labels (positions computed by the game each frame). */
  setPings(pings: { x: number; y: number; text: string }[]): void {
    this.pingsEl.innerHTML = pings.map((p) => `<div style="left:${p.x}px;top:${p.y}px">${p.text}</div>`).join('');
  }

  popup(on: boolean): void {
    this.popupEl.classList.toggle('hidden', !on);
  }

  setFx(red: number): void {
    const id = 'dmg';
    let e = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!e) { e = document.createElement('div'); e.id = id; e.className = 'vignette-red'; e.style.pointerEvents = 'none'; this.hud.appendChild(e); }
    e.style.opacity = String(Math.min(1, red));
  }

  // ------------------------------------------------------------------ dialogue

  openDialogue(name: string, text: string, you: Look, them: Look | null, mimic: boolean, onBlip: () => void): void {
    this.dialogueOpen = true;
    this.dlg.classList.remove('hidden');
    this.dlg.innerHTML = `<div class="bar-t"></div><div class="por l"></div><div class="por r ${mimic ? 'mimic' : ''}"></div><div class="bar-b"><div class="line"></div></div>`;
    this.dlg.querySelector('.por.l')!.appendChild(lookPortrait(you, 400));
    if (them) this.dlg.querySelector('.por.r')!.appendChild(lookPortrait(them, 400));
    this.typing = { text: name ? `${name}: ${text}` : text, shown: 0, acc: 0, timer: 0, onBlip };
    this.dlg.onclick = () => {
      if (this.typing.shown < this.typing.text.length) this.typing.shown = this.typing.text.length;
      else this.closeDialogue();
    };
  }

  closeDialogue(): void {
    this.dialogueOpen = false;
    this.dlg.classList.add('hidden');
  }

  tick(dt: number): void {
    if (!this.dialogueOpen) return;
    const t = this.typing;
    if (t.shown >= t.text.length) return;
    t.acc += dt * 30; // about 30 characters per second
    while (t.acc >= 1 && t.shown < t.text.length) {
      t.acc -= 1; t.shown++;
      if (t.shown % 2 === 0) t.onBlip(); // one blip per 2 letters
    }
    const el = this.dlg.querySelector('.line');
    if (el) el.textContent = t.text.slice(0, t.shown);
  }

  // ------------------------------------------------------------------ overlays

  closeOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlayKind = null;
    this.mapCtx = null;
  }

  openMap(size: number): CanvasRenderingContext2D {
    this.overlayKind = 'map';
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = `<canvas id="mapcv" width="${size}" height="${size}"></canvas>`;
    this.overlay.onclick = () => this.closeOverlay();
    const cv = this.overlay.querySelector<HTMLCanvasElement>('#mapcv')!;
    cv.style.width = cv.style.height = `${Math.min(innerWidth, innerHeight) * 0.88}px`;
    this.mapCtx = cv.getContext('2d')!;
    this.mapCtx.imageSmoothingEnabled = false;
    return this.mapCtx;
  }

  openBookmarks(b: Bookmarks, anomalyIds = ANOMALIES): void {
    this.overlayKind = 'book';
    this.overlay.classList.remove('hidden');
    const card = (known: boolean, title: string, desc: string): string => known ? `<div><b>${esc(title)}</b>${esc(desc)}</div>` : '<div class="lock"><b>???</b>Not discovered yet.</div>';
    const mon = MONSTERS.map((m) => card(b.monster.includes(m.id), m.name, `${m.desc} Counter: ${m.counter}`)).join('');
    const an = anomalyIds.map((a) => card(b.anomaly.includes(a.id), a.name, a.desc)).join('');
    const npc = [...NPC_KINDS, 'mimic'].map((k) => card(b.npc.includes(k), k === 'hint' ? 'Helper NPC' : k === 'trade' ? 'Trader NPC' : k === 'line' ? 'Talker NPC' : 'Mimic NPC', k === 'mimic' ? 'Looks friendly. Is not.' : 'Wanders a floor and says something.')).join('');
    this.overlay.innerHTML = `<div class="panel"><h3>Bookmarks (press Tab or tap to close)</h3><div class="body"><div class="sect">Monsters</div><div class="bm">${mon}</div><div class="sect">Anomalies</div><div class="bm">${an}</div><div class="sect">Residents</div><div class="bm">${npc}</div></div></div>`;
    this.overlay.onclick = () => this.closeOverlay();
  }

  openShop(floor: number, balance: number, ghosts: number): void {
    this.overlayKind = 'shop';
    this.overlay.classList.remove('hidden');
    const mult = priceMultiplier(floor);
    const rows = VENDOR_STOCK.map((id) => {
      const it = ITEMS[id];
      const cost = Math.round(it.cost * mult);
      const dis = cost > balance || (id === 'ghost' && ghosts === 0);
      return `<div class="shop-item"><div class="ic">${it.icon}</div><div class="d"><b>${esc(it.name)}</b><small>${esc(it.desc)}${id === 'ghost' ? ` (${ghosts} ghost${ghosts === 1 ? '' : 'es'})` : ''}</small></div><div>${cost}◆</div><button data-i="${id}" ${dis ? 'disabled' : ''}>Order</button></div>`;
    }).join('');
    this.overlay.innerHTML = `<div class="panel"><h3>The Vendor · you have ${balance}◆</h3><div class="body"><div class="smallnote">Order an item and the hand will bring it. Grab it with E when it reaches you. Do not run away from the hand.</div>${rows}<div class="row"><button id="s-close">Close (B)</button></div></div></div>`;
    this.overlay.onclick = (e) => { if (e.target === this.overlay) this.closeOverlay(); };
    this.overlay.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) => b.addEventListener('click', () => { this.h.order(b.dataset.i as ItemId); this.closeOverlay(); }));
    this.overlay.querySelector('#s-close')?.addEventListener('click', () => this.closeOverlay());
  }

  openHelp(): void {
    this.overlayKind = 'help';
    this.overlay.classList.remove('hidden');
    this.overlay.innerHTML = '<div class="panel"><h3>Paused</h3><div class="body"><div class="row"><button id="p-resume">Resume</button><button id="p-leave">Leave run</button></div><div class="smallnote">Click the game view to capture the mouse again.</div></div></div>';
    this.overlay.querySelector('#p-resume')?.addEventListener('click', () => this.closeOverlay());
    this.overlay.querySelector('#p-leave')?.addEventListener('click', () => { this.closeOverlay(); this.h.leave(); });
  }

  showOver(m: OverMsg, name: string): void {
    this.over.classList.remove('hidden');
    this.over.innerHTML = `
      <h1 class="logo">GAME OVER</h1>
      <div class="panel"><h3>This page cannot be displayed</h3><div class="body" style="text-align:center">
        <div style="font-size:42px;font-family:var(--head)">Floor ${m.floor}</div>
        <div>${m.totalBits} bits earned</div>
        <div class="smallnote">Seed <b>${esc(m.seed)}</b> · enter it on the menu to replay this world</div>
        <div class="row" style="justify-content:center;margin-top:12px"><button class="big" id="o-again">Back to menu</button></div>
        <div class="smallnote">${esc(name)}, nobody dies on the internet. They just stop loading.</div>
      </div></div>`;
    this.over.querySelector('#o-again')?.addEventListener('click', () => this.h.again());
  }

  openChat(onSend: (t: string) => void): void {
    if (this.chatEl) return;
    const i = document.createElement('input');
    i.type = 'text'; i.maxLength = 80; i.placeholder = 'say something…'; i.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);width:min(80vw,420px);z-index:30';
    this.root.appendChild(i);
    this.chatEl = i;
    i.focus();
    i.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { if (i.value.trim()) onSend(i.value); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    };
  }

  closeChat(): void {
    this.chatEl?.remove();
    this.chatEl = null;
  }

  get blocking(): boolean {
    return this.dialogueOpen || this.overlayKind !== null || this.chatEl !== null;
  }
}
