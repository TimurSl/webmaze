// Every texture is generated on a canvas at runtime (64-256 px, nearest filtering).
// That keeps the download tiny and lets each floor re-tint the same patterns from its palette.
import * as THREE from 'three';
import { Palette, Rng, WallpaperPattern } from '@webmaze/shared';

export const hex = (n: number): string => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

export function shade(n: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function toTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount: number, alpha = 0.12): void {
  for (let i = 0; i < amount; i++) {
    ctx.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), 1, 1);
  }
}

const cache = new Map<string, THREE.CanvasTexture>();
function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}
export function clearTextureCache(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

/** Wallpaper tile: patterned upper wall + wooden trim at the bottom + a thin cornice at the top. */
export function wallpaperTexture(pattern: WallpaperPattern, pal: Palette): THREE.CanvasTexture {
  return cached(`wp-${pattern}-${pal.wall}-${pal.accent}`, () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(pal.wall ^ pal.accent ^ pattern.length);
    const top = 5, trim = 14;
    ctx.fillStyle = hex(pal.wall);
    ctx.fillRect(0, 0, S, S);
    const dark = hex(shade(pal.wall, 0.78)), light = hex(shade(pal.wall, 1.15)), acc = hex(pal.accent);
    if (pattern === 'stripes') {
      for (let x = 0; x < S; x += 32) {
        ctx.fillStyle = dark; ctx.fillRect(x, top, 14, S - top - trim);
        ctx.fillStyle = acc; ctx.fillRect(x + 14, top, 2, S - top - trim);
        ctx.fillStyle = light; ctx.fillRect(x + 22, top, 3, S - top - trim);
      }
    } else if (pattern === 'swirls') {
      ctx.strokeStyle = acc; ctx.lineWidth = 3;
      for (let k = 0; k < 2; k++) {
        const ox = k * 64;
        for (let y = top + 6; y < S - trim - 6; y += 36) {
          ctx.beginPath();
          ctx.moveTo(ox + 8, y + 18);
          ctx.bezierCurveTo(ox + 8, y - 6, ox + 52, y - 6, ox + 52, y + 14);
          ctx.bezierCurveTo(ox + 52, y + 30, ox + 22, y + 30, ox + 26, y + 16);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = dark; ctx.lineWidth = 1;
      for (let x = 0; x < S; x += 64) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, S - trim); ctx.stroke(); }
    } else if (pattern === 'damask') {
      ctx.fillStyle = dark;
      for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) {
        const cx = 32 + x * 64 + (y % 2) * 32, cy = top + 16 + y * 30;
        ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx + 12, cy); ctx.lineTo(cx, cy + 14); ctx.lineTo(cx - 12, cy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = acc; ctx.fillRect(cx - 3, cy - 3, 6, 6); ctx.fillStyle = dark;
      }
    } else {
      // 'gif': a chunky repeating pixel-art wallpaper (stars + checks), like an early web background
      const cell = 16;
      for (let y = 0; y < (S - top - trim) / cell; y++) for (let x = 0; x < S / cell; x++) {
        const v = (x + y) % 2;
        ctx.fillStyle = v ? dark : light;
        ctx.fillRect(x * cell, top + y * cell, cell, cell);
        if ((x * 3 + y * 5) % 7 === 0) { ctx.fillStyle = acc; ctx.fillRect(x * cell + 5, top + y * cell + 5, 6, 6); }
      }
    }
    // cornice
    ctx.fillStyle = hex(shade(pal.accent, 0.5)); ctx.fillRect(0, 0, S, top);
    // wood trim
    ctx.fillStyle = '#6b4226'; ctx.fillRect(0, S - trim, S, trim);
    ctx.fillStyle = '#7d5230'; ctx.fillRect(0, S - trim, S, 4);
    ctx.fillStyle = '#54331c'; ctx.fillRect(0, S - 6, S, 6);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(rng.int(0, S - 12), S - trim + 6 + rng.int(0, 14), rng.int(6, 12), 1); }
    grain(ctx, S, S, rng, 500);
    return toTexture(c);
  });
}

export function groundTexture(color: number, kind: 'carpet' | 'grass' | 'tile' | 'metal' = 'carpet'): THREE.CanvasTexture {
  return cached(`ground-${color}-${kind}`, () => {
    const S = 64;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(color + kind.length);
    ctx.fillStyle = hex(color); ctx.fillRect(0, 0, S, S);
    const n = kind === 'grass' ? 700 : 450;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hex(shade(color, rng.range(0.78, 1.2)));
      const sz = rng.chance(0.15) ? 2 : 1;
      ctx.fillRect(rng.int(0, S - 1), rng.int(0, S - 1), sz, sz);
    }
    if (kind === 'tile' || kind === 'metal') {
      ctx.strokeStyle = hex(shade(color, 0.7)); ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
      if (kind === 'metal') { ctx.fillStyle = hex(shade(color, 0.6)); for (let i = 0; i < 4; i++) ctx.fillRect(4 + i * 16, 4, 2, 2); }
    }
    return toTexture(c);
  });
}

export function ceilingTexture(color: number): THREE.CanvasTexture {
  return cached(`ceil-${color}`, () => {
    const S = 64;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(color);
    ctx.fillStyle = hex(color); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) { ctx.fillStyle = hex(shade(color, rng.range(0.85, 1.05))); ctx.fillRect(rng.int(0, S - 1), rng.int(0, S - 1), 1, 1); }
    ctx.strokeStyle = hex(shade(color, 0.72)); ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, S - 2, S - 2);
    ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke();
    return toTexture(c);
  });
}

/** Desktop floor type: walls are error windows. */
export function windowTexture(pal: Palette): THREE.CanvasTexture {
  return cached(`win-${pal.accent}`, () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S, S);
    ctx.fillStyle = '#c0c0c0'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, 2); ctx.fillRect(0, 0, 2, S);
    ctx.fillStyle = '#404040'; ctx.fillRect(0, S - 2, S, 2); ctx.fillRect(S - 2, 0, 2, S);
    ctx.fillStyle = '#000080'; ctx.fillRect(4, 4, S - 8, 16);
    ctx.fillStyle = '#c0c0c0'; ctx.fillRect(S - 20, 6, 12, 12);
    ctx.fillStyle = '#000'; ctx.font = 'bold 12px monospace'; ctx.fillText('x', S - 17, 16);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px monospace'; ctx.fillText('ERROR', 8, 16);
    ctx.fillStyle = '#d00000'; ctx.beginPath(); ctx.arc(26, 52, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(24, 44, 4, 12); ctx.fillRect(24, 59, 4, 4);
    ctx.fillStyle = '#000'; ctx.font = '10px monospace';
    ctx.fillText('This page has', 46, 48); ctx.fillText('performed an', 46, 60); ctx.fillText('illegal act.', 46, 72);
    ctx.fillStyle = '#c0c0c0'; ctx.fillRect(40, 92, 48, 16);
    ctx.fillStyle = '#fff'; ctx.fillRect(40, 92, 48, 1); ctx.fillStyle = '#404040'; ctx.fillRect(40, 107, 48, 1);
    ctx.fillStyle = '#000'; ctx.fillText('OK', 56, 104);
    return toTexture(c);
  });
}

export function hedgeTexture(color: number): THREE.CanvasTexture {
  return cached(`hedge-${color}`, () => {
    const S = 64;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(color);
    ctx.fillStyle = hex(color); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 600; i++) { ctx.fillStyle = hex(shade(color, rng.range(0.6, 1.3))); ctx.fillRect(rng.int(0, S - 2), rng.int(0, S - 2), 2, 2); }
    return toTexture(c);
  });
}

export function serverTexture(): THREE.CanvasTexture {
  return cached('server', () => {
    const S = 128;
    const [c, ctx] = makeCanvas(S, S);
    const rng = new Rng(77);
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(0, 0, S, S);
    for (let y = 8; y < S - 8; y += 18) {
      ctx.fillStyle = '#16181c'; ctx.fillRect(6, y, S - 12, 14);
      for (let x = 10; x < S - 20; x += 6) { ctx.fillStyle = rng.chance(0.3) ? '#2ee860' : rng.chance(0.2) ? '#ff8030' : '#14442a'; ctx.fillRect(x, y + 5, 3, 3); }
      ctx.fillStyle = '#555a63'; ctx.fillRect(S - 24, y + 4, 14, 6);
    }
    return toTexture(c);
  });
}

/** The flip maze draws a second layout on the ceiling. */
export function ceilingMapTexture(solid: Uint8Array, cols: number, color: number): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(cols * 4, cols * 4);
  ctx.fillStyle = hex(color); ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = hex(shade(color, 0.45));
  for (let z = 0; z < cols; z++) for (let x = 0; x < cols; x++) if (solid[z * cols + x]) ctx.fillRect(x * 4, z * 4, 4, 4);
  const t = toTexture(c, false);
  return t;
}

/** Small round glow used for glowsticks, disks, etc. */
export function glowTexture(color: number): THREE.CanvasTexture {
  return cached(`glow-${color}`, () => {
    const [c, ctx] = makeCanvas(32, 32);
    const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
    g.addColorStop(0, hex(color)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
    return toTexture(c, false);
  });
}

/** Text label sprite texture (names, usernames, floating GIF billboards). */
export function labelTexture(text: string, fg = '#ffffff', bg = 'rgba(0,0,0,0.55)', size = 14): THREE.CanvasTexture {
  const [c0, ctx0] = makeCanvas(8, 8);
  ctx0.font = `bold ${size}px monospace`;
  const w = Math.ceil(ctx0.measureText(text).width) + 10;
  const [c, ctx] = makeCanvas(w, size + 8);
  ctx.font = `bold ${size}px monospace`;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, size + 8);
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, 5, (size + 8) / 2 + 1);
  return toTexture(c, false);
}
