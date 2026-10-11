import * as THREE from 'three';
import { textTexture } from '../util';
import { ROOMS } from './shapes';
import { waveInto, type VoiceStem } from './voice';

// The line of the voice: the real waveform of the vocal, drawn as a thread of light. This is the one thing kept from
// the first version. In the bridge it carries the stanza; in the choir it becomes a thousand small lines, one in each
// room, every one singing a moment out of step with the others.

const N = 512;
const X0 = -9;
const X1 = 9;

function strip(width: number) {
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
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float u, v; varying float vU, vV; void main(){ vU = u; vV = v; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vU, vV;
      void main(){ float edge = smoothstep(0., .2, vU) * smoothstep(1., .8, vU); float core = 1. - abs(vV);
        gl_FragColor = vec4(uColor, uOpacity * edge * core * core); }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh, mat, width };
}

const CH_SAMPLES = 128;

export class VoiceLines {
  readonly group = new THREE.Group();
  private core = strip(0.03);
  private halo = strip(0.45);
  private ys = new Float32Array(N);
  private bufVocal = new Float32Array(N);
  private bufMix = new Float32Array(N);
  // Choir: one row of waveform per room
  private chData = new Float32Array(CH_SAMPLES * ROOMS.length);
  private chTex = new THREE.DataTexture(this.chData, CH_SAMPLES, ROOMS.length, THREE.RedFormat, THREE.FloatType);
  private chMat: THREE.ShaderMaterial;
  private chMesh: THREE.Mesh;
  private chRow = new Float32Array(CH_SAMPLES);
  private words: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  /** The waveform currently drawn, for the particle sim (512 samples). */
  readonly current = new Float32Array(N);

  constructor() {
    this.group.add(this.halo.mesh, this.core.mesh);
    this.chTex.magFilter = this.chTex.minFilter = THREE.LinearFilter;
    // Instanced choir lines: a strip of CH_SAMPLES points per room
    const g = new THREE.InstancedBufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    for (let i = 0; i < CH_SAMPLES; i++) {
      const u = i / (CH_SAMPLES - 1);
      pos.push(u, -1, 0, u, 1, 0);
      uv.push(u, 0, u, 1);
    }
    const idx: number[] = [];
    for (let i = 0; i < CH_SAMPLES - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const room = new Float32Array(ROOMS.length * 4);
    ROOMS.forEach((r, i) => room.set([r.x, r.y, r.z, r.w], i * 4));
    g.setAttribute('aRoom', new THREE.InstancedBufferAttribute(room, 4));
    const row = new Float32Array(ROOMS.length);
    row.forEach((_, i) => (row[i] = (i + 0.5) / ROOMS.length));
    g.setAttribute('aRow', new THREE.InstancedBufferAttribute(row, 1));
    g.instanceCount = ROOMS.length;
    this.chMat = new THREE.ShaderMaterial({
      uniforms: { tWave: { value: this.chTex }, uA: { value: 0 }, uAmp: { value: 0.3 }, uSpread: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uSpread, uTime; attribute vec4 aRoom; attribute float aRow;
        varying vec2 vQ; varying float vRow, vOn;
        void main(){
          // A lit window: rooms light up from the middle outwards, each one breathing on its own clock
          float d = length(aRoom.xy / vec2(14.0, 6.0)) * 0.6 + (-aRoom.z / 18.0) * 0.4;
          vOn = smoothstep(d, d + 0.12, uSpread * 1.1);
          vOn *= 0.55 + 0.45 * sin(uTime * (0.7 + fract(aRow * 91.3) * 1.6) + aRow * 230.0);
          vOn *= step(0.4, fract(aRow * 53.71)) * (0.4 + 0.6 * fract(aRow * 17.3)); // not every room is lit
          vec2 q = vec2(uv.x - 0.5, position.y * 0.5);
          vQ = q;
          vRow = aRow;
          vec3 p = aRoom.xyz + vec3(q.x * aRoom.w * 0.92, q.y * aRoom.w * 1.18, -0.02);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uA; varying vec2 vQ; varying float vRow, vOn;
        void main(){
          vec2 d = abs(vQ);
          float pane = smoothstep(0.5, 0.2, d.x) * smoothstep(0.5, 0.25, d.y);
          // Warmer and brighter low in the pane, like a lamp on a table
          float lamp = 0.55 + 0.8 * smoothstep(0.5, -0.5, vQ.y);
          vec3 c = mix(vec3(1.0, 0.66, 0.36), vec3(0.62, 0.78, 1.0), step(0.72, fract(vRow * 37.13)));
          gl_FragColor = vec4(c * lamp, uA * pane * vOn);
        }`,    });
    this.chMesh = new THREE.Mesh(g, this.chMat);
    this.chMesh.frustumCulled = false;
    this.group.add(this.chMesh);

    // Two word slots: the stanza above the line, the question centred
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, opacity: 0, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.words.push({ mesh, mat });
    }
  }

  /**
   * Draw the line at song time t.
   * src 0..1 blends the mix waveform into the lead vocal; level scales it so silence is a flat line.
   * pulses: song times at which a pulse runs out from the centre along the line (the stanza lines).
   */
  update(t: number, opts: { alpha: number; amp: number; src: number; level: number; pulses: number[]; color: THREE.Color; spread: number }) {
    waveInto('vocals', t, this.bufVocal, 0.45);
    waveInto('mix', t, this.bufMix, 0.45);
    for (let i = 0; i < N; i++) {
      const x = X0 + ((X1 - X0) * i) / (N - 1);
      const env = Math.sin((i / (N - 1)) * Math.PI);
      let y = (this.bufMix[i] * (1 - opts.src) + this.bufVocal[i] * opts.src) * opts.amp * env * env;
      for (const p of opts.pulses) {
        const dt = t - p;
        if (dt < 0 || dt > 6) continue;
        const dist = Math.abs(x) - dt * 5;
        y += 0.22 * Math.exp(-dist * dist * 1.2) * Math.exp(-dt * 0.9) * Math.sin(9 * x - dt * 14) * (0.8 + 0.4 * opts.level);
      }
      this.ys[i] = y;
      this.current[i] = y / Math.max(0.05, opts.amp);
    }
    for (const s of [this.core, this.halo]) {
      const pos = s.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const w = s.width / 2;
      for (let i = 0; i < N; i++) {
        const x = X0 + ((X1 - X0) * i) / (N - 1);
        pos.setXYZ(i * 2, x, this.ys[i] - w, 0);
        pos.setXYZ(i * 2 + 1, x, this.ys[i] + w, 0);
      }
      pos.needsUpdate = true;
      s.mat.uniforms.uColor.value.copy(opts.color);
    }
    this.core.mat.uniforms.uOpacity.value = opts.alpha;
    this.halo.mat.uniforms.uOpacity.value = opts.alpha * 0.22;
    this.core.mesh.visible = this.halo.mesh.visible = opts.alpha > 0.002;
  }

  /** The choir: every room sings the voice from a slightly different moment (and the backing choir underneath). */
  updateChoir(t: number, amount: number, level: number) {
    this.chMesh.visible = amount > 0.002;
    if (!this.chMesh.visible) return;
    this.chMat.uniforms.uTime.value = t;
    this.chMat.uniforms.uA.value = amount * (0.12 + 0.18 * level);
    this.chMat.uniforms.uSpread.value = Math.min(1, amount * 1.15);
    this.chMat.uniforms.uAmp.value = 0.5;
  }

  setWord(slot: number, text: string, y: number, h: number, color: THREE.ColorRepresentation, a: number, maxW = 7.5) {
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
    h = Math.min(h, maxW / tex.userData.aspect);
    w.mesh.scale.set(h * tex.userData.aspect, h, 1);
    w.mesh.position.set(0, y, 0.01);
    w.mat.color.set(color);
    w.mat.opacity = a;
  }
}
