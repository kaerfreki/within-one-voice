import * as THREE from 'three';

export interface Frame {
  /** Seconds since the start of this section. */
  local: number;
  /** Section length in seconds. */
  dur: number;
  /** Song time in seconds. */
  t: number;
  variant: string;
}

export abstract class Dream {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 2000);
  /** Extra bloom strength this dream wants right now, set in update(). */
  bloom = 0;
  abstract update(f: Frame): void;
}
