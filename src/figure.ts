import * as THREE from 'three';

/**
 * Azri as a dream silhouette, 1.85 m: hooded skald shape with a mask plane and a frame drum on his left side.
 * Origin at the feet, facing -Z.
 */
export function buildFigure(body: THREE.Material, mask: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    g.add(mesh);
    return mesh;
  };
  // Long cloak: a tapered cone from shoulders to the ground
  add(new THREE.CylinderGeometry(0.26, 0.42, 1.5, 16, 1, true), body, 0, 0.75, 0);
  add(new THREE.CapsuleGeometry(0.22, 0.35, 4, 12), body, 0, 1.35, 0, 1.15, 1, 0.8);
  // Hooded head
  add(new THREE.SphereGeometry(0.13, 16, 12), body, 0, 1.72, 0, 1, 1.12, 1);
  // Mask: a slightly curved pale plate on the face
  const maskGeo = new THREE.SphereGeometry(0.11, 16, 12, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.2, Math.PI * 0.62);
  add(maskGeo, mask, 0, 1.71, -0.025, 1, 1.15, 1);
  // Beard
  add(new THREE.ConeGeometry(0.075, 0.3, 8), body, 0, 1.47, -0.09, 1, 1, 0.6).rotation.x = Math.PI;
  // Frame drum at the left hip
  const drum = add(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 32), body, -0.34, 1.0, -0.05);
  drum.rotation.z = Math.PI / 2;
  drum.rotation.y = 0.3;
  return g;
}
