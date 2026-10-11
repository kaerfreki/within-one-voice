import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Dream, type Frame } from '../dream';
import { clamp, easeInOut, noise1, rng, smooth } from '../util';

// RETIRED for "Within One Voice": the pre-chorus lyrics were cut from the final take. Not in the timeline and not
// built by main.ts; kept here in case a pre-chorus comes back.
// Pre-chorus: "Somebody folded a bird out of paper and left it at my door. How would they know what I dream?"
// A door left ajar, warm light spilling across a dark floor. A sheet of paper on the floor folds itself into a bird.
// The second time ("many"), the camera pulls back: dozens of paper birds are waiting at the door.

function tri(a: number[], b: number[], c: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
  g.computeVertexNormals();
  return g;
}

/** A folding paper bird. Faces -Z (towards the door is +Z... it looks at the camera). fold 0 = flat sheet, 1 = bird. */
function paperBird(mat: THREE.Material) {
  const root = new THREE.Group();
  const L = 0.5; // half body length
  const w = 0.09;
  // Body: two strips meeting along the spine, flat at fold 0, a ridge at fold 1
  const bodyL = new THREE.Group();
  const bodyR = new THREE.Group();
  bodyL.add(new THREE.Mesh(mergeGeometries([tri([0, 0, -L], [-w, 0, 0], [0, 0, L])])!, mat));
  bodyR.add(new THREE.Mesh(mergeGeometries([tri([0, 0, -L], [0, 0, L], [w, 0, 0])])!, mat));
  root.add(bodyL, bodyR);
  // Wings hinge on the body's outer edges
  const wingL = new THREE.Group();
  const wingR = new THREE.Group();
  wingL.add(new THREE.Mesh(tri([0, 0, -0.2], [-0.62, 0, 0.12], [0, 0, 0.22]), mat));
  wingR.add(new THREE.Mesh(tri([0, 0, -0.2], [0, 0, 0.22], [0.62, 0, 0.12]), mat));
  wingL.position.set(-w, 0, 0);
  wingR.position.set(w, 0, 0);
  bodyL.add(wingL);
  bodyR.add(wingR);
  // Neck at the front tip, head at the end of the neck; tail at the back
  const neck = new THREE.Group();
  neck.add(new THREE.Mesh(tri([-0.035, 0, 0], [0.035, 0, 0], [0, 0, -0.55]), mat));
  neck.position.set(0, 0, -L);
  const head = new THREE.Group();
  head.add(new THREE.Mesh(tri([-0.02, 0, 0], [0.02, 0, 0], [0, 0, -0.14]), mat));
  head.position.set(0, 0, -0.55);
  neck.add(head);
  const tail = new THREE.Group();
  tail.add(new THREE.Mesh(tri([-0.04, 0, 0], [0, 0, 0.5], [0.04, 0, 0]), mat));
  tail.position.set(0, 0, L);
  root.add(neck, tail);
  root.traverse((o) => {
    o.castShadow = true;
  });

  return {
    root,
    fold(k: number, flap = 0) {
      // Folds happen one after another: body, tail, neck, head, wings
      const s = (a: number, b: number) => easeInOut(clamp((k - a) / (b - a)));
      const body = s(0, 0.25);
      bodyL.rotation.z = -body * 0.9;
      bodyR.rotation.z = body * 0.9;
      tail.rotation.x = s(0.2, 0.45) * 0.9;
      neck.rotation.x = -s(0.35, 0.6) * 1.0;
      head.rotation.x = s(0.55, 0.7) * 1.9;
      const wing = s(0.6, 1) * (1.55 + flap);
      wingL.rotation.z = wing - body * 0.9 + 0.05;
      wingR.rotation.z = -(wing - body * 0.9 + 0.05);
      root.position.y = body * 0.06;
    },
  };
}

export class PaperDream extends Dream {
  private bird: ReturnType<typeof paperBird>;
  private flock: THREE.InstancedMesh;
  private motes: THREE.Points;
  private door: THREE.Object3D;
  private spot = new THREE.SpotLight('#ffd7a0', 260, 18, 0.55, 0.45, 1.6);
  private shaft: THREE.Mesh;

  constructor() {
    super();
    this.scene.background = new THREE.Color('#020204');
    this.scene.fog = new THREE.Fog('#020204', 6, 20);
    this.scene.add(new THREE.AmbientLight('#2a3550', 0.25));

    const dark = new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#1a1c22', roughness: 0.35, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Wall with a door opening at x = 0
    const DW = 1.05;
    const DH = 2.2;
    const left = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 0.2), dark);
    left.position.set(-6 - DW / 2, 3, 0);
    const right = left.clone();
    right.position.x = 6 + DW / 2;
    const top = new THREE.Mesh(new THREE.BoxGeometry(DW, 6 - DH, 0.2), dark);
    top.position.set(0, DH + (6 - DH) / 2, 0);
    this.scene.add(left, right, top);
    // Light behind the door
    const light = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a8').multiplyScalar(6) }));
    light.position.set(0, 2, -1.2);
    this.scene.add(light);
    // The door, standing ajar on its hinge
    const hinge = new THREE.Group();
    hinge.position.set(-DW / 2, 0, -0.05);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(DW, DH, 0.05), dark);
    panel.position.set(DW / 2, DH / 2, 0);
    panel.castShadow = true;
    hinge.add(panel);
    this.door = hinge;
    this.scene.add(hinge);

    this.spot.position.set(0.15, 1.9, -1.0);
    this.spot.target.position.set(0, 0, 3);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(2048, 2048);
    this.spot.shadow.bias = -0.0004;
    this.scene.add(this.spot, this.spot.target);

    // A faint shaft of light through the door
    const shaftGeo = new THREE.CylinderGeometry(0.5, 2.2, 5, 32, 1, true);
    shaftGeo.translate(0, -2.5, 0);
    shaftGeo.rotateX(-Math.PI / 2 + 0.38);
    this.shaft = new THREE.Mesh(
      shaftGeo,
      new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0.07 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = uv.y; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uA; varying vec3 vN; varying vec3 vV; varying float vY; void main(){ float f = pow(abs(dot(vN, vV)), 2.0); gl_FragColor = vec4(1.0, .8, .55, uA * f * vY); }`,
      }),
    );
    this.shaft.position.set(0.1, 1.9, -0.6);
    this.scene.add(this.shaft);

    const paper = new THREE.MeshStandardMaterial({ color: '#f2eee6', roughness: 0.7, side: THREE.DoubleSide, flatShading: true, emissive: '#3a3020', emissiveIntensity: 0.3 });
    this.bird = paperBird(paper);
    this.bird.root.position.set(0, 0.002, 1.5);
    this.bird.root.rotation.y = Math.PI + 0.5; // head turned towards the camera
    this.bird.root.scale.setScalar(0.42);
    this.scene.add(this.bird.root);

    // The flock: folded birds, merged into one geometry and instanced
    const proto = paperBird(paper);
    proto.fold(1);
    proto.root.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    proto.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) parts.push((o as THREE.Mesh).geometry.clone().applyMatrix4(o.matrixWorld));
    });
    const r = rng(31);
    const COUNT = 70;
    this.flock = new THREE.InstancedMesh(mergeGeometries(parts)!, paper, COUNT);
    this.flock.castShadow = true;
    const m = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      // Scattered in the light in front of the door, thinning out with distance
      const a = (r() - 0.5) * 2.4;
      const d = 0.9 + Math.pow(r(), 0.8) * 6;
      const pos = new THREE.Vector3(Math.sin(a) * d * 0.9, 0.025, Math.cos(a) * d * 0.7 + 0.4);
      if (pos.distanceTo(new THREE.Vector3(0, 0, 1.5)) < 0.5) pos.x += 0.8;
      m.compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0)), new THREE.Vector3().setScalar(0.32 + r() * 0.12));
      this.flock.setMatrixAt(i, m);
    }
    this.scene.add(this.flock);

    // Dust in the light
    const pos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) pos.set([(r() - 0.5) * 2.4, r() * 2.4, r() * 4 - 0.5], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.008, color: '#ffe0b0', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.motes);
  }

  update(f: Frame) {
    const { local, dur, variant } = f;
    const many = variant === 'many';
    const p = clamp(local / dur);
    this.flock.visible = many;
    // The bird folds through the first two lines; on "how would they know" its wings stir once
    const k = many ? 1 : easeInOut(clamp((local - 0.6) / (dur * 0.55)));
    const flap = smooth(dur * 0.7, dur * 0.78, local) * (1 - smooth(dur * 0.8, dur * 0.95, local)) * 0.5;
    this.bird.fold(k, flap);
    // The door swings open a little wider as the section goes on
    this.door.rotation.y = 0.55 + p * 0.25 + noise1(local * 0.3, 2) * 0.02;
    this.motes.rotation.y = local * 0.01;
    this.motes.position.y = Math.sin(local * 0.2) * 0.03;
    (this.shaft.material as THREE.ShaderMaterial).uniforms.uA.value = 0.06 + 0.02 * noise1(local * 0.5, 4);

    if (!many) {
      // Low over the floor, pushing in on the bird
      const e = easeInOut(p);
      this.camera.position.set(0.55 - e * 0.35, 0.32 - e * 0.12, 3.6 - e * 1.3);
      this.camera.lookAt(0, 0.08, 1.45);
    } else {
      // Start close on the bird, then rise and pull back to reveal the rest
      const e = easeInOut(smooth(1, dur - 0.5, local));
      this.camera.position.set(0.25 + e * 0.6, 0.22 + e * 2.6, 2.4 + e * 4.8);
      this.camera.lookAt(0, 0.05 + e * 0.4, 1.4 - e * 0.6);
    }
  }
}
