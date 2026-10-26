import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Models and the shared gradient atlas come from the Farm Pack. The glTF
// files carry UVs but no texture, so every mesh gets the atlas here.
const BASE = `${import.meta.env.BASE_URL}models/farm/`;

let atlas: Promise<THREE.Material> | null = null;
const files = new Map<string, Promise<THREE.Object3D>>();

function loadMaterial() {
  atlas ??= new THREE.TextureLoader()
    .loadAsync(`${BASE}farm-atlas.png`)
    .then((map) => {
      map.flipY = false;
      map.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
    });
  atlas.catch(() => (atlas = null));
  return atlas;
}

function loadFile(file: string, material: THREE.Material) {
  let model = files.get(file);
  if (!model) {
    model = new GLTFLoader()
      .loadAsync(`${BASE}${file}.glb`)
      .then(({ scene }) => {
        scene.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.userData.fruit = child.material.name === 'M_Metalic_3_Farm';
          child.material = material;
          child.castShadow = true;
          child.receiveShadow = true;
        });
        return scene;
      });
    model.catch(() => files.delete(file));
    files.set(file, model);
  }
  return model;
}

/** Loads each model once for the app's lifetime; scenes clone from it. */
export async function loadFarm<K extends string>(models: Record<K, string>) {
  const material = await loadMaterial();
  const entries = await Promise.all(
    Object.entries<string>(models).map(
      async ([key, file]) => [key, await loadFile(file, material)] as const,
    ),
  );
  return {
    material,
    models: Object.fromEntries(entries) as Record<K, THREE.Object3D>,
  };
}

const down = new THREE.Vector3(0, -1, 0);

/** Height of `ground`'s surface under (x, z), or `fallback` off its edge. */
export function groundAt(
  ground: THREE.Object3D,
  x: number,
  z: number,
  fallback = 0,
) {
  ground.updateMatrixWorld(true);
  return (
    new THREE.Raycaster(new THREE.Vector3(x, 50, z), down).intersectObject(
      ground,
      true,
    )[0]?.point.y ?? fallback
  );
}

/** World positions of every vertex under `object`. */
export function worldVertices(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const position = child.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++)
      points.push(
        new THREE.Vector3()
          .fromBufferAttribute(position, i)
          .applyMatrix4(child.matrixWorld),
      );
  });
  return points;
}

/** The eight corners of a box. */
export function boxCorners(box: THREE.Box3) {
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z])
        corners.push(new THREE.Vector3(x, y, z));
  return corners;
}

/**
 * Places `camera` along `view` from the points' centre, as close as it can be
 * while every point stays inside `margin` of the frame, with matching
 * margins on opposite sides.
 */
export function fitCamera(
  camera: THREE.PerspectiveCamera,
  points: THREE.Vector3[],
  view: THREE.Vector3,
  margin: number,
) {
  const target = new THREE.Box3()
    .setFromPoints(points)
    .getCenter(new THREE.Vector3());
  const point = new THREE.Vector3();
  const place = (distance: number) => {
    camera.position.copy(target).addScaledVector(view, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const extent = new THREE.Box2();
    for (const p of points) {
      point.copy(p).project(camera);
      extent.expandByPoint(new THREE.Vector2(point.x, point.y));
    }
    return extent;
  };
  const size = new THREE.Box3()
    .setFromPoints(points)
    .getSize(new THREE.Vector3())
    .length();
  for (let pass = 0; pass < 4; pass++) {
    let near = size;
    let far = size * 10;
    for (let i = 0; i < 20; i++) {
      const mid = (near + far) / 2;
      const { min, max } = place(mid);
      if (Math.max(-min.x, max.x, -min.y, max.y) > margin) near = mid;
      else far = mid;
    }
    const { min, max } = place(far);
    if (pass === 3) break;
    // Shift the aim so opposite margins match, then fit again.
    const half = far * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target
      .addScaledVector(right, ((min.x + max.x) / 2) * half * camera.aspect)
      .addScaledVector(up, ((min.y + max.y) / 2) * half);
  }
  return target;
}
