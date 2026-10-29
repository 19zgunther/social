/** Three.js scene: low-poly course, ball, camera, distance labels. */

import * as THREE from "three";
import {
  BALL_RADIUS,
  CUP_DEPTH,
  CUP_RADIUS,
  SHOT_GHOST_COUNT,
  predictShotGhosts,
  sampleTerrain,
  type HoleDef,
  type LevelData,
  type RoundSnapshot,
  type WorkGolfEngine,
} from "./workGolfEngine";

const COLORS = {
  water: 0x4eb8d9,
  waterDeep: 0x1a6f8c,
  waterHorizon: 0x7ad0ea,
  medium: 0x4cae3a,
  tall: 0x2f7a28,
  green: 0xa8d94a,
  sand: 0xe2c98a,
  dirt: 0xc9a36a,
  trunk: 0x6b4423,
  pine: 0x1f6b2e,
  ball: 0xf5f5f0,
};

/** Cap visible grass cards — one InstancedMesh draw call, no shadows. */
const GRASS_MAX_INSTANCES = 720;
/** Only populate tufts near the ball (mobile-friendly). */
const GRASS_VIEW_RADIUS = 20;
const GRASS_BUCKET = 4;
const SURFACE_CODE_MEDIUM = 0;
const SURFACE_CODE_TALL = 1;

type GrassTuft = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  tall: boolean;
};

/** Soft alpha blade card — alphaTest (no blending sort cost). */
function makeGrassTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  // A few overlapping blades tapering to a tip
  const blades = [
    { x: 0.28, w: 0.1, lean: -0.08, shade: "#3d9a32" },
    { x: 0.5, w: 0.12, lean: 0.04, shade: "#4cae3a" },
    { x: 0.7, w: 0.09, lean: 0.1, shade: "#2f7a28" },
    { x: 0.4, w: 0.07, lean: -0.14, shade: "#5bc24a" },
    { x: 0.6, w: 0.08, lean: 0.16, shade: "#357a2c" },
  ];
  for (const b of blades) {
    ctx.beginPath();
    const baseX = b.x * size;
    const half = b.w * size * 0.5;
    ctx.moveTo(baseX - half, size);
    ctx.quadraticCurveTo(
      baseX + b.lean * size * 0.35,
      size * 0.45,
      baseX + b.lean * size,
      size * 0.04,
    );
    ctx.quadraticCurveTo(
      baseX + b.lean * size * 0.35 + half * 0.15,
      size * 0.45,
      baseX + half,
      size,
    );
    ctx.closePath();
    ctx.fillStyle = b.shade;
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Two crossed quads = readable tuft from any yaw without camera-facing CPU work. */
function makeGrassClumpGeometry(): THREE.BufferGeometry {
  const w = 0.55;
  const h = 1;
  const hw = w * 0.5;
  // prettier-ignore
  const positions = new Float32Array([
    // plane A (along X)
    -hw, 0, 0,  hw, 0, 0,  hw, h, 0,  -hw, h, 0,
    // plane B (along Z)
    0, 0, -hw,  0, 0, hw,  0, h, hw,  0, h, -hw,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function grassBucketKey(x: number, z: number): string {
  const bx = Math.floor(x / GRASS_BUCKET);
  const bz = Math.floor(z / GRASS_BUCKET);
  return `${bx},${bz}`;
}

function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(COLORS.waterDeep) },
      uShallow: { value: new THREE.Color(COLORS.water) },
      uFoam: { value: new THREE.Color(0xd7f6ff) },
      uSunDir: { value: new THREE.Vector3(-0.45, 0.82, 0.35).normalize() },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying float vWave;

      void main() {
        vec3 p = position;
        float t = uTime;
        float w1 = sin(p.x * 0.11 + t * 1.1) * cos(p.y * 0.09 + t * 0.85);
        float w2 = sin(p.x * 0.29 - t * 1.4 + p.y * 0.17) * 0.45;
        float w3 = cos(p.x * 0.07 - p.y * 0.13 + t * 0.55) * 0.35;
        float wave = (w1 + w2 + w3) * 0.16;
        p.z += wave;
        vWave = wave;

        // Analytic-ish normal for low-poly sparkle
        float dx = cos(p.x * 0.11 + t * 1.1) * 0.11 * cos(p.y * 0.09 + t * 0.85)
          + cos(p.x * 0.29 - t * 1.4 + p.y * 0.17) * 0.29 * 0.45
          - sin(p.x * 0.07 - p.y * 0.13 + t * 0.55) * 0.07 * 0.35;
        float dy = -sin(p.x * 0.11 + t * 1.1) * sin(p.y * 0.09 + t * 0.85) * 0.09
          + cos(p.x * 0.29 - t * 1.4 + p.y * 0.17) * 0.17 * 0.45
          + sin(p.x * 0.07 - p.y * 0.13 + t * 0.55) * 0.13 * 0.35;
        vec3 n = normalize(vec3(-dx * 0.16, -dy * 0.16, 1.0));

        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying float vWave;

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = max(dot(N, V), 0.0);
        float fresnel = pow(1.0 - ndv, 2.8);

        vec3 col = mix(uShallow, uDeep, fresnel * 0.85 + 0.1);
        // Crest foam on wave peaks
        float crest = smoothstep(0.06, 0.14, vWave);
        col = mix(col, uFoam, crest * 0.35);

        // Soft specular sun glitter
        vec3 R = reflect(-uSunDir, N);
        float spec = pow(max(dot(R, V), 0.0), 42.0);
        col += uFoam * spec * 0.55;

        // Tiny sparkles drifting across the surface
        float spark = sin(vWorldPos.x * 2.8 + uTime * 2.0) * sin(vWorldPos.z * 2.4 - uTime * 1.6);
        spark = smoothstep(0.92, 0.995, spark);
        col += uFoam * spark * 0.4;

        float alpha = 0.82 + fresnel * 0.14;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

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

/** Local grid refinement near cups and bunker lips (same density so edges weld). */
const DETAIL_SUBDIV = 6;

function cellNeedsDetail(level: LevelData, ix: number, iz: number): boolean {
  const half = ((level.size - 1) * level.cell) / 2;
  const cx = -half + (ix + 0.5) * level.cell;
  const cz = -half + (iz + 0.5) * level.cell;
  const cupReach = level.cell * 1.6 + CUP_RADIUS + 0.2;
  for (const hole of level.holes) {
    if (Math.hypot(cx - hole.x, cz - hole.z) <= cupReach) return true;
  }
  for (const b of level.bunkers) {
    if (Math.hypot(cx - b.x, cz - b.z) <= b.reach + level.cell * 1.25) return true;
  }
  return false;
}

function pushTerrainVert(
  positions: number[],
  colors: number[],
  level: LevelData,
  x: number,
  z: number,
  color: THREE.Color,
  dirt: THREE.Color,
): number {
  const sample = sampleTerrain(level, x, z);
  const h = sample.height;
  const i = positions.length / 3;
  positions.push(x, h, z);
  if (sample.inCup) {
    color.setHex(0x1a1a1a);
  } else if (sample.onSandFloor) {
    // Sand only on the recessed floor — rim / walls stay turf-colored
    color.setHex(COLORS.sand);
  } else if (h <= level.waterY + 0.12) {
    color.copy(dirt);
  } else if (h < level.waterY + 1.35) {
    // Cliff band above the ocean
    color.copy(dirt);
  } else {
    // Approximate surface color from nearest heightfield cell
    const half = ((level.size - 1) * level.cell) / 2;
    const ix = Math.max(0, Math.min(level.size - 1, Math.round((x + half) / level.cell)));
    const iz = Math.max(0, Math.min(level.size - 1, Math.round((z + half) / level.cell)));
    color.setHex(surfaceColor(level.surfaces[iz * level.size + ix]!));
  }
  colors.push(color.r, color.g, color.b);
  return i;
}

function buildTerrainMesh(level: LevelData): THREE.Mesh {
  const { size, cell, heights, waterY } = level;
  const half = ((size - 1) * cell) / 2;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  const dirt = new THREE.Color(COLORS.dirt);
  const refineEdgeCache = new Map<string, number>();

  // Coarse shared-vertex grid for cells away from cups
  const coarseIndex = new Int32Array(size * size);
  coarseIndex.fill(-1);

  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const i = iz * size + ix;
      const h = heights[i]!;
      const x = -half + ix * cell;
      const z = -half + iz * cell;
      // Still store coarse verts (shared); cup/bunker carve applied via sample
      const carved = sampleTerrain(level, x, z);
      const y = carved.height;
      coarseIndex[i] = positions.length / 3;
      positions.push(x, y, z);
      if (carved.inCup) {
        color.setHex(0x1a1a1a);
      } else if (carved.onSandFloor) {
        color.setHex(COLORS.sand);
      } else if (y <= waterY + 0.12 || y < waterY + 1.35) {
        color.copy(dirt);
      } else {
        color.setHex(surfaceColor(level.surfaces[i]!));
      }
      colors.push(color.r, color.g, color.b);
    }
  }

  for (let iz = 0; iz < size - 1; iz++) {
    for (let ix = 0; ix < size - 1; ix++) {
      const i00 = iz * size + ix;
      const maxH = Math.max(
        heights[i00]!,
        heights[i00 + 1]!,
        heights[i00 + size]!,
        heights[i00 + size + 1]!,
      );
      if (maxH < waterY - 0.05) continue;

      if (cellNeedsDetail(level, ix, iz)) {
        // Local high-res patch so cup / bunker lips have real triangles
        const x0 = -half + ix * cell;
        const z0 = -half + iz * cell;
        const step = cell / DETAIL_SUBDIV;
        const local: number[] = [];
        for (let jz = 0; jz <= DETAIL_SUBDIV; jz++) {
          for (let jx = 0; jx <= DETAIL_SUBDIV; jx++) {
            const x = x0 + jx * step;
            const z = z0 + jz * step;
            const onCorner =
              (jx === 0 || jx === DETAIL_SUBDIV) && (jz === 0 || jz === DETAIL_SUBDIV);
            if (onCorner) {
              const cix = ix + (jx === DETAIL_SUBDIV ? 1 : 0);
              const ciz = iz + (jz === DETAIL_SUBDIV ? 1 : 0);
              local.push(coarseIndex[ciz * size + cix]!);
            } else {
              // Cache edge verts so adjacent refined cells weld
              const onEdge =
                jx === 0 || jx === DETAIL_SUBDIV || jz === 0 || jz === DETAIL_SUBDIV;
              if (onEdge) {
                const key = `${x.toFixed(4)},${z.toFixed(4)}`;
                let vi = refineEdgeCache.get(key);
                if (vi === undefined) {
                  vi = pushTerrainVert(positions, colors, level, x, z, color, dirt);
                  refineEdgeCache.set(key, vi);
                }
                local.push(vi);
              } else {
                local.push(pushTerrainVert(positions, colors, level, x, z, color, dirt));
              }
            }
          }
        }
        const stride = DETAIL_SUBDIV + 1;
        for (let jz = 0; jz < DETAIL_SUBDIV; jz++) {
          for (let jx = 0; jx < DETAIL_SUBDIV; jx++) {
            const a = local[jz * stride + jx]!;
            const b = local[jz * stride + jx + 1]!;
            const c = local[(jz + 1) * stride + jx]!;
            const d = local[(jz + 1) * stride + jx + 1]!;
            indices.push(a, c, b, b, c, d);
          }
        }
      } else {
        const a = coarseIndex[i00]!;
        const b = coarseIndex[i00 + 1]!;
        const c = coarseIndex[i00 + size]!;
        const d = coarseIndex[i00 + size + 1]!;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
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

  // Dark cup liner matching the carved opening (terrain holds the real hole)
  const liner = new THREE.Mesh(
    new THREE.CylinderGeometry(CUP_RADIUS * 0.98, CUP_RADIUS * 0.92, CUP_DEPTH, 12, 1, true),
    new THREE.MeshLambertMaterial({
      color: 0x111111,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  );
  liner.position.y = -CUP_DEPTH * 0.5 + 0.02;
  g.add(liner);

  const cupFloor = new THREE.Mesh(
    new THREE.CircleGeometry(CUP_RADIUS * 0.9, 12),
    new THREE.MeshLambertMaterial({ color: 0x0a0a0a, flatShading: true }),
  );
  cupFloor.rotation.x = -Math.PI / 2;
  cupFloor.position.y = -CUP_DEPTH + 0.04;
  g.add(cupFloor);

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
  scene.background = new THREE.Color(COLORS.waterHorizon);
  scene.fog = new THREE.Fog(COLORS.waterDeep, 75, 175);

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

  const waterMat = createWaterMaterial();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(280, 280, 72, 72), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.renderOrder = -1;
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

  // --- Cheap grass: instanced cards, distance-culled, alphaTest, no shadows ---
  const grassTex = makeGrassTexture();
  const grassGeo = makeGrassClumpGeometry();
  const grassTime = { value: 0 };
  const grassMat = new THREE.MeshLambertMaterial({
    map: grassTex,
    alphaTest: 0.4,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = grassTime;
    shader.vertexShader = `uniform float uGrassTime;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float bladeH = uv.y;
       float breeze = sin(uGrassTime * 1.7 + instanceMatrix[3].x * 0.55 + instanceMatrix[3].z * 0.4);
       transformed.x += breeze * 0.15 * bladeH * bladeH;
       transformed.z += breeze * 0.1 * bladeH * bladeH;`,
    );
  };
  // Force shader rebuild path to pick up onBeforeCompile after first use
  grassMat.customProgramCacheKey = () => "workGolfGrassSway";

  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_MAX_INSTANCES);
  grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grassMesh.frustumCulled = false;
  grassMesh.castShadow = false;
  grassMesh.receiveShadow = false;
  grassMesh.count = 0;
  scene.add(grassMesh);

  const grassTufts: GrassTuft[] = [];
  const grassBuckets = new Map<string, number[]>();
  const grassDummy = new THREE.Object3D();
  const grassColor = new THREE.Color();
  let grassFocusX = Infinity;
  let grassFocusZ = Infinity;

  function clearGrassCandidates() {
    grassTufts.length = 0;
    grassBuckets.clear();
    grassMesh.count = 0;
    grassFocusX = Infinity;
    grassFocusZ = Infinity;
  }

  function rebuildGrass(level: LevelData) {
    clearGrassCandidates();
    const { size, cell, surfaces } = level;
    const half = ((size - 1) * cell) / 2;
    // Sparse grid sample — tall denser than medium; jitter so it doesn't look tiled
    for (let iz = 0; iz < size; iz++) {
      for (let ix = 0; ix < size; ix++) {
        const code = surfaces[iz * size + ix]!;
        const isTall = code === SURFACE_CODE_TALL;
        const isMed = code === SURFACE_CODE_MEDIUM;
        if (!isTall && !isMed) continue;
        // Skip most cells: ~1 tuft / 2.2m (med) or / 1.35m (tall)
        const stride = isTall ? 1 : 2;
        if (ix % stride !== 0 || iz % stride !== 0) continue;
        if (!isTall && (ix + iz) % 3 === 0) continue;

        const jx = Math.abs(Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453) % 1;
        const jz = Math.abs(Math.sin(ix * 39.346 + iz * 11.135) * 24634.134) % 1;
        const x = -half + ix * cell + (jx - 0.5) * cell * 0.85;
        const z = -half + iz * cell + (jz - 0.5) * cell * 0.85;
        const sample = sampleTerrain(level, x, z);
        if (sample.surface !== "medium" && sample.surface !== "tall") continue;
        if (sample.inCup || sample.inBunker) continue;
        if (sample.height <= level.waterY + 0.2) continue;

        const yaw = jx * Math.PI * 2;
        const tall = sample.surface === "tall";
        const sy = tall ? 0.55 + jz * 0.35 : 0.22 + jz * 0.14;
        const sx = tall ? 0.7 + jx * 0.35 : 0.55 + jx * 0.25;
        const idx = grassTufts.length;
        grassTufts.push({
          x,
          y: sample.height,
          z,
          yaw,
          sx,
          sy,
          sz: sx,
          tall,
        });
        const key = grassBucketKey(x, z);
        let bucket = grassBuckets.get(key);
        if (!bucket) {
          bucket = [];
          grassBuckets.set(key, bucket);
        }
        bucket.push(idx);
      }
    }
  }

  function updateGrass(ballX: number, ballZ: number, timeSec: number) {
    // Wind uniform updates every frame; instance matrices only when focus moves
    grassTime.value = timeSec;
    const moved =
      (ballX - grassFocusX) * (ballX - grassFocusX) +
        (ballZ - grassFocusZ) * (ballZ - grassFocusZ) >
      1.2 * 1.2;
    if (!moved && Number.isFinite(grassFocusX)) return;

    grassFocusX = ballX;
    grassFocusZ = ballZ;
    const r = GRASS_VIEW_RADIUS;
    const r2 = r * r;
    const minBx = Math.floor((ballX - r) / GRASS_BUCKET);
    const maxBx = Math.floor((ballX + r) / GRASS_BUCKET);
    const minBz = Math.floor((ballZ - r) / GRASS_BUCKET);
    const maxBz = Math.floor((ballZ + r) / GRASS_BUCKET);

    let count = 0;
    for (let bz = minBz; bz <= maxBz; bz++) {
      for (let bx = minBx; bx <= maxBx; bx++) {
        const bucket = grassBuckets.get(`${bx},${bz}`);
        if (!bucket) continue;
        for (const ti of bucket) {
          const t = grassTufts[ti]!;
          const dx = t.x - ballX;
          const dz = t.z - ballZ;
          if (dx * dx + dz * dz > r2) continue;

          grassDummy.position.set(t.x, t.y, t.z);
          grassDummy.rotation.set(0, t.yaw, 0);
          grassDummy.scale.set(t.sx, t.sy, t.sz);
          grassDummy.updateMatrix();
          grassMesh.setMatrixAt(count, grassDummy.matrix);
          grassColor.setHex(t.tall ? COLORS.tall : COLORS.medium);
          grassMesh.setColorAt(count, grassColor);
          count += 1;
          if (count >= GRASS_MAX_INSTANCES) break;
        }
        if (count >= GRASS_MAX_INSTANCES) break;
      }
      if (count >= GRASS_MAX_INSTANCES) break;
    }

    grassMesh.count = count;
    grassMesh.instanceMatrix.needsUpdate = true;
    if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  type ConfettiBit = {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    spinX: number;
    spinY: number;
    spinZ: number;
    settled: boolean;
  };

  const CONFETTI_PALETTE = [
    0xef4444, 0xeab308, 0x22c55e, 0x3b82f6, 0xec4899, 0xf97316, 0xffffff, 0xa855f7,
  ];
  const confettiGroup = new THREE.Group();
  scene.add(confettiGroup);
  const confettiBits: ConfettiBit[] = [];
  const celebratedHoles = new Set<number>();
  let confettiLastTs = performance.now();
  const confettiGeo = new THREE.PlaneGeometry(0.1, 0.14);

  function clearConfetti() {
    while (confettiGroup.children.length) {
      const child = confettiGroup.children[0]!;
      confettiGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m.dispose();
      }
    }
    confettiBits.length = 0;
    celebratedHoles.clear();
  }

  function spawnHoleConfetti(hole: HoleDef) {
    const count = 64;
    for (let i = 0; i < count; i++) {
      const hex =
        i % 4 === 0
          ? new THREE.Color(hole.color).getHex()
          : CONFETTI_PALETTE[(i + hole.id * 3) % CONFETTI_PALETTE.length]!;
      const mat = new THREE.MeshLambertMaterial({
        color: hex,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(confettiGeo, mat);
      mesh.position.set(
        hole.x + (Math.random() - 0.5) * 0.15,
        hole.y + 0.15 + Math.random() * 0.2,
        hole.z + (Math.random() - 0.5) * 0.15,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      confettiGroup.add(mesh);

      // Burst upward/outward, then fall like snow
      const angle = Math.random() * Math.PI * 2;
      const speed = 3.5 + Math.random() * 7;
      const up = 6 + Math.random() * 8;
      confettiBits.push({
        mesh,
        vx: Math.cos(angle) * speed * (0.4 + Math.random()),
        vy: up,
        vz: Math.sin(angle) * speed * (0.4 + Math.random()),
        spinX: (Math.random() - 0.5) * 10,
        spinY: (Math.random() - 0.5) * 12,
        spinZ: (Math.random() - 0.5) * 10,
        settled: false,
      });
    }
  }

  function updateConfetti(level: LevelData, dt: number) {
    const g = 16;
    for (const bit of confettiBits) {
      if (bit.settled) continue;
      bit.vy -= g * dt;
      // Soft air drag + gentle flutter
      bit.vx *= Math.exp(-0.55 * dt);
      bit.vz *= Math.exp(-0.55 * dt);
      bit.vx += Math.sin(performance.now() * 0.008 + bit.mesh.id) * 0.8 * dt;
      bit.vz += Math.cos(performance.now() * 0.007 + bit.mesh.id) * 0.8 * dt;

      bit.mesh.position.x += bit.vx * dt;
      bit.mesh.position.y += bit.vy * dt;
      bit.mesh.position.z += bit.vz * dt;
      bit.mesh.rotation.x += bit.spinX * dt;
      bit.mesh.rotation.y += bit.spinY * dt;
      bit.mesh.rotation.z += bit.spinZ * dt;

      const ground = sampleTerrain(level, bit.mesh.position.x, bit.mesh.position.z);
      const floorY = ground.height + 0.02;
      if (bit.mesh.position.y <= floorY && bit.vy <= 0) {
        bit.mesh.position.y = floorY;
        bit.vx = 0;
        bit.vy = 0;
        bit.vz = 0;
        bit.spinX = 0;
        bit.spinY = 0;
        bit.spinZ = 0;
        // Lie flat-ish on the ground for the rest of the round
        bit.mesh.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.35;
        bit.mesh.rotation.z = Math.random() * Math.PI * 2;
        bit.settled = true;
      }
    }
  }

  function clearWorld() {
    clearConfetti();
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
    rebuildGrass(level);

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

    const now = performance.now();
    const dt = Math.min(0.05, (now - confettiLastTs) / 1000);
    confettiLastTs = now;

    // Celebrate newly sunk cups — confetti stays on the ground for the rest of the round
    for (const hole of snap.holes) {
      if (!hole.active && !celebratedHoles.has(hole.id)) {
        celebratedHoles.add(hole.id);
        spawnHoleConfetti(hole);
      }
    }
    updateConfetti(engine.level, dt);

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

    waterMat.uniforms.uTime!.value = now * 0.001;
    updateGrass(snap.ball.pos.x, snap.ball.pos.z, now * 0.001);

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
    clearGrassCandidates();
    scene.remove(grassMesh);
    grassMesh.dispose();
    grassGeo.dispose();
    grassMat.dispose();
    grassTex.dispose();
    confettiGeo.dispose();
    water.geometry.dispose();
    waterMat.dispose();
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
