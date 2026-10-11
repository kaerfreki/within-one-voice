import * as THREE from 'three';
import { Dream, type Frame } from '../dream';
import { glow, precipitation } from '../fx';
import { buildRaven } from '../raven';
import { clamp, easeInOut, noise1, smooth } from '../util';

// RETIRED for "Within One Voice": the spoken outro (and "It still sings") was cut from the final take. Not in the
// timeline and not built by main.ts; the outro is now the baseline line fading to black.
// Outro: "Found a raven in the ash this morning. Wire in the wing. I kept it anyway."
// Grey morning, ash falling like snow. A raven lies in the ash, a thread of blue wire glowing out of its wing.
// On "I kept it anyway" its eye catches the light and it breathes.

export class AshDream extends Dream {
  private ash = precipitation({ count: 4000, box: new THREE.Vector3(14, 8, 14), center: new THREE.Vector3(0, 3, 0), speed: 0.35, length: 0, size: 26, color: '#b8b4ae', opacity: 0.55, wind: new THREE.Vector2(0.3, -0.1), seed: 23 });
  private raven = buildRaven(new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.45, metalness: 0.2, flatShading: true, side: THREE.DoubleSide }));
  private wireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5fb4ff').multiplyScalar(3) });
  private eye = glow('#9fd0ff', 0.08, 0);

  constructor() {
    super();
    const bg = new THREE.Color('#8e8c88');
    this.scene.background = bg;
    this.scene.fog = new THREE.FogExp2(bg, 0.16);
    this.scene.add(new THREE.HemisphereLight('#d6d4d0', '#3a3836', 1.4));
    const key = new THREE.DirectionalLight('#e8e4dc', 0.6);
    key.position.set(-3, 5, 2);
    this.scene.add(key);

    // Ash dunes
    const g = new THREE.PlaneGeometry(40, 40, 160, 160);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, noise1(x * 0.4, 1) * noise1(z * 0.4, 2) * 0.3 + noise1(x * 3 + z * 2, 3) * 0.015);
    }
    g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#7a7774', roughness: 1 })));

    // The raven, lying on its side with one wing open
    this.raven.pose(-0.8, 0.6);
    this.raven.group.scale.setScalar(1.1);
    this.raven.group.rotation.set(0.15, 0.9, 1.25);
    this.raven.group.position.set(0, 0.08, 0);
    this.scene.add(this.raven.group);

    // The wire: out of the open wing and away into the ash
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.12, 0.2, -0.05),
      new THREE.Vector3(0.35, 0.12, 0.1),
      new THREE.Vector3(0.6, 0.02, 0.05),
      new THREE.Vector3(0.95, 0.0, 0.3),
      new THREE.Vector3(1.6, -0.02, 0.2),
    ]);
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.0045, 6), this.wireMat));
    this.eye.position.set(-0.07, 0.29, -0.2);
    this.scene.add(this.eye, this.ash);
  }

  update(f: Frame) {
    const { local, dur, t } = f;
    this.ash.time.value = t;
    // Wire pulses; once he keeps it, the eye lights and the bird breathes
    const kept = smooth(dur * 0.6, dur * 0.72, local);
    this.wireMat.color.set('#5fb4ff').multiplyScalar(1.5 + 1.5 * (0.5 + 0.5 * Math.sin(t * 2.2)) + kept * 2);
    (this.eye.material as THREE.SpriteMaterial).opacity = kept * (0.8 + 0.2 * noise1(t * 3, 4));
    this.raven.group.scale.setScalar(1.1 * (1 + kept * 0.015 * Math.sin(t * 2.4)));

    // Camera: a slow push down towards the bird
    const e = easeInOut(clamp(local / dur));
    this.camera.position.set(1.1 - e * 0.5, 0.75 - e * 0.35, 1.6 - e * 0.75);
    this.camera.lookAt(0.05, 0.12, 0);
  }
}
