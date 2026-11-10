// Thin wrapper over colyseus.js: join/create, typed senders, reconnect, REST helpers for accounts.
import { Client, Room } from 'colyseus.js';
import {
  BuyMsg, C, DlgMsg, EvMsg, FloorMsg, GameState, InteractMsg, InvMsg, JoinOptions, LobbyMsg, LobbyOptions, OverMsg, PosMsg, S, Snap, UseMsg,
} from '@webmaze/shared';

export interface NetHandlers {
  lobby(m: LobbyMsg): void;
  floor(m: FloorMsg): void;
  snap(m: Snap): void;
  gs(m: GameState): void;
  inv(m: InvMsg): void;
  ev(m: EvMsg): void;
  dlg(m: DlgMsg): void;
  over(m: OverMsg): void;
  bookmarks(rows: { kind: string; key: string }[]): void;
  closed(reason: string): void;
  reconnected(): void;
}

export function endpoint(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  if (env?.VITE_SERVER) return env.VITE_SERVER;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // behind the Caddy reverse proxy the game server lives at /api; in dev vite proxies /api too
  return `${proto}://${location.host}/api`;
}

export function httpBase(): string {
  const e = endpoint();
  return e.replace(/^ws/, 'http');
}

export class Net {
  room: Room | null = null;
  private client: Client;
  private closing = false;

  constructor(private h: NetHandlers) {
    this.client = new Client(endpoint());
  }

  async create(opts: JoinOptions): Promise<void> {
    this.attach(await this.client.create('game', opts));
  }

  async join(code: string, opts: JoinOptions): Promise<void> {
    this.attach(await this.client.joinById(code.toUpperCase(), opts));
  }

  private attach(room: Room): void {
    this.room = room;
    this.closing = false;
    room.onMessage(S.lobby, (m: LobbyMsg) => this.h.lobby(m));
    room.onMessage(S.floor, (m: FloorMsg) => this.h.floor(m));
    room.onMessage(S.snap, (m: Snap) => this.h.snap(m));
    room.onMessage(S.gs, (m: GameState) => this.h.gs(m));
    room.onMessage(S.inv, (m: InvMsg) => this.h.inv(m));
    room.onMessage(S.ev, (m: EvMsg) => this.h.ev(m));
    room.onMessage(S.dlg, (m: DlgMsg) => this.h.dlg(m));
    room.onMessage(S.over, (m: OverMsg) => this.h.over(m));
    room.onMessage('bookmarks', (m: { kind: string; key: string }[]) => this.h.bookmarks(m));
    room.onError((code, msg) => console.warn('room error', code, msg));
    room.onLeave((code) => {
      if (this.closing) return;
      void this.tryReconnect(room.reconnectionToken, code);
    });
  }

  private async tryReconnect(token: string, code: number): Promise<void> {
    for (let i = 0; i < 6; i++) {
      try {
        this.attach(await this.client.reconnect(token));
        this.h.reconnected();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    this.h.closed(code === 1000 ? 'Left the room' : 'Lost connection to the server');
  }

  leave(): void {
    this.closing = true;
    void this.room?.leave();
    this.room = null;
  }

  private send(type: string, msg?: unknown): void {
    this.room?.send(type, msg);
  }
  pos(m: PosMsg): void { this.send(C.pos, m); }
  interact(m: InteractMsg): void { this.send(C.interact, m); }
  scan(): void { this.send(C.scan); }
  buy(m: BuyMsg): void { this.send(C.buy, m); }
  use(m: UseMsg): void { this.send(C.use, m); }
  rewind(x: number, z: number): void { this.send(C.rewind, { x, z }); }
  ping(x: number, z: number): void { this.send(C.ping, { x, z }); }
  say(text: string): void { this.send(C.say, { text }); }
  secret(): void { this.send(C.secret); }
  opts(o: Partial<LobbyOptions>): void { this.send(C.opts, o); }
  reroll(): void { this.send(C.reroll); }
  start(): void { this.send(C.start); }
}

// ---- accounts (REST) ----
export interface Account { token: string; user: { id: number; name: string } }

async function post(path: string, body: unknown): Promise<Account> {
  const r = await fetch(`${httpBase()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'request failed');
  return j as Account;
}
export const register = (name: string, password: string): Promise<Account> => post('/auth/register', { name, password });
export const login = (name: string, password: string): Promise<Account> => post('/auth/login', { name, password });
export async function me(token: string): Promise<{ user: { id: number; name: string }; bookmarks: { kind: string; key: string }[] } | null> {
  try {
    const r = await fetch(`${httpBase()}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export async function leaderboard(): Promise<{ name: string; floor: number; bits: number; seed: string; players: number }[]> {
  try {
    const r = await fetch(`${httpBase()}/leaderboard`);
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
