#!/usr/bin/env node
// Makes public/envelopes.json for the dreams app from the Suno stems.
//
//   node scripts/analyze_stems.mjs [stemsDir=stems] [out=public/envelopes.json]
//
// Looks in stemsDir for "Dream of Electric Ravens (Drums|Bass|Vocals|Backing Vocals).wav/.mp3/.flac" (any prefix
// works, the name in brackets is what counts) and also analyses public/song.mp3 as the full mix.
// Decodes each file to mono 24 kHz float PCM with ffmpeg (on PATH, or set FFMPEG=path\to\ffmpeg.exe), then writes:
//   fps      24
//   stems    { drums, bass, vocals, backing, mix }: per-frame loudness 0..1 (RMS in dB, 40 dB range under the
//            stem's own 99th percentile, fast attack, ~150 ms release)
//   onsets   [[seconds, strength 0..1], ...] drum hits from the drum stem (rise in short-time energy)
// No dependencies beyond Node and ffmpeg.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const FPS = 24;
const SR = 24000;
const HOP = SR / FPS; // 1000 samples per video frame
const RANGE_DB = 40;

const stemsDir = resolve(process.argv[2] ?? 'stems');
const outPath = resolve(process.argv[3] ?? 'public/envelopes.json');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';

const WANT = [
  ['backing', /\(\s*backing\s*vocals?\s*\)/i], // before 'vocals' so it wins
  ['drums', /\(\s*drums?\s*\)/i],
  ['bass', /\(\s*bass\s*\)/i],
  ['vocals', /\(\s*vocals?\s*\)/i],
];
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aiff?)$/i;

function decode(file) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (r.error) throw new Error(`could not run ffmpeg (${ffmpeg}): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr.toString()}`);
  const buf = r.stdout;
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
}

function percentile(values, p) {
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/** Per-frame loudness, 0..1. */
function envelope(x) {
  const frames = Math.ceil(x.length / HOP);
  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    // A window of two frames centred on the frame
    const a = Math.max(0, Math.round((f - 0.5) * HOP));
    const b = Math.min(x.length, Math.round((f + 1.5) * HOP));
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    db[f] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-12);
  }
  const top = percentile(db, 0.99);
  const out = new Array(frames);
  const release = Math.exp(-1 / (0.15 * FPS));
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    const v = Math.min(1, Math.max(0, (db[f] - (top - RANGE_DB)) / RANGE_DB));
    prev = v > prev ? v : prev * release + v * (1 - release);
    out[f] = Math.round(prev * 1000) / 1000;
  }
  return out;
}

/** Drum hits: peaks in the rise of log energy over 5 ms hops, against a running median. */
function onsets(x) {
  const hop = Math.round(SR * 0.005);
  const win = hop * 2;
  const n = Math.floor((x.length - win) / hop);
  const e = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * hop; i < k * hop + win; i++) s += x[i] * x[i];
    e[k] = Math.log10(s / win + 1e-10);
  }
  // Rise over ~15 ms, half-wave rectified
  const flux = new Float64Array(n);
  for (let k = 3; k < n; k++) flux[k] = Math.max(0, e[k] - e[k - 3]);
  const W = 100; // 0.5 s of hops for the adaptive threshold
  const hits = [];
  let lastT = -1;
  let maxFlux = 1e-9;
  for (let k = 0; k < n; k++) maxFlux = Math.max(maxFlux, flux[k]);
  for (let k = 1; k < n - 1; k++) {
    if (flux[k] < flux[k - 1] || flux[k] < flux[k + 1]) continue;
    const lo = Math.max(0, k - W);
    const hi = Math.min(n, k + W);
    const local = Array.from(flux.subarray(lo, hi)).sort((a, b) => a - b);
    const med = local[local.length >> 1];
    const thr = med * 1.5 + 0.08 * maxFlux;
    if (flux[k] < thr) continue;
    const t = (k * hop + hop) / SR;
    if (t - lastT < 0.09) continue;
    hits.push([Math.round(t * 1000) / 1000, flux[k]]);
    lastT = t;
  }
  // Strength 0..1 against the loud hits
  const ref = hits.length ? percentile(hits.map((h) => h[1]), 0.95) : 1;
  return hits.map(([t, f]) => [t, Math.round(Math.min(1, f / ref) * 1000) / 1000]);
}

const files = {};
if (existsSync(stemsDir)) {
  for (const name of readdirSync(stemsDir)) {
    if (!AUDIO_EXT.test(name)) continue;
    const hit = WANT.find(([, re]) => re.test(name));
    if (hit && !files[hit[0]]) files[hit[0]] = join(stemsDir, name);
  }
} else {
  console.warn(`no stems folder at ${stemsDir}; only the full mix will be analysed`);
}
const mix = resolve('public/song.mp3');
if (existsSync(mix)) files.mix = mix;
if (Object.keys(files).length === 0) {
  console.error('nothing to analyse');
  process.exit(1);
}

const stems = {};
let drumHits = [];
let frames = 0;
for (const [key, file] of Object.entries(files)) {
  process.stdout.write(`${key.padEnd(8)} ${file} ... `);
  const pcm = decode(file);
  stems[key] = envelope(pcm);
  frames = Math.max(frames, stems[key].length);
  if (key === 'drums') drumHits = onsets(pcm);
  console.log(`${(pcm.length / SR).toFixed(1)} s${key === 'drums' ? `, ${drumHits.length} hits` : ''}`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ version: 1, fps: FPS, frames, duration: frames / FPS, stems, onsets: drumHits }));
console.log(`wrote ${outPath}`);
