import * as THREE from 'three';
import { Dream, type Frame } from '../dream';
import { level, levelSmooth } from '../envelopes';
import { precipitation } from '../fx';
import { BRIDGE, CUE } from '../timeline';
import { clamp, noise1, rng, smooth, textTexture } from '../util';

// A single flat line of light in the dark: the intro, the bridge and the outro.
// Intro: the line wakes as the music comes in. No text.
// Bridge: the spoken stanza, each line sending a pulse along the line. "Ash-grey silence started to unwind":
// the line loosens and comes apart into strands, "a web of songs entwined", the strands braid ("songs entwined
// within songs entwined") and fold back into one line on "Within one voice". Then the choir, "thousands of me
// in a thousand rooms": lit windows multiply in the dark behind the line, each one singing. Then the question,
// alone and quiet in the middle of the frame.
// Outro: the line steady and warm, then gone.
// (The old tester words and the "Off baseline" verdict belonged to lyrics that were cut.)

const N = 720;
const X0 = -9;
const X1 = 9;
const STRANDS = 8;

function strip(width: number, opacity: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
  const u = new Float32Array(N * 2);
  const v = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    u[i * 2] = u[i * 2 + 1] = i / (N - 1);
    v[i * 2] = -1;
    v[i * 2 + 1] = 1;
  }
  g.setAttribute('u', new THREE.BufferAttribute(u, 1));
  g.setAttribute('v', new THREE.BufferAttribute(v, 1));
  const idx: number[] = [];
  for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: opacity } },
    transparent: true,
    depthWrite: false,
    // The strip's triangles wind clockwise as seen from the camera, so with the default FrontSide
    // they were culled and the line of light never drew. Draw both sides.
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float u, v; varying float vU, vV; void main(){ vU = u; vV = v; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vU, vV;
      void main(){ float edge = smoothstep(0., .25, vU) * smoothstep(1., .75, vU); float core = 1. - abs(vV);
        gl_FragColor = vec4(uColor, uOpacity * edge * core * core); }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return { mesh, width, mat: m };
}
type Strip = ReturnType<typeof strip>;

function writeStrip(s: Strip, ys: Float32Array, widthScale = 1) {
  const pos = s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const w = (s.width * widthScale) / 2;
  for (let i = 0; i < N; i++) {
    const x = X0 + ((X1 - X0) * i) / (N - 1);
    pos.setXYZ(i * 2, x, ys[i] - w, 0);
    pos.setXYZ(i * 2 + 1, x, ys[i] + w, 0);
  }
  pos.needsUpdate = true;
}

/** Thousands of lit windows in the dark, each a room with someone singing in it. */
function windows(count: number, seed: number) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const s = new Float32Array(count * 4);
  // Towers of rooms at different depths, spread wide behind the line
  const towers = Array.from({ length: 90 }, () => {
    const z = -5 - Math.pow(r(), 0.8) * 45;
    const spread = 10 + -z * 0.75;
    return { x: (r() - 0.5) * 2 * spread, z, w: 2 + Math.floor(r() * 5), base: -9 - r() * 4, h: 6 + Math.floor(r() * 18) };
  });
  for (let i = 0; i < count; i++) {
    const tw = towers[Math.floor(r() * towers.length)];
    const col = Math.floor(r() * tw.w);
    const row = Math.floor(r() * tw.h);
    const x = tw.x + (col - tw.w / 2) * 0.9;
    const y = tw.base + row * 1.15;
    pos.set([x, y, tw.z], i * 3);
    // Born from the centre outwards: one voice, then many
    const d = Math.hypot(x / 30, (y - 0.5) / 12, (tw.z + 5) / 45);
    s.set([clamp(d * 0.75 + r() * 0.25), r(), r(), r()], i * 4);
  }
  // One small quad per window, placed per instance
  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(0.62, 0.8);
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  g.setAttribute('uv', quad.getAttribute('uv'));
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAmount: { value: 0 }, uTime: { value: 0 }, uBright: { value: 1 }, uFade: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uAmount, uTime, uBright; attribute vec3 aOffset; attribute vec4 aSeed;
      varying float vA; varying vec3 vC; varying vec2 vUv;
      void main(){
        float born = smoothstep(aSeed.x, aSeed.x + 0.06, uAmount);
        // Each room breathes on its own clock, like a voice
        float sing = 0.55 + 0.45 * sin(uTime * (1.3 + aSeed.y * 2.4) + aSeed.z * 40.0);
        vA = born * sing * uBright * (0.35 + 0.65 * aSeed.w);
        vC = mix(vec3(1.0, 0.64, 0.32), vec3(0.5, 0.72, 1.0), step(0.72, aSeed.y));
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position * (0.8 + 0.4 * aSeed.w) + aOffset, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFade; varying float vA; varying vec3 vC; varying vec2 vUv;
      void main(){
        vec2 d = abs(vUv - 0.5);
        float pane = smoothstep(0.5, 0.42, d.x) * smoothstep(0.5, 0.44, d.y);
        float bars = 1.0 - 0.6 * (smoothstep(0.04, 0.0, d.x) + smoothstep(0.03, 0.0, abs(vUv.y - 0.58)));
        // Warmer at the bottom of the pane, like a lamp in the room
        float lamp = 0.75 + 0.5 * (1.0 - vUv.y);
        gl_FragColor = vec4(vC * 1.6 * lamp, vA * pane * bars * uFade);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return Object.assign(mesh, { mat });
}

export class BaselineDream extends Dream {
  private core = strip(0.035, 1);
  private halo = strip(0.5, 0.18);
  private strands: Strip[] = [];
  private ys = new Float32Array(N);
  private sy = new Float32Array(N);
  private rain = precipitation({
    count: 2500, box: new THREE.Vector3(24, 14, 10), center: new THREE.Vector3(0, 0, 2), speed: 9, length: 0.35,
    color: '#7f9bb8', opacity: 0.22, wind: new THREE.Vector2(-0.8, 0), seed: 11,
  });
  private words: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private dust: THREE.Points;
  private rooms = windows(3200, 31);

  constructor() {
    super();
    this.scene.background = new THREE.Color('#010103');
    this.scene.add(this.rooms, this.halo.mesh, this.core.mesh, this.rain);
    for (let i = 0; i < STRANDS; i++) {
      const s = strip(0.026, 0);
      this.strands.push(s);
      this.scene.add(s.mesh);
    }
    const r = rng(3);
    // Two word slots: the stanza above the line, the question centred
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this.scene.add(mesh);
      this.words.push({ mesh, mat });
    }
    // Faint motes hanging in the dark
    const pos = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) pos.set([(r() - 0.5) * 20, (r() - 0.5) * 10, -r() * 12], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.02, color: '#334455', transparent: true, opacity: 0.6 }));
    this.scene.add(this.dust);
  }

  private setWord(slot: number, text: string, y: number, h: number, color: THREE.ColorRepresentation, a: number, maxW = 7.5) {
    const w = this.words[slot];
    if (a <= 0.001 || !text) {
      w.mesh.visible = false;
      return;
    }
    const tex = textTexture(text, 140);
    if (w.mat.map !== tex) {
      w.mat.map = tex;
      w.mat.needsUpdate = true;
    }
    w.mesh.visible = true;
    // Long lines shrink to stay inside the frame
    h = Math.min(h, maxW / tex.userData.aspect);
    w.mesh.scale.set(h * tex.userData.aspect, h, 1);
    w.mesh.position.set(0, y, 0.01);
    w.mat.color.set(color);
    w.mat.opacity = a;
  }

  update(f: Frame) {
    const { local, dur, variant, t } = f;
    const bridge = variant === 'bridge';
    const outro = variant === 'outro';
    this.rain.time.value = t;

    // Bridge states, all from absolute song time
    const st = BRIDGE.stanza;
    const unwind = bridge ? smooth(st[0].t, st[0].end, t) : 0; // the line loosens
    const web = bridge ? smooth(st[1].t - 0.5, st[1].t + 3.5, t) : 0; // ...and comes apart into strands
    const braid = bridge ? smooth(st[2].t, st[2].end, t) : 0; // the strands entwine
    const one = bridge ? smooth(st[3].t, st[3].t + 3.2, t) : 0; // and fold back into one voice
    const choir = bridge ? smooth(BRIDGE.choir.t - 0.6, BRIDGE.choir.end - 1.5, t) : 0;
    const choirOut = bridge ? smooth(BRIDGE.choir.end, BRIDGE.question.t - 0.3, t) : 0;
    const quiet = bridge ? smooth(BRIDGE.question.t - 2.2, BRIDGE.question.t, t) : 0; // the line goes still and dim
    const spread = web * (1 - one);
    // The outro line is calm and steady from the start
    const settled = outro ? smooth(0, 2.5, local) : 0;
    const voice = level('vocals', t, 0.6);

    // Pulses: each stanza line sends one along the line
    const pulses = bridge ? st.map((l) => l.t) : [];
    const lineY = (x: number) => {
      let y = noise1(x * 0.8 + local * 0.6, 1) * 0.012 * (1 - settled) * (1 - quiet);
      y += unwind * (1 - one) * noise1(x * 1.3 + t * 0.9, 12) * 0.06;
      for (const p of pulses) {
        const dt = t - p;
        if (dt < 0 || dt > 6) continue;
        const front = dt * 5;
        const dist = Math.abs(x) - front;
        const env = Math.exp(-dist * dist * 1.2) * Math.exp(-dt * 0.9);
        y += 0.22 * env * Math.sin(9 * x - dt * 14) * (0.8 + 0.4 * voice);
      }
      return y;
    };
    for (let i = 0; i < N; i++) this.ys[i] = lineY(X0 + ((X1 - X0) * i) / (N - 1));
    writeStrip(this.core, this.ys, 1 - spread * 0.5);
    writeStrip(this.halo, this.ys);

    // Strands: braid around the line, wider as the web opens, tighter twist as they entwine
    for (let k = 0; k < STRANDS; k++) {
      const s = this.strands[k];
      s.mesh.visible = spread > 0.002;
      if (!s.mesh.visible) continue;
      const ph = (k / STRANDS) * Math.PI * 2;
      const freq = 0.55 + braid * 1.1 + (k % 3) * 0.08;
      const amp = spread * (0.35 + 0.25 * ((k * 5) % STRANDS) / STRANDS);
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const x = X0 + (X1 - X0) * u;
        const edge = Math.sin(Math.PI * u);
        this.sy[i] = this.ys[i] + amp * edge * Math.sin(x * freq + ph + t * (0.6 + braid * 0.9) * (k % 2 ? 1 : -1)) + noise1(x * 0.7 + k * 9 + t * 0.3, 20 + k) * 0.05 * spread;
      }
      writeStrip(s, this.sy);
      s.mat.uniforms.uColor.value.set(k % 2 ? '#ffb45a' : '#7fb8ff');
      s.mat.uniforms.uOpacity.value = spread * 0.85;
    }

    const white = new THREE.Color('#dfe8ff');
    const amber = new THREE.Color('#ffb45a');
    const col = white.clone().lerp(amber, settled * 0.35 + one * (1 - choirOut) * 0.25);
    const intro = variant === 'intro' ? smooth(CUE.musicIn - 1.0, CUE.musicIn + 3.5, t) : smooth(0, 0.5, local);
    const outroFade = outro ? 1 - smooth(dur - 5.0, dur - 0.4, local) : 1;
    const dim = 1 - quiet * 0.85 - choir * (1 - choirOut) * 0.35;
    this.core.mat.uniforms.uColor.value.copy(col);
    this.halo.mat.uniforms.uColor.value.copy(col);
    this.core.mat.uniforms.uOpacity.value = intro * outroFade * dim * (1 + settled * 0.4);
    this.halo.mat.uniforms.uOpacity.value = 0.18 * intro * outroFade * dim * (1 + settled + one * 0.6);

    // Choir: the rooms light up, brighter where the backing vocals swell
    this.rooms.visible = choir > 0 && choirOut < 1;
    this.rooms.mat.uniforms.uAmount.value = choir * 1.06;
    this.rooms.mat.uniforms.uTime.value = t;
    this.rooms.mat.uniforms.uBright.value = 0.65 + 0.7 * levelSmooth('backing', t, 0.3, 0.5);
    this.rooms.mat.uniforms.uFade.value = 1 - choirOut;

    // Words
    const life = (t0: number, t1: number) => smooth(t0, t0 + 0.4, t) * (1 - smooth(t1, t1 + 0.8, t));
    const line = bridge ? [...st].reverse().find((l) => l.t <= t) : undefined;
    // Each line has faded out by the time the next one starts
    const lineA = line ? life(line.t, line.end - 0.8) * (0.8 + 0.3 * voice) : 0;
    this.setWord(0, line?.text ?? '', 1.05, 0.3, '#bcd4ff', Math.min(1, lineA));
    const q = BRIDGE.question;
    const qA = bridge ? life(q.t - 0.2, q.end + 0.6) * (0.7 + 0.3 * voice) : 0;
    this.setWord(1, q.text, 0, 0.22, '#e9dcc6', Math.min(1, qA) * 0.85, 6.2);

    // Camera: a slow push in and a slight drift; pulls back a little to let the rooms in
    const p = clamp(local / dur);
    this.camera.position.set(
      noise1(local * 0.2, 3) * 0.25 * (1 - quiet * 0.7),
      noise1(local * 0.17, 4) * 0.12,
      10.5 - p * 2.2 + choir * (1 - choirOut) * 1.2,
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.rotation.z = noise1(local * 0.1, 6) * 0.01;
    this.bloom = choir * (1 - choirOut) * 0.25 + one * (1 - choir) * 0.15;
  }
}
