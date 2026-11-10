// Headless check of soda, the Konami secret room, discovery mode and the hidden wake timer.
// Start the server first: WEBMAZE_DEBUG=1 WEBMAZE_NO_SPEED_CHECK=1 WEBMAZE_WAKE_DELAY=2 npm run dev:server
import { Client } from 'colyseus.js';
import { generateFloor, centerOf, SODA, TILE } from '@webmaze/shared';

const url = process.env.URL ?? 'ws://127.0.0.1:2567';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

async function bot(seed, opts = {}) {
  const code = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const room = await new Client(url).create('game', { name: 'Bot', code, seed });
  const S = { floor: null, snap: null, gs: null, inv: null, evs: [], snaps: [], floors: [] };
  room.onMessage('floor', (m) => { S.floor = m; S.floors.push(m); });
  room.onMessage('snap', (m) => { S.snap = m; S.snaps.push(m); });
  room.onMessage('gs', (m) => { S.gs = m; });
  room.onMessage('inv', (m) => { S.inv = m; });
  room.onMessage('ev', (m) => { S.evs.push(m); });
  for (const n of ['lobby', 'dlg', 'bookmarks', 'over']) room.onMessage(n, () => {});
  await sleep(300);
  if (opts.discovery) { room.send('opts', { discovery: true }); await sleep(200); }
  room.send('start', {});
  await sleep(500);
  return { room, S, tp: (x, z) => room.send('pos', { n: S.floor.floor, x, z, yaw: 0, f: 0 }) };
}

// ---------- normal run: wake timer is hidden, then secret room + soda ----------
{
  const SEED = 'FEATURE1';
  const { room, S, tp } = await bot(SEED);
  check('floor message has no wake countdown', !('wakeIn' in S.floor));
  check('floor message is a normal floor', S.floor.discovery === false && S.floor.secret === false);
  await sleep(500);
  check('snapshots carry no wake countdown', S.snap && !('wk' in S.snap));

  room.send('secret');
  await sleep(500);
  check('Konami message opens the secret room', S.floor.secret === true);
  const sf = generateFloor(SEED, S.floor.floor, { secret: true });
  check('secret room shows one of each monster', ['silhouette', 'rat', 'mannequin', 'mimic'].every((k) => S.snap.m.some((m) => m.k === k)), JSON.stringify(S.snap.m.map((m) => m.k)));
  const before = JSON.stringify(S.snap.m.map((m) => [m.x, m.z]));
  await sleep(800);
  check('exhibits stand still', JSON.stringify(S.snap.m.map((m) => [m.x, m.z])) === before);
  check('secret room is a safe floor with open exit', S.gs.exitOpen === true);

  // pick up all sodas lying around: slots fill, bits stay at zero
  for (const it of sf.items.filter((i) => i.sub === 'soda').slice(0, 2)) {
    tp(it.x, it.z); await sleep(120);
    room.send('interact', { kind: 'item', id: it.id }); await sleep(150);
  }
  check('picked up soda cans', S.inv.slots.filter((s) => s === 'soda').length === 2, JSON.stringify(S.inv.slots));
  const d = sf.disks[0];
  tp(d.x, d.z); await sleep(120);
  room.send('interact', { kind: 'disk', id: d.id }); await sleep(200);
  check('secret room pays no bits', S.gs.totalBits === 0, `totalBits=${S.gs.totalBits}`);

  // buy from the free vendor: the hand should come out with no bits at all
  tp(centerOf(sf.vendor.tx), centerOf(sf.vendor.tz) + 6); await sleep(150);
  room.send('buy', { item: 'ctrlz' });
  await sleep(2500);
  check('vendor hand snaps out for a broke player', S.snaps.some((s) => s.a.some((a) => a.s === 1 || a.s === 2)));

  // leave through the portal
  tp(centerOf(sf.exit.tx), centerOf(sf.exit.tz)); S.floors.length = 0;
  await sleep(3800);
  check('exit portal returns to the maze', S.floors.length > 0 && S.floor.secret === false && S.floor.floor === 1);
  check('inventory survived the trip', S.inv.slots.filter((s) => s === 'soda').length === 2);

  // soda against the real Silhouette
  const f1 = generateFloor(SEED, 1);
  await sleep(3000); // wake delay is 2 s
  check('it woke up', S.gs.awake === true);
  let pushedOk = false, stunOk = false, tries = 0;
  for (; tries < 6 && !pushedOk; tries++) {
    const sil = S.snap.m.find((m) => m.k === 'silhouette');
    if (!sil) { await sleep(500); continue; }
    // stand 2 m from it, on an open tile (the same tile as it, offset a little along the tile)
    tp(sil.x + 0.3, sil.z); room.send('use', { slot: S.inv.slots.indexOf('soda') });
    S.evs.length = 0;
    await sleep(250);
    if (!S.evs.some((e) => e.k === 'soda')) { await sleep(2500); continue; } // got caught first: retry later
    const a = S.snap.m.find((m) => m.k === 'silhouette');
    const moved = Math.hypot(a.x - sil.x, a.z - sil.z);
    await sleep(1500);
    const b = S.snap.m.find((m) => m.k === 'silhouette');
    const still = Math.hypot(b.x - a.x, b.z - a.z) < 0.05;
    await sleep(3500);
    const c = S.snap.m.find((m) => m.k === 'silhouette');
    const free = Math.hypot(c.x - b.x, c.z - b.z) > 0.2;
    pushedOk = moved >= 2 * TILE * 0.9 || moved >= TILE * 0.9; stunOk = still;
    check('soda shoved the Silhouette away', pushedOk, `moved ${moved.toFixed(1)} m`);
    check('soda froze it for a few seconds', stunOk);
    check('it moves again afterwards', free);
    check(`state is not hunting right after the pop`, a.s !== 2, `state ${a.s}`);
  }
  if (!pushedOk) { check('soda test reached the Silhouette', false, `after ${tries} tries`); }
  // use with nothing near: not consumed
  tp(centerOf(f1.entry.tx), centerOf(f1.entry.tz));
  await sleep(300);
  const left = S.inv.slots.filter((s) => s === 'soda').length;
  room.send('use', { slot: S.inv.slots.indexOf('soda') });
  await sleep(300);
  check('soda is kept when nothing is in range', S.inv.slots.filter((s) => s === 'soda').length === left, `range ${SODA.range} m`);
  room.leave();
}

// ---------- discovery run ----------
{
  const { room, S } = await bot('FEATURE2', { discovery: true });
  check('discovery flag reaches the client', S.floor.discovery === true);
  await sleep(4500); // wake delay would have passed
  check('discovery: no monsters ever appear', S.snaps.every((s) => s.m.length === 0));
  check('discovery: nothing wakes', !S.evs.some((e) => e.k === 'wake') && S.gs.awake === false);
  check('discovery: no stingers', !S.evs.some((e) => e.k === 'stinger'));
  room.leave();
}

await sleep(300);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
