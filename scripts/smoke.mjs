// Headless multi-floor bot test against a running server (start it with WEBMAZE_DEBUG=1 WEBMAZE_NO_MONSTERS=1).
// Plays floors with two bots: collect 3 disks, insert them, walk to the exit, shop on guestbook floors.
import { Client } from 'colyseus.js';
import { generateFloor, centerOf, findPath, pathToWorld, TILE } from '@webmaze/shared';

const url = process.env.URL ?? 'ws://127.0.0.1:2567';
const START = Number(process.env.START ?? 4);
const FLOORS = Number(process.env.FLOORS ?? 3);
const SEED = 'SMOKE123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const room = await new Client(url).create('game', { name: 'BotA', code: process.env.CODE ?? ('SM' + Math.random().toString(36).slice(2, 6).toUpperCase()), seed: SEED, startFloor: START });
const room2 = await new Client(url).joinById(room.roomId, { name: 'BotB' });
const S = { floor: null, gs: null, snap: null, evs: [], inv: null };
room.onMessage('floor', (m) => { S.floor = m; });
room.onMessage('gs', (m) => { S.gs = m; });
room.onMessage('snap', (m) => { S.snap = m; });
room.onMessage('ev', (m) => { S.evs.push(m); });
room.onMessage('inv', (m) => { S.inv = m; });
room.onMessage('over', (m) => log('OVER', m));
for (const n of ['lobby', 'dlg', 'bookmarks']) { room.onMessage(n, () => {}); }
for (const n of ['lobby', 'dlg', 'bookmarks', 'floor', 'gs', 'snap', 'ev', 'inv', 'over']) room2.onMessage(n, () => {});
await sleep(300);
room.send('start', {});
await sleep(600);

async function walk(r, p, floorNum, f, tx, tz, speed = 4.5) {
  const path = findPath(f, Math.floor(p.x / TILE), Math.floor(p.z / TILE), Math.floor(tx / TILE), Math.floor(tz / TILE));
  if (!path) throw new Error('no path');
  for (const w of pathToWorld(f, path)) {
    for (let guard = 0; Math.hypot(w.x - p.x, w.z - p.z) > 0.15 && guard < 2000; guard++) {
      const d = Math.hypot(w.x - p.x, w.z - p.z), s = Math.min(d, speed * 0.05);
      p.x += ((w.x - p.x) / d) * s; p.z += ((w.z - p.z) / d) * s;
      r.send('pos', { n: floorNum, x: p.x, z: p.z, yaw: 0, f: 2 });
      await sleep(50);
    }
  }
}

let ok = true;
for (let i = 0; i < FLOORS; i++) {
  const t0 = Date.now();
  const fl = S.floor.floor;
  const f = generateFloor(SEED, fl);
  const pa = { x: S.floor.spawn.x, z: S.floor.spawn.z };
  const pb = { ...pa };
  S.evs.length = 0;
  log(`--- floor ${fl} (${f.type}) ${f.cols}x${f.rows}`);
  if (f.type === 'guestbook') {
    await sleep(500);
    const bitsBefore = S.gs.wallets[room.sessionId];
    room.send('buy', { item: 'sprintchip' });
    await sleep(300);
    const vx = centerOf(f.vendor.tx), vz = centerOf(f.vendor.tz);
    // approach until the arm snaps (20 m), then walk to the fingertips and grab
    await walk(room, pa, fl, f, vx, vz + 14);
    let grabbed = false;
    for (let k = 0; k < 120 && !grabbed; k++) {
      const arm = S.snap?.a.find((a) => a.p === room.sessionId);
      if (arm && (arm.s === 1 || arm.s === 2)) {
        // the hand may stop short at its max length: walk to the fingertips like a player would
        const tx = arm.t[arm.t.length - 2], tz = arm.t[arm.t.length - 1];
        const d = Math.hypot(tx - pa.x, tz - pa.z);
        if (d < 1.2) { room.send('interact', { kind: 'grab', id: room.sessionId }); grabbed = true; }
        else if (d < 6) {
          const s2 = Math.min(d, 0.2);
          pa.x += ((tx - pa.x) / d) * s2; pa.z += ((tz - pa.z) / d) * s2;
          room.send('pos', { n: fl, x: pa.x, z: pa.z, yaw: 0, f: 2 });
        }
      }
      await sleep(50);
    }
    await sleep(500);
    log('vendor: grabbed', grabbed, 'bits', bitsBefore, '->', S.gs.wallets[room.sessionId], 'sprint chips', S.gs.passives[room.sessionId]?.sprint);
    if (!grabbed || S.gs.passives[room.sessionId]?.sprint !== 1) ok = false;
  } else {
    for (const d of f.disks) {
      await walk(room, pa, fl, f, d.x, d.z);
      room.send('interact', { kind: 'disk', id: d.id });
      await sleep(120);
    }
    const tm = f.terminal;
    await walk(room, pa, fl, f, centerOf(tm.tx), centerOf(tm.tz));
    room.send('interact', { kind: 'terminal', id: 'terminal' });
    await sleep(300);
    log('terminal: inserted', S.gs.inserted, 'exitOpen', S.gs.exitOpen, 'bits', JSON.stringify(S.gs.wallets));
    if (S.gs.inserted !== 3 || !S.gs.exitOpen) ok = false;
  }
  const ex = centerOf(f.exit.tx), ez = centerOf(f.exit.tz);
  await Promise.all([walk(room, pa, fl, f, ex, ez), walk(room2, pb, fl, f, ex, ez)]);
  const erased = S.evs.filter((e) => e.k === 'erase').length;
  for (let k = 0; k < 60 && S.floor.floor === fl; k++) await sleep(100);
  log(`floor ${fl} done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> now floor ${S.floor.floor}; 404 erase events: ${erased}; events: ${[...new Set(S.evs.map((e) => e.k))].join(',')}`);
  if (S.floor.floor !== fl + 1) { ok = false; break; }
}
log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
