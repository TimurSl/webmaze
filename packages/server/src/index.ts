import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './GameRoom';
import { Db } from './db';

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.WEBMAZE_DB ?? (process.env.STATE_DIRECTORY ? `${process.env.STATE_DIRECTORY}/webmaze.sqlite` : './data/webmaze.sqlite');
const MAX_PER_ROOM = Math.min(6, Math.max(1, Number(process.env.WEBMAZE_MAX_PLAYERS ?? 6)));

const db = new Db(DB_PATH);
GameRoom.db = db;

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 8192) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization' });
  res.end(JSON.stringify(body));
}

const bearer = (req: IncomingMessage): string | undefined => {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : undefined;
};

const http = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  try {
    if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
    if (url === '/health') { send(res, 200, { ok: true }); return; }
    if (url === '/auth/register' && req.method === 'POST') {
      const b = await readJson(req);
      send(res, 200, await db.register(String(b.name ?? ''), String(b.password ?? '')));
      return;
    }
    if (url === '/auth/login' && req.method === 'POST') {
      const b = await readJson(req);
      send(res, 200, await db.login(String(b.name ?? ''), String(b.password ?? '')));
      return;
    }
    if (url === '/auth/me') {
      const u = db.userForToken(bearer(req));
      if (!u) { send(res, 401, { error: 'not signed in' }); return; }
      send(res, 200, { user: u, bookmarks: db.bookmarks(u.id) });
      return;
    }
    if (url === '/leaderboard') { send(res, 200, db.leaderboard(20)); return; }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : 'error' });
  }
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
gameServer.define('game', GameRoom);
GameRoom.prototype.maxClients = MAX_PER_ROOM;

gameServer.listen(PORT, HOST).then(() => {
  console.log(`webmaze server listening on ${HOST}:${PORT} (db: ${DB_PATH})`);
});

const stop = (): void => { gameServer.gracefullyShutdown(false).finally(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
