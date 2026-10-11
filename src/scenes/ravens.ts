import * as THREE from 'three';
import { Dream, type Frame } from '../dream';
import { Ribbon, glow, precipitation } from '../fx';
import { buildRaven, type Raven } from '../raven';
import { drumPulse, levelSmooth } from '../envelopes';
import { CUE } from '../timeline';
import { GLSL_NOISE, clamp, easeInOut, lerp, noise1, rng, smooth } from '../util';

// Chorus: "Do I dream, or do I remember? Thought on my left, and memory on my right."
// Flying through an endless city of lit windows in the rain, behind two ravens made of wire:
// Thought (cold blue) on the left, Memory (amber) on the right, each dragging a trail of light.
// Windows and halos flare on the drum hits when envelopes.json is there.
// Final chorus: they climb, burst through the cloud deck and the dawn breaks on the first "let them fly";
// on the second they fly off ahead of us into the sun.

const SPEED = 32; // city scroll, units per second
const LZ = 520; // length of the repeating city block

/** Final chorus moments, song seconds (section 248-287). */
const F = {
  clouds0: 254, // the cloud deck fades in overhead
  clouds1: 262,
  climb0: 258, // start climbing, nose up
  burst0: 270, // under the deck at y 120, then up through it
  burst1: CUE.letThemFly1 + 1.2, // above it (y 185), levelling out
  dawn0: CUE.letThemFly1 - 1.6,
  dawn1: CUE.letThemFly1 + 1.6,
};

export class RavensDream extends Dream {
  private cityMat: THREE.ShaderMaterial;
  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private clouds: THREE.Mesh;
  private rain = precipitation({ count: 7000, box: new THREE.Vector3(70, 50, 70), speed: 38, length: 1.6, color: '#8fb0d8', opacity: 0.18, wind: new THREE.Vector2(0, 12), seed: 5 });
  private ravens: { r: Raven; trail: Ribbon; side: number; color: THREE.Color; halo: THREE.Sprite }[] = [];
  private sun = glow('#ffcf96', 160, 0);

  constructor() {
    super();
    this.camera.far = 3000;
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();

    // Sky dome: night haze that turns to dawn in the final chorus
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uDawn: { value: 0 }, uTime: { value: 0 } },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform float uDawn; varying vec3 vD;
        void main(){
          float h = vD.y;
          vec3 night = mix(vec3(0.05, 0.07, 0.11), vec3(0.01, 0.012, 0.02), smoothstep(-0.1, 0.5, h));
          night += vec3(0.35, 0.16, 0.05) * smoothstep(0.25, -0.15, h) * 0.5; // city glow on the haze
          // Dawn kept well under the bloom threshold (0.72) except at the sun itself;
          // at the old levels (horizon 1.0, sun x2) the whole frame bloomed to white.
          vec3 dawn = mix(vec3(0.52, 0.27, 0.15), vec3(0.06, 0.1, 0.22), smoothstep(-0.05, 0.5, h));
          dawn += vec3(1.0, 0.7, 0.4) * pow(max(dot(vD, normalize(vec3(0.0, 0.08, -1.0))), 0.0), 60.0) * 0.9;
          gl_FragColor = vec4(mix(night, dawn, uDawn), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);

    // City: one instanced box, every tower placed and scrolled in the vertex shader
    const r = rng(42);
    const boxes: number[] = [];
    const seeds: number[] = [];
    const CELL = 14;
    for (let gx = -12; gx <= 12; gx++) {
      for (let gz = 0; gz < LZ / CELL; gz++) {
        const cx = gx * CELL;
        if (Math.abs(cx) < 12) continue; // the flight corridor
        const n = r() < 0.35 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const w = 5 + r() * 7;
          const near = 1 - clamp((Math.abs(cx) - 12) / 160);
          const h = 40 + Math.pow(r(), 1.8) * 190 * (0.5 + near * 0.6);
          boxes.push(cx + (r() - 0.5) * (CELL - w), gz * CELL + (r() - 0.5) * (CELL - w), w, h);
          seeds.push(r());
        }
      }
    }
    const count = seeds.length;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.BoxGeometry(1, 1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.setAttribute('aBox', new THREE.InstancedBufferAttribute(new Float32Array(boxes), 4));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    geo.instanceCount = count;
    this.cityMat = new THREE.ShaderMaterial({
      uniforms: { uTravel: { value: 0 }, uTime: { value: 0 }, uFog: { value: new THREE.Color('#0d1018') }, uCam: { value: new THREE.Vector3() }, uDawn: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTravel; attribute vec4 aBox; attribute float aSeed;
        varying vec3 vLocal; varying vec3 vN; varying vec3 vWorld; varying float vSeed; varying vec2 vSize;
        void main(){
          vec3 size = vec3(aBox.z, aBox.w, aBox.z);
          vec3 lp = position * size;
          float z = mod(aBox.y + uTravel, ${LZ.toFixed(1)}) - ${(LZ - 60).toFixed(1)};
          vec3 wp = lp + vec3(aBox.x, aBox.w * 0.5 - 90.0, z);
          vLocal = lp + size * 0.5; vN = normal; vWorld = wp; vSeed = aSeed; vSize = size.xy;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uDawn, uPulse; uniform vec3 uFog, uCam;
        varying vec3 vLocal; varying vec3 vN; varying vec3 vWorld; varying float vSeed; varying vec2 vSize;
        ${GLSL_NOISE}
        void main(){
          vec3 col = vec3(0.012, 0.014, 0.02);
          if (abs(vN.y) < 0.5) {
            float u = abs(vN.x) > 0.5 ? vLocal.z : vLocal.x;
            vec2 cell = floor(vec2(u / 1.3, vLocal.y / 1.9));
            vec2 f = fract(vec2(u / 1.3, vLocal.y / 1.9));
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
            float h = hash21(cell + vSeed * 97.0 + vN.xz * 13.0);
            float lit = step(0.78 - 0.1 * vSeed, h);
            lit *= 0.75 + 0.25 * sin(uTime * (0.5 + h * 3.0) + h * 40.0); // some windows breathe
            vec3 warm = vec3(1.0, 0.62, 0.3);
            vec3 cold = vec3(0.45, 0.7, 1.0);
            col += win * lit * mix(warm, cold, step(0.6, hash11(h * 31.0))) * 1.6 * (1.0 + uPulse * 0.6);
            // Vertical light strips on some towers
            if (vSeed > 0.86) {
              float edge = smoothstep(0.6, 0.0, abs(u - 0.6));
              vec3 neon = mix(vec3(1.0, 0.2, 0.55), vec3(0.2, 0.9, 1.0), step(0.93, vSeed));
              col += neon * edge * 3.0 * (0.8 + 0.2 * sin(uTime * 3.0 + vSeed * 50.0));
            }
            // Big wordless glowing panels on a few towers
            if (vSeed < 0.06) {
              float panel = step(0.15, f.x * 0.0 + fract(vSeed * 13.0)) ;
              vec2 q = vec2(u, vLocal.y - vSize.y * 0.62);
              float inPanel = step(abs(q.x - vSize.x * 0.5), vSize.x * 0.42) * step(abs(q.y), 9.0);
              vec3 pc = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vSeed * 9.0 + uTime * 0.05 + q.y * 0.02));
              col = mix(col, pc * 2.2 * (0.7 + 0.3 * fbm(q * 0.15 + uTime * 0.2)), inPanel * panel);
            }
            col *= smoothstep(-90.0, -20.0, vWorld.y) * 0.8 + 0.2;
          } else if (vN.y > 0.5) {
            // Red light on the roof
            float d = length(vLocal.xz - vSize.x * 0.5);
            col += vec3(1.0, 0.1, 0.05) * smoothstep(0.5, 0.0, d) * step(0.5, fract(uTime * 0.6 + vSeed * 7.0)) * 6.0;
          }
          float dist = length(vWorld - uCam);
          float fogK = 1.0 - exp(-dist * mix(0.0042, 0.0026, uDawn));
          // Low haze glows warm, high air is cold
          vec3 fog = mix(uFog * vec3(2.6, 1.6, 1.0), uFog, smoothstep(-80.0, 40.0, vWorld.y));
          fog = mix(fog, vec3(0.75, 0.55, 0.45), uDawn);
          gl_FragColor = vec4(mix(col, fog, fogK), 1.0);
        }`,
    });
    const city = new THREE.Mesh(geo, this.cityMat);
    city.frustumCulled = false;
    this.scene.add(city);

    // Cloud deck for the final chorus, at y = 150
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDawn: { value: 0 }, uA: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uDawn, uA; varying vec2 vP;
        ${GLSL_NOISE}
        void main(){
          vec2 p = vP * 0.006 + vec2(0.0, uTime * 0.02);
          float n = fbm(p) * 0.7 + fbm(p * 3.1 + 4.0) * 0.3;
          float a = smoothstep(0.35, 0.7, n) * smoothstep(1400.0, 300.0, length(vP));
          vec3 c = mix(vec3(0.16, 0.18, 0.24), vec3(0.5, 0.38, 0.32), uDawn) * (0.7 + 0.5 * n); // dawn-lit tops, kept under the bloom threshold
          gl_FragColor = vec4(c, a * uA);
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 150;
    this.scene.add(this.clouds);

    this.sun.position.set(0, 230, -1600);
    this.scene.add(this.sun, this.rain);

    // Thought (left, blue) and Memory (right, amber)
    for (const [side, hex] of [[-1, '#6cb6ff'], [1, '#ffb050']] as const) {
      const color = new THREE.Color(hex);
      const wire = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), wireframe: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const r = buildRaven(wire);
      // A dark core so the wire reads as a cage around a body
      const core = buildRaven(new THREE.MeshBasicMaterial({ color: '#020306', side: THREE.DoubleSide }));
      core.group.scale.setScalar(0.97);
      r.group.add(core.group);
      (r.group.userData as { core: Raven }).core = core;
      r.group.scale.setScalar(2.2);
      const trail = new Ribbon(48, color.clone().multiplyScalar(1.4), 0.5, 0.8);
      const halo = glow(color, 3.2, 0.35);
      this.scene.add(r.group, trail, halo);
      this.ravens.push({ r, trail, side, color, halo });
    }
  }

  /** Camera height. x is song time, local is seconds into the section. y climbs in the final chorus. */
  private camY(variant: string, x: number, local: number) {
    if (variant !== 'final') return variant === 'ch2' ? -18 + Math.sin(local * 0.2) * 3 : 4 + Math.sin(local * 0.25) * 4;
    // A long climb under the cloud deck (y 150), then a burst up through it that clears it just before "let them fly"
    return 4 + 116 * easeInOut(smooth(F.climb0, F.burst0, x)) + 65 * smooth(F.burst0, F.burst1, x);
  }

  /** A raven's position at song time x, in camera-relative world space (the city moves, not the birds).
   *  The +6 lift that leads the nose-up climb is taken back out as the camera levels after the burst;
   *  otherwise the birds sat above the top of the frame for the whole dawn. */
  private ravenPos(side: number, x: number, variant: string, local: number, out: THREE.Vector3) {
    const weave = side < 0 ? 0 : 1.7;
    const final = variant === 'final';
    // Second "let them fly": they pull away ahead of us, up into the sun
    const rel = final ? smooth(CUE.letThemFly2 - 0.3, CUE.letThemFly2 + 4.5, x) : 0;
    out.set(
      (side * (3.2 + Math.sin(x * 0.5 + weave) * 1.4) + noise1(x * 0.3, side + 3) * 1.2) * (1 + rel * 0.8),
      this.camY(variant, x, local) + 0.6 + Math.sin(x * 0.7 + weave) * 1.1 + (final ? smooth(F.climb0 - 2, F.burst0, x) * (1 - smooth(F.burst1 - 1.5, F.burst1 + 1.5, x)) * 6 : 0) + rel * rel * 14,
      -11 + Math.sin(x * 0.33 + weave * 2) * 2.5 - rel * rel * 70,
    );
    return out;
  }

  update(f: Frame) {
    const { local, t, variant } = f;
    const final = variant === 'final';
    const dawn = final ? smooth(F.dawn0, F.dawn1, t) : 0;
    const travel = t * SPEED;
    const cy = this.camY(variant, t, local);
    const hit = drumPulse(t);

    this.cityMat.uniforms.uTravel.value = travel;
    this.cityMat.uniforms.uTime.value = t;
    this.cityMat.uniforms.uDawn.value = dawn;
    this.cityMat.uniforms.uPulse.value = hit;
    this.skyMat.uniforms.uDawn.value = dawn;
    this.cloudMat.uniforms.uTime.value = t;
    this.cloudMat.uniforms.uDawn.value = dawn;
    this.cloudMat.uniforms.uA.value = final ? smooth(F.clouds0, F.clouds1, t) : 0;
    this.clouds.position.z = 0;
    this.sun.material.opacity = dawn * 0.3;
    // Rain stops once we're above the clouds
    this.rain.time.value = t;
    this.rain.mat.uniforms.uCenter.value.set(0, cy, -10);
    this.rain.mat.uniforms.uOpacity.value = 0.18 * (1 - smooth(140, 160, cy));

    // Camera: follows behind and between the birds, banking with their weave
    const bank = noise1(local * 0.25, 9) * 0.08 + Math.sin(local * 0.5) * 0.04;
    const pitch = final ? smooth(F.climb0 - 1.5, F.climb0 + 1.5, t) * (1 - smooth(F.burst1 - 1.5, F.burst1 + 1.5, t)) * 0.5 : -0.02;
    this.camera.position.set(Math.sin(local * 0.3) * 0.8, cy, 0);
    this.camera.rotation.set(pitch + noise1(local * 0.4, 1) * 0.015, Math.sin(local * 0.21) * 0.05, bank, 'YXZ');
    this.cityMat.uniforms.uCam.value.copy(this.camera.position);

    // Ravens and trails
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    // Wingbeat: harder with the drums (steady without envelopes), a glide in the dawn, full strokes as they fly off
    const rel = final ? smooth(CUE.letThemFly2 - 0.3, CUE.letThemFly2 + 1.5, t) : 0;
    const flapAmt = (lerp(0.9, 0.6, dawn) + rel * 0.4) * (0.85 + 0.35 * levelSmooth('drums', t, 0.2, 0.43));
    for (const rv of this.ravens) {
      this.ravenPos(rv.side, t, variant, local, p);
      this.ravenPos(rv.side, t + 0.05, variant, local, q);
      rv.r.group.position.copy(p);
      // Face the direction of travel (the city moves past at SPEED, so forward is -Z plus their own drift)
      const vel = q.sub(p).divideScalar(0.05);
      vel.z -= SPEED * 0.25;
      rv.r.group.lookAt(p.clone().sub(vel)); // lookAt points +Z at the target; the raven faces -Z
      rv.r.group.rotateZ(-vel.x * 0.04);
      const phase = t * (rv.side < 0 ? 7.5 : 7.1) + (rv.side < 0 ? 0 : 1.3);
      rv.r.pose(phase, flapAmt);
      (rv.r.group.userData as { core: Raven }).core.pose(phase, flapAmt);
      rv.halo.position.copy(p);
      rv.halo.material.opacity = 0.35 + 0.45 * hit;
      // Trail: where the bird was, carried back by the moving city
      const pts: THREE.Vector3[] = [];
      const n = rv.trail.size;
      for (let i = 0; i < n; i++) {
        const age = (1 - i / (n - 1)) * 1.1;
        const v = this.ravenPos(rv.side, t - age, variant, local - age, new THREE.Vector3());
        v.z += age * SPEED * 0.55;
        v.y -= 0.05;
        pts.push(v);
      }
      rv.trail.set(pts, this.camera, (u) => u * (0.4 + 0.6 * Math.abs(Math.sin(t * 7.3 + rv.side))) * (1 + 0.5 * hit));
    }
    this.bloom = hit * 0.12 + dawn * 0.2;
  }
}
