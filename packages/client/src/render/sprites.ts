// Flat 2D cut-out characters, monsters and icons, drawn procedurally on canvases.
// Characters are seven separate faceted planes (head, torso, hips, two arms, two legs) that float a
// little apart, so the parts can wobble, swing and - for NPCs - come apart in surreal ways.
import * as THREE from 'three';
import { Look, LookStyle, MANNEQUIN_VARIANTS, Rng, lookStyle } from '@webmaze/shared';
import { hex, makeCanvas, shade, toTexture, labelTexture } from './textures';

type Ctx = CanvasRenderingContext2D;
const OUT = '#0a0a10';
const CREAM = '#f4f0e0';

function trace(ctx: Ctx, pts: number[][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function poly(ctx: Ctx, pts: number[][], fill: string | null, stroke = true, lw = 4): void {
  trace(ctx, pts);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

/** Run `fn` with drawing clipped to a polygon. */
function inside(ctx: Ctx, pts: number[][], fn: () => void): void {
  ctx.save(); trace(ctx, pts); ctx.clip(); fn(); ctx.restore();
}

/** Flat facet shading: a>0 darkens, a<0 lightens. */
function facet(ctx: Ctx, pts: number[][], a: number): void {
  trace(ctx, pts);
  ctx.fillStyle = a > 0 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${-a})`;
  ctx.fill();
}

/** Thin inner crease line. */
function seam(ctx: Ctx, pts: number[][], lw = 1.5): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = OUT; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
}

/** Smooth rubber-hose limb: an outlined thick curve. */
function tube(ctx: Ctx, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number, col: string): void {
  ctx.lineCap = 'round';
  for (const [lw, c] of [[w + 6, OUT], [w, col]] as [number, string][]) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.stroke();
  }
}

const HEADS: number[][][] = [
  [[34, 14], [94, 14], [116, 40], [116, 86], [94, 116], [34, 116], [12, 86], [12, 40]],
  [[18, 12], [110, 12], [114, 112], [14, 116]],
  [[30, 10], [98, 10], [118, 114], [10, 114]],
  [[64, 6], [100, 24], [114, 66], [96, 112], [64, 122], [32, 112], [14, 66], [28, 24]],
  [[14, 16], [114, 16], [118, 70], [64, 124], [10, 70]],
  [[30, 6], [100, 6], [104, 100], [84, 122], [24, 122], [24, 30]],
];

function drawEye(ctx: Ctx, x: number, y: number, kind: number, blink: boolean, dir: number): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * 1.15, 1.15);
  ctx.strokeStyle = OUT; ctx.lineCap = 'round';
  if (blink) { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-11, 2); ctx.lineTo(11, 4); ctx.stroke(); ctx.restore(); return; }
  switch (kind) {
    case 0: // sharp triangle, triangle pupil
      poly(ctx, [[-14, -8], [13, -3], [-4, 12]], '#fff', true, 3);
      poly(ctx, [[-3, -3], [8, -1], [0, 8]], OUT, false);
      break;
    case 1: // black diamond
      poly(ctx, [[-10, 0], [0, -9], [10, 0], [0, 9]], OUT, false);
      ctx.fillStyle = '#fff'; ctx.fillRect(-2, -4, 3, 3);
      break;
    case 2: // half-lidded
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 2, 13, 9, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
      ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(3, 5, 4, 0, 7); ctx.fill();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-15, 1); ctx.lineTo(15, 1); ctx.stroke();
      break;
    case 3: // shut slit with lashes
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-12, -2); ctx.quadraticCurveTo(0, 8, 12, -2); ctx.stroke();
      ctx.lineWidth = 2; for (const lx of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(lx, 3); ctx.lineTo(lx * 1.3, 9); ctx.stroke(); }
      break;
    case 4: // wide stare
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(1, 0, 3.5, 0, 7); ctx.fill();
      break;
    default: // slanted block with a heavy brow
      poly(ctx, [[-13, -4], [13, 2], [11, 12], [-11, 10]], '#fff', true, 3);
      ctx.fillStyle = OUT; ctx.fillRect(-2, 1, 6, 7);
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-15, -12); ctx.lineTo(13, -4); ctx.stroke();
  }
  ctx.restore();
}

function drawMouth(ctx: Ctx, kind: number, talking: boolean): void {
  ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.fillStyle = '#c0182a'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const y = 96;
  switch (kind) {
    case 0:
      if (talking) poly(ctx, [[46, y - 6], [82, y - 4], [78, y + 10], [50, y + 8]], '#c0182a');
      else { ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(70, y + 2); ctx.lineTo(82, y - 3); ctx.stroke(); }
      break;
    case 1: // smirk
      ctx.beginPath(); ctx.moveTo(44, y - 2); ctx.quadraticCurveTo(66, y + (talking ? 26 : 12), 86, y - 8);
      if (talking) { ctx.closePath(); ctx.fill(); } ctx.stroke();
      break;
    case 2: ctx.beginPath(); ctx.arc(64, y + 2, talking ? 11 : 5, 0, 7); if (talking) ctx.fill(); ctx.stroke(); break;
    default: { // grin with fangs
      const h = talking ? 16 : 8;
      poly(ctx, [[42, y - 4], [86, y - 4], [78, y + h], [50, y + h]], talking ? '#c0182a' : OUT, true, 3);
      for (const fx of [48, 58, 70, 80]) poly(ctx, [[fx - 4, y - 4], [fx + 4, y - 4], [fx, y + (fx === 48 || fx === 80 ? 9 : 5)]], '#fff', false);
    }
  }
}

function drawHair(ctx: Ctx, look: Look, st: LookStyle, front: boolean): void {
  const col = hex(look.hairCol), dk = hex(shade(look.hairCol, 0.7));
  const hat = hex(st.accent), hatDk = hex(shade(st.accent, 0.62));
  switch (look.hair) {
    case 0: // peaked cap over a blunt cut
      if (!front) poly(ctx, [[2, 24], [126, 24], [132, 104], [112, 118], [16, 118], [-4, 104]], col);
      else {
        poly(ctx, [[6, 40], [12, 8], [58, -12], [110, -4], [124, 38]], hat);
        inside(ctx, [[6, 40], [12, 8], [58, -12], [110, -4], [124, 38]], () => facet(ctx, [[58, -12], [110, -4], [124, 38], [70, 40]], 0.16));
        poly(ctx, [[8, 28], [122, 24], [124, 38], [6, 40]], hatDk, true, 3);
        poly(ctx, [[50, 36], [138, 26], [134, 44], [56, 50]], hatDk);
        ctx.fillStyle = CREAM; ctx.strokeStyle = OUT; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(92, 12, 7, 0, 7); ctx.fill(); ctx.stroke();
      }
      break;
    case 1: // angular bob with a notched fringe
      if (!front) poly(ctx, [[-4, 14], [132, 14], [138, 116], [118, 132], [106, 114], [22, 114], [10, 132], [-10, 116]], col);
      else poly(ctx, [[4, 16], [64, -8], [124, 16], [122, 48], [98, 34], [84, 50], [60, 32], [40, 46], [22, 34], [6, 48]], col);
      break;
    case 2: // spikes
      if (!front) poly(ctx, [[4, 30], [124, 30], [130, 92], [112, 78], [16, 78], [-2, 92]], col);
      else {
        poly(ctx, [[10, 34], [12, -8], [36, 16], [50, -18], [66, 14], [86, -14], [94, 16], [116, -6], [118, 34], [90, 26], [64, 36], [38, 26]], col);
        seam(ctx, [[50, -18], [54, 22]]); seam(ctx, [[86, -14], [84, 22]]);
      }
      break;
    case 3: // beret with a side wedge
      if (!front) poly(ctx, [[2, 24], [126, 24], [132, 100], [108, 110], [20, 110], [-4, 100]], col);
      else {
        poly(ctx, [[8, 22], [60, 14], [34, 58], [8, 52]], col);
        ctx.save(); ctx.translate(66, 12); ctx.rotate(-0.18);
        poly(ctx, [[-62, 6], [-44, -18], [0, -28], [48, -20], [64, 4], [40, 16], [-40, 18]], hat);
        inside(ctx, [[-62, 6], [-44, -18], [0, -28], [48, -20], [64, 4], [40, 16], [-40, 18]], () => facet(ctx, [[0, -28], [48, -20], [64, 4], [40, 16], [8, 18]], 0.16));
        poly(ctx, [[-5, -36], [7, -34], [2, -24]], OUT, false);
        ctx.restore();
      }
      break;
    default: // lopsided: flat top, one long side
      if (!front) poly(ctx, [[-2, 8], [130, 8], [134, 74], [112, 66], [24, 66], [18, 134], [-12, 126]], col);
      else {
        poly(ctx, [[0, 38], [6, 0], [122, 0], [128, 42], [74, 22], [26, 56]], col);
        inside(ctx, [[0, 38], [6, 0], [122, 0], [128, 42], [74, 22], [26, 56]], () => facet(ctx, [[74, 0], [122, 0], [128, 42], [74, 22]], 0.2));
      }
  }
  if (front && st.shards) {
    poly(ctx, [[104, -22], [112, -6], [98, -9]], dk, true, 2.5);
    if (st.shards > 1) poly(ctx, [[118, -12], [128, 2], [114, -1]], dk, true, 2.5);
  }
}

const HEAD_OX = 16, HEAD_OY = 24;

export function drawHead(look: Look, talking: boolean, blink: boolean): HTMLCanvasElement {
  const st = lookStyle(look);
  const [c, ctx] = makeCanvas(160, 160);
  ctx.translate(HEAD_OX, HEAD_OY);
  drawHair(ctx, look, st, false);
  const shape = HEADS[look.head % HEADS.length];
  inside(ctx, shape, () => {
    ctx.fillStyle = hex(look.faceA); ctx.fillRect(0, 0, 128, 128);
    ctx.save();
    ctx.translate(64, 64); ctx.rotate((look.split * Math.PI) / 180);
    ctx.fillStyle = hex(look.faceB); ctx.fillRect(0, -200, 300, 400);
    ctx.restore();
    facet(ctx, [[0, 92], [64, 130], [128, 92], [128, 140], [0, 140]], 0.14); // jaw
    facet(ctx, [[0, 0], [54, 0], [0, 46]], -0.14);                          // brow highlight
  });
  poly(ctx, shape, null);
  poly(ctx, [[62, 62], [73, 80], [58, 80]], hex(shade(look.faceA, 0.78)), true, 2); // nose
  drawEye(ctx, 42, 56, look.eyes, blink, 1);
  drawEye(ctx, 88, 56, st.eyes2, blink, -1);
  const acc = hex(st.accent);
  if (st.mark === 1) poly(ctx, [[30, 74], [46, 74], [38, 88]], acc, true, 2);
  else if (st.mark === 2) poly(ctx, [[86, 70], [92, 70], [91, 94], [87, 94]], acc, true, 2);
  else if (st.mark === 3) { ctx.fillStyle = OUT; for (let i = 0; i < 3; i++) ctx.fillRect(28 + i * 7, 76 + (i % 2) * 4, 4, 4); }
  drawMouth(ctx, look.mouth, talking);
  drawHair(ctx, look, st, true);
  return c;
}

const TORSO: number[][] = [[30, 10], [98, 10], [118, 38], [100, 102], [28, 102], [10, 38]];

/** Gem-cut torso: 128x112. */
export function drawBody(look: Look): HTMLCanvasElement {
  const st = lookStyle(look);
  const [c, ctx] = makeCanvas(128, 112);
  const col = hex(look.bodyCol), dk = hex(shade(look.bodyCol, 0.65)), lt = hex(shade(look.bodyCol, 1.3));
  const acc = hex(st.accent);
  let collar = CREAM;
  inside(ctx, TORSO, () => {
    ctx.fillStyle = col; ctx.fillRect(0, 0, 128, 112);
    switch (look.body) {
      case 0: // coat with lapels
        poly(ctx, [[44, 0], [64, 66], [84, 0]], CREAM, true, 3);
        poly(ctx, [[26, 4], [46, 4], [64, 66], [38, 50]], dk, true, 3);
        poly(ctx, [[102, 4], [82, 4], [64, 66], [90, 50]], dk, true, 3);
        ctx.fillStyle = OUT; for (let i = 0; i < 2; i++) ctx.fillRect(62, 74 + i * 14, 5, 5);
        collar = dk;
        break;
      case 1: // shirt and striped braces
        ctx.fillStyle = CREAM; ctx.fillRect(0, 0, 128, 112);
        for (const sx of [34, 80]) {
          poly(ctx, [[sx, 0], [sx + 14, 0], [sx + 14, 112], [sx, 112]], acc, true, 3);
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(sx + 5, 0, 4, 112);
        }
        break;
      case 2: // tunic with a centre band
        poly(ctx, [[54, 0], [74, 0], [72, 112], [56, 112]], lt, true, 3);
        ctx.fillStyle = OUT; for (let i = 0; i < 4; i++) ctx.fillRect(62, 26 + i * 18, 4, 4);
        break;
      case 3: // striped tee
        ctx.fillStyle = CREAM; for (let y = 22; y < 112; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y - 8); ctx.lineTo(128, y + 4); ctx.lineTo(0, y + 12); ctx.fill(); }
        collar = col;
        break;
      default: // pinafore
        ctx.fillStyle = CREAM; ctx.fillRect(0, 0, 128, 112);
        poly(ctx, [[36, 112], [42, 44], [86, 44], [92, 112]], dk, true, 3);
        poly(ctx, [[40, 0], [50, 0], [52, 46], [42, 46]], dk, true, 3);
        poly(ctx, [[88, 0], [78, 0], [76, 46], [86, 46]], dk, true, 3);
    }
    // facets
    facet(ctx, [[64, 38], [128, 38], [128, 112], [64, 112]], 0.2);
    facet(ctx, [[0, 38], [64, 38], [64, 112], [0, 112]], 0.07);
    facet(ctx, [[0, 0], [64, 0], [64, 38], [0, 38]], -0.1);
    seam(ctx, [[10, 38], [118, 38]]);
    seam(ctx, [[64, 38], [64, 102]], 1);
  });
  poly(ctx, TORSO, null);
  poly(ctx, [[42, 4], [64, 16], [50, 26]], collar, true, 3);
  poly(ctx, [[86, 4], [64, 16], [78, 26]], collar, true, 3);
  return c;
}

/** Hips: shorts, a flared skirt or a block. 128x80. */
export function drawBottom(look: Look): HTMLCanvasElement {
  const st = lookStyle(look);
  const [c, ctx] = makeCanvas(128, 80);
  const col = hex(st.botCol), lt = hex(shade(st.botCol, 1.5) || 0x404048);
  let shape: number[][];
  switch (st.bottom) {
    case 0:
      shape = [[22, 8], [106, 8], [122, 66], [72, 74], [64, 42], [56, 74], [6, 66]];
      poly(ctx, shape, col);
      inside(ctx, shape, () => {
        facet(ctx, [[64, 0], [128, 0], [128, 80], [64, 80]], 0.2);
        facet(ctx, [[0, 56], [128, 56], [128, 80], [0, 80]], -0.14);
        seam(ctx, [[4, 57], [124, 57]]);
        seam(ctx, [[64, 8], [64, 42]], 1);
      });
      break;
    case 1:
      shape = [[36, 6], [92, 6], [126, 62], [100, 76], [64, 66], [28, 76], [2, 62]];
      poly(ctx, shape, col);
      inside(ctx, shape, () => {
        facet(ctx, [[64, 6], [92, 6], [100, 76], [64, 66]], 0.12);
        facet(ctx, [[92, 6], [128, 62], [100, 76]], 0.26);
        facet(ctx, [[36, 6], [28, 76], [0, 62]], -0.1);
        seam(ctx, [[92, 6], [100, 76]]); seam(ctx, [[36, 6], [28, 76]]); seam(ctx, [[64, 6], [64, 66]], 1);
      });
      break;
    default:
      shape = [[26, 8], [102, 8], [114, 40], [92, 72], [36, 72], [14, 40]];
      poly(ctx, shape, col);
      inside(ctx, shape, () => {
        facet(ctx, [[64, 0], [128, 0], [128, 80], [64, 80]], 0.2);
        ctx.fillStyle = hex(st.accent); ctx.fillRect(0, 8, 128, 12);
        seam(ctx, [[18, 20], [110, 20]]);
        ctx.fillStyle = lt; ctx.fillRect(56, 8, 16, 12);
        seam(ctx, [[14, 40], [114, 40]], 1);
      });
  }
  poly(ctx, shape, null);
  return c;
}

/** One leg, 64x144, hip at the top centre. */
export function drawLeg(kind: number, skin: number, boot: number, left: boolean): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(64, 144);
  const col = hex(skin), bt = hex(boot), btLt = hex(shade(boot, 1.6));
  if (left) { ctx.translate(64, 0); ctx.scale(-1, 1); }
  const shoe = [[20, 110], [44, 110], [46, 126], [60, 132], [60, 141], [20, 141]];
  switch (kind % 3) {
    case 0: { // faceted block leg, ankle boot
      const thigh = [[18, 3], [46, 3], [43, 58], [22, 58]], shin = [[22, 58], [43, 58], [40, 114], [26, 114]];
      poly(ctx, thigh, col); poly(ctx, shin, col);
      inside(ctx, thigh, () => facet(ctx, [[36, 0], [64, 0], [64, 60], [34, 60]], 0.18));
      inside(ctx, shin, () => { facet(ctx, [[0, 58], [64, 58], [64, 120], [0, 120]], 0.12); facet(ctx, [[35, 58], [64, 58], [64, 120], [33, 120]], 0.18); });
      poly(ctx, thigh, null, true, 3); poly(ctx, shin, null, true, 3);
      poly(ctx, shoe, bt);
      inside(ctx, shoe, () => facet(ctx, [[20, 110], [46, 110], [46, 120], [20, 120]], -0.2));
      break;
    }
    case 1: // rubber-hose leg, sock and shoe
      tube(ctx, 32, 12, 26, 60, 32, 112, 17, col);
      poly(ctx, [[21, 96], [43, 96], [44, 116], [20, 116]], btLt, true, 3);
      poly(ctx, [[18, 114], [44, 114], [58, 128], [60, 141], [18, 141]], bt);
      break;
    default: { // thigh-high faceted boot
      poly(ctx, [[22, 3], [42, 3], [41, 40], [23, 40]], col, true, 3);
      const high = [[18, 34], [46, 34], [42, 124], [60, 132], [60, 141], [20, 141]];
      poly(ctx, high, bt);
      inside(ctx, high, () => {
        facet(ctx, [[0, 34], [64, 34], [64, 46], [0, 46]], -0.25);
        facet(ctx, [[34, 46], [64, 46], [64, 144], [32, 144]], 0.22);
        seam(ctx, [[18, 46], [46, 46]]); seam(ctx, [[20, 84], [44, 80]], 1);
      });
      poly(ctx, high, null);
    }
  }
  return c;
}

/** One arm, 64x128, shoulder at the top centre. `skin` is the bare colour, `sleeve` the shoulder piece. */
export function drawArm(kind: number, skin: number, sleeve: number, left: boolean): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(64, 128);
  const col = hex(skin), sc = hex(sleeve), pale = hex(shade(skin, 1.35));
  if (left) { ctx.translate(64, 0); ctx.scale(-1, 1); }
  switch (kind % 4) {
    case 0: { // faceted: shoulder cube, two segments, cut-gem fist
      const up = [[23, 24], [42, 24], [40, 64], [26, 64]], fore = [[26, 64], [40, 64], [45, 100], [23, 100]];
      poly(ctx, up, col, true, 3); poly(ctx, fore, col, true, 3);
      inside(ctx, fore, () => facet(ctx, [[0, 60], [64, 60], [64, 104], [0, 104]], 0.16));
      inside(ctx, up, () => facet(ctx, [[34, 20], [64, 20], [64, 66], [32, 66]], 0.14));
      poly(ctx, up, null, true, 3); poly(ctx, fore, null, true, 3);
      const cube = [[12, 6], [36, 2], [54, 8], [52, 28], [14, 28]];
      poly(ctx, cube, sc);
      inside(ctx, cube, () => { facet(ctx, [[36, 2], [64, 8], [64, 30], [36, 30]], 0.2); seam(ctx, [[36, 2], [36, 28]]); });
      poly(ctx, cube, null);
      const fist = [[19, 98], [46, 98], [51, 114], [36, 126], [16, 116]];
      poly(ctx, fist, pale);
      inside(ctx, fist, () => { facet(ctx, [[36, 98], [64, 98], [64, 128], [36, 128]], 0.16); seam(ctx, [[27, 104], [26, 119]], 1); seam(ctx, [[35, 104], [35, 123]], 1); seam(ctx, [[43, 104], [43, 118]], 1); });
      poly(ctx, fist, null, true, 3);
      break;
    }
    case 1: // rubber-hose arm with a mitten
      tube(ctx, 30, 12, 52, 56, 34, 100, 15, col);
      ctx.fillStyle = col; ctx.strokeStyle = OUT; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(33, 108, 13, 15, 0.2, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(48, 102, 5, 8, -0.7, 0, 7); ctx.fill(); ctx.stroke();
      break;
    case 2: // puff sleeve, thin arm, round hand
      tube(ctx, 32, 30, 28, 60, 32, 92, 11, col);
      ctx.fillStyle = sc; ctx.strokeStyle = OUT; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(32, 30, 23, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      inside(ctx, [[32, 0], [64, 0], [64, 30], [32, 30]], () => { ctx.beginPath(); ctx.arc(32, 30, 21, Math.PI, 0); ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fill(); });
      ctx.fillStyle = pale; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(32, 104, 14, 0, 7); ctx.fill(); ctx.stroke();
      seam(ctx, [[26, 102], [26, 114]], 1); seam(ctx, [[33, 100], [33, 116]], 1); seam(ctx, [[40, 102], [40, 113]], 1);
      break;
    default: { // spindly arm ending in long shard fingers
      poly(ctx, [[18, 4], [46, 4], [42, 22], [22, 22]], sc, true, 3);
      poly(ctx, [[25, 22], [39, 22], [37, 84], [28, 84]], col, true, 3);
      const claw = [[18, 82], [46, 82], [60, 122], [45, 104], [41, 127], [33, 104], [25, 127], [20, 104], [5, 120]];
      poly(ctx, claw, pale, true, 3);
      inside(ctx, claw, () => facet(ctx, [[33, 82], [64, 82], [64, 128], [33, 128]], 0.14));
      poly(ctx, claw, null, true, 3);
    }
  }
  return c;
}

/** Limb colours follow the split face: each side of the body takes one half's colour. */
function skins(look: Look): [number, number] {
  return lookStyle(look).flip ? [look.faceB, look.faceA] : [look.faceA, look.faceB];
}

// ---- figure layout (world units, feet on y = 0) ----
const PX = 205;                     // canvas pixels per world unit
const HIP_Y = 0.69, LEG_X = 0.125;
const PELVIS_Y = 0.74, TORSO_Y = 1.154;
const SHOULDER_Y = 1.33, ARM_X = 0.345;
const HEAD_Y = 1.8, HEAD_SCALE = 1.16; // big heads read better at a distance
const FIGURE_SCALE = 0.88;

interface LookCanvases { head: HTMLCanvasElement; body: HTMLCanvasElement; bottom: HTMLCanvasElement; armL: HTMLCanvasElement; armR: HTMLCanvasElement; legL: HTMLCanvasElement; legR: HTMLCanvasElement }

function lookCanvases(look: Look, talking = false, blink = false): LookCanvases {
  const st = lookStyle(look);
  const [sl, sr] = skins(look);
  return {
    head: drawHead(look, talking, blink),
    body: drawBody(look),
    bottom: drawBottom(look),
    armL: drawArm(look.armL, sl, look.armColL, true),
    armR: drawArm(look.armR, sr, look.armColR, false),
    legL: drawLeg(st.legL, sr, st.bootCol, true),   // legs cross over: opposite colour to the arm above
    legR: drawLeg(st.legR, sl, st.bootCol, false),
  };
}

const lookKey = (l: Look): string => JSON.stringify(l);
interface LookTex { head: THREE.CanvasTexture[]; body: THREE.CanvasTexture; bottom: THREE.CanvasTexture; armL: THREE.CanvasTexture; armR: THREE.CanvasTexture; legL: THREE.CanvasTexture; legR: THREE.CanvasTexture }
const lookCache = new Map<string, LookTex>();

export function lookTextures(look: Look): LookTex {
  const k = lookKey(look);
  let t = lookCache.get(k);
  if (!t) {
    const cv = lookCanvases(look);
    const tx = (c: HTMLCanvasElement): THREE.CanvasTexture => toTexture(c, false);
    t = {
      head: [tx(cv.head), tx(drawHead(look, true, false)), tx(drawHead(look, false, true))],
      body: tx(cv.body), bottom: tx(cv.bottom), armL: tx(cv.armL), armR: tx(cv.armR), legL: tx(cv.legL), legR: tx(cv.legR),
    };
    lookCache.set(k, t);
  }
  return t;
}

/** Whole figure on one canvas, struck in a pose. Used by the lobby and the dialogue screen. */
export function lookPortrait(look: Look, w = 160): HTMLCanvasElement {
  const W = 340, H = 470;
  const [c, ctx] = makeCanvas(W, H);
  const cv = lookCanvases(look);
  const pose = new Rng(look.split * 31 + look.head * 7 + look.body + 1);
  const X = (x: number): number => W / 2 + x * PX, Y = (y: number): number => H - 8 - y * PX;
  // limb: pivot at the top centre of its canvas, angle in radians (positive swings outward to +x)
  const limb = (img: HTMLCanvasElement, x: number, y: number, a: number): void => {
    ctx.save(); ctx.translate(X(x), Y(y)); ctx.rotate(-a); ctx.drawImage(img, -img.width / 2, 0); ctx.restore();
  };
  const block = (img: HTMLCanvasElement, x: number, y: number, a: number): void => {
    ctx.save(); ctx.translate(X(x), Y(y)); ctx.rotate(-a); ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore();
  };
  const lean = pose.range(-0.07, 0.07);
  limb(cv.legL, -LEG_X, HIP_Y, -pose.range(0.06, 0.3));
  limb(cv.legR, LEG_X, HIP_Y, pose.range(0.06, 0.3));
  block(cv.bottom, 0, PELVIS_Y, 0);
  block(cv.body, lean * 0.4, TORSO_Y, lean);
  // one arm thrown up or out, the other hanging
  const up = pose.chance(0.5);
  limb(cv.armL, -ARM_X, SHOULDER_Y, up ? -pose.range(2.3, 2.9) : -pose.range(0.1, 0.5));
  limb(cv.armR, ARM_X, SHOULDER_Y, up ? pose.range(0.15, 0.6) : pose.range(2.3, 2.9));
  ctx.save(); ctx.translate(X(lean), Y(HEAD_Y)); ctx.rotate(-lean * 2.2); ctx.scale(HEAD_SCALE, HEAD_SCALE);
  ctx.drawImage(cv.head, -cv.head.width / 2, -cv.head.height / 2); ctx.restore();
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

const SURREAL_MOVES = 9;
const smooth = (x: number): number => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/** A paper-doll character: seven planes that always face the camera. */
export class CharacterSprite {
  group = new THREE.Group();
  private root = new THREE.Group();
  private head = new THREE.Group();
  private torso = new THREE.Group();
  private pelvis = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private parts: { g: THREE.Group; x: number; y: number; z: number }[] = [];
  private headMat: THREE.MeshBasicMaterial;
  private tex: LookTex;
  private t = Math.random() * 10;
  private popup: THREE.Mesh | null = null;
  private tag: THREE.Mesh | null = null;
  private lying = 0;
  private ownTextures: THREE.Texture[] = [];
  wrong = false;
  /** NPCs: every few seconds, do something that a body should not do. */
  surreal = false;
  private move = -1;
  private moveT = 0;
  private moveDur = 1;
  private moveDir = 1;
  private nextMove = 1.5 + Math.random() * 5;

  constructor(public look: Look, name?: string) {
    this.tex = lookTextures(look);
    // `hang` parts pivot at the top centre of their texture (limbs); the rest pivot at their centre
    const add = (g: THREE.Group, tex: THREE.Texture, x: number, y: number, z: number, hang: boolean): THREE.MeshBasicMaterial => {
      const img = tex.image as HTMLCanvasElement;
      const mat = planeMat(tex);
      const k = g === this.head ? HEAD_SCALE : 1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry((img.width / PX) * k, (img.height / PX) * k), mat);
      if (hang) m.position.y = -img.height / PX / 2;
      g.add(m);
      g.position.set(x, y, z);
      this.parts.push({ g, x, y, z });
      this.root.add(g);
      return mat;
    };
    add(this.legL, this.tex.legL, -LEG_X, HIP_Y, -0.012, true);
    add(this.legR, this.tex.legR, LEG_X, HIP_Y, -0.01, true);
    add(this.pelvis, this.tex.bottom, 0, PELVIS_Y, 0, false);
    add(this.torso, this.tex.body, 0, TORSO_Y, 0.01, false);
    add(this.armL, this.tex.armL, -ARM_X, SHOULDER_Y, 0.02, true);
    add(this.armR, this.tex.armR, ARM_X, SHOULDER_Y, 0.022, true);
    this.headMat = add(this.head, this.tex.head[0], 0, HEAD_Y, 0.03, false);
    this.root.scale.setScalar(FIGURE_SCALE);
    this.group.add(this.root);
    if (name) {
      const tt = labelTexture(name, '#fff', 'rgba(0,0,0,0.5)', 12);
      this.ownTextures.push(tt);
      const img = tt.image as HTMLCanvasElement;
      this.tag = new THREE.Mesh(new THREE.PlaneGeometry(img.width / 70, img.height / 70), new THREE.MeshBasicMaterial({ map: tt, transparent: true, depthTest: false, fog: false }));
      this.tag.position.set(0, 2.12, 0);
      this.tag.renderOrder = 10;
      this.group.add(this.tag);
    }
  }

  showPopup(on: boolean): void {
    if (on && !this.popup) {
      const tt = popupTexture();
      this.popup = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.65), new THREE.MeshBasicMaterial({ map: tt, transparent: true, depthTest: false }));
      this.popup.position.set(0, 1.5, 0.1);
      this.popup.renderOrder = 11;
      this.group.add(this.popup);
    } else if (!on && this.popup) { this.group.remove(this.popup); this.popup = null; }
  }

  update(dt: number, camX: number, camZ: number, moving: boolean, talking: boolean, downed: boolean): void {
    this.t += dt;
    const t = this.t, g = this.group, root = this.root;
    for (const p of this.parts) { p.g.position.set(p.x, p.y, p.z); p.g.rotation.set(0, 0, 0); p.g.scale.set(1, 1, 1); }
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.setScalar(FIGURE_SCALE);

    const walk = moving ? Math.sin(t * 9) : 0;
    const wob = this.wrong ? Math.sin(t * 23) * 0.18 : 0;
    this.armL.rotation.z = (moving ? walk * 0.7 : Math.sin(t * 1.7) * 0.06) - 0.08 + wob;
    this.armR.rotation.z = (moving ? -walk * 0.7 : Math.sin(t * 1.9 + 1) * 0.06) + 0.08 - wob;
    this.legL.rotation.z = -walk * 0.45 - 0.03;
    this.legR.rotation.z = walk * 0.45 + 0.03;
    this.head.rotation.z = Math.sin(t * (moving ? 9 : 1.4)) * (moving ? 0.05 : 0.03) + (this.wrong ? Math.sin(t * 31) * 0.05 : 0);
    // the parts hover: each bobs on its own phase
    const bounce = moving ? Math.abs(walk) * 0.04 : 0;
    this.head.position.y += bounce + Math.sin(t * 1.4) * 0.014;
    this.torso.position.y += bounce * 0.6 + Math.sin(t * 1.4 + 1.1) * 0.008;
    this.torso.rotation.z = moving ? walk * 0.04 : 0;
    const blink = Math.floor(t * 2) % 7 === 0 && (t * 2) % 1 < 0.25;
    this.headMat.map = this.tex.head[talking ? (Math.floor(t * 8) % 2 ? 1 : 0) : blink ? 2 : 0];

    let spin = 0;
    if (this.surreal && !downed) spin = this.surrealStep(dt);
    const face = Math.atan2(camX - g.position.x, camZ - g.position.z) - g.rotation.y;
    root.rotation.y = face + spin;
    if (this.tag) this.tag.rotation.y = face;     // name tag and pop-up stay readable from any side
    if (this.popup) this.popup.rotation.y = face;

    // downed players lie flat
    const target = downed ? 1 : 0;
    this.lying += (target - this.lying) * Math.min(1, dt * 6);
    root.position.y -= this.lying * 0.55;
    root.rotation.x = -this.lying * 1.35;
    if (this.tag) this.tag.position.y = 2.12 - this.lying * 1.3;
  }

  /** Runs the current surreal move on top of the idle pose. Returns extra spin about the vertical axis. */
  private surrealStep(dt: number): number {
    if (this.move < 0) {
      this.nextMove -= dt;
      if (this.nextMove > 0) return 0;
      this.move = Math.floor(Math.random() * SURREAL_MOVES);
      this.moveT = 0;
      this.moveDur = 1.6 + Math.random() * 1.8;
      this.moveDir = Math.random() < 0.5 ? -1 : 1;
    }
    this.moveT += dt;
    const p = Math.min(1, this.moveT / this.moveDur);
    const hold = smooth(Math.min(p, 1 - p) * 4); // 0 -> 1, held, -> 0
    const ease = smooth(p);                       // 0 -> 1
    const d = this.moveDir, TAU = Math.PI * 2;
    const { head, torso, pelvis, armL, armR, legL, legR, root } = this;
    let spin = 0;
    switch (this.move) {
      case 0: // the head lifts off and turns a full circle
        head.position.y += 0.42 * hold;
        head.rotation.z += d * TAU * ease;
        armL.rotation.z -= 0.5 * hold; armR.rotation.z += 0.5 * hold;
        break;
      case 1: // impossible lean, one arm thrown over the head
        root.rotation.z = d * 0.62 * hold;
        (d > 0 ? armL : armR).rotation.z -= d * 2.5 * hold;
        (d > 0 ? armR : armL).rotation.z += d * 0.9 * hold;
        (d > 0 ? legR : legL).rotation.z += d * 0.55 * hold;
        head.rotation.z -= d * 0.35 * hold;
        break;
      case 2: // comes apart, hangs there, reassembles
        head.position.x += d * 0.22 * hold; head.position.y += 0.38 * hold; head.rotation.z += d * 0.4 * hold;
        torso.position.x -= d * 0.3 * hold; torso.position.y += 0.1 * hold; torso.rotation.z -= d * 0.5 * hold;
        pelvis.position.x += d * 0.24 * hold; pelvis.rotation.z += d * 0.3 * hold;
        armL.position.x -= 0.42 * hold; armL.position.y += 0.3 * hold; armL.rotation.z -= 1.3 * hold;
        armR.position.x += 0.42 * hold; armR.position.y += 0.12 * hold; armR.rotation.z += 1.9 * hold;
        legL.position.x -= 0.2 * hold; legL.rotation.z -= 0.4 * hold;
        legR.position.x += 0.26 * hold; legR.position.y += 0.12 * hold; legR.rotation.z += 0.7 * hold;
        break;
      case 3: { // stretches tall and thin, then squashes
        const s = 1 + 0.55 * Math.sin(TAU * p) * Math.sin(Math.PI * p);
        root.scale.set(FIGURE_SCALE / Math.sqrt(s), FIGURE_SCALE * s, FIGURE_SCALE);
        break;
      }
      case 4: { // one arm is a propeller, the other grows
        const a = d > 0 ? armL : armR, b = d > 0 ? armR : armL;
        a.rotation.z += d * TAU * 3 * ease;
        b.scale.y = 1 + 1.4 * hold; b.rotation.z += d * 1.2 * hold;
        head.rotation.z += d * 0.25 * hold;
        break;
      }
      case 5: { // bad signal: parts jump sideways on a stepped clock
        const k = Math.floor(this.moveT * 14);
        const n = (i: number): number => { const v = Math.sin(k * 12.9898 + i * 78.233) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
        this.parts.forEach((q, i) => { q.g.position.x += n(i) * 0.22 * hold; });
        head.position.y += n(9) * 0.1 * hold;
        if (hold > 0.5 && k % 3 === 0) root.scale.x = -FIGURE_SCALE;
        if (hold > 0.2) this.headMat.map = this.tex.head[k % 3];
        break;
      }
      case 6: // head upside down, legs in the splits
        head.rotation.z += d * Math.PI * hold;
        legL.rotation.z -= 1.25 * hold; legR.rotation.z += 1.25 * hold;
        root.position.y -= (1 - Math.cos(1.25 * hold)) * HIP_Y * FIGURE_SCALE;
        armL.rotation.z -= 1.6 * hold; armR.rotation.z += 1.6 * hold;
        break;
      case 7: // levitates and turns like a sheet of paper
        root.position.y += 0.38 * hold;
        spin = d * TAU * ease;
        legL.rotation.z += Math.sin(this.moveT * 5) * 0.25 * hold;
        legR.rotation.z += Math.sin(this.moveT * 5 + 2) * 0.25 * hold;
        armL.rotation.z -= 0.9 * hold; armR.rotation.z += 0.9 * hold;
        break;
      default: { // torso slides out and orbits the head while the hips go the other way
        const a = TAU * ease * d;
        torso.position.x += Math.sin(a) * 0.5 * hold; torso.position.y += (1 - Math.cos(a)) * 0.3 * hold; torso.rotation.z += a;
        pelvis.position.x -= Math.sin(a) * 0.3 * hold;
        head.position.y -= 0.12 * hold; head.rotation.z -= d * 0.2 * hold;
      }
    }
    if (p >= 1) { this.move = -1; this.nextMove = 2.5 + Math.random() * 7; }
    return spin;
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

const INK = '#0b0b0e', RIM = '#2c2440';

/** Many-armed trunk shared by the bell trees and the Silhouette: angular joints, long claws. */
function treeArms(ctx: Ctx, rng: Rng, w: number, h: number, pose: number, bells: boolean): void {
  const cx = w / 2, top = h * 0.36;
  ctx.lineCap = 'round'; ctx.lineJoin = 'miter'; ctx.miterLimit = 6;
  // trunk: tapered, with splayed roots and one lit facet
  const trunk = [[cx - 30, h], [cx - 13, h - 22], [cx - 9, h - 70], [cx - 6, top], [cx + 6, top], [cx + 9, h - 70], [cx + 13, h - 22], [cx + 30, h]];
  trace(ctx, trunk); ctx.fillStyle = INK; ctx.fill();
  trace(ctx, [[cx + 2, top], [cx + 6, top], [cx + 9, h - 70], [cx + 13, h - 22], [cx + 6, h - 22], [cx + 4, h - 70]]); ctx.fillStyle = RIM; ctx.fill();
  poly(ctx, [[cx - 30, h], [cx - 44, h - 5], [cx - 13, h - 22]], INK, false);
  poly(ctx, [[cx + 30, h], [cx + 46, h - 7], [cx + 13, h - 22]], INK, false);
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const side = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    const y0 = h * (0.62 - k * 0.1);
    const reach = w * (0.28 + 0.07 * (k % 2)) + Math.sin(pose * 1.7 + i) * 6;
    const lift = (k - 1.2) * 26 + Math.cos(pose * 1.3 + i * 2) * 10;
    const ex = cx + side * reach, ey = y0 - lift - 40 - rng.int(0, 10);
    // elbow kinks the wrong way on alternating arms
    const bx = cx + side * reach * (k % 2 ? 0.62 : 0.4), by = y0 - lift * 0.4 + (k % 2 ? -44 : 6) + Math.sin(pose * 2.1 + i) * 5;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9 - k; ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(bx, by); ctx.stroke();
    ctx.lineWidth = 6 - k * 0.7; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    poly(ctx, [[bx - 5, by], [bx, by - 6], [bx + 5, by], [bx, by + 6]], INK, false); // knuckle joint
    // claws
    ctx.lineWidth = 2.5;
    for (let f = -1; f <= 1; f++) {
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + side * 9, ey - 8 + f * 8); ctx.lineTo(ex + side * (15 + (f === 0 ? 5 : 0)), ey - 20 + f * 13); ctx.stroke();
    }
    if (bells) {
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex, ey + 8); ctx.stroke();
      trace(ctx, [[ex - 3, ey + 7], [ex + 3, ey + 7], [ex + 6, ey + 17], [ex - 6, ey + 17]]); ctx.fillStyle = '#e8c040'; ctx.fill();
      trace(ctx, [[ex + 1, ey + 7], [ex + 3, ey + 7], [ex + 6, ey + 17], [ex + 1, ey + 17]]); ctx.fillStyle = '#a87818'; ctx.fill();
      ctx.fillStyle = '#fff2a8'; ctx.fillRect(ex - 3, ey + 9, 2, 3);
      ctx.fillStyle = INK; ctx.fillRect(ex - 1, ey + 17, 3, 3);
    }
  }
}

/** Static bell tree, or the Silhouette when `eyes` is set. They share a silhouette on purpose. */
export function silhouetteTexture(eyes: boolean, pose: number): THREE.CanvasTexture {
  const w = 160, h = 240;
  const [c, ctx] = makeCanvas(w, h);
  const rng = new Rng(9 + pose);
  treeArms(ctx, rng, w, h, pose, !eyes);
  if (eyes) {
    // a cut-stone head, tilted, with two burning slits
    const cx = w / 2, hy = h * 0.3, tilt = pose % 2 ? 0.14 : -0.1;
    ctx.save(); ctx.translate(cx, hy); ctx.rotate(tilt);
    const head = [[-17, -22], [11, -27], [21, -3], [9, 25], [-11, 23], [-21, 0]];
    trace(ctx, head); ctx.fillStyle = INK; ctx.fill();
    trace(ctx, [[11, -27], [21, -3], [9, 25], [5, 0]]); ctx.fillStyle = RIM; ctx.fill();
    for (const sx of [-1, 1]) {
      trace(ctx, [[sx * 3, -5], [sx * 9, -10], [sx * 14, -6], [sx * 8, -1]]); ctx.fillStyle = '#ff1010'; ctx.fill();
      ctx.fillStyle = '#ffb0a0'; ctx.fillRect(sx * 8 - 1, -7, 2, 2);
    }
    ctx.restore();
  }
  return toTexture(c, false);
}

export function bellTreeTexture(variant: number): THREE.CanvasTexture {
  return silhouetteTexture(false, variant);
}

export function ratTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(96, 60);
  const fur = 0x8a8a96, pink = '#e09ab0';
  // tail: a kinked wire
  ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
  for (const [lw, col] of [[6, OUT], [3, pink]] as [number, string][]) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(80, 44); ctx.lineTo(92, 32); ctx.lineTo(85, 20); ctx.lineTo(93, 6); ctx.stroke();
  }
  poly(ctx, [[30, 28], [28, 6], [44, 18]], hex(shade(fur, 0.7)), true, 3);            // far ear
  const body = [[16, 50], [22, 30], [44, 14], [68, 16], [86, 34], [84, 52]];
  poly(ctx, body, hex(fur), true, 3);
  inside(ctx, body, () => {
    facet(ctx, [[0, 42], [96, 42], [96, 60], [0, 60]], 0.2);
    facet(ctx, [[58, 0], [96, 0], [96, 60], [66, 60]], 0.16);
    facet(ctx, [[22, 30], [44, 14], [58, 16], [40, 32]], -0.16);
    seam(ctx, [[58, 16], [66, 52]], 1);
  });
  poly(ctx, body, null, true, 3);
  poly(ctx, [[16, 50], [2, 44], [22, 30]], hex(shade(fur, 1.2)), true, 3);          // snout
  ctx.fillStyle = pink; ctx.fillRect(1, 42, 4, 4);
  poly(ctx, [[20, 30], [12, 6], [34, 20]], pink, true, 3);                           // near ear
  poly(ctx, [[18, 34], [24, 30], [29, 35], [23, 39]], '#ff2030', true, 2);          // eye
  ctx.fillStyle = '#fff'; ctx.fillRect(22, 32, 2, 2);
  poly(ctx, [[8, 49], [12, 49], [10, 55]], '#fff', true, 1.5);                       // tooth
  for (const fx of [26, 40, 62, 74]) poly(ctx, [[fx, 50], [fx + 8, 50], [fx + 5, 58], [fx - 4, 58]], hex(shade(fur, 0.55)), true, 2);
  seam(ctx, [[6, 46], [-2, 40]], 1); seam(ctx, [[6, 47], [-2, 50]], 1);             // whiskers
  return toTexture(c, false);
}

const mannCache: THREE.CanvasTexture[] = [];
/** Jointed shop dummy: every segment is its own cut block, with gaps at the joints. */
export function mannequinTexture(v: number): THREE.CanvasTexture {
  const k = v % MANNEQUIN_VARIANTS;
  if (mannCache[k]) return mannCache[k];
  const [c, ctx] = makeCanvas(96, 192);
  const g = (f: number): string => hex(shade(0xd6d6dc, f));
  const lean = (k - 2) * 3;
  // each block: fill, darken the right-hand facet, outline
  const block = (pts: number[][], f: number, split?: number): void => {
    poly(ctx, pts, g(f), false);
    const xs = pts.map((q) => q[0]), mid = split ?? (Math.min(...xs) + Math.max(...xs)) / 2 + 3;
    inside(ctx, pts, () => facet(ctx, [[mid, 0], [96, 0], [96, 192], [mid - 3, 192]], 0.17));
    poly(ctx, pts, null, true, 3);
  };
  const head = [[37 + lean, 5], [59 + lean, 5], [64 + lean, 22], [56 + lean, 37], [40 + lean, 37], [32 + lean, 22]];
  block(head, 1);
  seam(ctx, [[48 + lean, 5], [48 + lean, 37]], 1); seam(ctx, [[33 + lean, 20], [63 + lean, 20]], 1); // dress-form cross, no face
  block([[43 + lean, 38], [53 + lean, 38], [53 + lean * 0.5, 45], [43 + lean * 0.5, 45]], 0.8);
  block([[20 + lean, 46], [76 + lean, 46], [67, 86], [29, 86]], 0.94);
  block([[29, 89], [67, 89], [73, 112], [23, 112]], 0.86);
  block([[24, 115], [46, 115], [44, 147], [27, 147]], 0.84); block([[27, 150], [44, 150], [42, 180], [29, 180]], 0.8);
  block([[50, 115], [72, 115], [69, 147], [52, 147]], 0.84); block([[52, 150], [69, 150], [67, 180], [54, 180]], 0.8);
  block([[22, 181], [43, 181], [43, 189], [16, 189]], 0.7); block([[53, 181], [74, 181], [80, 189], [53, 189]], 0.7);
  const armPose = k % 3;
  // left arm: hangs, or (pose 0) bends out at the elbow
  const lx = 10 + lean, lo = armPose === 0 ? -6 : 2;
  block([[lx, 46], [lx + 12, 46], [lx + 10 + lo * 0.4, 78], [lx + lo * 0.4, 78]], 0.9);
  block([[lx + lo * 0.5, 81], [lx + 10 + lo * 0.5, 81], [lx + 8 + lo * 1.6, 112], [lx + lo * 1.6, 112]], 0.86);
  // right arm: hangs, or (pose 1) is raised as if hailing someone
  const rx = 74 + lean;
  block([[rx, 46], [rx + 12, 46], [rx + 13, 78], [rx + 3, 78]], 0.9);
  if (armPose === 1) block([[rx + 3, 76], [rx + 13, 76], [rx + 17, 46], [rx + 9, 44]], 0.86);
  else block([[rx + 3, 81], [rx + 13, 81], [rx + 11, 112], [rx + 3, 112]], 0.86);
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
    case 'phone':
      poly(ctx, [[5, 28], [8, 15], [24, 15], [27, 28]], '#2a8a2a', false); R(1, 8, 30, 5, '#1a6a1a'); R(1, 8, 7, 9, '#145014'); R(24, 8, 7, 9, '#145014');
      ctx.fillStyle = '#e8e8d0'; ctx.beginPath(); ctx.arc(16, 22, 5, 0, 7); ctx.fill(); R(15, 21, 2, 2, '#145014');
      break;
    case 'cone': R(14, 4, 4, 24, '#fa0'); ctx.fillStyle = '#fc0'; ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(30, 20); ctx.lineTo(2, 20); ctx.closePath(); ctx.fill(); R(6, 22, 20, 4, '#fa0'); break;
    case 'dolphin':
      poly(ctx, [[2, 14], [10, 9], [22, 8], [30, 3], [27, 12], [30, 20], [22, 16], [12, 22], [5, 20]], '#60a0ff', false);
      poly(ctx, [[12, 22], [22, 16], [27, 12], [22, 13], [8, 18]], '#d8ecff', false);
      poly(ctx, [[13, 9], [17, 2], [20, 8]], '#4080e0', false); poly(ctx, [[12, 21], [14, 28], [18, 19]], '#4080e0', false);
      R(7, 13, 2, 2, '#000');
      break;
    case 'envelope': R(3, 8, 26, 18, '#f4f0d8'); ctx.strokeStyle = '#a00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 8); ctx.lineTo(16, 19); ctx.lineTo(29, 8); ctx.stroke(); break;
    case 'terminal': R(3, 3, 26, 22, '#c0c0c0'); R(6, 6, 20, 14, '#111'); R(8, 9, 10, 2, '#0f0'); R(8, 13, 14, 2, '#0f0'); R(10, 26, 12, 4, '#999'); break;
    case 'locker': R(6, 2, 20, 28, '#5a6a8a'); R(8, 4, 16, 6, '#222'); R(8, 12, 16, 16, '#4a5a7a'); R(21, 18, 2, 4, '#ddd'); break;
    default: R(4, 4, 24, 24, '#f0f');
  }
  t = toTexture(outlined(c), false);
  iconCache.set(kind, t);
  return t;
}

/** Sticker treatment: a dark 2px outline around everything opaque, so pickups read against busy walls. */
function outlined(src: HTMLCanvasElement, pad = 2): HTMLCanvasElement {
  const [sil, sctx] = makeCanvas(src.width, src.height);
  sctx.drawImage(src, 0, 0);
  sctx.globalCompositeOperation = 'source-in'; sctx.fillStyle = OUT; sctx.fillRect(0, 0, src.width, src.height);
  const [c, ctx] = makeCanvas(src.width + pad * 2, src.height + pad * 2);
  for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) if (dx * dx + dy * dy <= pad * pad + 1) ctx.drawImage(sil, pad + dx, pad + dy);
  ctx.drawImage(src, pad, pad);
  return c;
}

export function vendorTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(96, 128);
  const body = [[48, 22], [84, 46], [92, 124], [4, 124], [12, 46]];
  poly(ctx, body, '#2a4ad8');
  inside(ctx, body, () => {
    facet(ctx, [[48, 22], [96, 46], [96, 128], [56, 128]], 0.2);
    facet(ctx, [[48, 22], [12, 46], [30, 60]], -0.2);
    facet(ctx, [[0, 100], [96, 100], [96, 128], [0, 128]], 0.14);
    seam(ctx, [[48, 22], [56, 124]], 1); seam(ctx, [[6, 100], [90, 100]], 1);
  });
  poly(ctx, body, null);
  // party hat
  poly(ctx, [[34, 30], [50, 0], [62, 30]], '#ffd030', true, 3);
  inside(ctx, [[34, 30], [50, 0], [62, 30]], () => { ctx.fillStyle = '#e0308a'; ctx.fillRect(30, 10, 40, 5); ctx.fillRect(30, 21, 40, 5); });
  poly(ctx, [[34, 30], [50, 0], [62, 30]], null, true, 3);
  // mismatched eyes
  ctx.strokeStyle = OUT; ctx.lineWidth = 3;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(32, 60, 13, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(35, 62, 4, 0, 7); ctx.fill();
  poly(ctx, [[52, 52], [78, 56], [62, 72]], '#fff', true, 3);
  poly(ctx, [[60, 57], [70, 59], [63, 67]], OUT, false);
  // shopkeeper grin
  const grin = [[24, 86], [72, 84], [64, 104], [34, 106]];
  poly(ctx, grin, OUT, true, 3);
  for (let i = 0; i < 5; i++) poly(ctx, [[27 + i * 9, 87], [35 + i * 9, 86.5], [31 + i * 9, 95]], '#fff', false);
  // a coin, offered
  ctx.fillStyle = '#ffd030'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(80, 106, 10, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = OUT; ctx.font = 'bold 13px monospace'; ctx.fillText('$', 76, 111);
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
