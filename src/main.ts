import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Dream } from './dream';
import { envelopesReady } from './envelopes';
import { DURATION, SECTIONS, XFADE, BAR, sectionAt, type DreamId } from './timeline';
import { GLSL_NOISE, clamp, lerp, smooth } from './util';
import { BaselineDream } from './scenes/baseline';
import { MemoryDream } from './scenes/memory';
import { RavensDream } from './scenes/ravens';
import { SnareDream } from './scenes/snare';
import { SongsDream } from './scenes/songs';
// Retired with the cut lyrics, kept on disk: ./scenes/paper (pre-chorus paper birds), ./scenes/ash (old outro).

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
const SCALE = CAPTURE ? 1 : Number(params.get('scale') ?? 0.5);
const W = Math.round(1920 * SCALE);
const H = Math.round(1080 * SCALE);
const FPS = Number(params.get('fps') ?? 24);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage')!.appendChild(renderer.domElement);

const makeRT = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const rtA = makeRT();
const rtB = makeRT();

const dreams: Record<DreamId, Dream> = {
  baseline: new BaselineDream(),
  memory: new MemoryDream(),
  ravens: new RavensDream(),
  snare: new SnareDream(),
  songs: new SongsDream(),
};
for (const d of Object.values(dreams)) d.camera.aspect = W / H;

// Composite: noisy dissolve between the current and the next dream
const mixPass = new ShaderPass({
  uniforms: { tA: { value: rtA.texture }, tB: { value: rtB.texture }, uMix: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA, tB; uniform float uMix, uTime; varying vec2 vUv;
    ${GLSL_NOISE}
    void main(){
      vec4 a = texture2D(tA, vUv);
      if (uMix <= 0.0) { gl_FragColor = a; return; }
      vec4 b = texture2D(tB, vUv);
      float n = fbm(vUv * vec2(3.2, 1.8) + uTime * 0.05);
      float m = uMix * 1.5 - 0.25;
      float e = smoothstep(n - 0.12, n + 0.12, m);
      float rim = smoothstep(0.12, 0.0, abs(n - m)) * (1.0 - abs(uMix * 2.0 - 1.0));
      gl_FragColor = mix(a, b, e) + vec4(1.0, 0.62, 0.3, 0.0) * rim * 0.6;
    }`,
});

// Film: grain, vignette, slight chromatic fringe, optional 2.39 letterbox
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uBox: { value: params.has('nobox') ? 0 : 1 }, uAspect: { value: W / H }, uFade: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uBox, uAspect, uFade; varying vec2 vUv;
    ${GLSL_NOISE}
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.012;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, 0.35, smoothstep(0.08, 0.6, r2 * 1.6));
      float g = hash21(vUv * vec2(1931.0, 1087.0) + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * 0.035 * (0.4 + col);
      col = max(col, vec3(0.004, 0.006, 0.012)); // lifted, cold blacks
      col *= uFade;
      float band = (1.0 - uAspect / 2.39) * 0.5;
      if (uBox > 0.5 && (vUv.y < band || vUv.y > 1.0 - band)) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

const BLOOM = 0.9;
const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(W, H);
// ShaderPass clones its uniforms, and three.js nulls render-target textures when cloning
// ("Textures of render targets cannot be cloned"), so tA/tB sampled nothing and every frame was black.
// Re-attach the real render targets after construction.
mixPass.uniforms.tA.value = rtA.texture;
mixPass.uniforms.tB.value = rtB.texture;
composer.addPass(mixPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), BLOOM, 0.6, 0.72);
composer.addPass(bloom);
composer.addPass(gradePass);
composer.addPass(new OutputPass());

function renderAt(t: number) {
  t = Math.min(Math.max(t, 0), DURATION - 1e-3);
  const i = sectionAt(t);
  const s = SECTIONS[i];
  const next = SECTIONS[i + 1];
  const mix = next ? smooth(s.end - XFADE, s.end, t) : 0;

  const a = dreams[s.dream];
  a.update({ local: t - s.start, dur: s.end - s.start, t, variant: s.variant });
  let boost = a.bloom;
  renderer.setRenderTarget(rtA);
  renderer.render(a.scene, a.camera);
  if (mix > 0 && next) {
    const b = dreams[next.dream];
    b.update({ local: t - next.start, dur: next.end - next.start, t, variant: next.variant });
    boost = lerp(boost, b.bloom, mix);
    renderer.setRenderTarget(rtB);
    renderer.render(b.scene, b.camera);
  }
  renderer.setRenderTarget(null);
  mixPass.uniforms.uMix.value = mix;
  mixPass.uniforms.uTime.value = t;
  bloom.strength = BLOOM + boost;
  gradePass.uniforms.uTime.value = Math.floor(t * FPS) / FPS;
  // The song ends in black
  gradePass.uniforms.uFade.value = 1 - smooth(DURATION - 2.5, DURATION - 0.1, t);
  composer.render();
  return s;
}

// ---- Playback (preview) ----
const hud = document.getElementById('hud')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const timeEl = document.getElementById('time')!;
const secEl = document.getElementById('sections')!;
scrub.max = String(DURATION);

// The take lives in public\song.mp3 (or .wav). The dev server answers a missing file with index.html and a 200,
// and some servers send audio with a generic content type, so check the first bytes as well as the header.
const audio = new Audio();
audio.preload = 'auto';
let hasAudio = false;

async function looksLikeAudio(src: string): Promise<boolean> {
  const ctrl = new AbortController();
  try {
    const r = await fetch(src, { headers: { Range: 'bytes=0-31' }, signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) return false;
    if ((r.headers.get('content-type') ?? '').startsWith('audio')) {
      ctrl.abort();
      return true;
    }
    const reader = r.body?.getReader();
    const head = reader ? (await reader.read()).value : new Uint8Array(await r.arrayBuffer());
    ctrl.abort();
    if (!head || head.length < 4) return false;
    const tag = String.fromCharCode(head[0], head[1], head[2], head[3]);
    const mpegSync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    return tag.startsWith('ID3') || tag === 'RIFF' || tag === 'fLaC' || tag === 'OggS' || mpegSync;
  } catch {
    return false;
  }
}

let t = clamp(Number(params.get('t') ?? 0) || 0, 0, DURATION);
let playing = false;
let last = performance.now();

void (async () => {
  if (CAPTURE) return;
  for (const src of ['song.mp3', 'song.wav']) {
    if (await looksLikeAudio(src)) {
      audio.src = src;
      hasAudio = true;
      audio.currentTime = t;
      if (playing) void audio.play();
      console.log(`[audio] following ${src}`);
      return;
    }
  }
  console.log('[audio] no song.mp3/song.wav in public/, playing on the clock');
})();

const secButtons = SECTIONS.map((s, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${s.name}`;
  b.title = `${s.shot}  ${fmt(s.start)}-${fmt(s.end)}`;
  b.onclick = () => seek(s.start);
  secEl.appendChild(b);
  return b;
});

function seek(to: number) {
  t = Math.min(Math.max(to, 0), DURATION);
  if (hasAudio) audio.currentTime = t;
}
function setPlaying(p: boolean) {
  playing = p;
  playBtn.textContent = p ? 'pause' : 'play';
  if (hasAudio) {
    if (p) {
      audio.currentTime = t;
      void audio.play();
    } else audio.pause();
  }
  last = performance.now();
}
playBtn.onclick = () => setPlaying(!playing);
scrub.oninput = () => seek(Number(scrub.value));
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
  else if (e.code === 'ArrowRight') seek(t + (e.shiftKey ? BAR * 4 : BAR));
  else if (e.code === 'ArrowLeft') seek(t - (e.shiftKey ? BAR * 4 : BAR));
  else if (e.code === 'KeyH') hud.classList.toggle('hidden');
  else if (e.code === 'KeyL') gradePass.uniforms.uBox.value = 1 - gradePass.uniforms.uBox.value;
  // 1-9 jump to sections 1-9, 0 to section 10 if there is one
  else if (/^Digit\d$/.test(e.code)) { const s = SECTIONS[(Number(e.code.slice(5)) + 9) % 10]; if (s) seek(s.start); }
});

function fmt(x: number) {
  return `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
}

function loop(now: number) {
  if (playing) {
    t = hasAudio ? audio.currentTime : t + (now - last) / 1000;
    if (t >= DURATION || (hasAudio && audio.ended)) setPlaying(false);
  }
  last = now;
  const s = renderAt(t);
  scrub.value = String(t);
  timeEl.textContent = `${fmt(t)}  ${s.shot} ${s.name}`;
  secButtons.forEach((b, i) => b.classList.toggle('on', SECTIONS[i] === s));
  requestAnimationFrame(loop);
}

// ---- Capture: ?capture&take=v01[&from=s&to=s] renders every frame at 1920x1080 and posts it to the dev server ----
async function capture() {
  hud.style.display = 'none';
  const take = (params.get('take') ?? 'take').replace(/[^\w-]/g, '') || 'take';
  const fromRaw = Number(params.get('from') ?? 0);
  const toRaw = Number(params.get('to') ?? DURATION);
  const from = clamp(Number.isFinite(fromRaw) ? fromRaw : 0, 0, DURATION);
  const to = clamp(Number.isFinite(toRaw) ? toRaw : DURATION, from, DURATION);
  const n0 = Math.round(from * FPS);
  const n1 = Math.round(to * FPS);
  // Every frame must see the same inputs: wait for the envelopes (or their absence) and the text font
  await envelopesReady;
  await document.fonts.ready;
  console.log(`[capture] ${take}: ${fmt(n0 / FPS)}-${fmt(n1 / FPS)}, ${n1 - n0} frames at ${FPS} fps`);
  const started = performance.now();
  for (let n = n0; n < n1; n++) {
    renderAt(n / FPS);
    const blob: Blob = await new Promise((res) => renderer.domElement.toBlob((b) => res(b!), 'image/png'));
    const r = await fetch(`/__frame?take=${take}&n=${n - n0}`, { method: 'POST', body: blob });
    if (!r.ok) throw new Error(`[capture] frame sink refused frame ${n - n0}: ${r.status}`);
    if ((n - n0) % 24 === 0) {
      const done = (n - n0 + 1) / (n1 - n0);
      document.title = `${Math.round(done * 100)}% capture ${take}`;
      console.log(`[capture] frame ${n - n0}/${n1 - n0} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
    }
  }
  document.title = `done capture ${take}`;
  const ss = n0 > 0 ? `-ss ${(n0 / FPS).toFixed(3)} ` : '';
  console.log(
    `[capture] done. From the dreams folder:\n` +
      `ffmpeg -framerate ${FPS} -i "../renders/dreams/${take}/f%06d.png" ${ss}-i public/song.mp3 -map 0:v -map 1:a ` +
      `-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 320k -shortest "../renders/dreams/${take}.mp4"`,
  );
}

if (CAPTURE) void capture();
else {
  seek(t);
  requestAnimationFrame(loop);
}

// Debug hook for checking a frame from the console
(window as unknown as { dreamsAt: (x: number) => void }).dreamsAt = (x: number) => { seek(x); };
