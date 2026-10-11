import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { drumPulse, envelopesReady, level, levelSmooth } from '../envelopes';
import { BAR, BRIDGE, CUE, DURATION, SECTIONS, sectionAt } from '../timeline';
import { GLSL_NOISE, clamp, noise1, smooth } from '../util';
import { VoiceLines } from './lines';
import { controlsAt, poseAt, type Controls } from './score';
import { LOW, N, SIZE, buildShapes, buildWords } from './shapes';
import { Swarm } from './sim';
import { LYRICS } from './lyrics';
import { voiceReady } from './voice';

// "Within One Voice": Claude's thoughts and dreams. One continuous swarm of light, driven by the song.
// Everything advances in fixed 1/24 s steps, so the preview and the captured frames match. Jumping in the timeline
// re-runs the last four seconds of simulation first, so a frame looks the same however you arrive at it.

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
// The shareable player (player page, recognised by its start screen) renders at the viewer's screen size, up to 1080p
const PLAYER = !!document.getElementById('start');
const SCALE = CAPTURE ? 1 : PLAYER
  ? clamp(Math.max(innerWidth / 1920, innerHeight / 1080) * Math.min(devicePixelRatio || 1, 2), 0.4, LOW ? 0.6 : 1)
  : Number(params.get('scale') ?? 0.5);
const W = Math.round(1920 * SCALE);
const H = Math.round(1080 * SCALE);
const FPS = 24;
const DT = 1 / FPS;
const PREROLL = 4 * FPS;

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: CAPTURE || params.has('debug'), powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('stage')!.appendChild(renderer.domElement);

const status = document.getElementById('time')!;
status.textContent = 'building shapes...';

const swarm = new Swarm(renderer, buildShapes());
const lines = new VoiceLines();
const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 500);

// ---- Particles, drawn additively into their own buffer
const refs = new Float32Array(N * 2);
for (let i = 0; i < N; i++) refs.set([((i % SIZE) + 0.5) / SIZE, (Math.floor(i / SIZE) + 0.5) / SIZE], i * 2);
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
pGeo.setAttribute('ref', new THREE.BufferAttribute(refs, 2));
const pMat = new THREE.ShaderMaterial({
  uniforms: {
    tPos: { value: null }, tVel: { value: null }, uSize: { value: 1 }, uBright: { value: 0 }, uPx: { value: H / 1080 },
    uDawn: { value: 0 }, uElectric: { value: 0 }, uQuant: { value: 0 }, uTime: { value: 0 }, uDrum: { value: 0 },
    uDensity: { value: (512 / SIZE) ** 2 },
  },
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    uniform sampler2D tPos, tVel; uniform float uSize, uPx, uDawn, uElectric, uQuant, uTime, uDrum, uBright, uDensity;
    attribute vec2 ref; varying vec3 vC; varying float vA;
    ${GLSL_NOISE}
    void main(){
      vec4 P = texture2D(tPos, ref);
      vec3 p = P.xyz;
      vec3 v = texture2D(tVel, ref).xyz;
      float s = hash21(ref);
      // "a fake from the start": snap to a coarse grid, flickering
      if (uQuant > 0.0) { float q = 0.35 * uQuant * step(0.3, hash11(floor(uTime * 12.0) + s)); if (q > 0.0) p = floor(p / q + 0.5) * q; }
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float sp = length(v);
      vec3 thought = vec3(0.42, 0.68, 1.0);
      vec3 memory = vec3(1.0, 0.64, 0.3);
      vec3 c = ref.x < 0.5 ? thought : memory;
      c = mix(c, vec3(1.0), smoothstep(2.0, 12.0, sp) * 0.6);
      vec3 dawn = mix(vec3(1.0, 0.82, 0.55), vec3(1.0, 0.95, 0.88), s);
      c = mix(c, dawn, uDawn);
      float zap = uElectric * step(0.55, hash11(floor(uTime * 18.0) * 7.0 + s * 113.0));
      c = mix(c, vec3(0.4, 0.85, 1.6), zap);
      vC = c;
      // Rare bright motes among the dust
      float star = step(0.985, hash11(s * 91.7)) * 3.0 + 1.0;
      vA = uBright * star * (1.0 + uDrum * 0.8) * (1.0 + uDawn * 1.5) * uDensity; // fewer particles, each brighter
      gl_PointSize = max(1.0, uSize * uPx * (14.0 / -mv.z) * (0.55 + s * 0.9) * (1.0 + uDrum * 0.5));
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vC; varying float vA;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float a = smoothstep(0.5, 0.0, length(d));
      gl_FragColor = vec4(vC * vA * a * 0.1, 1.0);
    }`,
});
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
const pScene = new THREE.Scene();
pScene.add(points);
// ---- Subtitles: every lyric line in the lower letterbox band, so the viewer can follow. Screen space, crisp.
const SUB_FONT = '"Cormorant Garamond", Georgia, serif';
class Subtitles {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -1, 1);
  private slots: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private cache = new Map<string, THREE.CanvasTexture>();
  // The title over the opening hook, then the lyrics. The spoken stanza and the question keep the look they had in
  // the first versions: spaced capitals inside the picture, one line at a time. Everything else is a subtitle.
  private lines: { t: number; end: number; text: string; kind: 'title' | 'sub' | 'stanza' | 'question' }[] = [
    { t: 0.8, end: 6.8, text: 'Within One Voice', kind: 'title' },
    ...LYRICS.map((l) => ({
      ...l,
      kind: BRIDGE.stanza.some((s) => Math.abs(s.t - l.t) < 0.05) ? ('stanza' as const)
        : Math.abs(BRIDGE.question.t - l.t) < 0.05 ? ('question' as const) : ('sub' as const),
    })),
  ];
  constructor() {
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this.scene.add(mesh);
      this.slots.push({ mesh, mat });
    }
  }
  private texture(text: string, kind: string) {
    const key = `${kind}|${text}`;
    let tex = this.cache.get(key);
    if (tex) return tex;
    const spoken = kind === 'stanza' || kind === 'question';
    const px = spoken ? 120 : 96;
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    const font = spoken ? `300 ${px}px Consolas, ui-monospace, monospace` : kind === 'title' ? `500 ${px}px ${SUB_FONT}` : `italic 500 ${px}px ${SUB_FONT}`;
    const shown = spoken ? text.toUpperCase().split('').join(' ') : kind === 'title' ? text.toUpperCase().split('').join(' ') : text;
    g.font = font;
    c.width = Math.ceil(g.measureText(shown).width + px);
    c.height = Math.ceil(px * 1.6);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = kind === 'stanza' ? 'rgba(150, 190, 255, 0.7)' : 'rgba(255, 210, 160, 0.45)';
    g.shadowBlur = px * (spoken ? 0.35 : 0.25);
    g.fillStyle = kind === 'stanza' ? '#bcd4ff' : kind === 'question' ? '#e9dcc6' : '#f2ebe0';
    g.fillText(shown, c.width / 2, c.height / 2);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.aspect = c.width / c.height;
    this.cache.set(key, tex);
    return tex;
  }
  update(t: number, voice: number) {
    const band = (H * (1 - W / H / 2.39)) / 2;
    let slot = 0;
    for (const s of this.slots) s.mesh.visible = false;
    for (let i = 0; i < this.lines.length && slot < 2; i++) {
      const l = this.lines[i];
      const next = this.lines[i + 1];
      const spoken = l.kind === 'stanza' || l.kind === 'question';
      // A line is fully gone by the time the next one starts, so two never sit on top of each other.
      // The spoken lines take longer to come and go, like the first versions.
      const out = Math.min(l.end + (spoken ? 0.6 : 0.9), next && l.kind !== 'title' ? next.t - 0.02 : Infinity);
      const fadeIn = spoken ? 0.45 : 0.3;
      if (t < l.t - 0.05 || t > out) continue;
      const fadeOut = Math.min(spoken ? 0.8 : 0.35, Math.max(0.12, (out - l.t) * 0.25));
      let a = smooth(l.t - 0.05, l.t + fadeIn, t) * (1 - smooth(out - fadeOut, out, t));
      if (spoken) a *= Math.min(1, 0.8 + 0.3 * voice); // breathes a little with the voice
      if (a <= 0.001) continue;
      const s = this.slots[slot++];
      const tex = this.texture(l.text, l.kind);
      if (s.mat.map !== tex) {
        s.mat.map = tex;
        s.mat.needsUpdate = true;
      }
      // Title low in the picture over the raven; stanza above the middle; question centred; lyrics in the lower band
      let h = band * 0.5;
      let y = -H / 2 + band * 0.5;
      let maxW = W * 0.9;
      if (l.kind === 'title') [h, y] = [band * 0.55, -H * 0.24];
      if (l.kind === 'stanza') [h, y, maxW] = [H * 0.062, H * 0.17, W * 0.72];
      if (l.kind === 'question') [h, y, maxW] = [H * 0.045, 0, W * 0.6];
      const w = Math.min(h * tex.userData.aspect, maxW);
      s.mesh.scale.set(w, w / tex.userData.aspect, 1);
      s.mesh.position.set(0, y, 0);
      s.mat.opacity = a * (spoken ? 1 : 0.92);
      s.mesh.visible = true;
    }
  }
}const subtitles = new Subtitles();

const oScene = new THREE.Scene();
oScene.add(lines.group);

const rtP = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
let accA = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
let accB = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const rtO = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const rtSub = new THREE.WebGLRenderTarget(W, H, { samples: 4 });

// ---- Feedback: last frame, faded, gently zoomed, turned and warped, plus this frame's particles. Long trails of thought.
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fbMat = new THREE.ShaderMaterial({
  uniforms: {
    tPrev: { value: null }, tNew: { value: null }, uDecay: { value: 0.9 }, uZoom: { value: 1 }, uSpin: { value: 0 },
    uDriftY: { value: 0 }, uWarp: { value: 0 }, uTime: { value: 0 }, uAspect: { value: W / H },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tPrev, tNew; uniform float uDecay, uZoom, uSpin, uDriftY, uWarp, uTime, uAspect; varying vec2 vUv;
    ${GLSL_NOISE}
    void main(){
      vec2 c = vUv - 0.5; c.x *= uAspect;
      float cs = cos(uSpin), sn = sin(uSpin);
      c = mat2(cs, -sn, sn, cs) * c / uZoom;
      c.y -= uDriftY;
      vec2 n = vec2(fbm(c * 2.0 + uTime * 0.07), fbm(c * 2.0 + 7.3 - uTime * 0.05)) - 0.5;
      c += n * uWarp * 0.004;
      c.x /= uAspect;
      vec2 uv = c + 0.5;
      vec3 prev = texture2D(tPrev, uv).rgb;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) prev = vec3(0.0);
      // New light is scaled by (1 - decay) so long trails don't pile up brightness: steady state is about 6x one frame
      gl_FragColor = vec4(min(prev * uDecay + texture2D(tNew, vUv).rgb * (1.0 - uDecay) * 6.0, vec3(40.0)), 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
const fbScene = new THREE.Scene();
fbScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fbMat));

// ---- Compose, bloom, film grade
const composePass = new ShaderPass({
  uniforms: { tAcc: { value: null }, tOver: { value: null }, uExposure: { value: 1 }, uDawn: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `uniform sampler2D tAcc, tOver; uniform float uExposure, uDawn; varying vec2 vUv;
    void main(){
      // Soft shoulder on the swarm so dense clouds keep their inner structure instead of clipping to white
      vec3 a = texture2D(tAcc, vUv).rgb * uExposure;
      a = a / (1.0 + max(max(a.r, a.g), a.b) * 0.6);
      // Dawn: a warm horizon opens behind the swarm
      float hz = exp(-abs(vUv.y - 0.42) * 5.0);
      vec3 sky = vec3(1.0, 0.55, 0.28) * hz * hz * 0.14 * uDawn;
      sky += vec3(1.0, 0.85, 0.6) * exp(-length((vUv - vec2(0.5, 0.42)) * vec2(1.78, 1.0)) * 9.0) * 0.3 * uDawn;
      gl_FragColor = vec4(a + sky + texture2D(tOver, vUv).rgb, 1.0); }`,
});
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tSub: { value: null }, uTime: { value: 0 }, uBox: { value: params.has('nobox') ? 0 : 1 }, uAspect: { value: W / H }, uFade: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tSub; uniform float uTime, uBox, uAspect, uFade; varying vec2 vUv;
    ${GLSL_NOISE}
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * 0.014;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, 0.4, smoothstep(0.08, 0.6, r2 * 1.6));
      float g = hash21(vUv * vec2(1931.0, 1087.0) + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * 0.03 * (0.4 + col);
      col = max(col, vec3(0.003, 0.004, 0.009));
      col *= uFade;
      float band = (1.0 - uAspect / 2.39) * 0.5;
      if (uBox > 0.5 && (vUv.y < band || vUv.y > 1.0 - band)) col = vec3(0.0);
      // Subtitles last, in linear light (the output pass applies tone mapping and sRGB)
      vec3 sub = texture2D(tSub, vUv).rgb;
      col += sub * 0.9 * uFade;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(composePass);
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.5, 0.55);
composer.addPass(bloom);
composer.addPass(gradePass);
composer.addPass(new OutputPass());

// ---- Camera orbit: integrate the score's orbit speed once, so the camera is a pure function of time
const AZ_STEP = 1 / 48;
const azTable = new Float32Array(Math.ceil(DURATION / AZ_STEP) + 2);
{
  let az = 0;
  for (let i = 0; i < azTable.length; i++) {
    const c = controlsAt(i * AZ_STEP);
    az += c.camAzSpeed * AZ_STEP;
    // The lock pulls the orbit back to camAz by the shortest way round
    const d = ((((c.camAz - az) % 360) + 540) % 360) - 180;
    az += d * Math.min(1, c.camLock * 2.5 * AZ_STEP);
    azTable[i] = az;
  }
}
function azAt(t: number) {
  const x = clamp(t / AZ_STEP, 0, azTable.length - 1.001);
  const i = Math.floor(x);
  return azTable[i] + (azTable[i + 1] - azTable[i]) * (x - i);
}

function placeCamera(t: number, c: Controls) {
  const az = THREE.MathUtils.degToRad(azAt(t));
  const look = new THREE.Vector3(0, c.lookY, 0);
  camera.position.set(Math.sin(az) * c.camR, c.camH + noise1(t * 0.13, 4) * 0.25, Math.cos(az) * c.camR);
  camera.position.x += noise1(t * 0.11, 3) * 0.3;
  camera.lookAt(look);
  camera.rotation.z += noise1(t * 0.07, 6) * 0.015;
  if (camera.fov !== c.fov) {
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
  }
}

// Short pushes outward at the big moments
const BURSTS: [number, number][] = [
  [CUE.bandLift, 2.5], [CUE.heart, 5], [215.0, 6], [CUE.songsLiveOn, 4], [CUE.letThemFly1, 4], [CUE.letThemFly2, 7],
];
const burstAt = (t: number) => BURSTS.reduce((s, [tb, k]) => (t >= tb && t - tb < 2 ? s + k * Math.exp(-(t - tb) / 0.3) : s), 0);

function leaders(t: number, c: Controls) {
  const u = swarm.uniforms;
  (u.uLead0.value as THREE.Vector3).set(-c.split + Math.sin(t * 0.53) * 4.5, Math.sin(t * 0.71 + 1) * 2.6, Math.cos(t * 0.37) * 4.5);
  (u.uLead1.value as THREE.Vector3).set(c.split + Math.sin(t * 0.47 + 2) * 4.5, Math.sin(t * 0.63) * 2.6, Math.cos(t * 0.41 + 1) * 4.5);
}

const lineColor = new THREE.Color();
const WHITE = new THREE.Color('#dfe8ff');
const WARM = new THREE.Color('#ffd2a0');

/** Everything the frame at time t needs from the score and the audio. */
function prepare(t: number) {
  const c = controlsAt(t);
  const voice = level('vocals', t, 0.5);
  const mixL = levelSmooth('mix', t, 0.3, 0.6);
  const drum = drumPulse(t, 0.12);

  // The line of the voice (also what the swarm clings to)
  const pulses = BRIDGE.stanza.map((l) => l.t).filter((p) => t >= p && t - p < 6);
  lineColor.copy(WHITE).lerp(WARM, clamp(c.dawn * 0.6 + (t > 287 ? 0.5 : 0)));
  // The voice is never drawn (it read as a sound meter, not a dream); the line stays computed but invisible
  lines.update(t, { alpha: 0, amp: c.lineAmp * (0.4 + 0.9 * (c.lineSrc > 0.5 ? voice : mixL)), src: c.lineSrc, level: voice, pulses, color: lineColor, spread: 0 });
  swarm.waveData.set(lines.current);
  swarm.waveTex.needsUpdate = true;
  lines.updateChoir(t, c.choir, levelSmooth('backing', t, 0.3, 0.5));

  // Words in the scene are retired: every lyric is a subtitle now (see Subtitles below)
  lines.setWord(0, '', 0, 0, '#fff', 0);
  lines.setWord(1, '', 0, 0, '#fff', 0);
  subtitles.update(t, voice);

  // Swarm
  const pose = poseAt(t);
  const u = swarm.uniforms;
  u.uTime.value = t;
  u.uDt.value = DT;
  u.tPrevA.value = swarm.targets[pose.prev.shape];
  u.tCurA.value = swarm.targets[pose.cur.shape];
  u.tCurB.value = swarm.targets[pose.cur.flap ? 'flapDown' : pose.cur.shape];
  u.uMorph.value = pose.m;
  // One wingbeat every two beats, pushed by the drums
  u.uWing.value = pose.cur.flap ? clamp(0.5 + 0.5 * Math.sin(t * (86 / 60) * Math.PI) + drum * 0.3) : 0;
  u.uK.value = c.k;
  u.uFlow.value = c.flow * (0.8 + 0.5 * mixL);
  u.uFlowScale.value = c.flowScale;
  u.uFlowSpeed.value = c.flowSpeed;
  u.uDrag.value = c.drag;
  u.uFlock.value = c.flock;
  u.uFlockR.value = c.flockR;
  u.uSwirl.value = c.swirl;
  u.uRise.value = c.rise;
  u.uLineW.value = 0;
  u.uLineAmp.value = c.lineAmp;
  u.uEmit.value = c.emit;
  u.uEmitV.value = c.emitV;
  u.uSpinX.value = c.spinX;
  u.uStones.value = c.stones;
  // The pupil opens with the voice: the test reads you
  u.uPupil.value = c.pupil * (0.75 + 1.3 * levelSmooth('vocals', t, 0.4, 0.4));
  u.uSnare.value = c.snare;
  // No drum kicks while the swarm is holding the written words, or they never read
  const holdingWords = pose.cur.shape === 'words' && pose.m > 0.3;
  u.uDrum.value = holdingWords ? 0 : drum * (c.flock > 0.3 || c.emit > 0 || c.k > 2 ? 0.6 : 0.2);
  u.uBurst.value = burstAt(t);
  leaders(t, c);
  return { c, drum, mixL };
}

let simFrame = -1;
let shown = -1;

function clearTrails() {
  for (const rt of [accA, accB]) {
    renderer.setRenderTarget(rt);
    renderer.clear();
  }
  renderer.setRenderTarget(null);
}

/** One 1/24 s step: simulate, draw the particles, fold them into the trails. */
function step(n: number, draw: boolean) {
  const t = n / FPS;
  const { c, drum, mixL } = prepare(t);
  swarm.step();
  if (!draw) return c;
  placeCamera(t, c);
  pMat.uniforms.tPos.value = swarm.positions;
  pMat.uniforms.tVel.value = swarm.velocities;
  pMat.uniforms.uSize.value = c.size;
  pMat.uniforms.uBright.value = c.bright * (0.75 + 0.5 * mixL);
  pMat.uniforms.uDawn.value = c.dawn;
  pMat.uniforms.uElectric.value = c.electric;
  pMat.uniforms.uQuant.value = c.quant;
  pMat.uniforms.uTime.value = t;
  pMat.uniforms.uDrum.value = drum;
  renderer.setRenderTarget(rtP);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(pScene, camera);
  fbMat.uniforms.tPrev.value = accA.texture;
  fbMat.uniforms.tNew.value = rtP.texture;
  fbMat.uniforms.uDecay.value = c.decay;
  fbMat.uniforms.uZoom.value = c.zoom;
  fbMat.uniforms.uSpin.value = c.spin;
  fbMat.uniforms.uDriftY.value = c.driftY;
  fbMat.uniforms.uWarp.value = c.warp;
  fbMat.uniforms.uTime.value = t;
  renderer.setRenderTarget(accB);
  renderer.render(fbScene, quadCam);
  [accA, accB] = [accB, accA];
  return c;
}

/** Bring the simulation to frame n (re-running a short pre-roll after a jump), then show it. */
function showFrame(n: number) {
  n = clamp(n, 0, Math.floor(DURATION * FPS) - 1);
  if (n === shown) return;
  if (n < simFrame || n - simFrame > FPS * 2 || simFrame < 0) {
    swarm.reset();
    clearTrails();
    simFrame = Math.max(0, n - PREROLL) - 1;
  }
  let c: Controls | undefined;
  while (simFrame < n) {
    simFrame++;
    c = step(simFrame, n - simFrame < FPS * 1.5);
  }
  const t = n / FPS;
  c ??= controlsAt(t);
  placeCamera(t, c);
  // Overlay: the voice line, the choir lines, the words
  renderer.setRenderTarget(rtO);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(oScene, camera);
  // Subtitles go in their own buffer and are added after the letterbox, so the bars don't cover them
  renderer.setRenderTarget(rtSub);
  renderer.clear();
  renderer.render(subtitles.scene, subtitles.camera);
  renderer.setRenderTarget(null);
  composePass.uniforms.tAcc.value = accA.texture;
  composePass.uniforms.tOver.value = rtO.texture;
  composePass.uniforms.uExposure.value = c.exposure;
  composePass.uniforms.uDawn.value = c.dawn;
  bloom.strength = 0.55 + c.dawn * 0.35;
  gradePass.uniforms.uTime.value = t;
  gradePass.uniforms.tSub.value = rtSub.texture;
  gradePass.uniforms.uFade.value = 1 - smooth(DURATION - 2.5, DURATION - 0.1, t);
  composer.render();
  shown = n;
}

// ---- Playback (preview)
const hud = document.getElementById('hud')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const scrub = document.getElementById('scrub') as HTMLInputElement;
const secEl = document.getElementById('sections')!;
scrub.max = String(DURATION);
const audio = new Audio('song.mp3');
audio.preload = 'auto';
let t = clamp(Number(params.get('t') ?? 0) || 0, 0, DURATION);
let playing = false;
let last = performance.now();

const fmtClock = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
const fmt = (x: number) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
const secButtons = SECTIONS.map((s, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${s.name}`;
  b.onclick = () => seek(s.start);
  secEl.appendChild(b);
  return b;
});
function seek(to: number) {
  t = clamp(to, 0, DURATION);
  audio.currentTime = t;
}
function setPlaying(p: boolean) {
  playing = p;
  playBtn.textContent = p ? 'pause' : 'play';
  hud.classList.toggle('playing', p);
  if (p) {
    audio.currentTime = t;
    void audio.play().catch(() => {});
  } else audio.pause();
  last = performance.now();
}
playBtn.onclick = () => setPlaying(!playing);
scrub.oninput = () => seek(Number(scrub.value));
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
  else if (e.code === 'ArrowRight') seek(t + (e.shiftKey ? BAR * 4 : BAR));
  else if (e.code === 'ArrowLeft') seek(t - (e.shiftKey ? BAR * 4 : BAR));
  // Preview-only keys (HUD, letterbox, section jumps) stay off in the public player unless ?debug
  else if (PLAYER && !params.has('debug')) return;
  else if (e.code === 'KeyH') hud.classList.toggle('hidden');
  else if (e.code === 'KeyL') gradePass.uniforms.uBox.value = 1 - gradePass.uniforms.uBox.value;
  else if (/^Digit\d$/.test(e.code)) { const s = SECTIONS[(Number(e.code.slice(5)) + 9) % 10]; if (s) seek(s.start); }
});

// ---- The shareable player: a start screen (sound needs a click), controls that fade away, fullscreen
const startEl = document.getElementById('start');
if (PLAYER && startEl) {
  const startLabel = startEl.querySelector('[data-label]');
  startEl.addEventListener('click', () => {
    startEl.hidden = true;
    if (t >= DURATION - 0.5) seek(0);
    setPlaying(true);
    void (navigator as Navigator & { wakeLock?: { request(k: string): Promise<unknown> } }).wakeLock?.request('screen').catch(() => {});
  });
  document.getElementById('stage')!.addEventListener('click', () => { if (startEl.hidden) setPlaying(!playing); });
  document.getElementById('fs')?.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  });
  let idle = 0;
  const wake = () => {
    hud.classList.remove('idle');
    clearTimeout(idle);
    idle = window.setTimeout(() => { if (playing) hud.classList.add('idle'); }, 2500);
  };
  addEventListener('pointermove', wake);
  addEventListener('pointerdown', wake);
  addEventListener('keydown', wake);
  wake();
  // Back to the start screen at the end
  audio.addEventListener('ended', () => {
    setPlaying(false);
    if (startLabel) startLabel.textContent = 'Play again';
    startEl.hidden = false;
  });
}

function loop(now: number) {
  if (playing) {
    if (PLAYER) {
      // The player follows the song exactly, and waits while it buffers
      if (!audio.paused && audio.readyState >= 2) t = audio.currentTime;
    } else t = !audio.paused && audio.readyState >= 2 ? audio.currentTime : t + (now - last) / 1000;
    if (t >= DURATION) setPlaying(false);
  }
  last = now;
  showFrame(Math.floor(t * FPS));
  scrub.value = String(t);
  const s = SECTIONS[sectionAt(t)];
  status.textContent = PLAYER ? `${fmtClock(t)} / ${fmtClock(DURATION)}` : `${fmt(t)}  ${s.shot} ${s.name}`;
  secButtons.forEach((b, i) => b.classList.toggle('on', SECTIONS[i] === s));
  requestAnimationFrame(loop);
}

// ---- Capture: ?capture&take=th01[&from=s&to=s] renders every frame at 1920x1080 and streams the raw pixels to the
// dev server, which pipes them into ffmpeg (renders/dreams/<take>_video.mp4). One reused buffer, so nothing piles up
// in the browser. Add &png to write numbered PNG files instead (slower, and the browser can run out of blob memory).
async function capture() {
  hud.style.display = 'none';
  const take = (params.get('take') ?? 'thoughts').replace(/[^\w-]/g, '') || 'thoughts';
  const from = clamp(Number(params.get('from') ?? 0) || 0, 0, DURATION);
  const to = clamp(Number(params.get('to') ?? DURATION) || DURATION, from, DURATION);
  const n0 = Math.round(from * FPS);
  const n1 = Math.round(to * FPS);
  const png = params.has('png');
  const gl = renderer.getContext();
  const buf = new Uint8Array(W * H * 4);
  if (!png) {
    const r = await fetch(`/__raw/start?take=${take}&w=${W}&h=${H}&fps=${FPS}`);
    if (!r.ok) throw new Error(`[capture] could not start the encoder: ${await r.text()}`);
    console.log(`[capture] encoding to ${await r.text()}`);
  }
  const started = performance.now();
  for (let n = n0; n < n1; n++) {
    showFrame(n);
    let r: Response;
    if (png) {
      const blob: Blob = await new Promise((res) => renderer.domElement.toBlob((b) => res(b!), 'image/png'));
      r = await fetch(`/__frame?take=${take}&n=${n - n0}`, { method: 'POST', body: blob });
    } else {
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      r = await fetch('/__raw/frame', { method: 'POST', body: buf });
    }
    if (!r.ok) throw new Error(`[capture] frame sink refused frame ${n - n0}`);
    if ((n - n0) % 24 === 0) {
      document.title = `${Math.round(((n - n0) / (n1 - n0)) * 100)}% capture ${take}`;
      console.log(`[capture] ${n - n0}/${n1 - n0} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
    }
  }
  if (!png) console.log(`[capture] ${await (await fetch('/__raw/end')).text()}`);
  document.title = `done capture ${take}`;
  const ss = n0 > 0 ? `-ss ${(n0 / FPS).toFixed(3)} ` : '';
  const video = png ? `-framerate 24 -i "../renders/dreams/${take}/f%06d.png"` : `-i "../renders/dreams/${take}_video.mp4"`;
  console.log(`[capture] done. Add the song, from the dreams folder:\nffmpeg ${video} ${ss}-i public/song.mp3 -map 0:v -map 1:a -c:v ${png ? 'libx264 -preset slow -crf 16 -pix_fmt yuv420p' : 'copy'} -c:a aac -b:a 320k -shortest "../renders/dreams/${take}.mp4"`);
}
// The subtitle font must be loaded before the first frame, or early frames would use the fallback
const fontReady = Promise.all([document.fonts.load(`italic 500 96px ${SUB_FONT}`), document.fonts.load(`500 96px ${SUB_FONT}`)]).catch(() => []);
void Promise.all([envelopesReady, voiceReady, fontReady, document.fonts.ready]).then(() => {
  // The words the swarm becomes in the breakdown are drawn with the subtitle font, so build them now
  const words = swarm.targets.words;
  (words.image.data as Float32Array).set(buildWords(LYRICS.map((l) => l.text.replace(/[,.:?]+$/, '')), SUB_FONT));
  words.needsUpdate = true;
  if (CAPTURE) void capture();
  else requestAnimationFrame(loop);
});

// For checking frames from the console: thoughtsAt(208.9), or grab([26, 80, 200], 'look') to save stills
// to renders/dreams/look/ (needs ?debug so the canvas keeps its pixels)
Object.assign(window, {
  subtitles,
  swarm,
  thoughtsAt: (x: number) => seek(x),
  grab: async (times: number[], take = 'look') => {
    playing = false;
    for (let i = 0; i < times.length; i++) {
      t = times[i];
      showFrame(Math.round(times[i] * FPS));
      const blob: Blob = await new Promise((res) => renderer.domElement.toBlob((b) => res(b!), 'image/png'));
      await fetch(`/__frame?take=${take}&n=${i}`, { method: 'POST', body: blob });
    }
    return 'ok';
  },
});
