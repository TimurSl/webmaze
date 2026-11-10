// Flat 2D cut-out characters, monsters and icons, drawn procedurally on canvases.
// Characters are four separate planes (head, body, left arm, right arm) so the parts can wobble apart.
import * as THREE from 'three';
import { Look, MANNEQUIN_VARIANTS, Rng } from '@webmaze/shared';
import { hex, makeCanvas, shade, toTexture, labelTexture } from './textures';

type Ctx = CanvasRenderingContext2D;
const OUT = '#0a0a10';

function poly(ctx: Ctx, pts: number[][], fill: string | null, stroke = true, lw = 4): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

const HEADS: number[][][] = [
  [[34, 14], [94, 14], [116, 40], [116, 86], [94, 116], [34, 116], [12, 86], [12, 40]],
  [[18, 12], [110, 12], [114, 112], [14, 116]],
  [[30, 10], [98, 10], [118, 114], [10, 114]],
  [[64, 6], [100, 24], [114, 66], [96, 112], [64, 122], [32, 112], [14, 66], [28, 24]],
  [[14, 16], [114, 16], [118, 70], [64, 124], [10, 70]],
  [[30, 6], [100, 6], [104, 100], [84, 122], [24, 122], [24, 30]],
];

function drawEyes(ctx: Ctx, kind: number, blink: boolean): void {
  const eyes = [[44, 56], [84, 56]];
  for (const [x, y] of eyes) {
    if (blink) { ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 10, y + 2); ctx.lineTo(x + 10, y + 2); ctx.stroke(); continue; }
    switch (kind) {
      case 0: // triangle with triangle pupil
        poly(ctx, [[x - 12, y - 8], [x + 12, y - 2], [x - 4, y + 12]], '#fff', true, 3);
        poly(ctx, [[x - 2, y - 2], [x + 8, y], [x, y + 8]], OUT, false);
        break;
      case 1: ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); break;
      case 2:
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, y, 12, 9, 0, 0, 7); ctx.fill();
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x + 2, y + 2, 4, 0, 7); ctx.fill();
        ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 14, y - 2); ctx.lineTo(x + 14, y - 2); ctx.stroke();
        break;
      case 3: ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.stroke(); break;
      case 4:
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(x + 1, y, 5, 0, 7); ctx.fill();
        break;
      default:
        poly(ctx, [[x - 12, y - 4], [x + 12, y + 2], [x + 10, y + 12], [x - 10, y + 10]], '#fff', true, 3);
        ctx.fillStyle = OUT; ctx.fillRect(x - 2, y + 1, 5, 6);
        ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 14, y - 12); ctx.lineTo(x + 12, y - 4); ctx.stroke();
    }
  }
}

function drawMouth(ctx: Ctx, kind: number, talking: boolean): void {
  ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.fillStyle = '#c0182a';
  const y = 94;
  switch (kind) {
    case 0:
      if (talking) { ctx.fillRect(48, y - 6, 32, 14); ctx.strokeRect(48, y - 6, 32, 14); } else { ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(80, y); ctx.stroke(); }
      break;
    case 1:
      ctx.beginPath(); ctx.moveTo(44, y - 4); ctx.quadraticCurveTo(64, y + (talking ? 26 : 12), 84, y - 4);
      if (talking) { ctx.closePath(); ctx.fill(); } ctx.stroke();
      break;
    case 2: ctx.beginPath(); ctx.arc(64, y + 2, talking ? 11 : 6, 0, 7); if (talking) ctx.fill(); ctx.stroke(); break;
    default:
      ctx.beginPath(); ctx.moveTo(44, y); for (let i = 1; i <= 6; i++) ctx.lineTo(44 + i * 7, y + (i % 2 ? (talking ? 12 : 5) : -2)); ctx.stroke();
  }
}

function drawHair(ctx: Ctx, look: Look, front: boolean): void {
  const col = hex(look.hairCol);
  switch (look.hair) {
    case 0: // cap with a brim
      if (front) {
        poly(ctx, [[10, 44], [20, 10], [64, -2], [108, 10], [118, 44]], col);
        poly(ctx, [[60, 38], [128, 30], [124, 54], [60, 52]], shade(look.hairCol, 0.75) | 0 ? hex(shade(look.hairCol, 0.8)) : col);
      }
      break;
    case 1: // bob
      if (!front) poly(ctx, [[6, 20], [122, 20], [124, 126], [4, 126]], col);
      else { poly(ctx, [[8, 14], [64, 0], [120, 14], [116, 40], [12, 40]], col); ctx.fillStyle = col; ctx.fillRect(6, 40, 14, 70); ctx.fillRect(108, 40, 14, 70); }
      break;
    case 2: // spikes
      if (front) poly(ctx, [[14, 30], [18, -6], [38, 18], [52, -12], [66, 16], [84, -10], [92, 18], [110, -4], [116, 30]], col);
      break;
    case 3: // beret
      if (front) {
        ctx.save(); ctx.translate(64, 18); ctx.rotate(-0.15);
        ctx.fillStyle = col; ctx.strokeStyle = OUT; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(0, 0, 58, 20, 0, 0, 7); ctx.fill(); ctx.stroke();
        poly(ctx, [[-4, -24], [6, -24], [2, -14]], OUT, false);
        ctx.restore();
      }
      break;
    default: // flat top
      if (front) poly(ctx, [[14, 34], [14, 4], [114, 4], [114, 34]], col);
  }
}

export function drawHead(look: Look, talking: boolean, blink: boolean): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 128);
  drawHair(ctx, look, false);
  const shape = HEADS[look.head % HEADS.length];
  ctx.save();
  ctx.beginPath(); shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.fillStyle = hex(look.faceA); ctx.fill();
  ctx.clip();
  ctx.translate(64, 64); ctx.rotate((look.split * Math.PI) / 180);
  ctx.fillStyle = hex(look.faceB); ctx.fillRect(0, -200, 300, 400);
  ctx.restore();
  poly(ctx, shape, null);
  drawEyes(ctx, look.eyes, blink);
  drawMouth(ctx, look.mouth, talking);
  drawHair(ctx, look, true);
  return c;
}

export function drawBody(look: Look): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 160);
  const col = hex(look.bodyCol), dk = hex(shade(look.bodyCol, 0.7)), lt = hex(shade(look.bodyCol, 1.25));
  switch (look.body) {
    case 0: // coat with lapel
      poly(ctx, [[20, 6], [108, 6], [124, 156], [4, 156]], col);
      poly(ctx, [[50, 6], [64, 70], [78, 6]], '#f4f0e0');
      poly(ctx, [[50, 6], [64, 70], [40, 70]], dk, true, 3);
      ctx.fillStyle = OUT; for (let i = 0; i < 3; i++) ctx.fillRect(62, 84 + i * 24, 5, 5);
      break;
    case 1: // overalls
      poly(ctx, [[22, 6], [106, 6], [118, 156], [10, 156]], '#f4f0e0');
      poly(ctx, [[34, 6], [46, 6], [46, 56], [90, 56], [90, 6], [102, 6], [112, 156], [16, 156]], col);
      ctx.fillStyle = lt; ctx.fillRect(52, 70, 24, 22); ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.strokeRect(52, 70, 24, 22);
      break;
    case 2: // robe
      poly(ctx, [[30, 6], [98, 6], [128, 156], [0, 156]], col);
      poly(ctx, [[56, 6], [72, 6], [72, 156], [56, 156]], lt, false);
      ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.strokeRect(56, 6, 16, 150);
      break;
    case 3: // striped tee
      poly(ctx, [[18, 6], [110, 6], [120, 156], [8, 156]], col);
      ctx.save(); ctx.beginPath(); ctx.moveTo(18, 6); ctx.lineTo(110, 6); ctx.lineTo(120, 156); ctx.lineTo(8, 156); ctx.closePath(); ctx.clip();
      ctx.fillStyle = '#f4f0e0'; for (let y = 20; y < 156; y += 28) ctx.fillRect(0, y, 128, 12);
      ctx.restore(); poly(ctx, [[18, 6], [110, 6], [120, 156], [8, 156]], null);
      break;
    default: // vest
      poly(ctx, [[24, 6], [104, 6], [116, 156], [12, 156]], dk);
      poly(ctx, [[34, 6], [60, 6], [56, 156], [20, 156]], col);
      poly(ctx, [[68, 6], [94, 6], [108, 156], [72, 156]], col);
  }
  return c;
}

export function drawArm(kind: number, colour: number, left: boolean): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(64, 128);
  const col = hex(colour);
  if (left) { ctx.translate(64, 0); ctx.scale(-1, 1); }
  switch (kind % 4) {
    case 0:
      poly(ctx, [[18, 4], [46, 4], [40, 100], [24, 100]], col);
      poly(ctx, [[20, 98], [44, 98], [50, 124], [14, 124]], '#f6e4c4');
      break;
    case 1:
      poly(ctx, [[18, 4], [46, 4], [52, 60], [34, 102], [20, 96], [30, 60]], col);
      poly(ctx, [[18, 94], [40, 98], [44, 124], [10, 120]], '#f6e4c4');
      break;
    case 2:
      poly(ctx, [[20, 4], [44, 4], [38, 84], [26, 84]], col);
      ctx.fillStyle = col; ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(32, 100, 20, 0, 7); ctx.fill(); ctx.stroke();
      break;
    default:
      poly(ctx, [[20, 4], [44, 4], [38, 92], [26, 92]], col);
      poly(ctx, [[18, 90], [46, 90], [58, 126], [40, 112], [32, 128], [24, 112], [6, 126]], '#f6e4c4');
  }
  return c;
}

const lookKey = (l: Look): string => JSON.stringify(l);
interface LookTex { head: THREE.CanvasTexture[]; body: THREE.CanvasTexture; armL: THREE.CanvasTexture; armR: THREE.CanvasTexture }
const lookCache = new Map<string, LookTex>();

export function lookTextures(look: Look): LookTex {
  const k = lookKey(look);
  let t = lookCache.get(k);
  if (!t) {
    t = {
      head: [toTexture(drawHead(look, false, false), false), toTexture(drawHead(look, true, false), false), toTexture(drawHead(look, false, true), false)],
      body: toTexture(drawBody(look), false),
      armL: toTexture(drawArm(look.armL, look.armColL, true), false),
      armR: toTexture(drawArm(look.armR, look.armColR, false), false),
    };
    if (lookCache.size > 64) { const first = lookCache.keys().next().value as string; for (const tx of [...lookCache.get(first)!.head]) tx.dispose(); lookCache.delete(first); }
    lookCache.set(k, t);
  }
  return t;
}

export function lookPortrait(look: Look, w = 160): HTMLCanvasElement {
  // used by the lobby and the dialogue screen: head + body on one canvas
  const [c, ctx] = makeCanvas(128, 260);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(drawArm(look.armL, look.armColL, true), 0, 100, 40, 80);
  ctx.drawImage(drawArm(look.armR, look.armColR, false), 88, 100, 40, 80);
  ctx.drawImage(drawBody(look), 6, 100, 116, 160);
  ctx.drawImage(drawHead(look, false, false), 0, 0, 128, 128);
  c.style.width = `${w}px`;
  return c;
}

export function headPortrait(look: Look, talking = false): HTMLCanvasElement {
  return drawHead(look, talking, false);
}

// ---------------------------------------------------------------------------

function planeMat(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
}

/** A paper-doll character: four planes that always face the camera. */
export class CharacterSprite {
  group = new THREE.Group();
  private root = new THREE.Group();
  private head: THREE.Mesh;
  private body: THREE.Mesh;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private tex: LookTex;
  private t = Math.random() * 10;
  private popup: THREE.Mesh | null = null;
  private tag: THREE.Mesh | null = null;
  private lying = 0;
  private ownTextures: THREE.Texture[] = [];
  wrong = false;

  constructor(public look: Look, name?: string) {
    this.tex = lookTextures(look);
    const hm = planeMat(this.tex.head[0]);
    this.head = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), hm);
    this.head.position.set(0, 1.36, 0.03);
    this.body = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), planeMat(this.tex.body));
    this.body.position.set(0, 0.56, 0);
    const mkArm = (g: THREE.Group, tex: THREE.Texture, x: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.6), planeMat(tex));
      m.position.set(0, -0.3, 0);
      g.add(m);
      g.position.set(x, 1.02, 0.015);
      this.root.add(g);
    };
    mkArm(this.armL, this.tex.armL, -0.42);
    mkArm(this.armR, this.tex.armR, 0.42);
    this.root.add(this.body, this.head);
    this.group.add(this.root);
    if (name) {
      const tt = labelTexture(name, '#fff', 'rgba(0,0,0,0.5)', 12);
      this.ownTextures.push(tt);
      const img = tt.image as HTMLCanvasElement;
      this.tag = new THREE.Mesh(new THREE.PlaneGeometry(img.width / 70, img.height / 70), new THREE.MeshBasicMaterial({ map: tt, transparent: true, depthTest: false, fog: false }));
      this.tag.position.set(0, 1.95, 0);
      this.tag.renderOrder = 10;
      this.group.add(this.tag);
    }
  }

  showPopup(on: boolean): void {
    if (on && !this.popup) {
      const tt = popupTexture();
      this.popup = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.65), new THREE.MeshBasicMaterial({ map: tt, transparent: true, depthTest: false }));
      this.popup.position.set(0, 1.35, 0.1);
      this.popup.renderOrder = 11;
      this.group.add(this.popup);
    } else if (!on && this.popup) { this.group.remove(this.popup); this.popup = null; }
  }

  update(dt: number, camX: number, camZ: number, moving: boolean, talking: boolean, downed: boolean): void {
    this.t += dt;
    const g = this.group;
    this.root.rotation.y = Math.atan2(camX - g.position.x, camZ - g.position.z) - g.rotation.y;
    const walk = moving ? Math.sin(this.t * 9) : 0;
    const wob = this.wrong ? Math.sin(this.t * 23) * 0.18 : 0;
    this.armL.rotation.z = (moving ? walk * 0.7 : Math.sin(this.t * 1.7) * 0.06) + 0.05 + wob;
    this.armR.rotation.z = (moving ? -walk * 0.7 : Math.sin(this.t * 1.9 + 1) * 0.06) - 0.05 - wob;
    this.head.rotation.z = Math.sin(this.t * (moving ? 9 : 1.4)) * (moving ? 0.05 : 0.03) + (this.wrong ? Math.sin(this.t * 31) * 0.05 : 0);
    this.head.position.y = 1.36 + (moving ? Math.abs(walk) * 0.04 : 0);
    const blink = Math.floor(this.t * 2) % 7 === 0 && (this.t * 2) % 1 < 0.25;
    (this.head.material as THREE.MeshBasicMaterial).map = this.tex.head[talking ? (Math.floor(this.t * 8) % 2 ? 1 : 0) : blink ? 2 : 0];
    // downed players lie flat
    const target = downed ? 1 : 0;
    this.lying += (target - this.lying) * Math.min(1, dt * 6);
    this.root.position.y = -this.lying * 0.55;
    this.root.rotation.x = -this.lying * 1.35;
    if (this.tag) this.tag.position.y = 1.95 - this.lying * 1.3;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      if (mat && mat !== undefined && !Array.isArray(mat)) mat.dispose();
    });
    for (const t of this.ownTextures) t.dispose();
  }
}

// ---------------------------------------------------------------------------
// monsters

let popupTex: THREE.CanvasTexture | null = null;
export function popupTexture(): THREE.CanvasTexture {
  if (popupTex) return popupTex;
  const [c, ctx] = makeCanvas(96, 70);
  ctx.fillStyle = '#c0c0c0'; ctx.fillRect(0, 0, 96, 70);
  ctx.fillStyle = '#000080'; ctx.fillRect(2, 2, 92, 12);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px monospace'; ctx.fillText('CONGRATULATIONS!!', 5, 11);
  ctx.fillStyle = '#d00'; ctx.fillRect(82, 4, 10, 9);
  ctx.fillStyle = '#ff0'; ctx.fillRect(6, 20, 84, 30);
  ctx.fillStyle = '#d0007f'; ctx.font = 'bold 11px monospace'; ctx.fillText('YOU ARE THE', 12, 32); ctx.fillText('1,000,000th!!', 12, 45);
  ctx.fillStyle = '#c0c0c0'; ctx.fillRect(30, 54, 36, 12); ctx.fillStyle = '#000'; ctx.font = '9px monospace'; ctx.fillText('CLICK', 38, 63);
  popupTex = toTexture(c, false);
  return popupTex;
}

function treeArms(ctx: Ctx, rng: Rng, w: number, h: number, pose: number, bells: boolean): void {
  ctx.strokeStyle = '#0b0b0e'; ctx.fillStyle = '#0b0b0e'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const cx = w / 2;
  // trunk
  ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(cx, h); ctx.lineTo(cx, h * 0.38); ctx.stroke();
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const side = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    const y0 = h * (0.62 - k * 0.1);
    const reach = w * (0.28 + 0.07 * (k % 2)) + Math.sin(pose * 1.7 + i) * 6;
    const lift = (k - 1.2) * 26 + Math.cos(pose * 1.3 + i * 2) * 10;
    ctx.lineWidth = 9 - k;
    ctx.beginPath();
    ctx.moveTo(cx, y0);
    ctx.quadraticCurveTo(cx + side * reach * 0.6, y0 - lift - 14, cx + side * reach, y0 - lift - 40 - rng.int(0, 10));
    ctx.stroke();
    const ex = cx + side * reach, ey = y0 - lift - 40;
    // fingers
    ctx.lineWidth = 3;
    for (let f = -1; f <= 1; f++) { ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + side * 12, ey - 14 + f * 10); ctx.stroke(); }
    if (bells) { ctx.fillStyle = '#e8c040'; ctx.fillRect(ex - 3, ey + 6, 6, 8); ctx.fillStyle = '#0b0b0e'; }
  }
}

/** Static bell tree, or the Silhouette when `eyes` is set. They share a silhouette on purpose. */
export function silhouetteTexture(eyes: boolean, pose: number): THREE.CanvasTexture {
  const w = 160, h = 240;
  const [c, ctx] = makeCanvas(w, h);
  const rng = new Rng(9 + pose);
  treeArms(ctx, rng, w, h, pose, !eyes);
  if (eyes) {
    // head blob + red dot eyes
    ctx.fillStyle = '#0b0b0e'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.3, 18, 24, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff1010'; ctx.fillRect(w / 2 - 9, h * 0.3 - 6, 5, 5); ctx.fillRect(w / 2 + 4, h * 0.3 - 6, 5, 5);
  }
  return toTexture(c, false);
}

export function bellTreeTexture(variant: number): THREE.CanvasTexture {
  return silhouetteTexture(false, variant);
}

export function ratTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 40);
  poly(ctx, [[8, 34], [14, 18], [34, 10], [52, 20], [58, 34]], '#8a8a96');
  poly(ctx, [[10, 20], [4, 6], [18, 14]], '#d9a0b0', true, 2);
  ctx.fillStyle = '#ff2030'; ctx.fillRect(16, 20, 4, 4);
  ctx.strokeStyle = '#d9a0b0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(58, 32); ctx.quadraticCurveTo(64, 20, 60, 10); ctx.stroke();
  return toTexture(c, false);
}

const mannCache: THREE.CanvasTexture[] = [];
export function mannequinTexture(v: number): THREE.CanvasTexture {
  const k = v % MANNEQUIN_VARIANTS;
  if (mannCache[k]) return mannCache[k];
  const [c, ctx] = makeCanvas(96, 192);
  const g = (f: number): string => hex(shade(0xd6d6dc, f));
  const lean = (k - 2) * 3;
  poly(ctx, [[34, 8], [58, 8], [62, 36], [30, 36]], g(1), true, 3);                       // head
  poly(ctx, [[18 + lean, 40], [78 + lean, 40], [72, 110], [24, 110]], g(0.92), true, 3);    // torso
  poly(ctx, [[24, 110], [72, 110], [76, 186], [50, 186], [48, 130], [46, 186], [20, 186]], g(0.82), true, 3); // legs
  const armPose = k % 3;
  poly(ctx, [[12 + lean, 42], [24 + lean, 42], [armPose === 0 ? 14 : 20, 110], [armPose === 0 ? 6 : 10, 108]], g(0.88), true, 3);
  poly(ctx, [[72 + lean, 42], [84 + lean, 42], [armPose === 1 ? 92 : 84, 108], [armPose === 1 ? 84 : 78, 110]], g(0.88), true, 3);
  mannCache[k] = toTexture(c, false);
  return mannCache[k];
}

// ---------------------------------------------------------------------------
// icons for pickups and anomalies

const iconCache = new Map<string, THREE.CanvasTexture>();
export function iconTexture(kind: string): THREE.CanvasTexture {
  let t = iconCache.get(kind);
  if (t) return t;
  const [c, ctx] = makeCanvas(32, 32);
  const R = (x: number, y: number, w: number, h: number, col: string): void => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  switch (kind) {
    case 'disk':
      R(3, 3, 26, 26, '#1a3acc'); R(8, 3, 16, 9, '#c8c8d0'); R(19, 4, 3, 6, '#222'); R(7, 17, 18, 12, '#f0f0f0'); R(9, 20, 14, 1, '#999'); R(9, 23, 14, 1, '#999');
      break;
    case 'battery': R(6, 10, 20, 16, '#ffc800'); R(8, 12, 16, 12, '#222'); R(11, 6, 4, 4, '#ccc'); R(17, 6, 4, 4, '#ccc'); R(13, 14, 6, 8, '#ffc800'); break;
    case 'glowsticks': for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(16, 16); ctx.rotate(-0.5 + i * 0.5); R(-2, -13, 4, 26, ['#40ff60', '#ff40d0', '#40d8ff'][i]); ctx.restore(); } break;
    case 'radio': R(3, 10, 26, 16, '#6a4a2a'); R(6, 13, 12, 10, '#222'); ctx.fillStyle = '#c0c0c0'; ctx.beginPath(); ctx.arc(23, 18, 4, 0, 7); ctx.fill(); R(20, 2, 2, 8, '#ccc'); break;
    case 'gif': {
      const cols = ['#ff30a0', '#30ff60', '#30c0ff', '#ffe030'];
      for (let i = 0; i < 4; i++) { ctx.fillStyle = cols[i]; ctx.save(); ctx.translate(16, 16); ctx.rotate(i * 0.8); ctx.fillRect(-12, -3, 24, 6); ctx.restore(); }
      break;
    }
    case 'smiley': ctx.fillStyle = '#ffe030'; ctx.beginPath(); ctx.arc(16, 16, 13, 0, 7); ctx.fill(); R(10, 11, 4, 5, '#000'); R(19, 11, 4, 5, '#000'); R(9, 20, 14, 3, '#000'); R(11, 23, 10, 2, '#000'); break;
    case 'clock': ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(16, 16, 13, 0, 7); ctx.fill(); R(15, 6, 2, 11, '#000'); R(15, 15, 9, 2, '#d00'); break;
    case 'cursor': ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(8, 3); ctx.lineTo(8, 26); ctx.lineTo(14, 20); ctx.lineTo(19, 29); ctx.lineTo(22, 27); ctx.lineTo(17, 18); ctx.lineTo(25, 18); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'counter': R(2, 9, 28, 14, '#000'); for (let i = 0; i < 6; i++) R(4 + i * 4.5, 11, 3.5, 10, i > 3 ? '#ff4' : '#0f0'); break;
    case 'phone': R(4, 18, 24, 10, '#2a8a2a'); R(6, 12, 20, 6, '#1a6a1a'); R(2, 12, 6, 4, '#145014'); R(24, 12, 6, 4, '#145014'); break;
    case 'cone': R(14, 4, 4, 24, '#fa0'); ctx.fillStyle = '#fc0'; ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(30, 20); ctx.lineTo(2, 20); ctx.closePath(); ctx.fill(); R(6, 22, 20, 4, '#fa0'); break;
    case 'dolphin': ctx.fillStyle = '#60a0ff'; ctx.beginPath(); ctx.ellipse(16, 18, 13, 7, -0.3, 0, 7); ctx.fill(); R(6, 6, 4, 8, '#4080e0'); break;
    case 'envelope': R(3, 8, 26, 18, '#f4f0d8'); ctx.strokeStyle = '#a00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 8); ctx.lineTo(16, 19); ctx.lineTo(29, 8); ctx.stroke(); break;
    case 'terminal': R(3, 3, 26, 22, '#c0c0c0'); R(6, 6, 20, 14, '#111'); R(8, 9, 10, 2, '#0f0'); R(8, 13, 14, 2, '#0f0'); R(10, 26, 12, 4, '#999'); break;
    case 'locker': R(6, 2, 20, 28, '#5a6a8a'); R(8, 4, 16, 6, '#222'); R(8, 12, 16, 16, '#4a5a7a'); R(21, 18, 2, 4, '#ddd'); break;
    default: R(4, 4, 24, 24, '#f0f');
  }
  t = toTexture(c, false);
  iconCache.set(kind, t);
  return t;
}

export function vendorTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(96, 128);
  poly(ctx, [[48, 6], [86, 40], [92, 124], [4, 124], [10, 40]], '#2a4ad8', true, 4);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(34, 52, 12, 0, 7); ctx.arc(62, 52, 12, 0, 7); ctx.fill();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(36, 54, 5, 0, 7); ctx.arc(60, 54, 5, 0, 7); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(30, 90); ctx.quadraticCurveTo(48, 110, 68, 88); ctx.stroke();
  return toTexture(c, false);
}

export function tentTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#8a30c8' : '#f0c020';
    ctx.beginPath(); ctx.moveTo(x * 16 + 8, y * 16); ctx.lineTo(x * 16 + 16, y * 16 + 8); ctx.lineTo(x * 16 + 8, y * 16 + 16); ctx.lineTo(x * 16, y * 16 + 8); ctx.closePath(); ctx.fill();
  }
  return toTexture(c);
}
