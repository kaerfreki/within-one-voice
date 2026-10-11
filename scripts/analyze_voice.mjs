#!/usr/bin/env node
// Makes public/voice.bin + public/voice.json for the "thoughts" visuals: the actual shape of the voice, per video frame.
//
//   node scripts/analyze_voice.mjs [stemsDir=stems]
//
// For each 24 fps frame and each of vocals / backing / mix:
//   wave   512 samples of the waveform centred on the frame (85 ms at 24 kHz, every 4th sample), Int8, scaled by the
//          stem's 99.9th-percentile peak so quiet passages still read
//   bands  48 log-spaced spectrum bands, 60 Hz to 9 kHz, Uint8, 0..255 over a 50 dB range under the stem's loud frames
// Layout of voice.bin: for stem in STEMS: wave[frames][512] (Int8) ; then for stem in STEMS: bands[frames][48] (Uint8).
// Needs ffmpeg (on PATH or FFMPEG=...). Pure function of the audio, so renders stay deterministic.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FPS = 24;
const SR = 24000;
const HOP = SR / FPS;
const WAVE = 512;
const WAVE_STEP = 4;
const BANDS = 48;
const FFT = 2048;
const STEMS = ['vocals', 'backing', 'mix'];

const stemsDir = resolve(process.argv[2] ?? 'stems');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

function decode(file) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.error?.message ?? r.stderr}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
}

function find(re) {
  const name = readdirSync(stemsDir).find((n) => re.test(n));
  return name ? join(stemsDir, name) : null;
}

function pct(arr, p) {
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * p))];
}

// In-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const files = {
  vocals: find(/\(\s*vocals?\s*\)/i),
  backing: find(/\(\s*backing\s*vocals?\s*\)/i),
  mix: existsSync('public/song.mp3') ? resolve('public/song.mp3') : null,
};
for (const s of STEMS) if (!files[s]) throw new Error(`missing ${s} (looked in ${stemsDir})`);

const pcm = Object.fromEntries(STEMS.map((s) => [s, decode(files[s])]));
const frames = Math.ceil(pcm.mix.length / HOP);
console.log(`${frames} frames, ${(frames / FPS).toFixed(1)} s`);

// Band edges, log spaced
const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((60 * Math.pow(9000 / 60, i / BANDS) * FFT) / SR));
const hann = Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));

const waveOut = new Int8Array(STEMS.length * frames * WAVE);
const bandOut = new Uint8Array(STEMS.length * frames * BANDS);

STEMS.forEach((stem, si) => {
  const x = pcm[stem];
  // Peak for the waveform scale, from the loud parts only
  const abs = new Float32Array(Math.floor(x.length / 7));
  for (let i = 0; i < abs.length; i++) abs[i] = Math.abs(x[i * 7]);
  const peak = Math.max(1e-4, pct(abs, 0.999));
  const db = new Float32Array(frames * BANDS);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  for (let f = 0; f < frames; f++) {
    const c = Math.round(f * HOP);
    // Waveform, lightly smoothed (box of 4) while decimating
    for (let k = 0; k < WAVE; k++) {
      const i0 = c + (k - WAVE / 2) * WAVE_STEP;
      let s = 0;
      for (let j = 0; j < WAVE_STEP; j++) s += x[i0 + j] ?? 0;
      waveOut[(si * frames + f) * WAVE + k] = Math.max(-127, Math.min(127, Math.round(((s / WAVE_STEP) / peak) * 100)));
    }
    // Spectrum
    for (let k = 0; k < FFT; k++) {
      re[k] = (x[c - FFT / 2 + k] ?? 0) * hann[k];
      im[k] = 0;
    }
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      let s = 0;
      const lo = edges[b];
      const hi = Math.max(lo + 1, edges[b + 1]);
      for (let k = lo; k < hi; k++) s += re[k] * re[k] + im[k] * im[k];
      db[f * BANDS + b] = 10 * Math.log10(s / (hi - lo) + 1e-12);
    }
  }
  const top = pct(db, 0.995);
  for (let i = 0; i < db.length; i++) bandOut[si * frames * BANDS + i] = Math.max(0, Math.min(255, Math.round(((db[i] - (top - 50)) / 50) * 255)));
  console.log(`${stem.padEnd(8)} peak ${peak.toFixed(3)}  top ${top.toFixed(1)} dB`);
});

const bin = Buffer.concat([Buffer.from(waveOut.buffer), Buffer.from(bandOut.buffer)]);
writeFileSync('public/voice.bin', bin);
writeFileSync('public/voice.json', JSON.stringify({ version: 1, fps: FPS, frames, stems: STEMS, wave: WAVE, bands: BANDS, waveBytes: waveOut.length }));
console.log(`wrote public/voice.bin (${(bin.length / 1e6).toFixed(1)} MB) and public/voice.json`);
