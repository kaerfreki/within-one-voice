// The shape of the voice, per video frame, from public/voice.bin (made by scripts/analyze_voice.mjs).
// Everything is looked up by song time, so a frame always renders the same.

export type VoiceStem = 'vocals' | 'backing' | 'mix';

interface Meta {
  fps: number;
  frames: number;
  stems: VoiceStem[];
  wave: number;
  bands: number;
  waveBytes: number;
}

let meta: Meta | null = null;
let waves: Int8Array | null = null;
let bands: Uint8Array | null = null;

export const voiceReady: Promise<boolean> = (async () => {
  try {
    const m = (await (await fetch('voice.json', { cache: 'no-store' })).json()) as Meta;
    const buf = await (await fetch('voice.bin', { cache: 'no-store' })).arrayBuffer();
    if (!m || !m.frames || buf.byteLength < m.waveBytes) throw new Error('bad voice data');
    meta = m;
    waves = new Int8Array(buf, 0, m.waveBytes);
    bands = new Uint8Array(buf, m.waveBytes);
    console.log(`[voice] ${m.frames} frames of ${m.stems.join(', ')}`);
    return true;
  } catch (e) {
    console.log('[voice] none, the lines stay flat', e);
    return false;
  }
})();

export const WAVE_LEN = 512;

/**
 * Writes the waveform of a stem at song time t into out (length n), as floats about -1..1.
 * Uses the central `span` fraction of the 85 ms window, interpolating between the two nearest frames.
 */
export function waveInto(stem: VoiceStem, t: number, out: Float32Array, span = 0.5) {
  const n = out.length;
  if (!meta || !waves) {
    out.fill(0);
    return;
  }
  const si = meta.stems.indexOf(stem);
  const x = Math.max(0, Math.min(meta.frames - 1.001, t * meta.fps));
  const f = Math.floor(x);
  const a = x - f;
  const base0 = (si * meta.frames + f) * meta.wave;
  const base1 = base0 + meta.wave;
  const lo = (meta.wave * (1 - span)) / 2;
  for (let i = 0; i < n; i++) {
    const p = lo + (i / (n - 1)) * (meta.wave * span - 1);
    const k = Math.floor(p);
    const b = p - k;
    const v0 = waves[base0 + k] * (1 - b) + waves[base0 + k + 1] * b;
    const v1 = waves[base1 + k] * (1 - b) + waves[base1 + k + 1] * b;
    out[i] = (v0 * (1 - a) + v1 * a) / 100;
  }
}

/** Spectrum band b (0 = 60 Hz .. 47 = 9 kHz) of a stem at time t, 0..1. */
export function band(stem: VoiceStem, t: number, b: number): number {
  if (!meta || !bands) return 0;
  const si = meta.stems.indexOf(stem);
  const f = Math.max(0, Math.min(meta.frames - 1, Math.round(t * meta.fps)));
  return bands[(si * meta.frames + f) * meta.bands + b] / 255;
}

/** Average of bands lo..hi. */
export function bandRange(stem: VoiceStem, t: number, lo: number, hi: number): number {
  let s = 0;
  for (let b = lo; b <= hi; b++) s += band(stem, t, b);
  return s / (hi - lo + 1);
}
