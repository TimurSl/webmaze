import './style.css';
import { randomRoomCode } from '@webmaze/shared';
import { AudioEngine } from './audio';
import { Game } from './game';
import { Input } from './input';
import { Net, NetHandlers, leaderboard, login, me, register } from './net';
import { UI } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('ui') as HTMLElement;

let game!: Game;
let account: { token: string; name: string } | null = null;
let autoStart = false;
let autoDiscovery = false;
let lastName = localStorage.getItem('webmaze.name') ?? '';
const audio = new AudioEngine();

const handlers: NetHandlers = {
  lobby: (m) => {
    game.onLobby(m);
    if (autoStart && !m.started && m.players.find((p) => p.id === m.youId)?.host) {
      autoStart = false;
      if (autoDiscovery) { autoDiscovery = false; net.opts({ discovery: true }); }
      net.start();
    }
  },
  floor: (m) => game.onFloor(m),
  snap: (m) => game.onSnap(m),
  gs: (m) => game.onGs(m),
  inv: (m) => game.onInv(m),
  ev: (m) => game.onEv(m),
  dlg: (m) => game.onDlg(m),
  over: (m) => game.onOver(m),
  bookmarks: (rows) => game.mergeBookmarks(rows),
  closed: (reason) => { toMenu(reason); },
  reconnected: () => game.ui.toast('Reconnected'),
};
const net = new Net(handlers);

async function toMenu(err = ''): Promise<void> {
  game.playing = false;
  game.input.enabled = false;
  game.input.setTouchVisible(false);
  game.input.releasePointer();
  game.ui.hideAll();
  const board = await leaderboard();
  game.ui.showMenu(account ? { name: account.name } : null, board, { name: lastName }, err);
  const q = new URLSearchParams(location.search).get('room');
  if (q) { const el = root.querySelector<HTMLInputElement>('#m-code'); if (el) el.value = q.toUpperCase().slice(0, 6); }
}

const ui = new UI(root, {
  solo: (name, seed) => { autoStart = true; void enter(name, () => net.create({ name, seed, code: randomRoomCode(), token: account?.token })); },
  discovery: (name, seed) => { autoStart = true; autoDiscovery = true; void enter(name, () => net.create({ name, seed, code: randomRoomCode(), token: account?.token })); },
  create: (name, seed) => void enter(name, () => net.create({ name, seed, code: randomRoomCode(), token: account?.token })),
  join: (name, code) => {
    if (!/^[A-Za-z]{6}$/.test(code)) { ui.menuError('Room codes are 6 letters.'); return; }
    void enter(name, () => net.join(code, { name, token: account?.token }));
  },
  login: async (n, p) => { const a = await login(n, p); setAccount(a.token, a.user.name); },
  register: async (n, p) => { const a = await register(n, p); setAccount(a.token, a.user.name); },
  logout: () => { account = null; localStorage.removeItem('webmaze.token'); void toMenu(); },
  start: () => net.start(),
  reroll: () => net.reroll(),
  setOpts: (o) => net.opts(o),
  leave: () => { net.leave(); autoStart = false; autoDiscovery = false; void toMenu(); },
  order: (item) => net.buy({ item }),
  again: () => { net.leave(); void toMenu(); },
  press: (name, down) => input.virtual(name, down),
});

async function enter(name: string, go: () => Promise<void>): Promise<void> {
  audio.start(); // needs a user gesture
  lastName = name; localStorage.setItem('webmaze.name', name);
  try { await go(); } catch (e) {
    autoStart = false; autoDiscovery = false;
    ui.menuError(e instanceof Error ? e.message : 'Could not connect to the server.');
  }
}

function setAccount(token: string, name: string): void {
  account = { token, name };
  localStorage.setItem('webmaze.token', token);
  void me(token).then((r) => { if (r) game.mergeBookmarks(r.bookmarks); });
  void toMenu();
}

const input = new Input(canvas, root);
game = new Game(canvas, ui, input, audio, net);

(async () => {
  const token = localStorage.getItem('webmaze.token');
  if (token) {
    const r = await me(token);
    if (r) { account = { token, name: r.user.name }; game.mergeBookmarks(r.bookmarks); } else localStorage.removeItem('webmaze.token');
  }
  await toMenu();
})();

// expose for debugging and headless tests
(window as unknown as { __webmaze: unknown }).__webmaze = { game, net };
