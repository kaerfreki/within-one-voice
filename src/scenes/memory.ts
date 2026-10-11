import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { Dream, type Frame } from '../dream';
import { glow, precipitation } from '../fx';
import { ravenGeometry } from '../raven';
import { drumPulse } from '../envelopes';
import { CUE } from '../timeline';
import { clamp, easeInOut, noise1, rng, smooth } from '../util';

// Verse 1: "There's a boy in my head, whittling ash in the dark, carving a raven by the fire's last spark."
// A fire in a snowbound forest at night. Above it a raven is carved out of a branch, point by point.
// On "I can't tell you whose hands" it flickers electric blue: whose memory is this?

export function embers(count: number, seed: number, color: THREE.ColorRepresentation, height = 3, spread = 0.4) {
  const r = rng(seed);
  const s = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) s[i] = r();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(s, 4));
  const time = { value: 0 };
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uColor: { value: new THREE.Color(color) }, uH: { value: height }, uSpread: { value: spread }, uAmount: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uH, uSpread; attribute vec4 seed; varying float vA;
      void main(){
        float life = fract(seed.x + uTime * (0.25 + 0.35 * seed.y));
        float a = seed.z * 6.2831 + uTime * (0.5 + seed.w);
        float rad = uSpread * (0.3 + life) * seed.w;
        vec3 p = vec3(cos(a) * rad, life * uH * (0.5 + seed.y), sin(a) * rad);
        p.x += sin(uTime * 2.0 + seed.y * 30.0) * 0.08 * life;
        vA = smoothstep(0.0, 0.08, life) * (1.0 - life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + 4.0 * seed.z) * (1.0 - life * 0.6) * 4.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAmount; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(uColor * 2.5, vA * uAmount * smoothstep(.5, .0, d)); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return Object.assign(p, { time, mat: m });
}

export class MemoryDream extends Dream {
  private fireLight = new THREE.PointLight('#ff8a3c', 30, 0, 2);
  private fireGlow = glow('#ff7a2a', 2.4, 0.9);
  private fireCore = glow('#ffd29a', 0.9, 1);
  private sparks = embers(500, 21, '#ff9a4a', 3.2, 0.35);
  private snow = precipitation({ count: 4000, box: new THREE.Vector3(22, 12, 22), center: new THREE.Vector3(0, 5, 0), speed: 0.7, length: 0, size: 60, color: '#d8e2ff', opacity: 0.55, wind: new THREE.Vector2(0.25, 0.1), seed: 4 });
  private carve: THREE.Points;
  private carveMat: THREE.ShaderMaterial;

  constructor() {
    super();
    const bg = new THREE.Color('#05070c');
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg, 0.07);
    this.scene.add(new THREE.HemisphereLight('#3a4a6a', '#0a0a10', 0.35));

    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: '#b9c4d2', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Forest: tall dark trunks, none near the fire
    const r = rng(9);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.15, 1, 7), new THREE.MeshStandardMaterial({ color: '#15130f', roughness: 1 }), 260);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2;
      const d = 4.5 + Math.pow(r(), 0.7) * 30;
      const rad = 0.1 + r() * 0.25;
      const h = 14 + r() * 10;
      m.compose(new THREE.Vector3(Math.cos(a) * d, h / 2, Math.sin(a) * d), new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.05)), new THREE.Vector3(rad, h, rad));
      trunks.setMatrixAt(i, m);
    }
    this.scene.add(trunks);

    // Fire: crossed logs, glow, light and sparks
    const logMat = new THREE.MeshStandardMaterial({ color: '#1b120b', roughness: 1, emissive: '#ff4a10', emissiveIntensity: 0.15 });
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 7), logMat);
      log.rotation.set(Math.PI / 2 - 0.35, (i / 4) * Math.PI * 2, 0, 'YXZ');
      log.position.y = 0.15;
      this.scene.add(log);
    }
    this.fireLight.position.set(0, 0.5, 0);
    this.fireGlow.position.set(0, 0.45, 0);
    this.fireCore.position.set(0, 0.3, 0);
    this.scene.add(this.fireLight, this.fireGlow, this.fireCore, this.sparks, this.snow);

    // The carving: raven surface points that start inside a branch
    const N = 9000;
    const raven = new THREE.Mesh(ravenGeometry(0.4, 0.5));
    const sampler = new MeshSurfaceSampler(raven).build();
    const target = new Float32Array(N * 3);
    const start = new Float32Array(N * 3);
    const order = new Float32Array(N);
    const extra = new Float32Array(N);
    const p = new THREE.Vector3();
    const rr = rng(17);
    for (let i = 0; i < N; i++) {
      sampler.sample(p);
      p.multiplyScalar(2.4);
      target.set([p.x, p.y, p.z], i * 3);
      // The branch: a log along Z, a little longer than the bird
      const a = rr() * Math.PI * 2;
      const rad = Math.sqrt(rr()) * 0.32;
      start.set([Math.cos(a) * rad, Math.sin(a) * rad, (rr() - 0.5) * 1.5], i * 3);
      // Carve from the beak back to the tail, with some noise
      order[i] = clamp((p.z + 0.85) / 1.6 + (rr() - 0.5) * 0.25);
      extra[i] = rr();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(target, 3));
    g.setAttribute('start', new THREE.BufferAttribute(start, 3));
    g.setAttribute('order', new THREE.BufferAttribute(order, 1));
    g.setAttribute('extra', new THREE.BufferAttribute(extra, 1));
    this.carveMat = new THREE.ShaderMaterial({
      uniforms: { uP: { value: 0 }, uTime: { value: 0 }, uElectric: { value: 0 }, uFire: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uP, uTime, uElectric; attribute vec3 start; attribute float order, extra;
        varying float vDone; varying float vExtra;
        void main(){
          float k = smoothstep(order - 0.08, order + 0.08, uP * 1.15 - 0.05);
          vec3 p = mix(start, position, k);
          // Chips flying off as each part is carved
          float chip = step(0.72, extra) * smoothstep(0.0, 1.0, k);
          vec3 chipDir = normalize(start + vec3(0.0, 0.2, 0.0)) * (0.6 + extra);
          p = mix(p, start + chipDir * k * 1.2 - vec3(0.0, k * k * 2.2, 0.0), chip);
          p += (vec3(fract(extra * 91.0), fract(extra * 57.0), fract(extra * 33.0)) - 0.5) * 0.03 * uElectric * sin(uTime * 40.0 + extra * 50.0);
          vDone = k; vExtra = extra * (1.0 - chip * k);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.5 + 2.5 * extra) * 3.0 / -mv.z * (1.0 - chip * k * 0.8);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uElectric, uFire; varying float vDone; varying float vExtra;
        void main(){
          float d = length(gl_PointCoord - .5);
          vec3 wood = mix(vec3(0.35, 0.18, 0.08), vec3(1.0, 0.6, 0.3), vDone) * uFire;
          vec3 elec = vec3(0.35, 0.75, 1.6);
          vec3 c = mix(wood, elec, uElectric * step(0.5, fract(vExtra * 7.0 + uElectric)));
          gl_FragColor = vec4(c, smoothstep(.5, .1, d) * (0.35 + 0.65 * vDone));
        }`,
    });
    this.carve = new THREE.Points(g, this.carveMat);
    this.carve.position.set(0, 1.55, 0);
    this.carve.frustumCulled = false;
    this.scene.add(this.carve);
  }

  update(f: Frame) {
    const { local, dur, t } = f;
    this.snow.time.value = t;
    this.sparks.time.value = t;
    // The band lifts at 0:44: the fire flares and throws more sparks; drum hits kick it
    const lift = smooth(CUE.bandLift - 1.5, CUE.bandLift + 1.0, t);
    const hit = drumPulse(t) * lift;
    const flick = 0.75 + 0.25 * noise1(t * 7, 1) + 0.1 * noise1(t * 23, 2);
    this.fireLight.intensity = (26 + lift * 10 + hit * 18) * flick;
    this.fireGlow.material.opacity = Math.min(1, (0.75 + lift * 0.15 + hit * 0.2) * flick);
    this.fireCore.scale.setScalar(0.8 + 0.25 * flick + lift * 0.15 + hit * 0.2);
    this.sparks.mat.uniforms.uAmount.value = 0.8 + lift * 0.5 + hit * 0.6;

    // Carving starts on "carving a raven by the fire's last spark" and is done by the end of the band's first bars;
    // it flickers electric on "I can't tell you whose hands ... how old", and again for good at the end of the verse
    const p = easeInOut(clamp((t - (CUE.carving - 3.5)) / (CUE.village - (CUE.carving - 3.5))));
    this.carveMat.uniforms.uP.value = p;
    this.carveMat.uniforms.uTime.value = t;
    const e1 = smooth(CUE.whoseHands - 0.2, CUE.whoseHands + 0.5, t) * (1 - smooth(CUE.howOld - 0.4, CUE.howOld + 0.6, t));
    const e2 = smooth(CUE.answer + 1.0, dur + (t - local) - 0.6, t);
    this.carveMat.uniforms.uElectric.value = Math.max(e1 * 0.8, e2);
    this.carveMat.uniforms.uFire.value = flick;
    this.carve.rotation.y = -0.6 + local * 0.05;
    this.carve.position.y = 1.55 + Math.sin(local * 0.7) * 0.04;

    // Camera: a slow orbit around the fire, closing in
    const a = 0.9 + local * 0.035;
    const rad = 4.4 - 1.4 * clamp(local / dur);
    // A memory skip: the camera jumps back a moment, like a stutter, on "whose hands" and on "my village, my name"
    const skip = [CUE.whoseHands, CUE.village].some((c) => t >= c && t < c + 0.12) ? 0.4 : 0;
    this.camera.position.set(Math.cos(a - skip) * rad, 1.25 + Math.sin(local * 0.2) * 0.1, Math.sin(a - skip) * rad);
    this.camera.lookAt(0, 1.25, 0);
    this.bloom = lift * 0.1 + e1 * 0.15;
  }
}
