import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A low-poly raven, about 0.9 m wingspan. Faces -Z, up is +Y, wings along X.

function shape(pts: [number, number][]): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2); // shape y becomes +Z (towards the tail)
  return g;
}

const INNER: [number, number][] = [[0, -0.06], [0.28, -0.05], [0.28, 0.12], [0.14, 0.15], [0, 0.14]];
const OUTER: [number, number][] = [
  [0, -0.05], [0.18, -0.03], [0.34, 0.02], [0.31, 0.06], [0.27, 0.045], [0.285, 0.09], [0.23, 0.075],
  [0.235, 0.12], [0.17, 0.105], [0.16, 0.13], [0.08, 0.12], [0, 0.12],
];
const TAIL: [number, number][] = [[-0.035, 0], [0.035, 0], [0.08, 0.2], [0, 0.23], [-0.08, 0.2]];

export interface Raven {
  group: THREE.Group;
  /** phase in radians, amount 0 = glide, 1 = full flap */
  pose(phase: number, amount: number): void;
}

export function buildRaven(material: THREE.Material): Raven {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 7), material);
  body.scale.set(0.75, 0.7, 2.1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.068, 8, 6), material);
  head.position.set(0, 0.04, -0.24);
  const beakG = new THREE.ConeGeometry(0.026, 0.11, 6);
  beakG.rotateX(-Math.PI / 2);
  const beak = new THREE.Mesh(beakG, material);
  beak.position.set(0, 0.03, -0.33);
  const tail = new THREE.Mesh(shape(TAIL), material);
  tail.position.set(0, 0.01, 0.17);
  group.add(body, head, beak, tail);

  const wings: { inner: THREE.Object3D; outer: THREE.Object3D; s: number }[] = [];
  for (const s of [1, -1]) {
    const innerG = shape(INNER);
    const outerG = shape(OUTER);
    if (s < 0) {
      innerG.scale(-1, 1, 1);
      outerG.scale(-1, 1, 1);
    }
    const inner = new THREE.Mesh(innerG, material);
    inner.position.set(s * 0.055, 0.035, -0.06);
    const outer = new THREE.Mesh(outerG, material);
    outer.position.set(s * 0.28, 0, 0);
    inner.add(outer);
    group.add(inner);
    wings.push({ inner, outer, s });
  }

  return {
    group,
    pose(phase, amount) {
      const a = Math.sin(phase) * 0.75 * amount + 0.12; // slight dihedral when gliding
      const b = Math.sin(phase - 0.6) * 0.55 * amount + 0.05;
      for (const w of wings) {
        w.inner.rotation.z = w.s * a;
        w.outer.rotation.z = w.s * b;
        w.inner.rotation.x = -0.15 * amount * Math.cos(phase); // wing twist on the downstroke
      }
      tail.rotation.x = 0.1 * Math.sin(phase * 0.5) * amount;
    },
  };
}

/** One merged mesh geometry of the raven in a pose, for sampling points on its surface. */
export function ravenGeometry(phase = 0, amount = 0): THREE.BufferGeometry {
  const r = buildRaven(new THREE.MeshBasicMaterial());
  r.pose(phase, amount);
  r.group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  r.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      parts.push(m.geometry.clone().applyMatrix4(m.matrixWorld));
    }
  });
  return mergeGeometries(parts)!;
}
