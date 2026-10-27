/** Three.js scene: low-poly course, ball, camera, distance labels. */

import * as THREE from "three";
import {
  BALL_RADIUS,
  SHOT_GHOST_COUNT,
  predictShotGhosts,
  sampleTerrain,
  type HoleDef,
  type LevelData,
  type RoundSnapshot,
  type WorkGolfEngine,
} from "./workGolfEngine";

const COLORS = {
  water: 0x5ec8e8,
  medium: 0x4cae3a,
  tall: 0x2f7a28,
  green: 0xa8d94a,
  sand: 0xe2c98a,
  dirt: 0xc9a36a,
  trunk: 0x6b4423,
  pine: 0x1f6b2e,
  ball: 0xf5f5f0,
};

function surfaceColor(code: number): number {
  switch (code) {
    case 1:
      return COLORS.tall;
    case 2:
      return COLORS.green;
    case 3:
      return COLORS.sand;
    default:
      return COLORS.medium;
  }
}

function makeDistanceTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildTerrainMesh(level: LevelData): THREE.Mesh {
  const { size, cell, heights, surfaces, waterY } = level;
  const half = ((size - 1) * cell) / 2;
  const vertCount = size * size;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const color = new THREE.Color();
  const dirt = new THREE.Color(COLORS.dirt);

  // Shared-vertex grid — every adjacent quad reuses the same corner verts (proper weld)
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const i = iz * size + ix;
      const h = heights[i]!;
      const x = -half + ix * cell;
      const z = -half + iz * cell;
      const p = i * 3;
      positions[p] = x;
      positions[p + 1] = h;
      positions[p + 2] = z;

      // Shore / underwater faces use dirt so cliffs read as soil, not grass underwater
      if (h <= waterY + 0.12) {
        color.copy(dirt);
      } else {
        color.setHex(surfaceColor(surfaces[i]!));
      }
      colors[p] = color.r;
      colors[p + 1] = color.g;
      colors[p + 2] = color.b;
    }
  }

  const indices: number[] = [];
  for (let iz = 0; iz < size - 1; iz++) {
    for (let ix = 0; ix < size - 1; ix++) {
      const i00 = iz * size + ix;
      const i10 = i00 + 1;
      const i01 = i00 + size;
      const i11 = i01 + 1;
      // Skip fully submerged quads (water plane covers them)
      const maxH = Math.max(heights[i00]!, heights[i10]!, heights[i01]!, heights[i11]!);
      if (maxH < waterY - 0.05) continue;
      indices.push(i00, i01, i10, i10, i01, i11);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function makeTree(tree: LevelData["trees"][number]): THREE.Group {
  const g = new THREE.Group();
  g.position.set(tree.x, tree.y, tree.z);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, tree.height * 0.28, 5),
    new THREE.MeshLambertMaterial({ color: COLORS.trunk, flatShading: true }),
  );
  trunk.position.y = tree.height * 0.14;
  trunk.castShadow = true;
  g.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(tree.radius * 1.35, tree.height * 0.85, 6),
    new THREE.MeshLambertMaterial({ color: COLORS.pine, flatShading: true }),
  );
  foliage.position.y = tree.height * 0.55;
  foliage.castShadow = true;
  g.add(foliage);

  return g;
}

function makeFlag(hole: HoleDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(hole.x, hole.y, hole.z);
  g.userData.holeId = hole.id;

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5),
    new THREE.MeshLambertMaterial({ color: 0xf8fafc, flatShading: true }),
  );
  pole.position.y = 1.2;
  pole.castShadow = true;
  g.add(pole);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.85, 0.28);
  flagShape.lineTo(0, 0.56);
  flagShape.closePath();
  const flagGeo = new THREE.ShapeGeometry(flagShape);
  const flag = new THREE.Mesh(
    flagGeo,
    new THREE.MeshLambertMaterial({
      color: hole.color,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  );
  flag.position.set(0.04, 1.85, 0);
  g.add(flag);

  const cup = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 10),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a, flatShading: true }),
  );
  cup.rotation.x = -Math.PI / 2;
  cup.position.y = 0.02;
  g.add(cup);

  return g;
}

export type WorkGolfSceneHandle = {
  dom: HTMLCanvasElement;
  resize: (w: number, h: number) => void;
  sync: (engine: WorkGolfEngine, snap: RoundSnapshot) => void;
  worldToScreen: (x: number, y: number, z: number) => { x: number; y: number } | null;
  pickBall: (clientX: number, clientY: number, rect: DOMRect) => boolean;
  dispose: () => void;
};

export function createWorkGolfScene(container: HTMLElement): WorkGolfSceneHandle {
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.water);
  scene.fog = new THREE.Fog(COLORS.water, 55, 120);

  const camera = new THREE.PerspectiveCamera(42, width / height, 0.35, 200);

  const hemi = new THREE.HemisphereLight(0xb8e8ff, 0x8b6b3a, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.15);
  sun.position.set(-28, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshLambertMaterial({ color: COLORS.water, flatShading: true }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.receiveShadow = true;
  scene.add(water);

  const world = new THREE.Group();
  scene.add(world);

  const ballGeo = new THREE.IcosahedronGeometry(BALL_RADIUS, 0);
  const ballMat = new THREE.MeshLambertMaterial({
    color: COLORS.ball,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.renderOrder = 2;
  scene.add(ballMesh);

  // Ghost balls along the predicted parabola (50% scale, fade 50% → 0%)
  const ghostBalls: THREE.Mesh[] = [];
  for (let i = 0; i < SHOT_GHOST_COUNT; i++) {
    const mat = new THREE.MeshLambertMaterial({
      color: COLORS.ball,
      flatShading: true,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
    });
    const ghost = new THREE.Mesh(ballGeo, mat);
    ghost.scale.setScalar(0.5);
    ghost.visible = false;
    ghost.frustumCulled = false;
    ghost.renderOrder = 10;
    scene.add(ghost);
    ghostBalls.push(ghost);
  }

  let terrainMesh: THREE.Mesh | null = null;
  const flagGroups = new Map<number, THREE.Group>();
  const labelSprites = new Map<number, THREE.Sprite>();
  let builtLevel = -1;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function clearWorld() {
    while (world.children.length) {
      const child = world.children[0]!;
      world.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
        if (obj instanceof THREE.Sprite) {
          const mat = obj.material;
          mat.map?.dispose();
          mat.dispose();
        }
      });
    }
    flagGroups.clear();
    labelSprites.clear();
    terrainMesh = null;
  }

  function rebuild(level: LevelData) {
    clearWorld();
    water.position.y = level.waterY;
    terrainMesh = buildTerrainMesh(level);
    world.add(terrainMesh);

    for (const tree of level.trees) {
      world.add(makeTree(tree));
    }

    for (const hole of level.holes) {
      const flag = makeFlag(hole);
      world.add(flag);
      flagGroups.set(hole.id, flag);

      const spriteMat = new THREE.SpriteMaterial({
        map: makeDistanceTexture("—", hole.color),
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(3.2, 0.8, 1);
      sprite.position.set(hole.x, hole.y + 3.1, hole.z);
      world.add(sprite);
      labelSprites.set(hole.id, sprite);
    }

    builtLevel = level.levelNumber;
  }

  function updateLabels(snap: RoundSnapshot) {
    for (const hole of snap.holes) {
      const sprite = labelSprites.get(hole.id);
      const flag = flagGroups.get(hole.id);
      if (!sprite || !flag) continue;
      flag.visible = hole.active;
      sprite.visible = hole.active;
      if (!hole.active) continue;

      const dx = hole.x - snap.ball.pos.x;
      const dz = hole.z - snap.ball.pos.z;
      const dist = Math.hypot(dx, dz);
      const yards = Math.round(dist * 1.2);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.map = makeDistanceTexture(`${yards}y`, hole.color);
      mat.needsUpdate = true;
      sprite.position.set(hole.x, hole.y + 3.1, hole.z);
    }
  }

  function updateCamera(snap: RoundSnapshot) {
    // Shot goes along cameraYaw; view sits ~3° off to the side so the arc is visible
    const aimYaw = snap.cameraYaw;
    const viewYaw = aimYaw + (3 * Math.PI) / 180;
    const z = snap.cameraZoom;
    // z=0 far, z=1 close — wide range so the slider feels dramatic
    const dist = 42 - z * 34;
    const height = 28 - z * 23;
    const lookAhead = 8.5 - z * 6.2;
    const lookUp = 3.4 - z * 2.2;
    const bx = snap.ball.pos.x;
    const by = snap.ball.pos.y;
    const bz = snap.ball.pos.z;

    // Camera behind/beside ball; look along the aim so ball stays bottom-center
    camera.position.set(
      bx - Math.sin(viewYaw) * dist,
      by + height,
      bz - Math.cos(viewYaw) * dist,
    );
    camera.lookAt(
      bx + Math.sin(aimYaw) * lookAhead,
      by + lookUp,
      bz + Math.cos(aimYaw) * lookAhead,
    );
  }

  function sync(engine: WorkGolfEngine, snap: RoundSnapshot) {
    if (builtLevel !== engine.level.levelNumber) {
      rebuild(engine.level);
    }

    // Lift slightly along terrain normal so the ball doesn't clip into slopes
    const ground = sampleTerrain(engine.level, snap.ball.pos.x, snap.ball.pos.z);
    const lift = 0.04;
    ballMesh.position.set(
      snap.ball.pos.x + ground.normal.x * lift,
      snap.ball.pos.y + ground.normal.y * lift,
      snap.ball.pos.z + ground.normal.z * lift,
    );
    if (snap.ball.moving) {
      ballMesh.rotation.x += snap.ball.vel.z * 0.02;
      ballMesh.rotation.z -= snap.ball.vel.x * 0.02;
    }

    if (snap.aiming && snap.power > 0.02) {
      const ghosts = predictShotGhosts({
        origin: snap.ball.pos,
        power: snap.power,
        yaw: snap.cameraYaw,
        club: snap.club,
        level: engine.level,
      });
      for (let i = 0; i < ghostBalls.length; i++) {
        const ghost = ghostBalls[i]!;
        const p = ghosts[i];
        if (!p) {
          ghost.visible = false;
          continue;
        }
        ghost.visible = true;
        ghost.position.set(p.x, p.y, p.z);
        // Near → far: 50% → faint (keep impact site visible)
        const t = ghostBalls.length <= 1 ? 0 : i / (ghostBalls.length - 1);
        (ghost.material as THREE.MeshLambertMaterial).opacity = 0.5 * (1 - t) + 0.08 * t;
      }
    } else {
      for (const ghost of ghostBalls) ghost.visible = false;
    }

    updateLabels(snap);
    updateCamera(snap);
    renderer.render(scene, camera);
  }

  function resize(w: number, h: number) {
    const ww = Math.max(1, w);
    const hh = Math.max(1, h);
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
    renderer.setSize(ww, hh);
  }

  function worldToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(camera);
    if (v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
      y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
    };
  }

  function pickBall(clientX: number, clientY: number, rect: DOMRect): boolean {
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(ballMesh, false);
    if (hits.length > 0) return true;
    // Generous touch target
    const screen = worldToScreen(ballMesh.position.x, ballMesh.position.y, ballMesh.position.z);
    if (!screen) return false;
    const dx = clientX - rect.left - screen.x;
    const dy = clientY - rect.top - screen.y;
    return dx * dx + dy * dy < 48 * 48;
  }

  function dispose() {
    clearWorld();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    dom: renderer.domElement,
    resize,
    sync,
    worldToScreen,
    pickBall,
    dispose,
  };
}
