# webmaze

A co-op (1–6 players) first-person horror game that runs in the browser. You wake up inside a webcore maze of mismatched wallpapers, MIDI loops and broken UI. A server-run AI monster, the Silhouette, hunts you. Find 3 floppy disks, insert them into the terminal, reach the exit link, repeat. The score is the deepest floor reached, with total bits as the tiebreaker.

Everything (textures, characters, sprites, audio) is generated procedurally in code. All characters are original.

## Run it

Requires Node 22.5+ (the server uses the built-in `node:sqlite`).

```bash
npm install
npm run dev        # server on :2567, client on http://localhost:5173
```

Production build:

```bash
npm run build
npm start          # serves the game server (WebSocket + REST) from packages/server/dist/server.mjs
```

The client is static (`packages/client/dist`). It talks to the server at `<same host>/api`, so put a reverse proxy in front that serves the static files at `/` and proxies `/api` (with WebSocket upgrade) to the server. The dev server does this for you.

Share a room by its 6-letter code or `?room=CODE`. Solo play creates a private room and starts at once.

### Nix / NixOS

`flake.nix` provides a package, a dev shell and a NixOS module:

```nix
services.webmaze = { enable = true; domain = "maze.example.com"; };
```

This sets up a systemd service (127.0.0.1 only, state in `/var/lib/webmaze`) and Caddy with automatic HTTPS. `npmDepsHash` is currently `lib.fakeHash`: run `nix build` once and paste the hash it prints.

## Controls

WASD/arrows move, mouse look, Shift sprint, C crouch, E interact (hold to revive), F flashlight, Q webcam (reveals hidden things), R scanner, M map, Tab bookmarks, B vendor menu on guestbook floors, 1–4 use item, Z rewind, G ping, V push to talk, Enter chat, H help, [ and ] lower/raise look sensitivity (saved). Mobile gets a virtual joystick, drag-to-look and on-screen buttons.

## Architecture

TypeScript npm-workspaces monorepo:

- `packages/shared`: seeded deterministic floor generator (`generateFloor(runSeed, floor)` gives identical results on client and server), nav (A*, LOS, collision), config/scaling tables, protocol types. Both sides import it as TS source.
- `packages/server`: Colyseus 0.16 room, server-authoritative for monsters, the vendor arm, items, bits, downed/dead state and the director (tension pacing). Client positions are validated (speed, solid tiles). Also accounts (scrypt, SQLite), bookmarks and a leaderboard over REST.
- `packages/client`: three.js renderer at ~270 px height into a nearest-filtered target with a post shader (grey drain, compression artifacts, dither, vignette, flashlight), paper-doll sprites, Web Audio with procedural loops, DOM UI.

Only the run seed and floor number cross the network for level data. Movement and state use 10 Hz snapshots plus reliable events. Disconnected players can reconnect within 60 s.

## Tests

```bash
npm test             # vitest: generator determinism, reachability, scaling table, nav
npm run typecheck
npx tsx scripts/smoke.mjs   # bot playthrough against a running server (see header of the script for env flags)
```

Debug switches (testing only): `WEBMAZE_DEBUG`, `WEBMAZE_NO_MONSTERS`, `WEBMAZE_NO_SPEED_CHECK`, `WEBMAZE_WAKE_DELAY`, `WEBMAZE_START_FLOOR`, `WEBMAZE_START_BITS`. Server config: `PORT`, `HOST`, `WEBMAZE_DB`, `STATE_DIRECTORY`, `WEBMAZE_MAX_PLAYERS`.

## Status vs. the design plan

Implemented: lobby/rooms, procedural floors with scaling, 3-disk/terminal/exit loop, the Silhouette AI (hearing, sight, hunting, search, hide spots), rats, mannequin crowds, mimics, NPC dialogue, anomalies and scanning, flashlight/battery/inventory, downing and reviving, spectating, guestbook floors with the vendor arm and shop, popups and 404 erasing on later floors, director and fake cues, style breaks near the monster, accounts with bookmarks, leaderboard, reconnection, touch controls.

Not yet implemented: Corrupted-floor shifting, flipped-gravity floors, breakable walls on desktop/park floors, voice chat. Hunting/revive/disconnect flows have only been partly play-tested.

Default options: wallets are split per player; dead players only spectate.
