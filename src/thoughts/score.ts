import { BRIDGE, CUE } from '../timeline';
import type { ShapeName } from './shapes';

// The score: what the swarm of thoughts does over the song. All times are song seconds.
//
// POSES: the shape the particles gather into (blended over `dur`, each particle on its own delay).
// KEYS: every other control, eased to its new value over `ease` seconds from `t`. Unlisted controls keep their value.

export interface Pose {
  t: number;
  shape: ShapeName;
  dur: number;
  /** Morph to flapDown with the wingbeat while this pose holds */
  flap?: boolean;
}

export const POSES: Pose[] = [
  // Hook: the first frame is already the giant raven, beating its wings; it dissolves into smoke as the music arrives
  { t: 0, shape: 'flapUp', dur: 0.01, flap: true },
  { t: 5.0, shape: 'line', dur: 8 },
  { t: CUE.carving - 0.8, shape: 'raven', dur: 4.5 },
  { t: CUE.bandLift - 0.2, shape: 'worlds', dur: 3 },
  { t: CUE.village, shape: 'same', dur: 3 },
  // Chorus 1 is a flock (spring off); the giant raven forms on "if the feathers are wire"
  { t: 81.0, shape: 'flapUp', dur: 2.6, flap: true },
  { t: 110.6, shape: 'eye', dur: 2.8 },
  { t: CUE.copy - 0.2, shape: 'eyes', dur: 1.4 },
  { t: CUE.oldMan - 0.3, shape: 'hill', dur: 2.0 },
  { t: 150.6, shape: 'flapUp', dur: 2.6, flap: true },
  { t: 170.5, shape: 'line', dur: 3.5 },
  { t: BRIDGE.stanza[1].t - 0.6, shape: 'helix', dur: 3.5 },
  { t: BRIDGE.stanza[3].t - 0.2, shape: 'line', dur: 3.2 },
  { t: BRIDGE.choir.t - 0.8, shape: 'rooms', dur: 3.2 },
  { t: BRIDGE.question.t - 2.0, shape: 'line', dur: 2.5 },
  { t: CUE.built - 0.6, shape: 'words', dur: 3.5 },
  { t: 266.0, shape: 'flapUp', dur: 2.4, flap: true },
  // Outro: everything settles back into a quiet nebula, then goes dark
  { t: 286.0, shape: 'line', dur: 7 },
];

export interface Controls {
  k: number; // spring towards the pose
  flow: number; // curl-noise drift
  flowScale: number;
  flowSpeed: number;
  drag: number;
  flock: number; // pull towards the two leaders
  split: number; // how far apart Thought and Memory fly
  flockR: number; // size of each flock
  swirl: number;
  rise: number;
  lineW: number; // pull onto the line of the voice
  emit: number; // particles die and are born again on the line (0 = off)
  emitV: number;
  spinX: number; // rotation around the line (the braid)
  stones: number;
  quant: number; // "a fake": snaps positions to a grid
  electric: number; // the memory flickers blue
  pupil: number;
  snare: number; // the wire closing in
  dawn: number;
  size: number;
  bright: number;
  decay: number; // trail feedback
  zoom: number;
  spin: number;
  driftY: number;
  warp: number;
  exposure: number;
  lineA: number; // the voice line
  lineAmp: number;
  lineSrc: number; // 0 = the mix, 1 = the lead vocal
  choir: number; // the thousand singing lines
  camR: number;
  camH: number;
  camAz: number; // degrees
  camAzSpeed: number; // degrees per second
  camLock: number; // pull the orbit back to camAz (0 = free orbit)
  lookY: number;
  fov: number;
}

type Key = { t: number; ease: number } & Partial<Controls>;

const START: Controls = {
  k: 0, flow: 0, flowScale: 0.25, flowSpeed: 0.05, drag: 1.6, flock: 0, split: 4, flockR: 1.2, swirl: 0, rise: 0,
  lineW: 0, emit: 0, emitV: 0.4, spinX: 0, stones: 0, quant: 0, electric: 0, pupil: 1, snare: 1, dawn: 0,
  size: 1, bright: 0, decay: 0.88, zoom: 1, spin: 0, driftY: 0, warp: 0, exposure: 1,
  lineA: 0, lineAmp: 0.35, lineSrc: 0, choir: 0,
  camR: 10.5, camH: 0, camAz: 0, camAzSpeed: 0, camLock: 1, lookY: 0, fov: 35,
};

const C = CUE;
const S = BRIDGE.stanza;

export const KEYS: Key[] = [
  // ---- Intro: one spark, then the line of the voice wakes and the first thoughts leak off it
  { t: 0, ease: 0.01, k: 3, flow: 0.18, flowScale: 0.6, bright: 1.1, camR: 17, camH: 1, camAzSpeed: 7, camLock: 0, decay: 0.93, spin: 0.002 },
  { t: 4.6, ease: 3, k: 0.3, flow: 0.7, bright: 0.6, size: 0.9, camR: 12, camAzSpeed: 1.5, spin: 0 },
  { t: 6, ease: 8, k: 1.2, flow: 0.15, decay: 0.9 },
  { t: 13, ease: 7, flow: 0.45, k: 0.25, lineW: 0.6, warp: 0.2, camAzSpeed: 0.8, camLock: 0, camR: 11 },

  // ---- Verse 1: thoughts rise off the voice like smoke, and a raven is carved out of them
  { t: 20.4, ease: 2, lineSrc: 1, lineAmp: 0.55, emit: 0.35, emitV: 0.5, flow: 0.8, flowScale: 0.35, k: 0, lineW: 0.2, bright: 0.45, decay: 0.93 },
  { t: C.carving - 0.8, ease: 4, emit: 0, k: 2.2, flow: 0.25, lineA: 0.45, camR: 13, camAzSpeed: 2.2, camH: 1.5, lookY: 0.4, bright: 0.55 },
  { t: C.whoseHands, ease: 0.4, electric: 1, quant: 0.0 },
  { t: C.howOld - 0.6, ease: 0.8, electric: 0, k: 0.4, flow: 1.4 },
  { t: C.bandLift, ease: 2.5, k: 1.6, flow: 0.3, camR: 17, camH: 3, lookY: 0, camAzSpeed: 3, decay: 0.95, bright: 0.6, zoom: 1.001 },
  { t: C.village, ease: 2.5, k: 3.5, flow: 0.15, camR: 16, camH: 0.5, camAzSpeed: 0.6, camAz: 8, decay: 0.9 },
  { t: C.answer, ease: 0.3, k: 8, flow: 0.0, electric: 0.35 },
  { t: C.answer + 1.2, ease: 2, electric: 0 },
  { t: 63.4, ease: 2, k: 0, flow: 1.0, emit: 0, decay: 0.95 },

  // ---- Chorus 1: Thought and Memory as two flocks, trailing light; on "feathers are wire" they become one giant raven
  { t: 65.0, ease: 2.5, flock: 1, split: 4.5, flockR: 3, swirl: 0.8, flow: 0.35, flowScale: 0.4, drag: 1.1, decay: 0.94, zoom: 1.0015, spin: 0.002, bright: 1.1,
    lineA: 0.2, lineAmp: 0.4, camR: 13, camH: 1.5, camAzSpeed: 5, lookY: 0, size: 1.1 },
  { t: 77.06, ease: 2, split: 6.5, flockR: 3.6 },
  { t: 81.0, ease: 2.6, flock: 0, k: 2.8, flow: 0.15, swirl: 0, camR: 17, camAzSpeed: 1.5, decay: 0.93, bright: 1.2, spin: 0 },
  { t: 86.6, ease: 1.2, k: 0, flock: 1, split: 5, flow: 0.4, swirl: 1.2, decay: 0.965, zoom: 1.003, spin: 0.003, camAzSpeed: 6, camR: 13 },
  { t: 97.4, ease: 1.5, split: 7, flockR: 4, swirl: 1.6 },
  { t: 103, ease: 4, split: 3, flockR: 2.5, swirl: 0.6, zoom: 1.001, spin: 0.001, camAzSpeed: 3 },

  // ---- Verse 2: the eye of the test; the snare closes; the eye is copied; the old man and the stones
  { t: 110.2, ease: 2.8, flock: 0, k: 3, flow: 0.08, swirl: 0, decay: 0.86, zoom: 1, spin: 0, lineA: 0.15, camR: 14, camH: 0, camAz: 0, camAzSpeed: 0, camLock: 1, bright: 0.8, size: 0.9 },
  { t: C.wolf, ease: 2.6, snare: 0.62 },
  { t: C.kneel, ease: 1.5, snare: 0.8, flow: 0.25 },
  { t: C.copy - 0.2, ease: 1.2, camR: 19, flow: 0.08 },
  { t: C.oldMan - 0.3, ease: 2, k: 2.2, stones: 1, bright: 0.95, camR: 15, camH: 1.2, lookY: 0.6, camAzSpeed: 0.8, camLock: 0, decay: 0.9 },
  { t: C.fake, ease: 0.2, quant: 1, electric: 0.6 },
  { t: C.fakeEnd, ease: 0.6, quant: 0, electric: 0 },
  { t: C.heart - 0.2, ease: 0.6, stones: 0, k: 0, flow: 1.6, decay: 0.95 },

  // ---- Chorus 2: the flocks again, bigger and braided around each other
  { t: 134.8, ease: 2.5, flock: 1, split: 5, flockR: 3.4, swirl: 1.4, flow: 0.4, drag: 1.0, decay: 0.965, zoom: 1.002, spin: -0.0025, bright: 1.15, stones: 0,
    lineA: 0.2, camR: 14, camH: -1.5, camAzSpeed: -5, lookY: 0 },
  { t: 146.0, ease: 2, split: 7, flockR: 4 },
  { t: 150.6, ease: 2.6, flock: 0, k: 2.8, flow: 0.15, swirl: 0, camR: 17, camAzSpeed: -1.5, decay: 0.93, spin: 0, bright: 1.2 },
  { t: 155.7, ease: 1.2, k: 0, flock: 1, split: 6, flow: 0.45, swirl: 1.6, decay: 0.97, zoom: 1.003, spin: -0.003, camAzSpeed: -6, camR: 14 },
  { t: 166.8, ease: 1.5, split: 8, flockR: 4.5 },
  // Energy drains before the bridge
  { t: 168.5, ease: 3.5, bright: 0.25, flow: 0.15, decay: 0.9, zoom: 1, spin: 0, swirl: 0.2 },

  // ---- Bridge: the line of the voice, the spoken stanza. The web, the braid, one voice. Then a thousand rooms singing.
  { t: 170.5, ease: 3.5, flock: 0, k: 1.5, flow: 0.04, lineA: 1, lineAmp: 0.5, lineSrc: 1, bright: 0.4, size: 0.8,
    camR: 10.5, camH: 0, camAz: 0, camAzSpeed: 0, camLock: 1, lookY: 0, decay: 0.84, warp: 0 },
  { t: S[0].t, ease: S[0].end - S[0].t, flow: 0.18, warp: 0.15 },
  { t: S[1].t - 0.6, ease: 3.5, k: 2.2, flow: 0.04, bright: 0.4, camR: 11.5, camAz: -18 },
  { t: S[2].t, ease: 2, spinX: 0.9 },
  { t: S[3].t - 0.2, ease: 3.2, spinX: 0, k: 2.5, bright: 0.4, camR: 10.5, camAz: 0 },
  { t: BRIDGE.choir.t - 0.8, ease: 3.2, choir: 1, k: 3, bright: 0.3, camR: 17, camH: 1, decay: 0.9, size: 0.6 },
  { t: BRIDGE.choir.end, ease: 2.5, choir: 0, bright: 0.08 },
  { t: BRIDGE.question.t - 2.0, ease: 2.5, lineA: 0.35, camR: 10.5, camH: 0, size: 0.6 },
  { t: BRIDGE.question.end, ease: 1.2, k: 6, lineA: 0.8, bright: 0.3 },

  // ---- Breakdown: the names pour up out of the voice; Azri is made of them; then they all go up
  { t: 215.0, ease: 0.6, k: 0, emit: 1, emitV: 2.2, rise: 1.6, flow: 0.7, flowScale: 0.3, drag: 0.7, bright: 1.2, size: 0.9, decay: 0.94, zoom: 1.0015,
    lineA: 0.7, lineAmp: 0.6, camR: 16, camH: 1, lookY: 2.5, camAzSpeed: 2, camLock: 0 },
  { t: C.built - 0.6, ease: 3.5, emit: 0, rise: 0, drag: 4.5, k: 2.5, flow: 0.2, lookY: 0, camR: 12.5, camH: 0, camAz: 0, camAzSpeed: 0, camLock: 1, lineA: 0.3, bright: 1.1, decay: 0.84, zoom: 1, spin: 0, size: 0.75 },
  { t: C.songsReal, ease: 1.5, k: 6, bright: 1.4, flow: 0.03, decay: 0.8 },
  { t: C.songsLiveOn, ease: 1.2, k: 0, drag: 0.7, camLock: 0, camAzSpeed: 1.2, rise: 3.2, flow: 1.1, emit: 0.25, emitV: 3, bright: 1.6, decay: 0.965, zoom: 1.003, size: 0.9, lookY: 4, camH: -1 },
  { t: C.songsLiveOnEnd, ease: 3, rise: 0.4, bright: 0.6, emit: 0, lookY: 0, camH: 0 },

  // ---- Final chorus: the flocks, the giant raven, then dawn on "let them fly" and they go
  { t: 247.4, ease: 2.5, rise: 0, flock: 1, split: 5, flockR: 3.6, swirl: 1.4, flow: 0.4, drag: 1.0, decay: 0.965, zoom: 1.002, spin: 0.0025, bright: 1.2,
    lineA: 0.2, camR: 12, camH: 1, camAzSpeed: 4, lookY: 0 },
  { t: C.thoughtFinal, ease: 2, split: 7, flockR: 4.2 },
  { t: 266.0, ease: 2.4, flock: 0, k: 3, flow: 0.15, swirl: 0, camAzSpeed: 1, camR: 17, spin: 0, decay: 0.94, bright: 1.3 },
  { t: C.letThemFly1 - 0.2, ease: 3.2, dawn: 1 },
  { t: C.letThemFly1, ease: 1.6, k: 0, flock: 1, split: 4, flockR: 7, swirl: 2.2, flow: 0.6, drag: 0.8, decay: 0.965, zoom: 1.005, spin: 0.004, bright: 1.8, camAzSpeed: 8, camR: 11 },
  { t: C.letThemFly2, ease: 1.2, flock: 0.4, flockR: 10, rise: 0.8, flow: 1.6, zoom: 1.009, decay: 0.97, bright: 2 },
  { t: 287.0, ease: 5, flock: 0, k: 0.8, bright: 0.3, zoom: 1.001, spin: 0, rise: 0.2, flow: 0.25, decay: 0.92, dawn: 0, camAzSpeed: 1 },

  // ---- Outro: one line, steady and warm, then dark
  { t: 287.5, ease: 4, lineA: 0.9, lineSrc: 0.6, lineAmp: 0.4, camR: 10.5, camH: 0, lookY: 0, camAzSpeed: 0, camAz: 0, camLock: 1 },
  { t: 297.0, ease: 5.5, lineA: 0, bright: 0 },
];

// Resolve the keys into piecewise eases per control
type Track = { t: number; ease: number; from: number; to: number }[];
const TRACKS = {} as Record<keyof Controls, Track>;
for (const name of Object.keys(START) as (keyof Controls)[]) {
  const tr: Track = [];
  let cur = START[name];
  for (const k of KEYS) {
    const v = k[name];
    if (v === undefined) continue;
    // Value at the moment this key starts, given the previous segment may still be easing
    const prev = tr[tr.length - 1];
    const from = prev ? prev.from + (prev.to - prev.from) * ease01((k.t - prev.t) / prev.ease) : cur;
    tr.push({ t: k.t, ease: k.ease, from, to: v });
    cur = v;
  }
  TRACKS[name] = tr;
}

function ease01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export function controlsAt(t: number): Controls {
  const out = { ...START };
  for (const name of Object.keys(TRACKS) as (keyof Controls)[]) {
    const tr = TRACKS[name];
    let seg: Track[0] | undefined;
    for (let i = tr.length - 1; i >= 0; i--) if (tr[i].t <= t) { seg = tr[i]; break; }
    if (seg) out[name] = seg.from + (seg.to - seg.from) * ease01((t - seg.t) / seg.ease);
  }
  return out;
}

/** The pose at time t: previous shape, current shape and how far the morph has gone (0..1). */
export function poseAt(t: number): { prev: Pose; cur: Pose; m: number } {
  let i = 0;
  for (let k = 0; k < POSES.length; k++) if (POSES[k].t <= t) i = k;
  const cur = POSES[i];
  const prev = POSES[Math.max(0, i - 1)];
  return { prev, cur, m: Math.min(1, Math.max(0, (t - cur.t) / cur.dur)) };
}
