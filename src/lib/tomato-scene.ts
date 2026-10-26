import * as THREE from 'three';
import { growth, fruitScale } from './growth.mjs';
import {
  loadFarm,
  groundAt,
  worldVertices,
  boxCorners,
  fitCamera,
} from './farm-assets';

const MODELS = {
  sprout: 'SM_TomatoPlant_1_A',
  tall: 'SM_TomatoPlant_2_A',
  fruit: 'SM_TomatoPlant_2_B',
  island: 'SM_GrassIsland_A_1',
  grass: 'SM_Grass_1_A',
  pebble: 'SM_Pebles_1_A',
};
// Pointer shake: push per canvas width crossed, spring stiffness, damping
// per second and the largest sideways bend at the top of a grown plant.
const PUSH = 3;
const STIFFNESS = 60;
const DAMPING = 4;
const MAX_BEND = 0.25;

// The fruit of SM_TomatoPlant_2_B is one mesh. Split it into separate
// tomatoes (connected pieces, welded by position) so each can grow alone.
function splitFruit(mesh: THREE.Mesh) {
  const geometry = mesh.geometry.index
    ? mesh.geometry.toNonIndexed()
    : mesh.geometry;
  const position = geometry.getAttribute('position');
  const triangles = position.count / 3;
  const parent = Array.from({ length: triangles }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const owner = new Map<string, number>();
  for (let v = 0; v < position.count; v++) {
    const key = [position.getX(v), position.getY(v), position.getZ(v)]
      .map((n) => Math.round(n * 1e4))
      .join();
    const triangle = Math.floor(v / 3);
    const other = owner.get(key);
    if (other === undefined) owner.set(key, triangle);
    else parent[find(triangle)] = find(other);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    const root = find(t);
    groups.set(root, [...(groups.get(root) ?? []), t]);
  }
  const pieces = [...groups.values()].map((list) => {
    const piece = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) {
      const source = geometry.getAttribute(name);
      const array = new Float32Array(list.length * 3 * source.itemSize);
      list.forEach((t, i) => {
        for (let k = 0; k < 3 * source.itemSize; k++)
          array[i * 3 * source.itemSize + k] =
            source.array[t * 3 * source.itemSize + k];
      });
      piece.setAttribute(
        name,
        new THREE.BufferAttribute(array, source.itemSize),
      );
    }
    piece.computeBoundingSphere();
    const center = piece.boundingSphere!.center.clone();
    piece.translate(-center.x, -center.y, -center.z);
    const fruit = new THREE.Mesh(piece, mesh.material);
    fruit.position.copy(center);
    fruit.castShadow = true;
    return fruit;
  });
  if (geometry !== mesh.geometry) geometry.dispose();
  const holder = new THREE.Group();
  holder.position.copy(mesh.position);
  holder.quaternion.copy(mesh.quaternion);
  holder.scale.copy(mesh.scale);
  pieces
    .sort((a, b) => a.position.y - b.position.y)
    .forEach((p) => holder.add(p));
  mesh.parent!.add(holder);
  mesh.removeFromParent();
  return pieces;
}

// The plant bends from its base: points higher above the ground move more,
// and fast motion makes the leaves flutter on top of the bend.
function bendingMaterial(
  base: THREE.Material,
  uniforms: Record<string, THREE.IUniform>,
) {
  const material = base.clone();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec2 uBend;
        uniform float uRustle;
        uniform float uTime;
        uniform float uGround;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 bent = modelMatrix * vec4( transformed, 1.0 );
        float lift = clamp( ( bent.y - uGround ) / 1.9, 0.0, 1.2 );
        float weight = lift * lift;
        bent.xz += uBend * weight;
        bent.xyz += uRustle * weight * 0.03 * vec3(
          sin( uTime * 17.0 + bent.y * 31.0 + bent.x * 23.0 ),
          0.5 * sin( uTime * 13.0 + bent.x * 29.0 ),
          sin( uTime * 19.0 + bent.z * 27.0 + bent.y * 11.0 ) );
        vec4 mvPosition = viewMatrix * bent;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  return material;
}

export type TomatoScene = {
  update(progress: number, running: boolean): void;
  dispose(): void;
};

export async function createTomatoScene(
  host: HTMLElement,
): Promise<TomatoScene> {
  const { material, models } = await loadFarm(MODELS);
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
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, {
    left: -1.2,
    right: 1.2,
    top: 1.2,
    bottom: -1.2,
  });
  scene.add(sun);

  const island = models.island.clone();
  island.scale.setScalar(0.62);
  scene.add(island);
  // The plant stands where the island's surface is under its centre.
  const ground = groundAt(island, 0, 0);
  for (const [x, z, r] of [
    [0.34, 0.26, 0.4],
    [-0.36, 0.1, 2.1],
    [0.12, -0.32, 4],
  ]) {
    const grass = models.grass.clone();
    grass.position.set(x, groundAt(island, x, z, ground), z);
    grass.rotation.y = r;
    grass.scale.setScalar(0.9);
    scene.add(grass);
  }
  const pebble = models.pebble.clone();
  pebble.position.set(-0.22, ground - 0.02, 0.36);
  pebble.scale.setScalar(0.6);
  scene.add(pebble);

  const plant = new THREE.Group();
  plant.position.y = ground - 0.02;
  scene.add(plant);
  const stages = {
    sprout: models.sprout.clone(),
    tall: models.tall.clone(),
    fruit: models.fruit.clone(),
  };
  const fruitMeshes: THREE.Mesh[] = [];
  stages.fruit.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.fruit)
      fruitMeshes.push(child);
  });
  const fruits = fruitMeshes.flatMap(splitFruit);
  for (const model of Object.values(stages)) plant.add(model);
  const bendUniforms = {
    uBend: { value: new THREE.Vector2() },
    uRustle: { value: 0 },
    uTime: { value: 0 },
    uGround: { value: ground },
  };
  const plantMaterial = bendingMaterial(material, bendUniforms);
  plant.traverse((child) => {
    if (child instanceof THREE.Mesh) child.material = plantMaterial;
  });

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  // The camera frames the island and the fully grown plant (with room for
  // the stage pop) from a fixed angle, so nothing is cut at any canvas size.
  scene.updateMatrixWorld(true);
  const grown = new THREE.Box3().setFromObject(stages.fruit);
  grown.max.y = ground + (grown.max.y - ground) * 1.08;
  grown.expandByVector(new THREE.Vector3(MAX_BEND / 2, 0, MAX_BEND / 2));
  const points = [...worldVertices(island), ...boxCorners(grown)];
  const view = new THREE.Vector3(2.7, 2.2, 3.8).normalize();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera(camera, points, view, 0.9);
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let stage = '';
  let scale = 1;
  let popAt = 0;
  let swaying = false;
  let frame = 0;

  // Moving the pointer across the plant pushes it sideways; a damped spring
  // brings it back upright.
  const bend = bendUniforms.uBend.value;
  const velocity = new THREE.Vector2();
  let pointer: { x: number; y: number } | null = null;
  const onPointerMove = (event: PointerEvent) => {
    if (still.matches) return;
    if (pointer) {
      const { clientWidth: w, clientHeight: h } = host;
      const right = new THREE.Vector3().setFromMatrixColumn(
        camera.matrixWorld,
        0,
      );
      const toward = new THREE.Vector3().setFromMatrixColumn(
        camera.matrixWorld,
        2,
      );
      const dx = (event.clientX - pointer.x) / w;
      const dy = (event.clientY - pointer.y) / h;
      velocity.x += (right.x * dx + toward.x * dy * 0.5) * PUSH;
      velocity.y += (right.z * dx + toward.z * dy * 0.5) * PUSH;
    }
    pointer = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(loop);
  };
  const onPointerLeave = () => (pointer = null);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  const settled = () => velocity.length() < 0.002 && bend.length() < 0.001;

  function step(dt: number) {
    if (settled()) {
      bend.set(0, 0);
      velocity.set(0, 0);
    } else {
      velocity.addScaledVector(bend, -STIFFNESS * dt);
      velocity.multiplyScalar(Math.exp(-DAMPING * dt));
      bend.addScaledVector(velocity, dt);
      if (bend.length() > MAX_BEND) bend.setLength(MAX_BEND);
    }
    bendUniforms.uRustle.value = Math.min(1, velocity.length() * 1.5);
  }

  function render(time = performance.now()) {
    bendUniforms.uTime.value = time / 1000;
    const pop =
      time - popAt < 600
        ? Math.sin(((time - popAt) / 600) * Math.PI) * 0.08
        : 0;
    plant.scale.setScalar(scale * (1 + pop));
    plant.rotation.z = swaying ? Math.sin(time / 900) * 0.03 : 0;
    plant.rotation.x = swaying ? Math.sin(time / 1300) * 0.015 : 0;
    renderer.render(scene, camera);
  }
  // Swaying only needs about 30 frames a second.
  let last = 0;
  function loop(time: number) {
    if (time - last > 30) {
      step(Math.min(0.05, (time - last) / 1000));
      last = time;
      render(time);
    }
    frame =
      swaying || time - popAt < 600 || !settled()
        ? requestAnimationFrame(loop)
        : 0;
  }

  resize();
  return {
    update(progress, running) {
      const next = growth(progress);
      if (stage && next.stage !== stage && !still.matches)
        popAt = performance.now();
      stage = next.stage;
      scale = next.scale;
      for (const [name, model] of Object.entries(stages))
        model.visible = name === stage;
      fruits.forEach((fruit, i) =>
        fruit.scale.setScalar(
          Math.max(1e-4, fruitScale(progress, i, fruits.length)),
        ),
      );
      swaying = running && !still.matches;
      if (!frame) frame = requestAnimationFrame(loop);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      plantMaterial.dispose();
      for (const fruit of fruits) fruit.geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
