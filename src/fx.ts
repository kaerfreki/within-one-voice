import * as THREE from 'three';
import { rng } from './util';

/**
 * Falling streaks (rain) or flakes (snow, ash) in a box around the camera, animated on the GPU from time only.
 */
export function precipitation(opts: {
  count: number;
  box: THREE.Vector3; // size of the volume
  center?: THREE.Vector3;
  speed: number; // units per second
  length: number; // streak length; 0 = round flakes
  size?: number; // flake size in px at distance 1
  color: THREE.ColorRepresentation;
  opacity: number;
  wind?: THREE.Vector2;
  seed?: number;
}): THREE.Object3D & { time: { value: number }; mat: THREE.ShaderMaterial } {
  const r = rng(opts.seed ?? 7);
  const time = { value: 0 };
  const uniforms = {
    uTime: time,
    uBox: { value: opts.box },
    uCenter: { value: opts.center ?? new THREE.Vector3() },
    uSpeed: { value: opts.speed },
    uLen: { value: opts.length },
    uSize: { value: opts.size ?? 40 },
    uWind: { value: opts.wind ?? new THREE.Vector2() },
    uColor: { value: new THREE.Color(opts.color) },
    uOpacity: { value: opts.opacity },
  };
  const common = /* glsl */ `
    uniform float uTime, uSpeed, uLen, uSize, uOpacity; uniform vec3 uBox, uCenter; uniform vec2 uWind;
    attribute vec4 seed;
    vec3 place(float back){
      float sp = uSpeed * (0.75 + 0.5 * seed.w);
      float y = fract(seed.y - (uTime * sp) / uBox.y);
      vec3 p = (vec3(seed.x, y, seed.z) - 0.5) * uBox + uCenter;
      p.xz += uWind * (0.5 - y) * uBox.y / sp;
      vec3 dir = normalize(vec3(uWind.x, -sp, uWind.y));
      return p - dir * uLen * back;
    }`;
  const frag = /* glsl */ `
    uniform vec3 uColor; uniform float uOpacity; varying float vA;
    void main(){
      #ifdef FLAKES
        vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d));
      #else
        float a = 1.0;
      #endif
      gl_FragColor = vec4(uColor, uOpacity * vA * a);
    }`;
  let obj: THREE.Object3D;
  if (opts.length > 0) {
    const pos = new Float32Array(opts.count * 6);
    const seed = new Float32Array(opts.count * 8);
    const back = new Float32Array(opts.count * 2);
    for (let i = 0; i < opts.count; i++) {
      const s = [r(), r(), r(), r()];
      seed.set(s, i * 8);
      seed.set(s, i * 8 + 4);
      back[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('back', new THREE.BufferAttribute(back, 1));
    const m = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: common + /* glsl */ `
        attribute float back; varying float vA;
        void main(){ vec3 p = place(back); vA = mix(1.0, 0.0, back) * (0.4 + 0.6 * seed.w);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: frag,
    });
    obj = new THREE.LineSegments(g, m);
  } else {
    const seed = new Float32Array(opts.count * 4);
    for (let i = 0; i < opts.count * 4; i++) seed[i] = r();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(opts.count * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      defines: { FLAKES: 1 },
      vertexShader: common + /* glsl */ `
        varying float vA;
        void main(){ vec3 p = place(0.0); p.x += sin(uTime * 0.7 + seed.z * 40.0) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vA = 0.5 + 0.5 * seed.w;
          gl_PointSize = uSize * (0.5 + seed.w) / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: frag,
    });
    obj = new THREE.Points(g, m);
  }
  obj.frustumCulled = false;
  return Object.assign(obj, { time, mat: (obj as THREE.Points).material as THREE.ShaderMaterial });
}

/** Soft additive glow sprite texture. */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function glow(color: THREE.ColorRepresentation, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  s.scale.setScalar(size);
  return s;
}

/**
 * A ribbon that always faces the camera, through a list of points. Rebuilt every frame by set().
 */
export class Ribbon extends THREE.Mesh {
  private pts: THREE.Vector3[];
  constructor(n: number, color: THREE.ColorRepresentation, public width: number, opacity = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const along = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) along[i * 2] = along[i * 2 + 1] = i / (n - 1);
    g.setAttribute('along', new THREE.BufferAttribute(along, 1));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    super(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `attribute float along; varying float vA; void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, uOpacity * pow(vA, 1.6)); }`,
      }),
    );
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());
    this.frustumCulled = false;
  }
  get size() {
    return this.pts.length;
  }
  /** points[0] is the tail, points[n-1] the head. */
  set(points: THREE.Vector3[], camera: THREE.Camera, widthAt?: (u: number) => number) {
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const camPos = camera.position;
    const tan = new THREE.Vector3();
    const side = new THREE.Vector3();
    const view = new THREE.Vector3();
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      tan.subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      view.subVectors(camPos, p).normalize();
      side.crossVectors(tan, view).normalize();
      const w = (this.width * (widthAt ? widthAt(i / (n - 1)) : 1)) / 2;
      pos.setXYZ(i * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      pos.setXYZ(i * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
    }
    pos.needsUpdate = true;
  }
}
