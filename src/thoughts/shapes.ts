import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ravenGeometry } from '../raven';
import { rng } from '../util';

// Target clouds the particles can gather into. One RGBA float per particle: xyz position, w a kind flag
// (0 plain, 1 iris fibre that follows the pupil, 2 snare wire, 3 thrown stone).
// Particle i sits at texel (i % SIZE, i / SIZE); the left half of the texture (x < SIZE/2) is Thought (blue),
// the right half Memory (amber).

// Phones and tablets (or #low / ?low) run a quarter of the particles: 256 x 256 instead of 512 x 512
export const LOW = /(^|[?&])low\b/.test(location.search) || location.hash === '#low' || ((matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600) && location.hash !== '#high');
export const SIZE = LOW ? 256 : 512;
export const N = SIZE * SIZE;

export type ShapeName =
  | 'seed' | 'line' | 'raven' | 'worlds' | 'same' | 'flapUp' | 'flapDown'
  | 'eye' | 'eyes' | 'hill' | 'helix' | 'rooms' | 'words';

export const isThought = (i: number) => i % SIZE < SIZE / 2;

type Fill = (i: number, r: () => number, out: Float32Array) => void;

function cloud(seed: number, fill: Fill): Float32Array {
  const a = new Float32Array(N * 4);
  const r = rng(seed);
  for (let i = 0; i < N; i++) fill(i, r, a);
  return a;
}

function surfacePoints(geo: THREE.BufferGeometry, m: THREE.Matrix4, count: number, seed: number): Float32Array {
  const mesh = new THREE.Mesh(geo);
  const r = rng(seed);
  // setRandomGenerator exists in three's sampler but is missing from @types/three; seeded so the shapes never change
  const s = (new MeshSurfaceSampler(mesh) as MeshSurfaceSampler & { setRandomGenerator(f: () => number): MeshSurfaceSampler }).setRandomGenerator(r).build();
  const out = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    s.sample(p);
    p.applyMatrix4(m);
    out.set([p.x, p.y, p.z], i * 3);
  }
  return out;
}

/** A plain hooded human shape, 1.85 m, origin at the feet: the old man on the hill. */
function plainFigure(): THREE.BufferGeometry {
  const part = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) =>
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.24, 0.4, 1.5, 16, 1, true), 0, 0.75, 0),
    part(new THREE.CapsuleGeometry(0.21, 0.35, 4, 12), 0, 1.35, 0, 1.1, 1, 0.8),
    part(new THREE.SphereGeometry(0.13, 16, 12), 0, 1.72, 0, 1, 1.1, 1),
  ])!;
}

/**
 * "If I'm built, then I'm built out of every song": the swarm settles into lines of written words, the song's own
 * lyrics drifting at different depths. Drawn on a canvas and sampled, so it needs the font loaded first.
 */
export function buildWords(lines: string[], font: string): Float32Array {
  const CW = 2400;
  const CH = 1200;
  const c = document.createElement('canvas');
  c.width = CW;
  c.height = CH;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const r = rng(13);
  const placed: { y: number; depth: number }[] = [];
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  // Rows of words, larger towards the middle of the frame, each row on its own depth
  const rows = 15;
  for (let k = 0; k < rows; k++) {
    const y = ((k + 0.5) / rows) * CH;
    const centre = 1 - Math.abs(k - (rows - 1) / 2) / ((rows - 1) / 2);
    const px = Math.round(34 + centre * 34 + r() * 10);
    g.font = `italic 500 ${px}px ${font}`;
    let x = -r() * 300;
    let text = '';
    while (g.measureText(text).width < CW + 600) text += lines[Math.floor(r() * lines.length)] + '   ';
    g.textAlign = 'left';
    g.fillText(text, x, y);
    placed.push({ y, depth: (r() - 0.5) * 5 });
  }
  const img = g.getImageData(0, 0, CW, CH).data;
  const cand: number[] = [];
  for (let y = 0; y < CH; y += 2) for (let x = 0; x < CW; x += 2) if (img[(y * CW + x) * 4 + 3] > 140) cand.push(x, y);
  const out = new Float32Array(N * 4);
  const count = cand.length / 2;
  for (let i = 0; i < N; i++) {
    const j = Math.floor(r() * count);
    const x = cand[j * 2];
    const y = cand[j * 2 + 1];
    const row = Math.min(rows - 1, Math.floor((y / CH) * rows));
    // 16 x 8 units, centred, rows at their own depth with a gentle curve
    const wx = (x / CW - 0.5) * 16;
    const wy = (0.5 - y / CH) * 8;
    const wz = placed[row].depth - (wx * wx) * 0.03 + (r() - 0.5) * 0.04;
    out.set([wx + (r() - 0.5) * 0.012, wy + (r() - 0.5) * 0.012, wz, 0], i * 4);
  }
  return out;
}
const mat = (s: number, ry: number, rx: number, x: number, y: number, z: number) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(s, s, s));

/** Gaussian-ish jitter. */
const jit = (r: () => number, s: number) => (r() + r() + r() - 1.5) * s;

export function buildShapes(): Record<ShapeName, Float32Array> {
  const shapes = {} as Record<ShapeName, Float32Array>;

  // A spark: everything in one point (the very start)
  shapes.seed = cloud(1, (i, r, o) => o.set([jit(r, 0.05), jit(r, 0.05), jit(r, 0.05), 0], i * 4));

  // 'line' (kept as the name): a resting nebula of thought, clumped into soft clouds, wider than tall
  {
    const r0 = rng(21);
    const clumps = Array.from({ length: 46 }, () => ({
      c: [(r0() - 0.5) * 13, (r0() - 0.5) * 4.5, (r0() - 0.5) * 8],
      s: 0.35 + r0() * 1.3,
    }));
    shapes.line = cloud(2, (i, r, o) => {
      if (r() < 0.3) {
        o.set([jit(r, 9), jit(r, 3.2), jit(r, 6), 0], i * 4);
        return;
      }
      const k = clumps[Math.floor(r() * clumps.length)];
      o.set([k.c[0] + jit(r, k.s), k.c[1] + jit(r, k.s * 0.7), k.c[2] + jit(r, k.s), 0], i * 4);
    });
  }

  // The carved raven, three-quarter view, head towards the camera
  {
    const pts = surfacePoints(ravenGeometry(0.4, 0.6), mat(7.5, Math.PI * 0.82, 0.12, 0, 0.1, 0), N, 3);
    shapes.raven = cloud(3, (i, r, o) => o.set([pts[i * 3] + jit(r, 0.015), pts[i * 3 + 1] + jit(r, 0.015), pts[i * 3 + 2] + jit(r, 0.015), 0], i * 4));
  }

  // The giant raven of the choruses, wings up and wings down (morphed with the beat)
  {
    const up = surfacePoints(ravenGeometry(Math.PI / 2, 1), mat(11, Math.PI * 0.9, 0.25, 0, -0.5, 0), N, 4);
    const down = surfacePoints(ravenGeometry(-Math.PI / 2, 1), mat(11, Math.PI * 0.9, 0.25, 0, -0.5, 0), N, 4);
    shapes.flapUp = cloud(4, (i, r, o) => o.set([up[i * 3], up[i * 3 + 1], up[i * 3 + 2], 0], i * 4));
    shapes.flapDown = cloud(4, (i, r, o) => o.set([down[i * 3], down[i * 3 + 1], down[i * 3 + 2], 0], i * 4));
  }

  // "I have walked through a hundred worlds": a hundred small spheres on a golden spiral, receding
  {
    const r0 = rng(5);
    const worlds = Array.from({ length: 100 }, (_, k) => {
      const a = k * 2.39996;
      const d = 1.2 + Math.sqrt(k) * 1.05;
      return { c: new THREE.Vector3(Math.cos(a) * d, Math.sin(a) * d * 0.6, -k * 0.12 + 2), rad: 0.12 + r0() * 0.38 };
    });
    const total = worlds.reduce((s, w) => s + w.rad * w.rad, 0);
    const cum: number[] = [];
    let acc = 0;
    for (const w of worlds) cum.push((acc += (w.rad * w.rad) / total));
    shapes.worlds = cloud(5, (i, r, o) => {
      const u = r();
      const w = worlds[Math.max(0, cum.findIndex((c) => c >= u))];
      const z = r() * 2 - 1;
      const ph = r() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      o.set([w.c.x + Math.cos(ph) * s * w.rad, w.c.y + Math.sin(ph) * s * w.rad, w.c.z + z * w.rad, 0], i * 4);
    });
  }

  // "and it's always the same": the same small raven, 28 times over
  {
    const small = surfacePoints(ravenGeometry(0.4, 0.6), mat(1.9, Math.PI, 0.1, 0, 0, 0), 9000, 6);
    shapes.same = cloud(6, (i, r, o) => {
      const k = i % 28;
      const cx = ((k % 7) - 3) * 2.5;
      const cy = (Math.floor(k / 7) - 1.5) * 2.0;
      const j = Math.floor(r() * 9000);
      o.set([cx + small[j * 3], cy + small[j * 3 + 1], small[j * 3 + 2], 0], i * 4);
    });
  }

  // The eye of the test: an iris of radial fibres (kind 1 follows the pupil), a faint white, and a snare of wire around it
  const eye = (cx: number, cy: number, s: number, i: number, r: () => number, o: Float32Array) => {
    const u = r();
    if (u < 0.78) {
      const fibre = Math.floor(r() * 220);
      const a = (fibre / 220) * Math.PI * 2 + jit(r, 0.012);
      const rad = 0.95 + Math.pow(r(), 0.8) * 2.25;
      const wav = Math.sin(rad * 5 + fibre) * 0.03;
      o.set([cx + Math.cos(a + wav) * rad * s, cy + Math.sin(a + wav) * rad * s, (0.4 - rad * 0.08) * s + jit(r, 0.02), 1], i * 4);
    } else if (u < 0.93) {
      const a = r() * Math.PI * 2;
      const rad = 3.25 + Math.pow(r(), 2) * 1.8;
      o.set([cx + Math.cos(a) * rad * s * 1.25, cy + Math.sin(a) * rad * s * 0.62, -0.3 * s, 0], i * 4);
    } else {
      const a = r() * Math.PI * 2;
      o.set([cx + Math.cos(a) * 5.2 * s, cy + Math.sin(a) * 5.2 * s, jit(r, 0.01), 2], i * 4);
    }
  };
  shapes.eye = cloud(7, (i, r, o) => eye(0, 0, 1, i, r, o));

  // "If I copy it perfectly": the eye, five times
  shapes.eyes = cloud(8, (i, r, o) => {
    const k = i % 5;
    const c = [[0, 0, 0.75], [-6.2, 2.7, 0.42], [6.2, 2.7, 0.42], [-6.2, -2.7, 0.42], [6.2, -2.7, 0.42]][k];
    eye(c[0], c[1], c[2], i, r, o);
  });

  // The old man's hill: a long slope of dust, him at the top, and stones (kind 3) thrown at him
  {
    const man = surfacePoints(plainFigure(), mat(0.75, Math.PI + 0.5, -0.3, 1.2, 1.15, 0), 40000, 9);
    shapes.hill = cloud(9, (i, r, o) => {
      const u = r();
      if (u < 0.12) {
        const j = Math.floor(r() * 40000);
        o.set([man[j * 3], man[j * 3 + 1], man[j * 3 + 2], 0], i * 4);
      } else if (u < 0.2) {
        o.set([1.2 + jit(r, 0.2), 2.2, 0, 3], i * 4);
      } else {
        const x = (r() - 0.5) * 22;
        const z = jit(r, 1.8);
        const y = 3.3 * Math.exp(-((x - 1.2) ** 2) / 14) - 2.2 + jit(r, 0.03) - Math.abs(z) * 0.15;
        o.set([x, y, z, 0], i * 4);
      }
    });
  }

  // "a web of songs entwined": two strands braided along the line, Thought and Memory, with rungs between
  shapes.helix = cloud(10, (i, r, o) => {
    const x = (r() - 0.5) * 18;
    const a = x * 1.15 + (isThought(i) ? 0 : Math.PI);
    const env = Math.sin(((x + 9) / 18) * Math.PI);
    const rad = 0.85 * env;
    if (r() < 0.82) {
      o.set([x, Math.cos(a) * rad + jit(r, 0.03), Math.sin(a) * rad + jit(r, 0.03), 0], i * 4);
    } else {
      const k = Math.round(x * 2.2) / 2.2;
      const ak = k * 1.15;
      const v = r() * 2 - 1;
      o.set([k, Math.cos(ak) * 0.85 * env * v, Math.sin(ak) * 0.85 * env * v, 0], i * 4);
    }
  });

  // "a thousand rooms": window frames in three walls receding into the dark. ROOMS lists their centres.
  shapes.rooms = cloud(11, (i, r, o) => {
    const k = i % ROOMS.length;
    const c = ROOMS[k];
    const per = r() * 4;
    const w = c.w;
    const h = c.w * 1.25;
    let x = 0;
    let y = 0;
    if (per < 1) [x, y] = [(per - 0.5) * w, -h / 2];
    else if (per < 2) [x, y] = [w / 2, (per - 1.5) * h];
    else if (per < 3) [x, y] = [(2.5 - per) * w, h / 2];
    else [x, y] = [-w / 2, (3.5 - per) * h];
    o.set([c.x + x + jit(r, 0.01), c.y + y + jit(r, 0.01), c.z, 0], i * 4);
  });

  // 'words' is drawn from text once the subtitle font has loaded (see buildWords); until then it rests as the nebula
  shapes.words = shapes.line.slice();

  return shapes;
}

/** The thousand rooms of the choir: 3 walls of 20 x 4 windows, each wall further back and wider. */
export const ROOMS: { x: number; y: number; z: number; w: number }[] = (() => {
  const out: { x: number; y: number; z: number; w: number }[] = [];
  const walls = [0, -9, -18];
  walls.forEach((z, wi) => {
    const scale = 1 + -z / 16;
    const cols = 20;
    const rows = 4 + wi;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        // Stagger alternate walls so the windows behind show through the gaps
        const x = (col - (cols - 1) / 2 + (wi % 2) * 0.5) * 0.85 * scale;
        const y = (row - (rows - 1) / 2) * 1.3 * scale + (wi === 0 ? -0.2 : 0);
        out.push({ x, y, z, w: 0.62 * scale });
      }
  });
  return out;
})();
