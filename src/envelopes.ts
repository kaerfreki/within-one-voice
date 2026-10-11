// Optional audio reactivity. scripts/analyze_stems.mjs writes public/envelopes.json from the Suno stems:
// per-frame (24 fps) loudness per stem, 0..1, and drum onsets. Everything here is a pure function of song
// time, so renders stay deterministic. Without the file every call returns its fallback and the dreams
// animate from time alone.

export type Stem = 'drums' | 'bass' | 'vocals' | 'backing' | 'mix';

interface EnvelopeFile {
  fps: number;
  stems: Partial<Record<Stem, number[]>>;
  /** [seconds, strength 0..1] per drum hit, sorted by time */
  onsets?: [number, number][];
}

let env: EnvelopeFile | null = null;

function valid(j: unknown): j is EnvelopeFile {
  const e = j as EnvelopeFile;
  return !!e && typeof e === 'object' && typeof e.fps === 'number' && e.fps > 0 && !!e.stems && typeof e.stems === 'object';
}

/** Settles (never rejects) once envelopes.json has loaded or is known to be missing. */
export const envelopesReady: Promise<boolean> = fetch('envelopes.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : ''))
  .then((txt) => {
    // The dev server answers a missing file with index.html, so parse rather than trust the status
    const j: unknown = JSON.parse(txt);
    if (!valid(j)) return false;
    j.onsets = (j.onsets ?? []).filter((o) => Array.isArray(o) && o.length >= 2).sort((a, b) => a[0] - b[0]);
    env = j;
    console.log(`[envelopes] loaded: ${Object.keys(j.stems).join(', ')}, ${j.onsets.length} drum onsets`);
    return true;
  })
  .catch(() => {
    console.log('[envelopes] none, using time-only animation');
    return false;
  });

export const hasEnvelopes = () => env !== null;

/** Loudness of a stem at song time t, 0..1, linearly interpolated between frames. */
export function level(stem: Stem, t: number, fallback = 0): number {
  const a = env?.stems[stem];
  if (!env || !a || a.length === 0) return fallback;
  const x = Math.max(0, t * env.fps);
  const i = Math.floor(x);
  if (i >= a.length - 1) return a[a.length - 1];
  return a[i] + (a[i + 1] - a[i]) * (x - i);
}

/** Loudness averaged over a short window before t, for steadier motion. */
export function levelSmooth(stem: Stem, t: number, window = 0.25, fallback = 0): number {
  if (!env?.stems[stem]) return fallback;
  let s = 0;
  for (let k = 0; k < 6; k++) s += level(stem, t - (window * k) / 5, fallback);
  return s / 6;
}

/** A decaying pulse on each drum hit: 1 at the hit, falling off over `decay` seconds. 0 without envelopes. */
export function drumPulse(t: number, decay = 0.14): number {
  const o = env?.onsets;
  if (!o || o.length === 0) return 0;
  // Last onset at or before t
  let lo = 0;
  let hi = o.length - 1;
  if (o[0][0] > t) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (o[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  let p = 0;
  for (let i = lo; i >= 0 && t - o[i][0] < decay * 5; i--) p = Math.max(p, o[i][1] * Math.exp(-(t - o[i][0]) / decay));
  return p;
}
