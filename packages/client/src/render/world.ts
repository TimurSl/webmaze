// Builds the Three.js scene for one floor from FloorData (the same data the server uses).
import * as THREE from 'three';
import {
  ASnap, FloorData, PALETTES, Rng, TILE, WALLPAPER_PATTERNS, WALL_H, centerOf, hashString, ANOMALIES, rngFor,
} from '@webmaze/shared';
import {
  bellTreeTexture, iconTexture, mannequinTexture, tentTexture, vendorTexture, silhouetteTexture, ratTexture,
} from './sprites';
import { CharacterSprite } from './sprites';
import {
  ceilingMapTexture, ceilingTexture, glowTexture, groundTexture, hedgeTexture, hex, labelTexture, mix, serverTexture, shade,
  wallpaperTexture, windowTexture,
} from './textures';

const basic = (color: number, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color, ...extra });

interface Facer { obj: THREE.Object3D }

export class FloorView {
  group = new THREE.Group();
  fog: THREE.Fog;
  clearColor: number;
  private wallMesh: THREE.Mesh | null = null;
  private wallMat: THREE.MeshBasicMaterial;
  private facers: Facer[] = [];
  private entities = new Map<string, THREE.Object3D>();
  private gifIds = new Set<string>();
  private bob: { obj: THREE.Object3D; y: number; ph: number }[] = [];
  private spin: THREE.Object3D[] = [];
  private npcs: { id: string; sprite: CharacterSprite }[] = [];
  private exitMat!: THREE.MeshBasicMaterial;
  private exitLabel!: THREE.Mesh;
  private terminalGlow!: THREE.Sprite;
  private mannequins: { mesh: THREE.Mesh; idx: number }[] = [];
  private glowSticks: THREE.Sprite[] = [];
  readonly bellTrees: { id: string; x: number; z: number; mesh: THREE.Mesh; ringing: number }[] = [];
  private t = 0;
  private armGroup = new THREE.Group();
  private armMeshes = new Map<string, { tube: THREE.Mesh; hand: THREE.Group; item: THREE.Sprite }>();
  private ownTextures: THREE.Texture[] = [];
  private pal;
  private mannequinHidden = -1;

  constructor(public floor: FloorData) {
    const pal = (this.pal = PALETTES[floor.palette]);
    const outdoor = floor.type === 'park';
    const dark = floor.type === 'chatroom';
    const fogCol = dark ? 0x05050c : outdoor ? pal.fog : mix(pal.fog, 0x000000, 0.4);
    this.clearColor = fogCol;
    this.fog = new THREE.Fog(fogCol, dark ? 1 : 2, outdoor ? 38 : dark ? 16 : 24);

    this.wallMat = this.makeWallMaterial();
    this.rebuildWalls();
    this.buildFloorAndCeiling();
    this.buildEntities();
    this.buildProps();
    this.group.add(this.armGroup);
  }

  // ------------------------------------------------------------------ walls

  private makeWallMaterial(): THREE.MeshBasicMaterial {
    const f = this.floor, pal = this.pal;
    let map: THREE.Texture;
    switch (f.type) {
      case 'desktop': map = windowTexture(pal); break;
      case 'park': map = hedgeTexture(mix(0x2e8a32, pal.accent, 0.15)); break;
      case 'server': map = serverTexture(); break;
      case 'geocities': map = wallpaperTexture('gif', pal); break;
      default: map = wallpaperTexture(WALLPAPER_PATTERNS[f.wallpaper % 4], pal);
    }
    return new THREE.MeshBasicMaterial({ map, fog: true, color: f.type === 'chatroom' ? 0x666688 : 0xffffff });
  }

  rebuildWalls(): void {
    const f = this.floor;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let vi = 0;
    const quad = (x0: number, z0: number, x1: number, z1: number): void => {
      pos.push(x0, 0, z0, x1, 0, z1, x1, WALL_H, z1, x0, WALL_H, z0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    };
    const solid = (x: number, z: number): boolean => x < 0 || z < 0 || x >= f.cols || z >= f.rows || f.solid[z * f.cols + x] === 1;
    for (let z = 0; z < f.rows; z++) {
      for (let x = 0; x < f.cols; x++) {
        if (!solid(x, z)) continue;
        const x0 = x * TILE, x1 = x0 + TILE, z0 = z * TILE, z1 = z0 + TILE;
        if (!solid(x, z - 1) && z > 0) quad(x1, z0, x0, z0);       // north face, seen from -z side
        if (!solid(x, z + 1) && z < f.rows - 1) quad(x0, z1, x1, z1); // south face
        if (!solid(x - 1, z) && x > 0) quad(x0, z0, x0, z1);       // west face
        if (!solid(x + 1, z) && x < f.cols - 1) quad(x1, z1, x1, z0); // east face
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    if (this.wallMesh) { this.group.remove(this.wallMesh); this.wallMesh.geometry.dispose(); }
    this.wallMat.side = THREE.DoubleSide;
    this.wallMesh = new THREE.Mesh(g, this.wallMat);
    this.wallMesh.frustumCulled = false;
    this.group.add(this.wallMesh);
  }

  private buildFloorAndCeiling(): void {
    const f = this.floor, pal = this.pal;
    const size = f.cols * TILE;
    const kind = f.type === 'park' ? 'grass' : f.type === 'server' ? 'metal' : f.type === 'desktop' ? 'tile' : 'carpet';
    const gt = groundTexture(f.type === 'park' ? mix(pal.ground, 0x2a8a2a, 0.55) : pal.ground, kind).clone();
    gt.needsUpdate = true;
    gt.repeat.set(size / 3, size / 3);
    this.ownTextures.push(gt);
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: gt, fog: true, color: f.type === 'chatroom' ? 0x303048 : 0xffffff }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(size / 2, 0, size / 2);
    this.group.add(floorMesh);

    if (f.type !== 'park') {
      let ct: THREE.Texture;
      if (f.ceilSolid) ct = ceilingMapTexture(f.ceilSolid, f.cols, mix(pal.wall, 0xffffff, 0.2));
      else {
        const base = ceilingTexture(f.type === 'chatroom' ? 0x08080e : mix(pal.wall, 0xffffff, 0.55)).clone();
        base.needsUpdate = true;
        base.repeat.set(size / 2.5, size / 2.5);
        this.ownTextures.push(base);
        ct = base;
      }
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: ct, fog: true }));
      ceil.rotation.x = Math.PI / 2;
      ceil.position.set(size / 2, WALL_H, size / 2);
      this.group.add(ceil);
    }
  }

  // ------------------------------------------------------------------ entities

  private face(obj: THREE.Object3D): void {
    this.facers.push({ obj });
  }

  private billboardPlane(tex: THREE.Texture, w: number, h: number, x: number, z: number, y = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true }));
    m.position.set(x, y + h / 2, z);
    this.group.add(m);
    this.face(m);
    return m;
  }

  private iconSprite(kind: string, size: number, x: number, z: number, y: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(kind), fog: true, alphaTest: 0.5 }));
    s.scale.set(size, size, 1);
    s.position.set(x, y, z);
    this.group.add(s);
    return s;
  }

  private buildEntities(): void {
    const f = this.floor, pal = this.pal;

    for (const d of f.disks) {
      const s = this.iconSprite('disk', 0.55, d.x, d.z, 0.7);
      this.entities.set(d.id, s);
      this.bob.push({ obj: s, y: 0.7, ph: Math.random() * 6 });
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0x4080ff), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      gl.scale.set(1.4, 1.4, 1); gl.position.set(d.x, 0.7, d.z); this.group.add(gl);
      this.entities.set(d.id + ':glow', gl);
    }
    for (const it of f.items) {
      const s = this.iconSprite(it.sub ?? 'battery', 0.5, it.x, it.z, 0.45);
      this.entities.set(it.id, s);
      this.bob.push({ obj: s, y: 0.45, ph: Math.random() * 6 });
    }
    for (const g of f.gifs) {
      const s = this.iconSprite('gif', 0.8, g.x, g.z, 1.2);
      s.visible = false; // hidden GIFs only show through the webcam
      this.entities.set(g.id, s);
      this.gifIds.add(g.id);
      this.spin.push(s);
    }
    for (const a of f.anomalies) {
      const s = this.iconSprite(ANOMALIES.find((x) => x.id === a.sub)?.id ?? 'smiley', 1.3, a.x, a.z, 1.0);
      this.entities.set(a.id, s);
      this.bob.push({ obj: s, y: 1.0, ph: Math.random() * 6 });
    }

    // terminal
    if (f.terminal) {
      const tx = centerOf(f.terminal.tx), tz = centerOf(f.terminal.tz);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.7), basic(0xb8b8c0, { fog: true }));
      base.position.set(tx, 0.5, tz);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.5), basic(0xd0d0d8));
      screen.position.set(tx, 1.35, tz);
      const face = this.iconSprite('terminal', 0.9, tx, tz, 1.35);
      this.group.add(base, screen);
      this.terminalGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0x30ff60), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.terminalGlow.scale.set(3, 3, 1); this.terminalGlow.position.set(tx, 1.35, tz); this.group.add(this.terminalGlow);
      void face;
    }

    // exit link: a big blue underlined hyperlink standing in the corridor
    const ex = centerOf(f.exit.tx), ez = centerOf(f.exit.tz);
    this.exitMat = new THREE.MeshBasicMaterial({ color: 0x5060ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, fog: false });
    const portal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, WALL_H - 0.2, 8, 1, true), this.exitMat);
    portal.position.set(ex, WALL_H / 2, ez);
    this.group.add(portal);
    this.spin.push(portal);
    const lt = labelTexture(f.secret ? '[ back to the maze ]' : f.type === 'guestbook' ? '[ next page ]' : '[ LOCKED ]', '#6a7aff', 'rgba(255,255,255,0.9)', 16);
    this.exitLabel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), new THREE.MeshBasicMaterial({ map: lt, transparent: true, fog: false, depthTest: false }));
    this.exitLabel.position.set(ex, 2.3, ez); this.exitLabel.renderOrder = 5;
    this.group.add(this.exitLabel);
    this.face(this.exitLabel);
    this.setExitOpen(f.type === 'guestbook');

    // entry mat
    const entryTex = labelTexture('ENTRY PAGE', '#fff', 'rgba(20,20,60,0.8)', 14);
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.7), new THREE.MeshBasicMaterial({ map: entryTex, transparent: true }));
    mat.rotation.x = -Math.PI / 2; mat.position.set(centerOf(f.entry.tx), 0.02, centerOf(f.entry.tz) + 0.9);
    this.group.add(mat);

    // hiding spots (lockers)
    for (const h of f.hides) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.8), basic(mix(pal.accent, 0x444466, 0.6), { fog: true }));
      m.position.set(h.x, 1.05, h.z);
      m.rotation.y = (h.face * Math.PI) / 2;
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.9), new THREE.MeshBasicMaterial({ map: iconTexture('locker'), transparent: true, fog: true }));
      front.position.set(0, 0, 0.41);
      m.add(front);
      this.group.add(m);
      this.entities.set(h.id, m);
    }

    // bell trees
    f.bellTrees.forEach((b, i) => {
      const mesh = this.billboardPlane(bellTreeTexture(i % 3), 1.9, 2.85, b.x, b.z);
      this.bellTrees.push({ id: b.id, x: b.x, z: b.z, mesh, ringing: 0 });
    });

    // mannequin crowds
    for (const c of f.crowds) {
      c.members.forEach((m, i) => {
        const mesh = this.billboardPlane(mannequinTexture(m.v), 0.9, 1.8, m.x, m.z);
        this.mannequins.push({ mesh, idx: i });
      });
    }

    // NPCs
    for (const n of f.npcs) {
      const sp = new CharacterSprite(n.look, n.name);
      sp.surreal = true;
      sp.group.position.set(n.x, 0, n.z);
      this.group.add(sp.group);
      this.npcs.push({ id: n.id, sprite: sp });
    }

    // vendor tent + creature
    if (f.vendor) {
      const vx = centerOf(f.vendor.tx), vz = centerOf(f.vendor.tz);
      const tex = tentTexture().clone();
      tex.needsUpdate = true; tex.repeat.set(2, 1); this.ownTextures.push(tex);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.1, 3.4, 4, 1, true), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: true }));
      tent.position.set(vx, 1.7, vz - 0.3);
      tent.rotation.y = Math.PI / 4;
      this.group.add(tent);
      const v = this.billboardPlane(vendorTexture(), 1.5, 2, vx, vz + 0.2);
      v.position.y = 1;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.6), new THREE.MeshBasicMaterial({ map: labelTexture(f.secret ? '★ SECRET ROOM: ALL FREE ★' : '~*~ SIGN MY GUESTBOOK ~*~', '#ff30c0', 'rgba(255,255,160,0.95)', 14), fog: false }));
      sign.position.set(vx, 3.7, vz + 0.4); this.group.add(sign); this.face(sign);
    }

    // chatroom: floating glowing usernames
    if (f.type === 'chatroom') {
      const rng = rngFor(f.seed, f.floor, 'chat');
      const names = ['xX_Gl1tch_Xx', 'sk8r_boi_99', 'Guest#4081', 'MIDI_Mike', 'AngelFire', 'ur_mom', 'WebMaster', 'n00b'];
      const lines = ['hi', 'asl?', 'is anyone here', 'brb', 'lol', 'you there?', 'who left the door open'];
      for (let i = 0; i < 40; i++) {
        const tx = rng.int(1, f.cols - 2), tz = rng.int(1, f.rows - 2);
        if (f.solid[tz * f.cols + tx]) continue;
        const col = rng.pick(['#40ff80', '#ff40d0', '#40d8ff', '#ffe040']);
        const t = labelTexture(`<${rng.pick(names)}> ${rng.pick(lines)}`, col, 'rgba(0,0,0,0)', 13);
        this.ownTextures.push(t);
        const w = (t.image as HTMLCanvasElement).width / 60;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.3), new THREE.MeshBasicMaterial({ map: t, transparent: true, fog: false }));
        m.position.set(centerOf(tx) + rng.range(-1, 1), rng.range(1.2, 2.6), centerOf(tz) + rng.range(-1, 1));
        this.group.add(m); this.face(m);
      }
    }
  }

  private buildProps(): void {
    const f = this.floor, pal = this.pal;
    for (const p of f.props) {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.rot;
      g.scale.setScalar(p.scale);
      const rng = new Rng(hashString(p.id + f.seed));
      switch (p.kind) {
        case 'cars':
          for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.9), basic(rng.pick([0xe03030, 0x3050e0, 0xf0d020, 0x20a050, 0xeeeeee])));
            b.position.set(rng.range(-0.15, 0.15), 0.3 + i * 0.55, rng.range(-0.1, 0.1)); b.rotation.y = rng.range(-0.3, 0.3);
            const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.8), basic(0x223344)); cab.position.set(0, 0.4, 0); b.add(cab);
            g.add(b);
          }
          break;
        case 'rocks':
          for (let i = 0; i < 4; i++) {
            const r = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.3, 0.7), 0), basic(rng.pick([0x6a6a88, 0x887a6a, 0x5a7a8a])));
            r.position.set(rng.range(-1.2, 1.2), 1.6 + rng.range(0, 1.4), rng.range(-1.2, 1.2));
            g.add(r); this.bob.push({ obj: r, y: r.position.y, ph: rng.range(0, 6) });
          }
          break;
        case 'seated': {
          const col = pal.accent;
          const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 1.0), basic(col)); torso.position.y = 2.0;
          const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), basic(0xf0d0b0)); head.position.y = 3.6;
          const legs = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2.2), basic(shade(col, 0.6))); legs.position.set(0, 0.7, 0.6);
          const faceTex = labelTexture(':|', '#000', 'rgba(240,208,176,1)', 40); this.ownTextures.push(faceTex);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: faceTex })); face.position.set(0, 3.6, 0.51);
          g.add(torso, head, legs, face); g.scale.multiplyScalar(1.3);
          break;
        }
        case 'house': {
          const grass = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 10), basic(0x3a9a3a)); grass.position.y = 0.04;
          const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), basic(0xf0e0b0)); body.position.y = 0.55;
          const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.7, 4), basic(0xc03030)); roof.position.y = 1.35; roof.rotation.y = Math.PI / 4;
          g.add(grass, body, roof);
          break;
        }
        case 'flowers':
          for (let i = 0; i < 26; i++) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture('smiley'), alphaTest: 0.5, fog: true }));
            s.scale.set(0.5, 0.5, 1); s.position.set(rng.range(-2, 2), 0.5 + rng.range(0, 0.15), rng.range(-2, 2));
            g.add(s);
          }
          break;
        case 'billboard': {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), basic(0x555560)); pole.position.y = 1.2;
          const t = labelTexture(rng.pick(['WELCOME TO MY HOMEPAGE', 'YOU ARE VISITOR #000042', 'BEST VIEWED IN NETSCAPE', 'SIGN MY GUESTBOOK!!']), '#ffff40', '#d010a0', 16);
          this.ownTextures.push(t);
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.0), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, fog: true })); panel.position.y = 2.6;
          g.add(pole, panel); this.bob.push({ obj: panel, y: 2.6, ph: rng.range(0, 6) });
          break;
        }
        case 'construction': {
          const t = labelTexture('UNDER CONSTRUCTION', '#000', '#ffcc00', 16); this.ownTextures.push(t);
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, fog: true })); panel.position.y = 1.2;
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), basic(0x886644)); post.position.y = 0.6;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 6), basic(0xff7a00)); cone.position.set(1.2, 0.3, 0.3);
          g.add(post, panel, cone);
          break;
        }
        default: { // counter
          const box = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 0.5), basic(0x111111)); box.position.y = 0.4;
          const t = labelTexture('000042', '#40ff40', '#000', 24); this.ownTextures.push(t);
          const digits = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.6), new THREE.MeshBasicMaterial({ map: t, fog: true })); digits.position.set(0, 0.4, 0.26);
          g.add(box, digits);
        }
      }
      this.group.add(g);
    }
  }

  // ------------------------------------------------------------------ dynamic state

  setExitOpen(open: boolean): void {
    this.exitMat.color.setHex(open ? 0x40ff80 : 0x5060ff);
    this.exitMat.opacity = open ? 0.55 : 0.3;
    const t = labelTexture(open ? (this.floor.secret ? '[ BACK << ]' : '[ NEXT PAGE >> ]') : '[ LOCKED ]', open ? '#0030ff' : '#808090', 'rgba(255,255,255,0.92)', 16);
    this.ownTextures.push(t);
    (this.exitLabel.material as THREE.MeshBasicMaterial).map = t;
    (this.exitLabel.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  setTaken(taken: Set<string>): void {
    for (const [id, obj] of this.entities) {
      const base = id.split(':')[0];
      if (taken.has(base) && !this.floor.hides.some((h) => h.id === base) && !this.floor.anomalies.some((a) => a.id === base)) obj.visible = false;
    }
    if (this.terminalGlow) this.terminalGlow.visible = true;
  }

  /** the mannequin monster steps out of the crowd: hide its crowd statue */
  hideMannequin(idx: number): void {
    if (idx === this.mannequinHidden) return;
    this.mannequinHidden = idx;
    for (const m of this.mannequins) m.mesh.visible = m.idx !== idx;
  }
  /** index of the crowd member closest to a point (the server picks the monster from the crowd) */
  nearestCrowdIndex(x: number, z: number): number {
    const c = this.floor.crowds[0];
    if (!c) return -1;
    let best = -1, bd = Infinity;
    c.members.forEach((m, i) => { const d = (m.x - x) ** 2 + (m.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  addGlowStick(x: number, z: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(0x40ff70), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(1.6, 1.6, 1); s.position.set(x, 0.3, z);
    this.group.add(s);
    this.glowSticks.push(s);
  }

  ringTree(id: string): void {
    const b = this.bellTrees.find((t) => t.id === id);
    if (b) b.ringing = 1.2;
  }

  npcSprite(id: string): CharacterSprite | undefined {
    return this.npcs.find((n) => n.id === id)?.sprite;
  }

  /** Update vendor arms from a snapshot. */
  setArms(arms: ASnap[]): void {
    const seen = new Set<string>();
    for (const a of arms) {
      seen.add(a.p);
      let v = this.armMeshes.get(a.p);
      if (!v) {
        const tube = new THREE.Mesh(new THREE.BufferGeometry(), basic(0xf0e2c8, { fog: true, side: THREE.DoubleSide }));
        tube.frustumCulled = false;
        const hand = new THREE.Group();
        const palm = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), basic(0xdbe8f4));
        palm.scale.set(1.2, 0.8, 1.4);
        hand.add(palm);
        const item = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture('battery'), alphaTest: 0.5 }));
        item.scale.set(0.5, 0.5, 1); item.position.y = 0.3;
        hand.add(item);
        this.armGroup.add(tube, hand);
        v = { tube, hand, item };
        this.armMeshes.set(a.p, v);
      }
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < a.t.length; i += 2) pts.push(new THREE.Vector3(a.t[i], 1.15 + 0.2 * Math.sin(i * 0.9), a.t[i + 1]));
      v.tube.geometry.dispose();
      v.tube.geometry = tubeGeometry(pts, 0.13, 5);
      const tip = pts[pts.length - 1];
      v.hand.position.copy(tip);
      (v.hand.children[0] as THREE.Mesh).material = basic(a.s === 4 ? 0xb0a090 : 0xdbe8f4);
      (v.item.material as THREE.SpriteMaterial).map = iconTexture(a.item === 'ghost' ? 'smiley' : a.item === 'sprintchip' || a.item === 'softshoes' || a.item === 'scannerrange' || a.item === 'floortip' || a.item === 'monstertip' || a.item === 'ctrlz' ? 'gif' : a.item);
      v.item.visible = a.s !== 4 && a.s !== 3;
    }
    for (const [id, v] of this.armMeshes) {
      if (!seen.has(id)) {
        this.armGroup.remove(v.tube, v.hand);
        v.tube.geometry.dispose();
        this.armMeshes.delete(id);
      }
    }
  }

  update(dt: number, camX: number, camZ: number, webcam: boolean): void {
    this.t += dt;
    for (const f of this.facers) {
      f.obj.rotation.y = Math.atan2(camX - f.obj.position.x, camZ - f.obj.position.z);
    }
    for (const b of this.bob) b.obj.position.y = b.y + Math.sin(this.t * 2 + b.ph) * 0.08;
    for (const s of this.spin) s.rotation.y += dt * 1.2;
    for (const id of this.gifIds) {
      const o = this.entities.get(id);
      if (o && !this.taken(id)) o.visible = webcam;
    }
    for (const n of this.npcs) {
      const npc = this.floor.npcs.find((q) => q.id === n.id)!;
      n.sprite.update(dt, camX, camZ, false, false, false);
      n.sprite.group.position.set(npc.x, 0, npc.z);
    }
    for (const b of this.bellTrees) {
      if (b.ringing > 0) { b.ringing -= dt; b.mesh.rotation.z = Math.sin(this.t * 40) * 0.05 * Math.min(1, b.ringing); } else b.mesh.rotation.z = 0;
    }
    if (this.terminalGlow) this.terminalGlow.material.opacity = 0.5 + Math.sin(this.t * 4) * 0.2;
  }

  private takenSet = new Set<string>();
  setTakenIds(s: Set<string>): void { this.takenSet = s; this.setTaken(s); }
  private taken(id: string): boolean { return this.takenSet.has(id); }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const t of this.ownTextures) t.dispose();
    for (const n of this.npcs) n.sprite.dispose();
  }
}

function tubeGeometry(points: THREE.Vector3[], radius: number, sides: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (points.length < 2) return g;
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dir = next.clone().sub(prev).normalize();
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
    const r = radius * (0.7 + 0.3 * (1 - i / points.length));
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(p.x + (side.x * Math.cos(a) + nrm.x * Math.sin(a)) * r, p.y + (side.y * Math.cos(a) + nrm.y * Math.sin(a)) * r, p.z + (side.z * Math.cos(a) + nrm.z * Math.sin(a)) * r);
    }
  }
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s, b = i * sides + ((s + 1) % sides), c = (i + 1) * sides + s, d = (i + 1) * sides + ((s + 1) % sides);
      idx.push(a, b, c, b, d, c);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export { hex, silhouetteTexture, ratTexture };
