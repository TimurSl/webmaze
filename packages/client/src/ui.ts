// DOM user interface: menu, lobby, HUD, dialogue letterbox, map, shop, bookmarks, results.
import {
  ANOMALIES, ITEMS, ItemId, Look, LobbyMsg, MONSTERS, NPC_KINDS, OverMsg, VENDOR_STOCK, priceMultiplier,
} from '@webmaze/shared';
import { ICON } from './icons';
import { fullscreenSupported, isFullscreen, isStandalone, onFullscreenChange, toggleFullscreen } from './fullscreen';
import { lookPortrait } from './render/sprites';

export interface UiHandlers {
  solo(name: string, seed: string): void;
  create(name: string, seed: string): void;
  discovery(name: string, seed: string): void;
  join(name: string, code: string): void;
  login(name: string, pw: string): Promise<void>;
  register(name: string, pw: string): Promise<void>;
  logout(): void;
  start(): void;
  reroll(): void;
  setOpts(o: { sharedWallet?: boolean; openMic?: boolean; discovery?: boolean }): void;
  leave(): void;
  order(item: ItemId): void;
  again(): void;
  /** a touch-HUD button went down or up; returns the new on/off state for toggles (crouch) */
  press(name: string, down: boolean): boolean | void;
}

export interface HudState {
  floor: number;
  bits: number;
  held: number;
  inserted: number;
  awake: boolean;
  guest: boolean;
  /** the Konami secret room */
  secret: boolean;
  /** peaceful run */
  discovery: boolean;
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

export interface PauseSettings {
  sensitivity: number;
  raw: boolean;
  setSensitivity(v: number): void;
  setRaw(on: boolean): void;
}

const X_GLYPH = ICON.close;
const mazeIcon = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect width="16" height="16" fill="#0a0a30"/><path d="M2 2h12v12H2z M4 4v8h2V6h4v4H8v2h4V4z" fill="#ffe030" fill-rule="evenodd"/></svg>`;

/** A Windows-95 style window. `close` adds a working title-bar close button (wired with [data-close]). */
const win = (title: string, body: string, o: { cls?: string; close?: boolean; icon?: boolean; status?: string[] } = {}): string =>
  `<div class="win ${o.cls ?? ''}"><div class="title"><span class="tt">${o.icon ? mazeIcon(14) : ''}${title}</span>` +
  `<span class="ctl">${o.close ? `<button data-close aria-label="Close" title="Close">${X_GLYPH}</button>` : ''}</span></div>` +
  `<div class="wb">${body}</div>${o.status ? `<div class="status">${o.status.map((t, i) => `<span${i ? ' class="fit"' : ''}>${t}</span>`).join('')}</div>` : ''}</div>`;

const CONTROLS = `<dl class="keys">
  <dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Move (Shift sprint, C crouch)</dd>
  <dt>Mouse</dt><dd>Look. Click the game to capture the mouse, Esc to pause</dd>
  <dt><kbd>E</kbd></dt><dd>Interact (hold to revive a teammate)</dd>
  <dt><kbd>F</kbd> <kbd>Q</kbd> <kbd>R</kbd></dt><dd>Flashlight · webcam (reveals hidden things) · scanner</dd>
  <dt><kbd>M</kbd> <kbd>Tab</kbd> <kbd>B</kbd></dt><dd>Map · bookmarks · vendor (on safe floors)</dd>
  <dt><kbd>1</kbd>–<kbd>4</kbd> <kbd>Z</kbd></dt><dd>Use item · Ctrl+Z rewind</dd>
  <dt><kbd>G</kbd> <kbd>V</kbd> <kbd>Enter</kbd></dt><dd>Ping · push to talk · chat</dd>
  <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Look sensitivity (also in the pause menu)</dd>
  <dt>Phone</dt><dd>Left stick to move, drag to look. Right: hand = use (hold), arrows = sprint, figure = crouch. Backpack = tools, ⛶ = fullscreen</dd>
</dl>`;

export class UI {
  private menu: HTMLElement;
  private lobby: HTMLElement;
  private hud: HTMLElement;
  private over: HTMLElement;
  private overlay: HTMLElement;
  private dlg: HTMLElement;
  private popupEl: HTMLElement;
  private taskbar: HTMLElement;
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
    this.taskbar = mk('taskbar', 'taskbar hidden');
    this.taskbar.innerHTML = `<button class="start" tabindex="-1">${mazeIcon(16)}Webmaze</button><span class="sep"></span><button class="task" tabindex="-1"></button><button class="fsbtn" id="tb-fs" aria-label="Fullscreen" title="Fullscreen"></button><span class="tray" id="tb-clock"></span>`;
    const clock = (): void => { const el = this.taskbar.querySelector('#tb-clock'); if (el) el.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    clock(); setInterval(clock, 15000);
    this.buildHud();
    this.bindTouchHud();
    this.popupEl.innerHTML = win('CONGRATULATIONS!!!', '<div class="bd">YOU ARE THE 1,000,000th VISITOR!!!<br><small>(click to claim)</small></div>', { close: true });
  }

  private showTaskbar(title: string | null): void {
    this.taskbar.classList.toggle('hidden', title === null);
    const t = this.taskbar.querySelector('.task');
    if (t && title !== null) t.textContent = title;
  }

  // ------------------------------------------------------------------ menu

  showMenu(account: { name: string } | null, board: { name: string; floor: number; bits: number; seed: string; players: number }[], saved: { name: string }, err = ''): void {
    this.hideAll();
    this.menu.classList.remove('hidden');
    const rows = board.length
      ? board.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.floor}</td><td>${r.bits}</td><td>${esc(r.seed)}</td></tr>`).join('')
      : '<tr><td colspan="5">No runs recorded yet. Be the first to get lost.</td></tr>';
    this.menu.innerHTML = `<div class="desk">${win('Webmaze', `
      <div class="banner">${mazeIcon(40)}<div><h1>WEBMAZE</h1><p>1–6 players. Find 3 floppy disks, find the link, go deeper.</p></div></div>
      <div class="tabs" role="tablist">
        <button class="sel" data-tab="play">Play</button><button data-tab="acct">Account</button><button data-tab="help">Controls</button><button data-tab="lb">High scores</button>
      </div>
      <div class="sheet">
        <section class="on" data-sec="play">
          <fieldset><legend>Player</legend>
            <div class="row">
              <label class="field">Your name:<input id="m-name" type="text" maxlength="16" value="${esc(account?.name ?? saved.name)}" ${account ? 'disabled' : ''} /></label>
              <label class="field">Seed (optional, replays a world):<input id="m-seed" type="text" maxlength="16" placeholder="random" /></label>
            </div>
          </fieldset>
          <fieldset><legend>New game</legend>
            <div class="row"><button class="default" id="b-solo">Solo run</button><button id="b-create">Create room</button><button id="b-disc" title="No monsters, no danger. Just wander and look at things.">Discovery walk</button></div>
            <div class="note" style="margin-top:6px">A room gets a code friends can join. Discovery walk is the peaceful version: nothing hunts you.</div>
          </fieldset>
          <fieldset><legend>Join a friend</legend>
            <div class="row"><label class="field">Room code:<input id="m-code" type="text" maxlength="6" placeholder="ABCDEF" style="text-transform:uppercase" /></label><button id="b-join" style="align-self:flex-end">Join</button></div>
          </fieldset>
          <div class="err" id="m-err">${esc(err)}</div>
        </section>
        <section data-sec="acct">
          <fieldset><legend>Account</legend>
          ${account
            ? `<div class="row">Signed in as <b>${esc(account.name)}</b>.</div><div class="row end"><button id="b-logout">Sign out</button></div>`
            : `<p class="note" style="margin-top:0">Optional. An account keeps your Bookmarks between runs and devices; guests keep them in this browser only.</p>
               <div class="row"><label class="field">User name:<input id="a-name" type="text" maxlength="20" autocomplete="username"/></label></div>
               <div class="row"><label class="field">Password:<input id="a-pw" type="password" autocomplete="current-password"/></label></div>
               <div class="err" id="a-err"></div>
               <div class="row end"><button class="default" id="b-login">Sign in</button><button id="b-reg">Create account</button></div>`}
          </fieldset>
        </section>
        <section data-sec="help">
          ${CONTROLS}
          <hr class="etch">
          <div class="note">Never fight. Walking is quieter than running. Listen to the music: when it thins out, something is near.</div>
        </section>
        <section data-sec="lb">
          <div class="lbwrap"><table class="lb"><tr><th>#</th><th>Team</th><th>Floor</th><th>Bits</th><th>Seed</th></tr>${rows}</table></div>
        </section>
      </div>`, { icon: true, status: ['Ready', 'Visitor #000042'] })}</div>`;
    this.showTaskbar('Webmaze');
    const tabs = this.menu.querySelectorAll<HTMLButtonElement>('[data-tab]');
    const showTab = (name: string): void => {
      tabs.forEach((t) => t.classList.toggle('sel', t.dataset.tab === name));
      this.menu.querySelectorAll<HTMLElement>('[data-sec]').forEach((sec) => sec.classList.toggle('on', sec.dataset.sec === name));
    };
    tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab!)));
    const val = (id: string): string => (this.menu.querySelector<HTMLInputElement>(id)?.value ?? '').trim();
    const name = (): string => val('#m-name') || 'Guest';
    this.menu.querySelector('#b-solo')?.addEventListener('click', () => this.h.solo(name(), val('#m-seed')));
    this.menu.querySelector('#b-create')?.addEventListener('click', () => this.h.create(name(), val('#m-seed')));
    this.menu.querySelector('#b-disc')?.addEventListener('click', () => this.h.discovery(name(), val('#m-seed')));
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
    this.lobby.innerHTML = `<div class="desk">${win(`Lobby - Room ${esc(m.code)}`, `
      <fieldset><legend>Invite</legend>
        <div class="codebox"><div class="code" id="l-code" title="Click to copy the invite link">${esc(m.code)}</div><button id="l-link">Copy link</button></div>
        <div class="note" style="margin-top:6px">Seed <b>${esc(m.seed)}</b>. Friends can enter it on the menu to replay this exact world.</div>
      </fieldset>
      <fieldset><legend>Players (${m.players.length}/6)</legend>
        <div class="players" id="l-players"></div>
        <div class="row end"><button id="l-reroll">Reroll my look</button></div>
      </fieldset>
      <fieldset><legend>Options${host ? '' : ' (host only)'}</legend>
        <label class="chk"><input type="checkbox" id="o-shared" ${m.opts.sharedWallet ? 'checked' : ''} ${host ? '' : 'disabled'}/>Shared wallet (one pool of bits for everyone)</label>
        <label class="chk"><input type="checkbox" id="o-mic" ${m.opts.openMic ? 'checked' : ''} ${host ? '' : 'disabled'}/>Open mic (otherwise push-to-talk with V)</label>
        <label class="chk"><input type="checkbox" id="o-disc" ${m.opts.discovery ? 'checked' : ''} ${host ? '' : 'disabled'}/>Discovery mode (no monsters, no danger, more things to find; runs are not scored)</label>
      </fieldset>
      <div class="row end">
        <button class="default" id="l-start" ${host ? '' : 'disabled'}>${host ? 'Start run' : 'Waiting for host…'}</button>
        <button id="l-leave">Leave</button>
      </div>`, { icon: true, status: [host ? 'You are the host.' : 'Waiting for the host to start.', `${m.players.length} connected`] })}</div>`;
    this.showTaskbar(`Lobby - ${m.code}`);
    const list = this.lobby.querySelector('#l-players')!;
    for (const p of m.players) {
      const card = document.createElement('div');
      card.className = p.id === m.youId ? 'pcard me' : 'pcard';
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
    $<HTMLInputElement>('#o-disc').onchange = (e) => this.h.setOpts({ discovery: (e.target as HTMLInputElement).checked });
    $<HTMLInputElement>('#o-mic').onchange = (e) => this.h.setOpts({ openMic: (e.target as HTMLInputElement).checked });
    const link = `${location.origin}${location.pathname}?room=${m.code}`;
    const copy = (e: Event): void => { e.preventDefault(); void navigator.clipboard?.writeText(link); this.toast('Invite link copied'); };
    $('#l-link').onclick = copy; $('#l-code').onclick = copy;
  }

  hideAll(): void {
    for (const e of [this.menu, this.lobby, this.hud, this.over, this.overlay, this.dlg, this.popupEl, this.taskbar]) e.classList.add('hidden');
    this.overlayKind = null; this.dialogueOpen = false;
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="tl hpanel"><div id="h-floor"></div><div id="h-bits"></div><div id="h-type" class="dim"></div></div>
      <div class="tc"><div id="h-disks"></div><div id="h-wake"></div></div>
      <div class="tr hpanel" id="h-team"></div>
      <div class="bl hpanel">
        <div class="srow"><span class="sic">${ICON.runner}</span><div class="lbl">Stamina</div><div class="prog"><i id="h-stam"></i></div></div>
        <div class="srow"><span class="sic">${ICON.battery}</span><div class="lbl">Battery</div><div class="prog"><i id="h-bat"></i></div></div>
        <div class="srow time"><span class="sic">${ICON.clock}</span><div id="h-bat-t" class="dim"></div></div>
      </div>
      <div class="bc" id="h-bc">
        <button class="tb tpack" data-act="pack" aria-label="Tools" title="Tools">🎒</button>
        <div class="hb"><button class="tb tbar" data-act="bar" aria-label="Hide or show the hotbar">${ICON.up}</button><div class="hpanel" id="h-slots"></div></div>
      </div>
      <div class="tools win hidden" id="h-tools">
        <div class="title"><span class="tt">Tools</span></div>
        <div class="grid">
          <button class="tb" data-act="webcam" title="Webcam (Q)">📹</button>
          <button class="tb" data-act="scan" title="Scanner (R)">📡</button>
          <button class="tb" data-act="book" title="Bookmarks (Tab)">📖</button>
          <button class="tb" data-act="shop" title="Vendor (B)">🛒</button>
          <button class="tb" data-act="ping" title="Ping (G)">📍</button>
          <button class="tb" data-act="talk" title="Push to talk (V)">🎤</button>
          <button class="tb" data-act="rewind" title="Rewind (Z)">⏪</button>
        </div>
      </div>
      <div class="tmenu">
        <button class="tb" data-act="fs" id="h-fs" aria-label="Fullscreen" title="Fullscreen">${ICON.fsEnter}</button>
        <button class="tb" data-act="map" aria-label="Map" title="Map">${ICON.pin}</button>
        <button class="tb" data-act="esc" aria-label="Pause" title="Pause">${ICON.pause}</button>
      </div>
      <div class="tact">
        <button class="tb big flash" data-act="flash" aria-label="Flashlight" title="Flashlight">💡</button>
        <button class="tb big sprint" data-act="sprint" aria-label="Sprint" title="Sprint (hold)">${ICON.sprint}</button>
        <button class="tb big crouch" data-act="crouch" aria-label="Crouch" title="Crouch">${ICON.crouch}</button>
        <button class="tb big hand" data-act="interact" aria-label="Use" title="Use / interact (hold)">${ICON.hand}</button>
      </div>
      <div class="crosshair" id="h-cross"></div>
      <div class="prompt tip hidden" id="h-prompt"></div>
      <div class="lockhint tip hidden" id="h-lock">Click to capture the mouse</div>
      <div class="toasts" id="h-toasts"></div>
      <div class="pings" id="h-pings"></div>
      <div class="center" id="h-center"></div>`;
    this.toastsEl = this.hud.querySelector('#h-toasts')!;
    this.pingsEl = this.hud.querySelector('#h-pings')!;
  }

  /**
   * The touch buttons live in the HUD (hidden unless `body.touch`). One delegated handler serves them all: any element
   * with `data-act` reports down/up to the input layer, so a held button (use, sprint, talk) keeps working while the
   * other thumb steers. Pointer capture delivers the release even if the finger slides off the button.
   */
  private bindTouchHud(): void {
    const held = new Map<number, HTMLElement>();
    this.hud.addEventListener('pointerdown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || !this.hud.contains(el)) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      held.set(e.pointerId, el);
      el.classList.add('down');
      this.act(el, true);
    });
    const up = (e: PointerEvent): void => {
      const el = held.get(e.pointerId);
      if (!el) return;
      held.delete(e.pointerId);
      el.classList.remove('down');
      this.act(el, false, e.type === 'pointerup');
    };
    for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) this.hud.addEventListener(n, up as EventListener);
    // cancelling the touch sequence stops the browser sending a click afterwards (it would hit whatever opened underneath)
    for (const n of ['touchstart', 'touchend']) {
      this.hud.addEventListener(n, (e) => { if ((e.target as HTMLElement).closest('[data-act]')) e.preventDefault(); }, { passive: false });
    }

    const syncFs = (): void => {
      const b = this.hud.querySelector('#h-fs'), t = this.taskbar.querySelector('#tb-fs');
      for (const el of [b, t]) if (el) { el.innerHTML = isFullscreen() ? ICON.fsExit : ICON.fsEnter; el.setAttribute('title', isFullscreen() ? 'Exit fullscreen' : 'Fullscreen'); }
    };
    onFullscreenChange(syncFs);
    syncFs();
    // a home-screen launch is already fullscreen: nothing to toggle
    if (isStandalone()) document.body.classList.add('standalone');
    this.taskbar.querySelector('#tb-fs')?.addEventListener('click', () => void this.fullscreen());
  }

  /** Fullscreen button (HUD and taskbar). iPhone Safari cannot do it for web pages, so say what to do instead. */
  private async fullscreen(): Promise<void> {
    if (!fullscreenSupported()) { this.toast('Fullscreen is not available here. Use Share, then Add to Home Screen.'); return; }
    await toggleFullscreen();
  }

  private act(el: HTMLElement, down: boolean, released = false): void {
    const name = el.dataset.act!;
    // Buttons that open a window fire on release, not on touch. The window appears a frame later, and the click the
    // browser sends after a tap would otherwise land on its backdrop and close it again.
    if (name === 'map' || name === 'book' || name === 'shop' || name === 'esc') {
      if (down || !released) return;
      this.hud.querySelector('#h-tools')?.classList.add('hidden');
      this.hud.querySelector('[data-act="pack"]')?.classList.remove('on');
      this.h.press(name, true);
      return;
    }
    if (name === 'pack') { if (down) this.hud.querySelector('#h-tools')?.classList.toggle('hidden'); el.classList.toggle('on', !this.hud.querySelector('#h-tools')?.classList.contains('hidden')); return; }
    if (name === 'bar') { if (down) this.hud.querySelector('#h-bc')?.classList.toggle('folded'); return; }
    if (name === 'fs') { if (down) void this.fullscreen(); return; }
    const on = this.h.press(name, down);
    if (typeof on === 'boolean') el.classList.toggle('on', on);
  }

  showHud(): void {
    this.menu.classList.add('hidden'); this.lobby.classList.add('hidden'); this.over.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.showTaskbar(null);
  }

  setLockHint(show: boolean): void {
    this.hud.querySelector('#h-lock')?.classList.toggle('hidden', !show);
  }

  private set(id: string, html: string): void {
    if (this.last.get(id) === html) return;
    this.last.set(id, html);
    const el = this.hud.querySelector(`#${id}`);
    if (el) el.innerHTML = html;
  }

  setHud(s: HudState): void {
    this.set('h-floor', s.secret ? 'Secret room' : `Floor ${s.floor}${s.guest ? ' · Guestbook' : ''}${s.discovery ? ' · Discovery' : ''}`);
    this.set('h-bits', `◆ ${s.bits} bits${s.shared ? ' (shared)' : ''}`);
    this.set('h-type', s.type);
    this.set('h-disks', `<div class="tip">${s.secret ? 'Everything is free in here. Shop (B), take what you like, then step into the link.' : s.guest ? 'Safe floor. Shop (B) then find the link.' : `💾 ${s.inserted}/3 inserted${s.held ? ` · carrying ${s.held}` : ''}${s.exitOpen ? ' · <b>link open</b>' : ''}`}</div>`);
    // no countdown: nobody is told when it wakes up, only that it has
    this.set('h-wake', s.guest || !s.awake ? '' : '<div class="tip warn">IT IS AWAKE</div>');
    this.set('h-team', s.team.length > 1 ? s.team.map((t) => `<div class="member ${t.st === 1 ? 'down' : t.st === 2 ? 'ghost' : ''} ${t.me ? 'me' : ''}">${t.st === 1 ? '⚠ ' : t.st === 2 ? '👻 ' : ''}${esc(t.name)}</div>`).join('') : '');
    const stam = this.hud.querySelector<HTMLElement>('#h-stam'); if (stam) stam.style.width = `${Math.round(s.stamina * 100)}%`;
    const bat = this.hud.querySelector<HTMLElement>('#h-bat'); if (bat) bat.style.width = `${Math.min(100, Math.round((s.battery / 120) * 100))}%`;
    this.set('h-bat-t', `${Math.round(s.battery)}s left${s.webcam ? ' · 📹 REC' : ''}${s.scanCd > 0 ? ` · scan ${Math.ceil(s.scanCd)}s` : ''}`);
    this.set('h-slots', s.slots.map((it, i) => `<div class="slot" data-act="use${i}"><b>${i + 1}</b>${it ? ITEMS[it].icon : ''}${it === 'glowsticks' ? `<i>${s.glow || 3}</i>` : ''}</div>`).join(''));
    let center = '';
    if (s.downed) {
      const rv = s.downed.rv > 0;
      center = win('You are down', `<div class="msg"><span class="ico-warn"></span><div style="flex:1">${rv ? `Being revived… ${Math.round(s.downed.rv * 100)}%` : 'Hold on. A teammate can revive you.'}
        <div class="prog ${rv ? '' : 'red'}" style="margin-top:6px"><i style="width:${Math.round((rv ? s.downed.rv : s.downed.bleed) * 100)}%"></i></div></div></div>`);
    } else if (s.ghost) center = win('Spectating', '<div class="msg"><span class="ico-info">i</span><div>You are a ghost. Click or tap to switch view. A teammate can buy you back at the vendor.</div></div>');
    else if (s.exitProgress > 0) center = `<div class="tip">Everyone stay close… ${Math.round(s.exitProgress * 100)}%</div>`;
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
    d.className = 'tip';
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
    this.dlg.innerHTML = `<div class="bar-t"></div><div class="por l"></div><div class="por r ${mimic ? 'mimic' : ''}"></div>` +
      `<div class="bar-b">${win(name ? esc(name) : 'Message', '<div class="line"></div><div class="more">Click to continue</div>')}</div>`;
    this.dlg.querySelector('.por.l')!.appendChild(lookPortrait(you, 400));
    if (them) this.dlg.querySelector('.por.r')!.appendChild(lookPortrait(them, 400));
    this.typing = { text, shown: 0, acc: 0, timer: 0, onBlip };
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
    this.overlay.innerHTML = win('Map', `<canvas id="mapcv" width="${size}" height="${size}"></canvas>`, { cls: 'mapwin', close: true, status: ['Click anywhere or press M to close'] });
    this.overlay.onclick = () => this.closeOverlay();
    const cv = this.overlay.querySelector<HTMLCanvasElement>('#mapcv')!;
    cv.style.width = cv.style.height = `${Math.min(innerWidth, innerHeight) * 0.78}px`;
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
    const count = (keys: string[], all: number): string => `${keys.length}/${all}`;
    this.overlay.innerHTML = win('Bookmarks', `<fieldset><legend>Monsters</legend><div class="bm">${mon}</div></fieldset><fieldset><legend>Anomalies</legend><div class="bm">${an}</div></fieldset><fieldset><legend>Residents</legend><div class="bm">${npc}</div></fieldset>`,
      { close: true, status: ['Press Tab to close', `Monsters ${count(b.monster, MONSTERS.length)}`, `Anomalies ${count(b.anomaly, anomalyIds.length)}`] });
    this.wireOverlay();
  }

  openShop(floor: number, balance: number, ghosts: number): void {
    this.overlayKind = 'shop';
    this.overlay.classList.remove('hidden');
    const mult = priceMultiplier(floor);
    const rows = VENDOR_STOCK.map((id) => {
      const it = ITEMS[id];
      const cost = Math.round(it.cost * mult);
      const dis = cost > balance || (id === 'ghost' && ghosts === 0);
      return `<div class="shop-item"><div class="ic">${it.icon}</div><div class="d"><b>${esc(it.name)}</b><small>${esc(it.desc)}${id === 'ghost' ? ` (${ghosts} ghost${ghosts === 1 ? '' : 'es'})` : ''}</small></div><div class="cost">${cost} ◆</div><button data-i="${id}" ${dis ? 'disabled' : ''}>Order</button></div>`;
    }).join('');
    this.overlay.innerHTML = win('The Vendor', `<p class="note" style="margin:0 0 8px">Order an item and the hand will bring it. Grab it with E when it reaches you. Do not run away from the hand.</p><div class="shoplist">${rows}</div><div class="row end" style="margin-top:8px"><button id="s-close">Close</button></div>`,
      { close: true, status: [`You have ${balance} ◆`, 'B to close'] });
    this.wireOverlay();
    this.overlay.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) => b.addEventListener('click', () => { this.h.order(b.dataset.i as ItemId); this.closeOverlay(); }));
    this.overlay.querySelector('#s-close')?.addEventListener('click', () => this.closeOverlay());
  }

  openHelp(set: PauseSettings): void {
    this.overlayKind = 'help';
    this.overlay.classList.remove('hidden');
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    this.overlay.innerHTML = win('Paused', `
      <fieldset><legend>Mouse</legend>
        <div class="row"><span style="min-width:96px">Look sensitivity:</span><input type="range" id="p-sens" min="5" max="300" step="5" value="${Math.round(set.sensitivity * 100)}"/><span id="p-sens-v" style="min-width:38px;text-align:right">${pct(set.sensitivity)}</span></div>
        <label class="chk"><input type="checkbox" id="p-raw" ${set.raw ? 'checked' : ''}/>Raw mouse input where supported (ignores OS pointer acceleration)</label>
      </fieldset>
      <fieldset><legend>Controls</legend>${CONTROLS}</fieldset>
      <div class="row end"><button class="default" id="p-resume">Resume</button><button id="p-leave">Leave run</button></div>`,
      { close: true, status: ['Esc or Resume to return to the game.'] });
    const sens = this.overlay.querySelector<HTMLInputElement>('#p-sens')!;
    const out = this.overlay.querySelector('#p-sens-v')!;
    sens.oninput = () => { const v = Number(sens.value) / 100; set.setSensitivity(v); out.textContent = pct(v); };
    const raw = this.overlay.querySelector<HTMLInputElement>('#p-raw')!;
    raw.onchange = () => set.setRaw(raw.checked);
    this.overlay.querySelector('#p-resume')?.addEventListener('click', () => this.closeOverlay());
    this.overlay.querySelector('#p-leave')?.addEventListener('click', () => { this.closeOverlay(); this.h.leave(); });
    this.wireOverlay();
  }

  /** Title-bar close buttons, and clicking the dimmed backdrop, close the current overlay window. */
  private wireOverlay(): void {
    this.overlay.onclick = (e) => { if (e.target === this.overlay) this.closeOverlay(); };
    this.overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeOverlay()));
  }

  showOver(m: OverMsg, name: string): void {
    this.over.classList.remove('hidden');
    this.over.innerHTML = `<div class="desk" style="justify-content:center">${win('Webmaze', `
      <div class="msg"><span class="ico-err"></span><div>
        <div style="font-weight:bold;margin-bottom:6px">This page cannot be displayed.</div>
        <div>Your team got lost on <b>floor ${m.floor}</b> with <b>${m.totalBits} bits</b> earned.</div>
        <div class="note" style="margin-top:6px">Seed <b>${esc(m.seed)}</b>: enter it on the menu to replay this world.</div>
        <div class="note" style="margin-top:6px">${esc(name)}, nobody dies on the internet. They just stop loading.</div>
      </div></div>
      <div class="row mid" style="margin-top:10px"><button class="default" id="o-again">OK</button></div>`, { cls: 'over' })}</div>`;
    this.showTaskbar('Webmaze - Game over');
    this.over.querySelector('#o-again')?.addEventListener('click', () => this.h.again());
  }

  openChat(onSend: (t: string) => void): void {
    if (this.chatEl) return;
    const i = document.createElement('input');
    i.type = 'text'; i.maxLength = 80; i.placeholder = 'say something…';
    const box = document.createElement('div');
    box.innerHTML = win('Chat', '', { cls: 'chat' });
    const w = box.firstElementChild as HTMLElement;
    w.querySelector('.wb')!.appendChild(i);
    this.root.appendChild(w);
    this.chatEl = i;
    i.focus();
    i.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { if (i.value.trim()) onSend(i.value); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    };
  }

  closeChat(): void {
    this.chatEl?.closest('.chat')?.remove();
    this.chatEl = null;
  }

  get blocking(): boolean {
    return this.dialogueOpen || this.overlayKind !== null || this.chatEl !== null;
  }
}
