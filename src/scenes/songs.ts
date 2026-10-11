import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { Dream, type Frame } from '../dream';
import { buildFigure } from '../figure';
import { precipitation } from '../fx';
import { drumPulse, levelSmooth } from '../envelopes';
import { CUE, SECTIONS } from '../timeline';
import { GLSL_NOISE, clamp, easeInOut, noise1, rng, smooth } from '../util';

// Breakdown: "I have sung for the dead of a hundred lands, I have carried their names in my two bare hands."
// The breakdown is loud and full, so this is big: Azri, seen from behind, stands on black water in the rain.
// The names he carries pour out of his hands and rise, more and more of them, and lights lift off the water all
// around him; the drums kick them and the rim light. On "and the songs live on" hundreds surge up at once.
// The rain can't put them out.

const WATER_SHADER = {
  uniforms: {
    color: { value: new THREE.Color('#556070') },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vXZ;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vXZ = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uTime; varying vec4 vUv; varying vec2 vXZ;
    ${GLSL_NOISE}
    // Rain rings: one expanding ring per grid cell, each on its own clock
    vec2 ripples(vec2 p){
      vec2 acc = vec2(0.0);
      for (int k = 0; k < 2; k++){
        vec2 q = p * (k == 0 ? 2.2 : 3.7);
        vec2 c = floor(q);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
          vec2 id = c + vec2(i, j);
          vec2 ctr = id + vec2(hash21(id), hash21(id + 7.1));
          float ph = fract(uTime * 0.9 + hash21(id + 3.3));
          vec2 d = q - ctr; float r = length(d);
          float ring = sin((r - ph * 1.2) * 40.0) * smoothstep(0.08, 0.0, abs(r - ph * 1.2)) * (1.0 - ph);
          acc += normalize(d + 1e-4) * ring;
        }
      }
      return acc;
    }
    void main(){
      vec2 rp = ripples(vXZ);
      vec4 uv = vUv; uv.xy += rp * 0.025 * uv.w + vec2(fbm(vXZ * 0.4 + uTime * 0.1) - 0.5) * 0.01 * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      gl_FragColor = vec4(refl * color + vec3(0.004, 0.006, 0.01), 1.0);
    }`,
};

export class SongsDream extends Dream {
  private water: Reflector;
  private names: THREE.Points;
  private namesMat: THREE.ShaderMaterial;
  private handLight = new THREE.PointLight('#ffb466', 6, 0, 2);
  private rain = precipitation({ count: 8000, box: new THREE.Vector3(30, 18, 30), center: new THREE.Vector3(0, 8, -2), speed: 13, length: 0.45, color: '#9fb4d0', opacity: 0.24, wind: new THREE.Vector2(0.6, 0), seed: 19 });
  private rim = new THREE.DirectionalLight('#7a9ad0', 1.2);
  private figure: THREE.Group;

  constructor() {
    super();
    const bg = new THREE.Color('#020306');
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg, 0.045);
    this.scene.add(new THREE.HemisphereLight('#26324a', '#000000', 0.4));
    this.rim.position.set(0, 4, -8);
    this.scene.add(this.rim);

    this.water = new Reflector(new THREE.PlaneGeometry(80, 80), { textureWidth: 1024, textureHeight: 576, shader: WATER_SHADER, clipBias: 0.003 });
    this.water.rotation.x = -Math.PI / 2;
    this.scene.add(this.water);

    const body = new THREE.MeshStandardMaterial({ color: '#0d0f14', roughness: 0.8 });
    const mask = new THREE.MeshStandardMaterial({ color: '#cfc8bc', roughness: 0.6 });
    this.figure = buildFigure(body, mask);
    this.figure.rotation.y = 0; // facing -Z, away from the camera
    this.scene.add(this.figure);
    this.handLight.position.set(0, 1.15, -0.45);
    this.scene.add(this.handLight, this.rain);

    // The names. Three kinds of light, each born at its own song time and rising:
    //  0: out of his hands, quicker and quicker through the section
    //  1: out of the black water all around him, "the dead of a hundred lands"
    //  2: the surge on "and the songs live on", hundreds at once
    const HANDS = 1800;
    const FIELD = 1400;
    const SURGE = 1100;
    const N = HANDS + FIELD + SURGE;
    const r = rng(77);
    const start = SECTIONS.find((s) => s.dream === 'songs')?.start ?? 215;
    const seed = new Float32Array(N * 4);
    const origin = new Float32Array(N * 3);
    const kind = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let birth: number;
      if (i < HANDS) {
        birth = start + 0.4 + Math.pow(i / HANDS, 0.7) * (CUE.songsLiveOnEnd - start - 0.4);
        origin.set([0, 1.15, -0.45], i * 3);
        kind[i] = 0;
      } else if (i < HANDS + FIELD) {
        // Slow at first, then everywhere from "if I'm built, then I'm built out of every song"
        const k = (i - HANDS) / FIELD;
        birth = k < 0.3 ? start + 2 + (k / 0.3) * (CUE.built - start - 2) : CUE.built + ((k - 0.3) / 0.7) * (CUE.songsLiveOnEnd - CUE.built);
        const a = r() * Math.PI * 2;
        const d = 3 + Math.pow(r(), 0.6) * 34;
        // Mostly out ahead of him, some off to the sides
        origin.set([Math.cos(a) * d, 0.04, -Math.abs(Math.sin(a)) * d - 1], i * 3);
        kind[i] = 1;
      } else {
        birth = CUE.songsLiveOn + Math.pow(r(), 2) * 2.2;
        origin.set([(r() - 0.5) * 1.2, 1.1 + r() * 0.3, -0.45 - r() * 0.6], i * 3);
        kind[i] = 2;
      }
      seed.set([birth, r(), r(), r()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(origin, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
    this.namesMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uPulse: { value: 0 }, uEnergy: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uT, uPulse, uEnergy; attribute vec4 seed; attribute float kind; varying float vA; varying float vCold;
        void main(){
          float age = uT - seed.x;
          float life = kind > 1.5 ? 26.0 : 20.0;
          vA = smoothstep(0.0, 0.5, age) * (1.0 - smoothstep(life * 0.6, life, age));
          age = max(age, 0.0);
          vec3 p = position;
          if (kind < 0.5) {
            // A widening spiral up out of his hands
            float a = seed.y * 6.2831 + age * (0.35 + seed.z * 0.45);
            float rad = 0.15 + age * (0.3 + seed.w * 0.7);
            p += vec3(cos(a) * rad, age * (0.8 + seed.z * 0.9), sin(a) * rad - age * 0.35);
          } else if (kind < 1.5) {
            // Straight up off the water, swaying
            p += vec3(sin(age * 0.7 + seed.y * 30.0) * 0.4, age * (0.5 + seed.z * 0.8), cos(age * 0.5 + seed.w * 20.0) * 0.3);
          } else {
            // The surge: a fountain thrown up and out, slowing as it climbs
            float a = seed.y * 6.2831;
            float fan = (1.0 - exp(-age * 0.9)) * (2.5 + seed.w * 9.0);
            p += vec3(cos(a) * fan, (1.0 - exp(-age * 0.45)) * (8.0 + seed.z * 16.0) + age * 0.3, sin(a) * fan * 0.7 - fan * 0.5);
          }
          p.x += sin(uT * 0.8 + seed.w * 20.0) * 0.08;
          vCold = step(0.8, seed.w);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = (kind > 1.5 ? 5.0 : 3.0) + 5.0 * seed.z;
          gl_PointSize = size * 3.5 / -mv.z * (0.85 + 0.15 * sin(uT * 3.0 + seed.y * 40.0)) * (1.0 + uPulse * 0.6) * (0.8 + 0.3 * uEnergy);
          gl_Position = projectionMatrix * mv;
          vA *= (0.7 + 0.5 * uEnergy) * (1.0 + uPulse * 0.5);
          if (uT < seed.x) vA = 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vCold;
        void main(){ float d = length(gl_PointCoord - .5); vec3 c = mix(vec3(1.0, 0.68, 0.34), vec3(0.6, 0.8, 1.0), vCold) * 3.0;
          gl_FragColor = vec4(c, vA * smoothstep(.5, .0, d)); }`,
    });
    this.names = new THREE.Points(g, this.namesMat);
    this.names.frustumCulled = false;
    this.scene.add(this.names);
  }

  update(f: Frame) {
    const { local, dur, t } = f;
    // Loud and full: energy from the mix envelope, or a steady build without it
    const surge = smooth(CUE.songsLiveOn - 0.3, CUE.songsLiveOn + 1.5, t) * (1 - 0.5 * smooth(CUE.songsLiveOnEnd, dur + t - local, t));
    const energy = levelSmooth('mix', t, 0.3, 0.7 + 0.3 * smooth(CUE.built - 2, CUE.songsLiveOn, t));
    const hit = drumPulse(t, 0.12);
    this.rain.time.value = t;
    (this.water.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    this.namesMat.uniforms.uT.value = t;
    this.namesMat.uniforms.uPulse.value = hit;
    this.namesMat.uniforms.uEnergy.value = energy + surge * 0.4;
    this.handLight.intensity = (3 + 5 * smooth(0, 2, local) + 4 * energy + 10 * surge + 6 * hit) * (0.85 + 0.15 * noise1(t * 6, 2));
    this.rim.intensity = 1.2 + 2.2 * hit + 1.5 * surge;
    // He breathes; on "and the songs live on" he lifts his head
    this.figure.position.y = Math.sin(local * 1.1) * 0.006;
    this.figure.rotation.x = -0.08 * smooth(CUE.songsLiveOn - 0.5, CUE.songsLiveOn + 2.5, t);

    // Camera: behind him at the waterline, swinging round and craning up to watch the names go up;
    // the drums push it, and on the surge it climbs fast to take in the whole sky of lights
    const e = easeInOut(clamp(local / dur));
    const a = -0.35 + e * 0.75 + noise1(local * 0.15, 3) * 0.06;
    const rad = 3.4 + e * 3.6 + surge * 3.0 - hit * 0.12;
    const y = 0.9 + e * 2.6 + surge * 3.2;
    this.camera.position.set(
      Math.sin(a) * rad + noise1(t * 18, 1) * 0.02 * (hit + surge * 0.5),
      y + noise1(t * 18, 2) * 0.02 * (hit + surge * 0.5),
      Math.cos(a) * rad,
    );
    this.camera.lookAt(0, 1.4 + e * 3.2 + surge * 4.5, -1.2);
    this.bloom = 0.25 + energy * 0.25 + hit * 0.25 + surge * 0.45;
  }
}
