import * as THREE from 'three';
import { Dream, type Frame } from '../dream';
import { buildFigure } from '../figure';
import { precipitation } from '../fx';
import { CUE } from '../timeline';
import { GLSL_NOISE, clamp, easeInOut, lerp, noise1, rng, smooth } from '../util';

// Verse 2, the empathy test. An amber, dust-hazed snowfield under a vast watching eye. Cut to the song's lines (CUE).
// First half: "a wolf in a snare, the wire biting inch by inch": a snare of glowing wire in the snow, wolf tracks
// leading to it; the wire bites. "The ones who would kneel": handprints sink in all around it. On "If I copy it
// perfectly, isn't it real?" the eye's pupil widens, the way the test reads you.
// Second half, from "There's an old man who climbs while the crowd throws the stones": an old man climbing a hill
// while stones fly at him. On "a fake from the start" he flickers like a projection; on "So whose is the stone
// that's still bruising my heart?" one stone comes straight at the camera.

function printTexture(kind: 'hand' | 'paw'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  const blob = (x: number, y: number, rx: number, ry: number, a = 0) => {
    g.beginPath();
    g.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    g.fill();
  };
  if (kind === 'hand') {
    blob(64, 82, 24, 28);
    [[-20, -18, -0.35, 22], [-8, -30, -0.1, 26], [6, -32, 0.05, 27], [19, -26, 0.25, 23]].forEach(([dx, dy, a, l]) => blob(64 + dx, 50 + dy, 6.5, l, a));
    blob(32, 82, 7, 18, 0.9);
  } else {
    blob(64, 78, 20, 17);
    [[-22, -20], [-8, -32], [8, -32], [22, -20]].forEach(([dx, dy]) => blob(64 + dx, 70 + dy, 8, 10));
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

export class SnareDream extends Dream {
  private irisMat: THREE.ShaderMaterial;
  private iris: THREE.Mesh;
  private snare: THREE.Mesh;
  private hands: THREE.Mesh[] = [];
  private oldMan: THREE.Group;
  private oldManMats: THREE.MeshStandardMaterial[];
  private stones: { mesh: THREE.Mesh; t0: number; from: THREE.Vector3; to: THREE.Vector3 }[] = [];
  private heartStone: THREE.Mesh;
  private dust = precipitation({ count: 3000, box: new THREE.Vector3(40, 16, 40), center: new THREE.Vector3(0, 6, -8), speed: 0.5, length: 0, size: 50, color: '#ffd3a0', opacity: 0.35, wind: new THREE.Vector2(1.4, 0.2), seed: 8 });
  private hill = new THREE.Vector3(0, 0, -46);

  constructor() {
    super();
    const haze = new THREE.Color('#b8692a');
    this.scene.background = haze;
    this.scene.fog = new THREE.FogExp2(haze, 0.028);
    this.scene.add(new THREE.HemisphereLight('#ffb070', '#5a3a2a', 1.1));
    const sun = new THREE.DirectionalLight('#ffc890', 1.6);
    sun.position.set(-20, 14, -30);
    this.scene.add(sun);

    // Snowfield with a hill in the distance
    const ground = new THREE.PlaneGeometry(260, 260, 220, 220);
    ground.rotateX(-Math.PI / 2);
    const pos = ground.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x - this.hill.x, z - this.hill.z);
      let y = noise1(x * 0.05, 1) * noise1(z * 0.05, 2) * 1.6 + noise1(x * 0.3 + z * 0.2, 3) * 0.08;
      y += 15 * Math.exp(-(d * d) / (2 * 15 * 15));
      if (Math.hypot(x, z) < 3) y *= Math.hypot(x, z) / 3; // flat around the snare
      pos.setY(i, y);
    }
    ground.computeVertexNormals();
    this.scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: '#e9dccd', roughness: 1 })));

    // The eye
    this.irisMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPupil: { value: 0.22 }, uOpen: { value: 1 } },
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uPupil, uOpen; varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          // Lids: an almond opening
          float lid = abs(p.y) - (1.0 - p.x * p.x) * 0.62 * uOpen;
          float inEye = smoothstep(0.04, -0.04, lid);
          float fibers = fbm(vec2(a * 6.0, r * 3.0 - uTime * 0.03)) * 0.6 + fbm(vec2(a * 24.0, r * 8.0)) * 0.4;
          vec3 iris = mix(vec3(0.55, 0.32, 0.08), vec3(0.95, 0.75, 0.35), fibers);
          iris = mix(iris, vec3(0.25, 0.4, 0.38), smoothstep(0.25, 0.55, r) * 0.5);
          iris *= smoothstep(0.62, 0.5, r) * 0.9 + 0.1;
          float pupil = smoothstep(uPupil + 0.015, uPupil - 0.015, r);
          vec3 sclera = vec3(0.85, 0.72, 0.62) * (0.7 + 0.3 * fbm(p * 4.0));
          vec3 col = mix(sclera, iris, smoothstep(0.62, 0.58, r));
          col = mix(col, vec3(0.0), pupil);
          col += vec3(1.0) * smoothstep(0.07, 0.0, length(p - vec2(-0.16, 0.14))) * 0.9; // catchlight
          float halo = smoothstep(1.0, 0.0, r) * 0.25;
          gl_FragColor = vec4(col * 1.25, max(inEye * 0.85, halo * 0.0) * smoothstep(1.0, 0.85, r));
        }`,
    });
    this.iris = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.irisMat);
    this.iris.scale.set(220, 220, 1);
    this.iris.position.set(0, 80, -260);
    this.scene.add(this.iris);

    // The snare: a loop of glowing wire on a stake
    this.snare = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.01, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe0b0').multiplyScalar(3) }));
    this.snare.rotation.x = Math.PI / 2;
    this.snare.position.set(0, 0.03, 0);
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#2a1d14' }));
    stake.position.set(0.9, 0.2, -0.2);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 4), this.snare.material);
    cable.position.set(0.6, 0.04, -0.12);
    cable.rotation.z = Math.PI / 2;
    cable.rotation.y = 0.2;
    this.scene.add(this.snare, stake, cable);

    // Wolf tracks running in to the snare, and handprints that appear around it
    const r = rng(12);
    const pawTex = printTexture('paw');
    const handTex = printTexture('hand');
    const printMat = (tex: THREE.Texture, op: number) => new THREE.MeshBasicMaterial({ map: tex, color: '#6a4a3a', transparent: true, opacity: op, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const paw = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), printMat(pawTex, 0.55));
      paw.rotation.x = -Math.PI / 2;
      paw.rotation.z = Math.PI + 0.3;
      paw.position.set(-0.6 - i * 0.32 + (i % 2) * 0.05, 0.012, -0.35 - i * 0.12 + (i % 2 ? 0.08 : -0.08));
      this.scene.add(paw);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + r() * 0.4;
      const d = 0.5 + r() * 0.35;
      const hand = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), printMat(handTex, 0));
      hand.rotation.x = -Math.PI / 2;
      hand.rotation.z = a + Math.PI / 2 + (r() - 0.5) * 0.5;
      hand.position.set(Math.cos(a) * d, 0.013, Math.sin(a) * d);
      this.scene.add(hand);
      this.hands.push(hand);
    }

    // The old man on the hill
    this.oldManMats = [new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 1, transparent: true }), new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 1, transparent: true })];
    this.oldMan = buildFigure(this.oldManMats[0], this.oldManMats[1]);
    this.oldMan.scale.setScalar(1.6);
    this.scene.add(this.oldMan);

    // Stones thrown from out of frame, each with its own launch time (seconds into the second half)
    const stoneGeo = new THREE.DodecahedronGeometry(0.22, 0);
    const stoneMat = new THREE.MeshStandardMaterial({ color: '#4b3d33', roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const mesh = new THREE.Mesh(stoneGeo, stoneMat);
      mesh.scale.setScalar(0.6 + r());
      const side = r() < 0.5 ? -1 : 1;
      this.stones.push({
        mesh,
        t0: r() * 9,
        from: new THREE.Vector3(side * (10 + r() * 8), 1 + r() * 3, 4 + (r() - 0.5) * 10),
        to: new THREE.Vector3((r() - 0.5) * 3, 0, (r() - 0.5) * 3),
      });
      this.scene.add(mesh);
    }
    this.heartStone = new THREE.Mesh(stoneGeo, stoneMat);
    this.heartStone.scale.setScalar(1.3);
    this.scene.add(this.heartStone, this.dust);
  }

  private groundAt(x: number, z: number) {
    const d = Math.hypot(x - this.hill.x, z - this.hill.z);
    return 15 * Math.exp(-(d * d) / (2 * 15 * 15));
  }

  update(f: Frame) {
    const { local, dur, t } = f;
    // The cut to the old man is on his line, not halfway through the section
    const split = CUE.oldMan;
    const end = t - local + dur;
    const second = t >= split;
    this.dust.time.value = t;
    this.irisMat.uniforms.uTime.value = t;
    // The eye blinks once in each half
    const blink = (at: number) => Math.exp(-Math.pow((t - at) / 0.09, 2));
    this.irisMat.uniforms.uOpen.value = 1 - Math.max(blink(CUE.flinch + 1.6), blink(split + 1.3)) * 0.97;
    // The test reads him: the pupil widens on "If I copy it perfectly, isn't it real?" and again on the last line
    const dil = smooth(CUE.copy - 0.2, CUE.copy + 1.0, t) * (1 - smooth(split - 1.0, split, t)) + smooth(CUE.whoseStone, CUE.whoseStone + 1.2, t);
    this.irisMat.uniforms.uPupil.value = 0.17 + 0.2 * Math.min(1, dil) + 0.01 * noise1(t * 2, 3);

    // Snare: the wire pulses faintly, then bites on "the wire biting inch by inch": hotter, and the loop draws tight.
    // Handprints sink into the snow around it on "the ones who would kneel"
    const bite = smooth(CUE.wolf + 1.0, CUE.kneel, t);
    (this.snare.material as THREE.MeshBasicMaterial).color.set('#ffe0b0').lerp(new THREE.Color('#ff7a3c'), bite * 0.6).multiplyScalar(2 + Math.sin(t * 3) * 0.6 + bite * (1.5 + Math.sin(t * 9) * 0.5));
    this.snare.scale.setScalar(1 - bite * 0.35);
    this.hands.forEach((h, i) => {
      const at = CUE.kneel + 0.4 + i * 0.22;
      (h.material as THREE.MeshBasicMaterial).opacity = 0.6 * smooth(at, at + 0.3, t);
    });

    // Old man: climbing a slow path up the hill
    const climb = clamp((t - split) / (end - split));
    const path = new THREE.Vector3(lerp(-6, -1, climb), 0, this.hill.z + lerp(14, 4, climb));
    path.y = this.groundAt(path.x, path.z);
    this.oldMan.position.copy(path);
    this.oldMan.rotation.set(-0.35, Math.PI + 0.4, 0); // bent forward, facing up the slope
    this.oldMan.position.y += Math.abs(Math.sin(local * 1.6)) * 0.05;
    // "a fake from the start": he flickers like a projection
    // Strongest over the line itself, then a lingering stutter
    const fake = smooth(CUE.fake + 0.2, CUE.fake + 0.5, t) * (1 - 0.5 * smooth(CUE.fakeEnd, CUE.fakeEnd + 1.0, t));
    const flick = fake > 0 ? (noise1(t * 30, 4) > 0.2 ? 0.25 : 1) * (0.6 + 0.4 * Math.abs(noise1(t * 11, 5))) : 1;
    for (const m of this.oldManMats) {
      m.opacity = lerp(1, flick, fake);
      m.emissive.set('#5fb4ff').multiplyScalar(fake * (1 - flick) * 1.5);
    }
    // The crowd starts throwing on "...throws the stones"
    for (const s of this.stones) {
      const k = (t - split - 1.4 - s.t0) / 1.4;
      s.mesh.visible = second && k > 0 && k < 3;
      if (!s.mesh.visible) continue;
      const kk = clamp(k);
      const to = s.to.clone().add(path).add(new THREE.Vector3(0, 0.8, 0));
      s.mesh.position.lerpVectors(s.from.clone().add(new THREE.Vector3(path.x, path.y, path.z)), to, kk);
      s.mesh.position.y += Math.sin(kk * Math.PI) * 5;
      if (k >= 1) s.mesh.position.y = this.groundAt(s.mesh.position.x, s.mesh.position.z) + 0.1;
      s.mesh.rotation.set(k * 6, k * 4, 0);
    }

    if (!second) {
      // Low across the snow towards the snare, the eye filling the haze above
      const e = easeInOut(clamp(local / (split - (t - local))));
      this.camera.position.set(-2.2 + e * 1.0, 1.1 - e * 0.4, 3.4 - e * 1.6);
      this.camera.lookAt(0, 0.0 + e * 0.05, 0);
      this.camera.rotation.z += noise1(local * 0.3, 2) * 0.01;
      this.camera.fov = 40;
      this.heartStone.visible = false;
    } else {
      // From below the hill, looking up at the climb and the eye behind it
      const e = easeInOut(climb);
      this.camera.fov = 32;
      this.camera.position.set(4 - e * 2, 2.5 + e * 2, this.hill.z + 36 - e * 8);
      this.camera.lookAt(path.x * 0.5, path.y + 4, path.z);
      // "So whose is the stone that's still bruising my heart?": one stone flies at the lens and hits on "heart"
      const hs = smooth(CUE.whoseStone + 0.8, CUE.heart, t);
      this.heartStone.visible = hs > 0 && hs < 1;
      const camFwd = new THREE.Vector3();
      this.camera.getWorldDirection(camFwd);
      this.heartStone.position.copy(this.oldMan.position).add(new THREE.Vector3(0, 2, 0)).lerp(this.camera.position.clone().add(camFwd.multiplyScalar(0.4)), hs);
      this.heartStone.rotation.set(local * 3, local * 2, 0);
      if (hs >= 1) this.camera.position.add(new THREE.Vector3(noise1(t * 40, 1), noise1(t * 40, 2), 0).multiplyScalar(0.15));
    }
    this.camera.updateProjectionMatrix();
  }
}
