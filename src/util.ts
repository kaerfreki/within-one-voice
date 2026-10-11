import * as THREE from 'three';

/** Seeded RNG (mulberry32). Every dream uses this, never Math.random, so a frame always renders the same. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Cheap smooth 1D value noise, deterministic. */
export function noise1(x: number, seed = 0): number {
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

const textCache = new Map<string, THREE.CanvasTexture>();

/** A white text texture on transparent, cached per string. Width-to-height ratio is in userData.aspect. */
export function textTexture(text: string, px = 160, font = '300 {px}px "Consolas", ui-monospace, monospace', tracking = 0.25): THREE.CanvasTexture {
  const key = `${text}|${px}|${font}|${tracking}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const f = font.replace('{px}', String(px));
  g.font = f;
  const spaced = text.toUpperCase().split('').join(' '.repeat(Math.round(tracking * 4)));
  const w = Math.ceil(g.measureText(spaced).width + px);
  c.width = w;
  c.height = Math.ceil(px * 1.6);
  g.font = f;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(spaced, w / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = c.width / c.height;
  textCache.set(key, tex);
  return tex;
}

/** Shared GLSL hash/noise helpers. */
export const GLSL_NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.03; a *= .5; } return v; }
`;
