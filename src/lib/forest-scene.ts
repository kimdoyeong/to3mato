import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { spiral } from './forest.mjs';
import {
  loadFarm,
  groundAt,
  worldVertices,
  boxCorners,
  fitCamera,
} from './farm-assets';

export type ForestItem = {
  kind: 'tree' | 'bush' | 'flowers' | 'chicken' | 'pig' | 'cow';
  variant?: number;
  seed: number;
};

const MODELS = {
  island: 'SM_GrassIsland_A_1',
  tree0: 'SM_Tree_A_1',
  tree1: 'SM_Tree_A_3',
  tree2: 'SM_Tree_B_1',
  tree3: 'SM_Tree_B_3',
  bush: 'SM_Bush_1_1_A',
  flowers: 'SM_Flowers_1_A',
  chicken: 'SM_Chicken_A',
  pig: 'SM_Pig',
  cow: 'SM_Cow',
};
// Scale of each kind so a tree is about 0.55 high next to small animals.
const SIZE: Record<ForestItem['kind'], number> = {
  tree: 0.16,
  bush: 0.15,
  flowers: 0.6,
  chicken: 0.34,
  pig: 0.3,
  cow: 0.25,
};
const SPACING = 0.21;
// SM_GrassIsland_A_1 is about 1 across from its centre at scale 1.
const ISLAND_REACH = 0.9;

export type ForestScene = {
  update(items: ForestItem[]): void;
  dispose(): void;
};

export async function createForestScene(
  host: HTMLElement,
): Promise<ForestScene> {
  const { models } = await loadFarm(MODELS);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8fae6a, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(2.5, 5, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const island = models.island.clone();
  // The island mesh sits off its origin; keep its middle under the spiral.
  const middle = new THREE.Box3()
    .setFromObject(island)
    .getCenter(new THREE.Vector3());
  scene.add(island);
  const forest = new THREE.Group();
  scene.add(forest);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const view = new THREE.Vector3(0, 1.3, 2.4).normalize();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = 0.85;
  controls.maxPolarAngle = 1.2;
  let points: THREE.Vector3[] = [];

  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  function frame() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h || !points.length) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.target.copy(fitCamera(camera, points, view, 0.85));
    controls.update();
    render();
  }
  const observer = new ResizeObserver(frame);
  observer.observe(host);

  return {
    update(items) {
      forest.clear();
      const outer = items.length ? spiral(items.length - 1, SPACING).radius : 0;
      const reach = Math.max(0.6, (outer + 0.25) / ISLAND_REACH);
      // Wider islands keep a low profile instead of growing into a cliff.
      island.scale.set(reach, Math.min(reach, 1) * 0.6, reach);
      island.position.set(-middle.x * reach, 0, -middle.z * reach);
      const shadow = sun.shadow.camera;
      Object.assign(shadow, {
        left: -reach * 1.3,
        right: reach * 1.3,
        top: reach * 1.3,
        bottom: -reach * 1.3,
      });
      shadow.updateProjectionMatrix();
      items.forEach((item, i) => {
        const { x, z } = spiral(i, SPACING);
        const source =
          item.kind === 'tree'
            ? models[`tree${item.variant ?? 0}` as 'tree0']
            : models[item.kind];
        const model = source.clone();
        model.position.set(x, groundAt(island, x, z) - 0.01, z);
        model.rotation.y = item.seed * Math.PI * 2;
        // A little size variety keeps rows of the same tree from looking cut out.
        model.scale.setScalar(SIZE[item.kind] * (0.9 + item.seed * 0.2));
        forest.add(model);
      });
      scene.updateMatrixWorld(true);
      points = worldVertices(island);
      if (items.length)
        points.push(...boxCorners(new THREE.Box3().setFromObject(forest)));
      frame();
    },
    dispose() {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
