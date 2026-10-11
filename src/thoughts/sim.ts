import * as THREE from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { GLSL_NOISE, rng } from '../util';
import { N, SIZE, type ShapeName } from './shapes';

// The swarm: 262,144 particles simulated on the GPU. Velocity and position live in float textures.
// Forces: a spring to the current pose (each particle blending from the previous pose on its own delay),
// curl-noise drift, two flock leaders (Thought, Memory), the line of the voice, rising, a braid around the line,
// thrown stones, and re-birth on the voice line.

const SIMPLEX = /* glsl */ `
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 curl(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0), dy = vec3(0.0, e, 0.0), dz = vec3(0.0, 0.0, e);
  float n1 = snoise(p + dy + vec3(31.4)), n2 = snoise(p - dy + vec3(31.4));
  float n3 = snoise(p + dz + vec3(-17.2)), n4 = snoise(p - dz + vec3(-17.2));
  float n5 = snoise(p + dz), n6 = snoise(p - dz);
  float n7 = snoise(p + dx + vec3(31.4)), n8 = snoise(p - dx + vec3(31.4));
  float n9 = snoise(p + dx + vec3(-17.2)), n10 = snoise(p - dx + vec3(-17.2));
  float n11 = snoise(p + dy), n12 = snoise(p - dy);
  return vec3((n1 - n2) - (n3 - n4), (n5 - n6) - (n9 - n10), (n7 - n8) - (n11 - n12)) / (2.0 * e);
}`;

const COMMON = /* glsl */ `
uniform float uTime, uDt, uEmit, uLineAmp;
uniform sampler2D tWave;
${GLSL_NOISE}
vec3 hash3(vec2 p){ return vec3(hash21(p), hash21(p + 17.31), hash21(p + 41.7)); }
float waveAt(float x){ float u = clamp((x + 9.0) / 18.0, 0.0, 1.0); return texture2D(tWave, vec2(u, 0.5)).r; }
float lineEnv(float x){ float u = clamp((x + 9.0) / 18.0, 0.0, 1.0); return sin(u * 3.14159); }
// Re-birth on the voice line: when a particle's life runs out it is born again where the voice is
bool reborn(vec4 pos, float s){ return uEmit > 0.0 && pos.w - uDt * uEmit * (0.4 + s) < 0.0; }
vec3 birthPlace(vec2 uv){
  // Born from a low bed of embers, like sparks off a fire
  float a = hash21(uv + fract(uTime * 0.37) * 91.0) * 6.2832;
  float r = sqrt(hash21(uv * 3.1 + uTime)) * 3.2;
  return vec3(cos(a) * r, -2.4 + hash21(uv * 7.7 - uTime) * 0.3, sin(a) * r * 0.5);
}`;

const VELOCITY = /* glsl */ `
uniform sampler2D tPrevA, tCurA, tCurB;
uniform float uMorph, uWing, uK, uFlow, uFlowScale, uFlowSpeed, uDrag, uFlock, uFlockR, uSwirl, uRise, uLineW, uEmitV,
  uSpinX, uStones, uPupil, uSnare, uDrum, uBurst;
uniform vec3 uLead0, uLead1;
${COMMON}
${SIMPLEX}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(tPos, uv);
  vec3 v = texture2D(tVel, uv).xyz;
  vec3 p = pos.xyz;
  vec3 h = hash3(uv);
  float s = h.x;
  if (reborn(pos, s)) {
    gl_FragColor = vec4((h - 0.5) * 0.4 + vec3(0.0, uEmitV * (0.5 + h.y), 0.0), 1.0);
    return;
  }
  // Pose: previous shape -> current shape, staggered per particle
  vec4 A = texture2D(tPrevA, uv);
  vec4 B = mix(texture2D(tCurA, uv), texture2D(tCurB, uv), uWing);
  float m = smoothstep(s * 0.55, s * 0.55 + 0.45, uMorph);
  vec3 tp = mix(A.xyz, B.xyz, m);
  float kind = m > 0.5 ? B.w : A.w;
  if (kind > 0.5 && kind < 1.5) {
    // Iris fibre: the pupil opens and closes, the iris squeezes outwards
    float r = length(tp.xy);
    float rr = uPupil * 0.95 + (r - 0.95) * (3.2 - uPupil * 0.95) / 2.25;
    tp.xy *= rr / max(r, 1e-3);
  } else if (kind > 1.5 && kind < 2.5) {
    tp.xy *= uSnare;                       // the snare wire closing
  } else if (kind > 2.5) {
    // A thrown stone: flies in from the side on its own clock and lands on the man
    float cycle = 2.2 + h.y * 1.6;
    float ph = fract(uTime / cycle + h.z);
    vec3 from = vec3((h.y > 0.5 ? 1.0 : -1.0) * (9.0 + h.z * 5.0), -1.0 + h.x * 2.0, 2.0 + h.y * 3.0);
    vec3 arc = mix(from, tp, ph) + vec3(0.0, sin(ph * 3.14159) * (3.0 + h.z * 2.0), 0.0);
    tp = mix(tp + (h - 0.5) * 0.4 + vec3(0.0, -0.3, 0.0), arc, uStones);
  }
  vec3 acc = (tp - p) * uK * (0.7 + 0.6 * h.y);
  // Drift of thought
  acc += curl(p * uFlowScale + vec3(0.0, 0.0, uTime * uFlowSpeed)) * uFlow;
  // Flocks: Thought follows one leader, Memory the other
  if (uFlock > 0.0) {
    // A linear pull plus a turn around a slowly tumbling axis: particles fall into long looping orbits
    // around their leader, which the trails draw out as ribbons (a murmuration, not a ball)
    bool th = uv.x < 0.5;
    vec3 lead = th ? uLead0 : uLead1;
    lead += (h - 0.5) * uFlockR;
    vec3 d = lead - p;
    float ph = uTime * (th ? 0.31 : -0.27);
    vec3 axis = normalize(vec3(sin(ph) * 0.6, 1.0, cos(ph * 1.3) * 0.6));
    acc += d * 1.3 * uFlock;
    // The turn is capped (it grows with distance only up to ~1 unit): an unbounded turn outruns the drag and the
    // flock spirals apart over a minute or two
    float dl = length(d);
    acc += cross(d / (dl + 1.0), axis) * min(dl, 4.0) * uSwirl * uFlock * (0.6 + 0.8 * s) * 0.9;
  }
  // The line of the voice
  if (uLineW > 0.0) {
    float wy = waveAt(p.x) * uLineAmp * lineEnv(p.x);
    acc.y += (wy - p.y) * uLineW * 3.0;
    acc.z += -p.z * uLineW * 1.5;
  }
  acc.y += uRise * (0.3 + h.y);
  // Braid: turn around the line
  acc += cross(vec3(1.0, 0.0, 0.0), p) * uSpinX * 2.0 - vec3(0.0, p.y, p.z) * uSpinX * 0.3;
  // A kick on each drum hit
  acc += normalize(p - vec3(0.0, 0.0, 0.0) + 1e-3) * uDrum * (0.5 + s) * 4.0;
  acc += normalize(p + 1e-3) * uBurst * (0.5 + s);
  v = v * exp(-uDrag * uDt) + acc * uDt;
  float sp = length(v);
  if (sp > 30.0) v *= 30.0 / sp;
  gl_FragColor = vec4(v, 1.0);
}`;

const POSITION = /* glsl */ `
uniform float uQuant;
${COMMON}
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(tPos, uv);
  vec3 v = texture2D(tVel, uv).xyz;
  float s = hash21(uv);
  if (reborn(pos, s)) { gl_FragColor = vec4(birthPlace(uv), 1.0); return; }
  vec3 p = pos.xyz + v * uDt;
  float life = uEmit > 0.0 ? pos.w - uDt * uEmit * (0.4 + s) : pos.w;
  gl_FragColor = vec4(p, life);
}`;

const WAVE_N = 512;

export class Swarm {
  private gpu: GPUComputationRenderer;
  private pos: Variable;
  private vel: Variable;
  private init: { pos: THREE.DataTexture; vel: THREE.DataTexture };
  readonly targets: Record<ShapeName, THREE.DataTexture>;
  readonly waveTex: THREE.DataTexture;
  // The voice waveform is always 512 samples (VoiceLines writes 512), whatever the particle grid size.
  // Sizing it from SIZE crashed the first frame in low-quality mode (256): Float32Array.set out of bounds.
  readonly waveData = new Float32Array(WAVE_N);

  constructor(renderer: THREE.WebGLRenderer, shapes: Record<ShapeName, Float32Array>) {
    this.gpu = new GPUComputationRenderer(SIZE, SIZE, renderer);
    this.gpu.setDataType(THREE.FloatType);
    const p0 = this.gpu.createTexture();
    const v0 = this.gpu.createTexture();
    const r = rng(99);
    const pd = p0.image.data as Float32Array;
    // The video opens on the giant raven already formed (the hook), so the swarm starts in that shape
    const seed = shapes.flapUp;
    for (let i = 0; i < N; i++) {
      pd[i * 4] = seed[i * 4];
      pd[i * 4 + 1] = seed[i * 4 + 1];
      pd[i * 4 + 2] = seed[i * 4 + 2];
      pd[i * 4 + 3] = r(); // life, staggered
    }
    this.init = { pos: p0, vel: v0 };
    this.vel = this.gpu.addVariable('tVel', VELOCITY, v0);
    this.pos = this.gpu.addVariable('tPos', POSITION, p0);
    this.gpu.setVariableDependencies(this.vel, [this.pos, this.vel]);
    this.gpu.setVariableDependencies(this.pos, [this.pos, this.vel]);

    this.targets = {} as Record<ShapeName, THREE.DataTexture>;
    for (const [name, data] of Object.entries(shapes) as [ShapeName, Float32Array][]) {
      const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      this.targets[name] = tex;
    }
    this.waveTex = new THREE.DataTexture(this.waveData, WAVE_N, 1, THREE.RedFormat, THREE.FloatType);
    this.waveTex.magFilter = this.waveTex.minFilter = THREE.LinearFilter;
    this.waveTex.needsUpdate = true;

    const common = { uTime: { value: 0 }, uDt: { value: 1 / 24 }, uEmit: { value: 0 }, uLineAmp: { value: 0.4 }, tWave: { value: this.waveTex } };
    Object.assign(this.vel.material.uniforms, common, {
      tPrevA: { value: this.targets.seed }, tCurA: { value: this.targets.seed }, tCurB: { value: this.targets.seed },
      uMorph: { value: 1 }, uWing: { value: 0 }, uK: { value: 0 }, uFlow: { value: 0 }, uFlowScale: { value: 0.3 }, uFlowSpeed: { value: 0.05 },
      uDrag: { value: 1.5 }, uFlock: { value: 0 }, uFlockR: { value: 1 }, uSwirl: { value: 0 }, uRise: { value: 0 }, uLineW: { value: 0 },
      uEmitV: { value: 0.5 }, uSpinX: { value: 0 }, uStones: { value: 0 }, uPupil: { value: 1 }, uSnare: { value: 1 }, uDrum: { value: 0 },
      uBurst: { value: 0 }, uLead0: { value: new THREE.Vector3(-4, 0, 0) }, uLead1: { value: new THREE.Vector3(4, 0, 0) },
    });
    // The position shader shares the time/emit/wave uniforms (same objects, so one write updates both)
    Object.assign(this.pos.material.uniforms, common, { uQuant: { value: 0 } });
    const err = this.gpu.init();
    if (err) throw new Error(err);
  }

  get uniforms() {
    return this.vel.material.uniforms;
  }
  get posUniforms() {
    return this.pos.material.uniforms;
  }

  step() {
    this.gpu.compute();
  }

  reset() {
    for (const rt of this.pos.renderTargets) this.gpu.renderTexture(this.init.pos, rt);
    for (const rt of this.vel.renderTargets) this.gpu.renderTexture(this.init.vel, rt);
  }

  get positions() {
    return this.gpu.getCurrentRenderTarget(this.pos).texture;
  }
  get velocities() {
    return this.gpu.getCurrentRenderTarget(this.vel).texture;
  }
}
