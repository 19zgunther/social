/** Three.js scene: low-poly course, ball, camera, distance labels. */

import * as THREE from "three";
import {
  BALL_RADIUS,
  CUP_DEPTH,
  CUP_RADIUS,
  SHOT_GHOST_COUNT,
  SHOT_SPREAD_GHOST_COUNT,
  aimSpreadHalfAngle,
  currentTargetHole,
  isBeachSkirt,
  predictShotGhosts,
  sampleTerrain,
  worldToYards,
  yawToward,
  type HoleDef,
  type LevelData,
  type PowerUpDef,
  type RoundSnapshot,
  type Vec3,
  type WorkGolfEngine,
  type WorkGolfFxEvent,
} from "./workGolfEngine";

const COLORS = {
  water: 0x4eb8d9,
  waterDeep: 0x1a6f8c,
  waterHorizon: 0x7ad0ea,
  medium: 0x52b842,
  tall: 0x34862c,
  green: 0xb4e055,
  sand: 0xe2c98a,
  dirt: 0xc9a36a,
  trunk: 0x6b4423,
  pine: 0x1f6b2e,
  pineMid: 0x247834,
  pineLight: 0x2d8a3e,
  ball: 0xf5f5f0,
};

/** Cap visible grass cards — one InstancedMesh draw call, no shadows. */
const GRASS_MAX_INSTANCES = 1100;
/** Only populate tufts near the ball (mobile-friendly). */
const GRASS_VIEW_RADIUS = 24;
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

/** World meters per terrain detail tile. */
const TERRAIN_TEX_TILE = 5.5;

/**
 * Soft grayscale grass/sand grain — multiplied with vertex colors so fairways
 * read as turf without fighting sand / dirt hues.
 */
function makeTerrainDetailTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smoothNoise = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number) => {
    let v = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < 4; i++) {
      v += a * smoothNoise(x * f, y * f);
      a *= 0.5;
      f *= 2.05;
    }
    return v;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      // Broad mottling + fine speckles
      let n = fbm(nx * 6.5, ny * 6.5) * 0.72 + fbm(nx * 28, ny * 28) * 0.28;
      // Soft blade streaks (anisotropic) for a grassy read on greens
      const streak =
        smoothNoise(nx * 40 + ny * 2.2, ny * 9) * 0.55 +
        smoothNoise(nx * 70 - ny * 1.4, ny * 18) * 0.45;
      n = n * 0.62 + streak * 0.38;
      // Mid-gray (~128): shader remaps so we don't globally darken vertex colors
      const g = Math.max(0, Math.min(255, Math.floor(128 + (n - 0.5) * 110)));
      const i = (y * size + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Soft darker tuft blobs so flat polys don't look painted plastic
  for (let i = 0; i < 90; i++) {
    const px = hash(i * 3.1, 1.7) * size;
    const py = hash(i * 5.9, 2.3) * size;
    const r = 2 + hash(i, 9.1) * 7;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    const shade = Math.floor(70 + hash(i, 4.4) * 50);
    grad.addColorStop(0, `rgba(${shade},${shade},${shade},0.4)`);
    grad.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
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
      uHorizon: { value: new THREE.Color(COLORS.waterHorizon) },
      uFoam: { value: new THREE.Color(0xe8f7ff) },
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
        float w1 = sin(p.x * 0.085 + t * 0.75) * cos(p.y * 0.07 + t * 0.55);
        float w2 = sin(p.x * 0.19 - t * 0.95 + p.y * 0.13) * 0.42;
        float w3 = cos(p.x * 0.045 - p.y * 0.09 + t * 0.38) * 0.55;
        float wave = (w1 + w2 + w3) * 0.11;
        p.z += wave;
        vWave = wave;

        float dx = cos(p.x * 0.085 + t * 0.75) * 0.085 * cos(p.y * 0.07 + t * 0.55)
          + cos(p.x * 0.19 - t * 0.95 + p.y * 0.13) * 0.19 * 0.42
          - sin(p.x * 0.045 - p.y * 0.09 + t * 0.38) * 0.045 * 0.55;
        float dy = -sin(p.x * 0.085 + t * 0.75) * sin(p.y * 0.07 + t * 0.55) * 0.07
          + cos(p.x * 0.19 - t * 0.95 + p.y * 0.13) * 0.13 * 0.42
          + sin(p.x * 0.045 - p.y * 0.09 + t * 0.38) * 0.09 * 0.55;
        vec3 n = normalize(vec3(-dx * 0.11, -dy * 0.11, 1.0));

        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uHorizon;
      uniform vec3 uFoam;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying float vWave;

      // Cheap value-noise for irregular caustics / glitter (no lattice)
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise21(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float ndv = max(dot(N, V), 0.0);
        float fresnel = pow(1.0 - ndv, 2.4);

        // Slow color drift + depth feel from viewing angle
        vec2 drift = vWorldPos.xz * 0.035 + vec2(uTime * 0.03, -uTime * 0.022);
        float blot = noise21(drift * 2.4) * 0.55 + noise21(drift * 5.1 + 3.7) * 0.45;
        vec3 base = mix(uShallow, uDeep, fresnel * 0.7 + blot * 0.35);
        base = mix(base, uHorizon, fresnel * 0.22);

        // Soft crest highlights (not hard foam dots)
        float crest = smoothstep(0.04, 0.12, vWave);
        base = mix(base, uFoam, crest * 0.18);

        // Broad specular band
        vec3 R = reflect(-uSunDir, N);
        float spec = pow(max(dot(R, V), 0.0), 28.0);
        base += uFoam * spec * 0.38;

        // Irregular glitter — sparse, drifting, not a grid
        vec2 gp = vWorldPos.xz * 0.55 + vec2(uTime * 0.12, -uTime * 0.09);
        float g = noise21(gp * 3.0);
        float glitter = smoothstep(0.88, 0.97, g) * smoothstep(0.2, 0.7, ndv);
        base += uFoam * glitter * 0.28;

        // Soft caustic mottling under the surface
        float cau = noise21(vWorldPos.xz * 0.4 + vec2(-uTime * 0.08, uTime * 0.06));
        base = mix(base, uShallow * 1.08, cau * 0.12 * (1.0 - fresnel));

        float alpha = 0.78 + fresnel * 0.18;
        gl_FragColor = vec4(base, alpha);
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
  uvs: number[],
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
  uvs.push(x / TERRAIN_TEX_TILE, z / TERRAIN_TEX_TILE);
  if (sample.inCup) {
    color.setHex(0x1a1a1a);
  } else if (sample.onSandFloor) {
    // Sand only on the recessed floor — rim / walls stay turf-colored
    color.setHex(COLORS.sand);
  } else if (isBeachSkirt(h, level.waterY, sample.normal)) {
    // Steep cliff / wet shore only — flat low fairways stay turf-colored
    color.copy(dirt);
  } else if (sample.surface === "sand") {
    color.setHex(COLORS.sand);
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

function buildTerrainMesh(level: LevelData, detailTex: THREE.Texture): THREE.Mesh {
  const { size, cell, heights, waterY } = level;
  const half = ((size - 1) * cell) / 2;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
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
      const x = -half + ix * cell;
      const z = -half + iz * cell;
      // Still store coarse verts (shared); cup/bunker carve applied via sample
      const carved = sampleTerrain(level, x, z);
      const y = carved.height;
      coarseIndex[i] = positions.length / 3;
      positions.push(x, y, z);
      uvs.push(x / TERRAIN_TEX_TILE, z / TERRAIN_TEX_TILE);
      if (carved.inCup) {
        color.setHex(0x1a1a1a);
      } else if (carved.onSandFloor) {
        color.setHex(COLORS.sand);
      } else if (isBeachSkirt(y, waterY, carved.normal)) {
        color.copy(dirt);
      } else if (carved.surface === "sand") {
        color.setHex(COLORS.sand);
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
                  vi = pushTerrainVert(positions, colors, uvs, level, x, z, color, dirt);
                  refineEdgeCache.set(key, vi);
                }
                local.push(vi);
              } else {
                local.push(pushTerrainVert(positions, colors, uvs, level, x, z, color, dirt));
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
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    map: detailTex,
    vertexColors: true,
    flatShading: true,
  });
  // Soft contrast detail instead of raw map*color (which would muddying mid-grays)
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      /* glsl */ `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float detail = sampledDiffuseColor.r;
        diffuseColor.rgb *= (0.78 + detail * 0.44);
      #endif
      `,
    );
  };
  mat.customProgramCacheKey = () => "workGolfTerrainDetail";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function makeTree(tree: LevelData["trees"][number]): THREE.Group {
  // Outer group leans on hit; inner keeps stable yaw
  const lean = new THREE.Group();
  lean.position.set(tree.x, tree.y, tree.z);

  const visual = new THREE.Group();
  visual.rotation.y = (tree.x * 13.7 + tree.z * 9.1) % (Math.PI * 2);
  lean.add(visual);

  const h = tree.height;
  const r = tree.radius;
  const trunkMat = new THREE.MeshLambertMaterial({
    color: COLORS.trunk,
    flatShading: true,
  });
  const pineColors = [COLORS.pine, COLORS.pineMid, COLORS.pineLight, COLORS.pine, COLORS.pineMid];

  // Root flare
  const roots = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.42, r * 0.62, h * 0.07, 5),
    trunkMat,
  );
  roots.position.y = h * 0.035;
  roots.castShadow = true;
  visual.add(roots);

  // Trunk up into the first foliage skirt
  const trunkH = h * 0.38;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.16, r * 0.26, trunkH, 5),
    trunkMat,
  );
  trunk.position.y = trunkH * 0.5;
  trunk.castShadow = true;
  visual.add(trunk);

  // Stacked low-poly skirts (wide → narrow), overlapping like classic cartoon pines
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const layerR = r * (1.65 - t * 1.15);
    const layerH = h * (0.34 - t * 0.08);
    // Overlap so each skirt sits into the one below
    const yCenter = h * (0.28 + t * 0.52);
    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(layerR, layerH, 6),
      new THREE.MeshLambertMaterial({
        color: pineColors[i]!,
        flatShading: true,
      }),
    );
    foliage.position.y = yCenter;
    foliage.castShadow = true;
    visual.add(foliage);
  }

  // Brown tip poking through the top cone
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.035, r * 0.07, h * 0.14, 4),
    trunkMat,
  );
  tip.position.y = h * 0.97;
  tip.castShadow = true;
  visual.add(tip);

  return lean;
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

  // Dark cup liner — only visible while this cup is the current target
  const liner = new THREE.Mesh(
    new THREE.CylinderGeometry(CUP_RADIUS * 0.98, CUP_RADIUS * 0.92, CUP_DEPTH, 12, 1, true),
    new THREE.MeshLambertMaterial({
      color: 0x111111,
      flatShading: true,
      side: THREE.DoubleSide,
    }),
  );
  liner.position.y = -CUP_DEPTH * 0.5 + 0.02;
  liner.name = "cupLiner";
  g.add(liner);

  const cupFloor = new THREE.Mesh(
    new THREE.CircleGeometry(CUP_RADIUS * 0.9, 12),
    new THREE.MeshLambertMaterial({ color: 0x0a0a0a, flatShading: true }),
  );
  cupFloor.rotation.x = -Math.PI / 2;
  cupFloor.position.y = -CUP_DEPTH + 0.04;
  cupFloor.name = "cupFloor";
  g.add(cupFloor);

  return g;
}

/** Flat ground arrow pointing +Z; yawed toward the next cup each frame. */
function makeBeerCan(pu: PowerUpDef): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pu.x, pu.y, pu.z);
  g.userData.powerUpId = pu.id;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.24, 0.72, 8),
    new THREE.MeshLambertMaterial({ color: 0xd4a017, flatShading: true }),
  );
  body.castShadow = true;
  g.add(body);

  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.245, 0.245, 0.28, 8),
    new THREE.MeshLambertMaterial({ color: 0xb91c1c, flatShading: true }),
  );
  label.position.y = 0.02;
  g.add(label);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.22, 0.06, 8),
    new THREE.MeshLambertMaterial({ color: 0xe8e8e8, flatShading: true }),
  );
  rim.position.y = 0.38;
  g.add(rim);

  const tab = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.18),
    new THREE.MeshLambertMaterial({ color: 0xc0c0c0, flatShading: true }),
  );
  tab.position.set(0.02, 0.44, 0);
  g.add(tab);

  return g;
}

/** Petite low-poly golf cart (wheels in userData for roll). */
function makeGolfCart(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc, flatShading: true });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0x16a34a, flatShading: true });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1f2937, flatShading: true });
  const seatMat = new THREE.MeshLambertMaterial({ color: 0x374151, flatShading: true });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111827, flatShading: true });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 1.45), bodyMat);
  chassis.position.y = 0.38;
  chassis.castShadow = true;
  g.add(chassis);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.16, 0.35), accentMat);
  nose.position.set(0, 0.4, 0.62);
  g.add(nose);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.55), seatMat);
  seat.position.set(0, 0.52, -0.05);
  g.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 0.1), seatMat);
  back.position.set(0, 0.7, -0.32);
  g.add(back);

  const bagWell = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.4), darkMat);
  bagWell.position.set(0, 0.48, -0.7);
  g.add(bagWell);

  // Roof posts + canopy
  const postGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4);
  const posts: [number, number][] = [
    [-0.38, 0.45],
    [0.38, 0.45],
    [-0.38, -0.35],
    [0.38, -0.35],
  ];
  for (const [px, pz] of posts) {
    const post = new THREE.Mesh(postGeo, darkMat);
    post.position.set(px, 0.85, pz);
    g.add(post);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.06, 1.15), accentMat);
  roof.position.set(0, 1.2, 0.05);
  roof.castShadow = true;
  g.add(roof);

  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 8);
  const wheelPos: [number, number, number][] = [
    [-0.48, 0.2, 0.48],
    [0.48, 0.2, 0.48],
    [-0.48, 0.2, -0.48],
    [0.48, 0.2, -0.48],
  ];
  for (const [wx, wy, wz] of wheelPos) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wy, wz);
    wheel.castShadow = true;
    g.add(wheel);
    wheels.push(wheel);
  }
  g.userData.wheels = wheels;
  g.scale.setScalar(0.69);
  return g;
}

/** Tiny low-poly seagull; wings stored on userData for flapping. */
function makeSeagull(): THREE.Group {
  const g = new THREE.Group();
  // Unique mats/geos per mesh so clearSeagulls can dispose safely
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0xf5f5f4, flatShading: true }),
  );
  body.scale.set(1.15, 0.75, 1.55);
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 5, 4),
    new THREE.MeshLambertMaterial({ color: 0xf5f5f4, flatShading: true }),
  );
  head.position.set(0, 0.04, 0.1);
  g.add(head);

  const bill = new THREE.Mesh(
    new THREE.ConeGeometry(0.025, 0.08, 4),
    new THREE.MeshLambertMaterial({ color: 0xf59e0b, flatShading: true }),
  );
  bill.rotation.x = Math.PI / 2;
  bill.position.set(0, 0.03, 0.16);
  g.add(bill);

  const leftWing = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.02, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xd4d4d8, flatShading: true }),
  );
  leftWing.position.set(-0.12, 0.02, 0);
  g.add(leftWing);
  const rightWing = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.02, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xd4d4d8, flatShading: true }),
  );
  rightWing.position.set(0.12, 0.02, 0);
  g.add(rightWing);

  g.userData.leftWing = leftWing;
  g.userData.rightWing = rightWing;
  g.scale.setScalar(0.85);
  return g;
}

/** Small low-poly sailboat for open water (hitbox ~hull size). */
function makeSailboat(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b, flatShading: true });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xc4a574, flatShading: true });
  const mastMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, flatShading: true });
  const sailMat = new THREE.MeshLambertMaterial({
    color: 0xf8fafc,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0xb91c1c, flatShading: true });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 1.35), hullMat);
  hull.position.y = 0.05;
  hull.castShadow = true;
  g.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), hullMat);
  bow.rotation.x = -Math.PI / 2;
  bow.position.set(0, 0.05, 0.85);
  bow.castShadow = true;
  g.add(bow);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.7), deckMat);
  deck.position.y = 0.18;
  g.add(deck);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.35), accentMat);
  cabin.position.set(0, 0.3, -0.15);
  g.add(cabin);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.55, 5), mastMat);
  mast.position.set(0, 0.95, 0.1);
  mast.castShadow = true;
  g.add(mast);

  // Triangle sail (two faces via DoubleSide)
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 1.25, 0, 0, 0.15, 0.7], 3),
  );
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeo, sailMat);
  sail.position.set(0.04, 0.35, 0.05);
  g.add(sail);

  g.scale.setScalar(1.15);
  return g;
}

function makeWayArrow(): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.05);
  shape.lineTo(0.55, 0.15);
  shape.lineTo(0.22, 0.15);
  shape.lineTo(0.22, -0.55);
  shape.lineTo(-0.22, -0.55);
  shape.lineTo(-0.22, 0.15);
  shape.lineTo(-0.55, 0.15);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshLambertMaterial({
      color: 0xffffff,
      flatShading: true,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  g.add(mesh);
  g.visible = false;
  return g;
}

export type WorkGolfSceneHandle = {
  dom: HTMLCanvasElement;
  resize: (w: number, h: number) => void;
  sync: (engine: WorkGolfEngine, snap: RoundSnapshot) => void;
  /** Slow orbital flyover for title / level select (hides ball HUD chrome). */
  setMenuPreview: (active: boolean) => void;
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
  const water = new THREE.Mesh(new THREE.PlaneGeometry(280, 280, 96, 96), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.renderOrder = -1;
  scene.add(water);

  const terrainDetailTex = makeTerrainDetailTexture();
  // Higher anisotropy when the GPU allows it
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  terrainDetailTex.anisotropy = Math.min(8, maxAniso);

  const world = new THREE.Group();
  scene.add(world);

  /** Dimpled sphere — rendering only; physics still uses BALL_RADIUS. */
  function makeGolfBallGeometry(radius: number): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(radius, 28, 20);
    const pos = geo.attributes.position!;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const dimpleDirs: THREE.Vector3[] = [];
    const dimpleCount = 80;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < dimpleCount; i++) {
      const y = 1 - (i / (dimpleCount - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      dimpleDirs.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
    }
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      n.copy(v).normalize();
      let nearest = 2;
      for (const d of dimpleDirs) {
        const dist = n.distanceTo(d);
        if (dist < nearest) nearest = dist;
      }
      const influence = Math.max(0, 1 - nearest / 0.2);
      const sink = influence * influence * radius * 0.055;
      v.setLength(radius - sink);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  const ballGeo = makeGolfBallGeometry(BALL_RADIUS);
  const ghostBallGeo = new THREE.SphereGeometry(BALL_RADIUS, 12, 10);
  const ballMat = new THREE.MeshLambertMaterial({
    color: COLORS.ball,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.renderOrder = 2;
  scene.add(ballMesh);

  function makeGhostBall(opacity: number, scale: number): THREE.Mesh {
    const mat = new THREE.MeshLambertMaterial({
      color: COLORS.ball,
      flatShading: false,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    const ghost = new THREE.Mesh(ghostBallGeo, mat);
    ghost.scale.setScalar(scale);
    ghost.visible = false;
    ghost.frustumCulled = false;
    ghost.renderOrder = 10;
    scene.add(ghost);
    return ghost;
  }

  // Center aim path + spray-edge paths (FPS bloom cone)
  const ghostBalls: THREE.Mesh[] = [];
  for (let i = 0; i < SHOT_GHOST_COUNT; i++) ghostBalls.push(makeGhostBall(0.5, 0.5));
  const spreadLeftGhosts: THREE.Mesh[] = [];
  const spreadRightGhosts: THREE.Mesh[] = [];
  for (let i = 0; i < SHOT_SPREAD_GHOST_COUNT; i++) {
    spreadLeftGhosts.push(makeGhostBall(0.22, 0.32));
    spreadRightGhosts.push(makeGhostBall(0.22, 0.32));
  }

  // Landing bloom ellipse — widens with aim spray
  const landRingGeo = new THREE.RingGeometry(0.55, 0.85, 28);
  const landRingMat = new THREE.MeshLambertMaterial({
    color: 0xf5f5f0,
    flatShading: true,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const landRing = new THREE.Mesh(landRingGeo, landRingMat);
  landRing.rotation.x = -Math.PI / 2;
  landRing.visible = false;
  landRing.frustumCulled = false;
  landRing.renderOrder = 9;
  scene.add(landRing);

  // Ground spray fan between left/right edge landings
  const sprayFanMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sprayFan = new THREE.Mesh(new THREE.BufferGeometry(), sprayFanMat);
  sprayFan.visible = false;
  sprayFan.frustumCulled = false;
  sprayFan.renderOrder = 8;
  scene.add(sprayFan);

  let terrainMesh: THREE.Mesh | null = null;
  const flagGroups = new Map<number, THREE.Group>();
  const labelSprites = new Map<number, THREE.Sprite>();
  const powerUpGroups = new Map<number, THREE.Group>();
  const wayArrow = makeWayArrow();
  scene.add(wayArrow);
  let builtLevel = -1;
  let builtTargetHoleId = -1;

  /** Title-screen cinematic orbit (instead of ball-follow cam). */
  let menuPreview = false;
  let previewYaw = 0.35;

  /** Smooth camera follow after water reset (anchor → ball over ~1s). */
  const WATER_CAM_SLIDE_DUR = 1;
  let camSlide: {
    ax: number;
    ay: number;
    az: number;
    t: number;
  } | null = null;

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
        // Denser near-ball carpet; tall still thicker than medium
        const stride = isTall ? 1 : 1;
        if (ix % stride !== 0 || iz % stride !== 0) continue;
        if (!isTall && (ix * 3 + iz * 7) % 5 === 0) continue;

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
        const sy = tall ? 0.55 + jz * 0.35 : 0.28 + jz * 0.16;
        const sx = tall ? 0.7 + jx * 0.35 : 0.62 + jx * 0.28;
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

  type TreeSway = {
    lean: THREE.Group;
    leanX: number;
    leanZ: number;
    velX: number;
    velZ: number;
    /** High-freq shiver that decays after a hit. */
    shudder: number;
  };
  const treeSwings: TreeSway[] = [];

  type SplashDrop = {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    waterY: number;
  };
  type SplashRing = {
    mesh: THREE.Mesh;
    age: number;
    maxAge: number;
    startScale: number;
    endScale: number;
  };
  const fxGroup = new THREE.Group();
  scene.add(fxGroup);
  const splashDrops: SplashDrop[] = [];
  const splashRings: SplashRing[] = [];
  const splashDropGeo = new THREE.IcosahedronGeometry(0.08, 0);
  const splashRingGeo = new THREE.RingGeometry(0.35, 0.55, 20);

  type BloodDrop = {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    settled: boolean;
  };
  const bloodGroup = new THREE.Group();
  scene.add(bloodGroup);
  const bloodDrops: BloodDrop[] = [];
  const bloodDropGeo = new THREE.IcosahedronGeometry(0.06, 0);

  type GullMode = "fly" | "descend" | "stand" | "walk" | "ascend";
  type Seagull = {
    group: THREE.Group;
    mode: GullMode;
    timer: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    speed: number;
    wingPhase: number;
    flyCenterX: number;
    flyCenterZ: number;
    flyRadius: number;
    flyAngle: number;
    flyHeight: number;
    dead: boolean;
  };
  const seagullGroup = new THREE.Group();
  scene.add(seagullGroup);
  const seagulls: Seagull[] = [];

  type Sailboat = {
    group: THREE.Group;
    x: number;
    y: number;
    z: number;
    yaw: number;
    speed: number;
    bobPhase: number;
    turnTimer: number;
    dead: boolean;
  };
  const sailboatGroup = new THREE.Group();
  scene.add(sailboatGroup);
  const sailboats: Sailboat[] = [];

  /** Cart center must stay at least this far from the ball (XZ). */
  const CART_BALL_KEEP = 2.15;

  /** Fairway-ish turf only — no sand, water, cups, or cliff skirts. */
  function cartDrivable(level: LevelData, x: number, z: number): boolean {
    const s = sampleTerrain(level, x, z);
    if (s.inCup || s.inBunker) return false;
    if (s.surface === "water" || s.surface === "sand" || s.surface === "void") return false;
    if (s.height <= level.waterY + 0.25) return false;
    if (s.normal.y < 0.74) return false;
    if (isBeachSkirt(s.height, level.waterY, s.normal)) return false;
    return true;
  }

  /** Pick a nearby drivable stand-off; falls back to current cart pose if none. */
  function findCartPark(
    level: LevelData,
    bx: number,
    bz: number,
    face: number,
    avoidSide: number,
    fallbackX: number,
    fallbackZ: number,
  ): { x: number; z: number } {
    const candidates: { behind: number; side: number }[] = [
      { behind: 4.4, side: 1.55 * avoidSide },
      { behind: 3.6, side: 2.2 * avoidSide },
      { behind: 5.2, side: 1.2 * avoidSide },
      { behind: 4.0, side: -1.55 * avoidSide },
      { behind: 3.2, side: -2.1 * avoidSide },
      { behind: 2.8, side: 2.6 * avoidSide },
      { behind: 5.5, side: 0.4 * avoidSide },
      { behind: 2.5, side: 0 },
    ];
    for (const c of candidates) {
      let x = bx - Math.sin(face) * c.behind + Math.cos(face) * c.side;
      let z = bz - Math.cos(face) * c.behind - Math.sin(face) * c.side;
      const pdx = x - bx;
      const pdz = z - bz;
      const pdist = Math.hypot(pdx, pdz);
      if (pdist < CART_BALL_KEEP) {
        if (pdist < 1e-4) continue;
        const s = CART_BALL_KEEP / pdist;
        x = bx + pdx * s;
        z = bz + pdz * s;
      }
      if (cartDrivable(level, x, z)) return { x, z };
    }
    // Spiral search around the ball for any safe turf
    for (let ring = 0; ring < 8; ring++) {
      const rad = CART_BALL_KEEP + 0.4 + ring * 0.55;
      for (let k = 0; k < 10; k++) {
        const a = face + (k / 10) * Math.PI * 2 + avoidSide * 0.2;
        const x = bx + Math.sin(a) * rad;
        const z = bz + Math.cos(a) * rad;
        if (cartDrivable(level, x, z)) return { x, z };
      }
    }
    if (cartDrivable(level, fallbackX, fallbackZ)) return { x: fallbackX, z: fallbackZ };
    return { x: fallbackX, z: fallbackZ };
  }

  type GolfCartState = {
    group: THREE.Group;
    x: number;
    y: number;
    z: number;
    yaw: number;
    vx: number;
    vy: number;
    vz: number;
    pitch: number;
    roll: number;
    grounded: boolean;
    wheelSpin: number;
    /** Consistent orbit direction when skirting the ball (+1 / -1). */
    avoidSide: number;
  };
  const golfCartGroup = new THREE.Group();
  scene.add(golfCartGroup);
  let golfCart: GolfCartState | null = null;

  type BoatDebris = {
    mesh: THREE.Mesh;
    vx: number;
    vy: number;
    vz: number;
    spinX: number;
    spinY: number;
    spinZ: number;
    life: number;
  };
  const boatDebris: BoatDebris[] = [];

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

  function clearSplashes() {
    while (fxGroup.children.length) {
      const child = fxGroup.children[0]!;
      fxGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m.dispose();
      }
    }
    splashDrops.length = 0;
    splashRings.length = 0;
    // Debris lives in fxGroup — wipe tracking when FX are cleared
    boatDebris.length = 0;
  }

  function clearBlood() {
    while (bloodGroup.children.length) {
      const child = bloodGroup.children[0]!;
      bloodGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) m.dispose();
      }
    }
    bloodDrops.length = 0;
  }

  function clearSeagulls() {
    while (seagullGroup.children.length) {
      const child = seagullGroup.children[0]!;
      seagullGroup.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    seagulls.length = 0;
  }

  function clearSailboats() {
    while (sailboatGroup.children.length) {
      const child = sailboatGroup.children[0]!;
      sailboatGroup.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    sailboats.length = 0;
  }

  function clearGolfCart() {
    while (golfCartGroup.children.length) {
      const child = golfCartGroup.children[0]!;
      golfCartGroup.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    golfCart = null;
  }

  function spawnGolfCart(level: LevelData) {
    clearGolfCart();
    const group = makeGolfCart();
    golfCartGroup.add(group);
    const hole = level.holes[0];
    const yaw = hole
      ? yawToward(level.tee.x, level.tee.z, hole.x, hole.z)
      : 0;
    const x = level.tee.x - Math.sin(yaw) * 3.2 + Math.cos(yaw) * 1.4;
    const z = level.tee.z - Math.cos(yaw) * 3.2 - Math.sin(yaw) * 1.4;
    const ground = sampleTerrain(level, x, z);
    const y =
      ground.height > level.waterY + 0.1 ? ground.height : level.tee.y;
    golfCart = {
      group,
      x,
      y,
      z,
      yaw,
      vx: 0,
      vy: 0,
      vz: 0,
      pitch: 0,
      roll: 0,
      grounded: true,
      wheelSpin: 0,
      avoidSide: 1,
    };
    group.position.set(x, y, z);
    group.rotation.y = yaw;
  }

  function updateGolfCart(level: LevelData, snap: RoundSnapshot, dt: number) {
    const cart = golfCart;
    if (!cart) return;

    const bx = snap.ball.pos.x;
    const bz = snap.ball.pos.z;

    // Stand-off relative to next cup (not aim yaw) — only on drivable turf
    const hole = currentTargetHole(snap.holes);
    const face = hole
      ? yawToward(bx, bz, hole.x, hole.z)
      : snap.cameraYaw;
    const park = findCartPark(level, bx, bz, face, cart.avoidSide, cart.x, cart.z);
    const tx = park.x;
    const tz = park.z;

    const grav = 28;
    const maxSpeed = snap.ball.moving ? 2.5 : 3.4;
    const accel = 7.5;
    const friction = cart.grounded ? 4.2 : 0.35;
    const turnRate = 2.8;

    // Drive toward stand-off, steering around the ball + bad terrain
    const toX = tx - cart.x;
    const toZ = tz - cart.z;
    const toDist = Math.hypot(toX, toZ);
    if (cart.grounded && toDist > 0.18) {
      let steerX = toX / toDist;
      let steerZ = toZ / toDist;

      // If the straight line to the parking spot clips the ball, detour sideways
      const abx = bx - cart.x;
      const abz = bz - cart.z;
      const abLen = Math.hypot(abx, abz);
      const along = abLen > 1e-4 ? (abx * steerX + abz * steerZ) : 0;
      if (along > 0 && along < toDist) {
        const closestX = cart.x + steerX * along;
        const closestZ = cart.z + steerZ * along;
        const miss = Math.hypot(closestX - bx, closestZ - bz);
        if (miss < CART_BALL_KEEP + 0.35) {
          const bypass = CART_BALL_KEEP + 0.9;
          const wx = bx + Math.cos(face) * bypass * cart.avoidSide;
          const wz = bz - Math.sin(face) * bypass * cart.avoidSide;
          if (cartDrivable(level, wx, wz)) {
            const wdx = wx - cart.x;
            const wdz = wz - cart.z;
            const wlen = Math.hypot(wdx, wdz) || 1;
            steerX = wdx / wlen;
            steerZ = wdz / wlen;
          } else {
            cart.avoidSide *= -1;
          }
        }
      }

      // Strong radial push if already inside / near the keep-out
      if (abLen < CART_BALL_KEEP + 1.1 && abLen > 1e-4) {
        const push = (CART_BALL_KEEP + 1.1 - abLen) / (CART_BALL_KEEP + 1.1);
        const awayX = -abx / abLen;
        const awayZ = -abz / abLen;
        const tangX = -awayZ * cart.avoidSide;
        const tangZ = awayX * cart.avoidSide;
        steerX = steerX + awayX * push * 1.8 + tangX * push * 1.15;
        steerZ = steerZ + awayZ * push * 1.8 + tangZ * push * 1.15;
        const sl = Math.hypot(steerX, steerZ) || 1;
        steerX /= sl;
        steerZ /= sl;
      }

      // Look-ahead: if next few meters are undrivable, veer along the hazard edge
      const look = 1.6;
      const probeX = cart.x + steerX * look;
      const probeZ = cart.z + steerZ * look;
      if (!cartDrivable(level, probeX, probeZ)) {
        const leftX = cart.x + (-steerZ * cart.avoidSide) * look + steerX * 0.4;
        const leftZ = cart.z + (steerX * cart.avoidSide) * look + steerZ * 0.4;
        const rightX = cart.x + (steerZ * cart.avoidSide) * look + steerX * 0.4;
        const rightZ = cart.z + (-steerX * cart.avoidSide) * look + steerZ * 0.4;
        const leftOk = cartDrivable(level, leftX, leftZ);
        const rightOk = cartDrivable(level, rightX, rightZ);
        if (leftOk && !rightOk) {
          const dx = leftX - cart.x;
          const dz = leftZ - cart.z;
          const l = Math.hypot(dx, dz) || 1;
          steerX = dx / l;
          steerZ = dz / l;
        } else if (rightOk && !leftOk) {
          const dx = rightX - cart.x;
          const dz = rightZ - cart.z;
          const l = Math.hypot(dx, dz) || 1;
          steerX = dx / l;
          steerZ = dz / l;
        } else if (leftOk) {
          const dx = leftX - cart.x;
          const dz = leftZ - cart.z;
          const l = Math.hypot(dx, dz) || 1;
          steerX = dx / l;
          steerZ = dz / l;
        } else {
          // Dead end — brake and flip preferred side
          cart.vx *= Math.exp(-6 * dt);
          cart.vz *= Math.exp(-6 * dt);
          cart.avoidSide *= -1;
        }
      }

      cart.vx += steerX * accel * dt;
      cart.vz += steerZ * accel * dt;
      const wantYaw = Math.atan2(steerX, steerZ);
      let dyaw = wantYaw - cart.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      cart.yaw += dyaw * Math.min(1, turnRate * dt);
    } else if (cart.grounded && toDist <= 0.18) {
      // Soft brake at parking spot
      cart.vx *= Math.exp(-8 * dt);
      cart.vz *= Math.exp(-8 * dt);
    }

    // Cap horizontal speed
    const hSpeed = Math.hypot(cart.vx, cart.vz);
    if (hSpeed > maxSpeed) {
      const s = maxSpeed / hSpeed;
      cart.vx *= s;
      cart.vz *= s;
    }

    // Gravity + integrate
    cart.vy -= grav * dt;
    let nextX = cart.x + cart.vx * dt;
    let nextZ = cart.z + cart.vz * dt;
    let nextY = cart.y + cart.vy * dt;

    // Hard keep-out: never step onto the ball
    {
      const ndx = nextX - bx;
      const ndz = nextZ - bz;
      const nd = Math.hypot(ndx, ndz);
      if (nd < CART_BALL_KEEP) {
        if (nd < 1e-4) {
          nextX = bx + Math.cos(face) * CART_BALL_KEEP * cart.avoidSide;
          nextZ = bz - Math.sin(face) * CART_BALL_KEEP * cart.avoidSide;
        } else {
          const s = CART_BALL_KEEP / nd;
          nextX = bx + ndx * s;
          nextZ = bz + ndz * s;
        }
        const inward = cart.vx * (bx - nextX) + cart.vz * (bz - nextZ);
        if (inward > 0) {
          const il = Math.hypot(bx - nextX, bz - nextZ) || 1;
          cart.vx -= ((bx - nextX) / il) * inward;
          cart.vz -= ((bz - nextZ) / il) * inward;
        }
      }
    }

    // Never drive onto sand / cliffs / water / cups
    if (!cartDrivable(level, nextX, nextZ)) {
      nextX = cart.x;
      nextZ = cart.z;
      cart.vx *= 0.25;
      cart.vz *= 0.25;
      cart.avoidSide *= -1;
    }

    const ground = sampleTerrain(level, nextX, nextZ);
    const floorY = ground.height;

    // Ground contact (only on turf we already validated)
    if (nextY <= floorY && cart.vy <= 0.5) {
      nextY = floorY;
      cart.vy = 0;
      cart.grounded = true;
      const n = ground.normal;
      const vn = cart.vx * n.x + cart.vy * n.y + cart.vz * n.z;
      if (vn < 0) {
        cart.vx -= n.x * vn;
        cart.vy -= n.y * vn;
        cart.vz -= n.z * vn;
      }
    } else {
      cart.grounded = false;
    }

    // If we somehow ended up off-road, crawl back toward park / ball ring
    if (!cartDrivable(level, cart.x, cart.z) && cart.grounded) {
      const hx = tx - cart.x;
      const hz = tz - cart.z;
      const hl = Math.hypot(hx, hz) || 1;
      cart.vx += (hx / hl) * 10 * dt;
      cart.vz += (hz / hl) * 10 * dt;
    }

    // Horizontal friction
    const damp = Math.exp(-friction * dt);
    cart.vx *= damp;
    cart.vz *= damp;

    cart.x = nextX;
    cart.y = nextY;
    cart.z = nextZ;

    // Orient to ground normal (smoothed)
    const n = ground.normal;
    const wantPitch = Math.atan2(n.z, n.y);
    const wantRoll = -Math.atan2(n.x, n.y);
    const lean = Math.min(1, 10 * dt);
    cart.pitch += (wantPitch - cart.pitch) * lean;
    cart.roll += (wantRoll - cart.roll) * lean;

    const moved = Math.hypot(cart.vx, cart.vz) * dt;
    cart.wheelSpin += moved * 4.2;
    cart.group.position.set(cart.x, cart.y, cart.z);
    cart.group.rotation.set(cart.pitch, cart.yaw, cart.roll);
    const wheels = cart.group.userData.wheels as THREE.Mesh[];
    for (const w of wheels) {
      w.rotation.x = cart.wheelSpin;
    }

    // Run over / clip seagulls
    for (const g of seagulls) {
      if (g.dead) continue;
      const horiz = Math.hypot(g.x - cart.x, g.z - cart.z);
      if (horiz > 0.85) continue;
      if (Math.abs(g.y - (cart.y + 0.45)) > 1.05) continue;
      killSeagull(g);
    }
  }

  function clearBoatDebris() {
    for (const bit of boatDebris) {
      fxGroup.remove(bit.mesh);
      bit.mesh.geometry.dispose();
      (bit.mesh.material as THREE.MeshLambertMaterial).dispose();
    }
    boatDebris.length = 0;
  }

  function spawnSeagulls(level: LevelData) {
    clearSeagulls();
    const half = ((level.size - 1) * level.cell) / 2;
    const count = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      let y = level.waterY + 4;
      let placed = false;
      for (let attempt = 0; attempt < 24; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = half * (0.25 + Math.random() * 0.55);
        x = Math.cos(ang) * rad;
        z = Math.sin(ang) * rad;
        const sample = sampleTerrain(level, x, z);
        if (sample.height <= level.waterY + 0.2) continue;
        y = sample.height + 2.2 + Math.random() * 2.5;
        placed = true;
        break;
      }
      if (!placed) continue;

      const group = makeSeagull();
      seagullGroup.add(group);
      const flyAngle = Math.random() * Math.PI * 2;
      const startFlying = Math.random() < 0.55;
      const groundY = sampleTerrain(level, x, z).height + 0.08;
      const gull: Seagull = {
        group,
        mode: startFlying ? "fly" : "stand",
        timer: 2 + Math.random() * 5,
        x,
        y: startFlying ? y : groundY,
        z,
        yaw: flyAngle,
        speed: 2.2 + Math.random() * 1.4,
        wingPhase: Math.random() * Math.PI * 2,
        flyCenterX: x,
        flyCenterZ: z,
        flyRadius: 6 + Math.random() * 10,
        flyAngle,
        flyHeight: y,
        dead: false,
      };
      seagulls.push(gull);
      group.position.set(gull.x, gull.y, gull.z);
      group.rotation.y = gull.yaw;
    }
  }

  function spawnBloodFountain(x: number, y: number, z: number) {
    const count = 48;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: i % 4 === 0 ? 0x7f1d1d : 0xdc2626,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(bloodDropGeo, mat);
      const ang = Math.random() * Math.PI * 2;
      const out = 1.2 + Math.random() * 4.5;
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(0.5 + Math.random() * 1.1);
      bloodGroup.add(mesh);
      bloodDrops.push({
        mesh,
        vx: Math.cos(ang) * out,
        vy: 4 + Math.random() * 9,
        vz: Math.sin(ang) * out,
        settled: false,
      });
    }
  }

  function updateBlood(level: LevelData, dt: number) {
    const g = 26;
    for (let i = bloodDrops.length - 1; i >= 0; i--) {
      const drop = bloodDrops[i]!;
      if (drop.settled) continue;

      drop.vy -= g * dt;
      drop.mesh.position.x += drop.vx * dt;
      drop.mesh.position.y += drop.vy * dt;
      drop.mesh.position.z += drop.vz * dt;
      drop.vx *= Math.exp(-0.8 * dt);
      drop.vz *= Math.exp(-0.8 * dt);

      const ground = sampleTerrain(level, drop.mesh.position.x, drop.mesh.position.z);
      const inWater = ground.surface === "water" || ground.height <= level.waterY + 0.05;
      const floorY = (inWater ? level.waterY : ground.height) + 0.02;

      if (drop.mesh.position.y > floorY || drop.vy > 0) continue;

      // Wash away in water; otherwise splat and stay for the rest of the round
      if (inWater) {
        bloodGroup.remove(drop.mesh);
        (drop.mesh.material as THREE.MeshLambertMaterial).dispose();
        bloodDrops.splice(i, 1);
        continue;
      }

      drop.mesh.position.y = ground.height + 0.015;
      const s = 0.7 + Math.random() * 1.4;
      drop.mesh.scale.set(s * 1.9, 0.18 + Math.random() * 0.12, s * 1.6);
      drop.mesh.rotation.set(
        (Math.random() - 0.5) * 0.35,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.35,
      );
      drop.vx = 0;
      drop.vy = 0;
      drop.vz = 0;
      drop.settled = true;
    }
  }

  function killSeagull(gull: Seagull) {
    if (gull.dead) return;
    gull.dead = true;
    spawnBloodFountain(gull.x, gull.y, gull.z);
    gull.group.visible = false;
  }

  function spawnSailboats(level: LevelData) {
    clearSailboats();
    clearBoatDebris();
    const half = ((level.size - 1) * level.cell) / 2;
    const count = 2 + Math.floor(Math.random() * 2); // 2–3
    for (let i = 0; i < count; i++) {
      let x = 0;
      let z = 0;
      let placed = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = half * (0.35 + Math.random() * 0.55);
        x = Math.cos(ang) * rad;
        z = Math.sin(ang) * rad;
        const sample = sampleTerrain(level, x, z);
        if (sample.height > level.waterY + 0.08) continue;
        // Prefer open water — check a few nearby points stay wet
        let open = true;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          const s = sampleTerrain(level, x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2);
          if (s.height > level.waterY + 0.15) {
            open = false;
            break;
          }
        }
        if (!open) continue;
        placed = true;
        break;
      }
      if (!placed) continue;

      const group = makeSailboat();
      sailboatGroup.add(group);
      const yaw = Math.random() * Math.PI * 2;
      const boat: Sailboat = {
        group,
        x,
        y: level.waterY,
        z,
        yaw,
        speed: 0.35 + Math.random() * 0.35,
        bobPhase: Math.random() * Math.PI * 2,
        turnTimer: 4 + Math.random() * 8,
        dead: false,
      };
      sailboats.push(boat);
      group.position.set(boat.x, boat.y, boat.z);
      group.rotation.y = boat.yaw;
    }
  }

  function spawnBoatExplosion(x: number, y: number, z: number, waterY: number) {
    spawnSplash(x, waterY, z, 1.4);
    const wood = [0x8b5a2b, 0x6b4423, 0xa67c52, 0x5c4033];
    const cloth = [0xf8fafc, 0xe2e8f0, 0xb91c1c];
    const count = 42;
    for (let i = 0; i < count; i++) {
      const isSail = i % 5 === 0;
      const mat = new THREE.MeshLambertMaterial({
        color: isSail ? cloth[i % cloth.length]! : wood[i % wood.length]!,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(
        isSail
          ? new THREE.PlaneGeometry(0.18 + Math.random() * 0.25, 0.22 + Math.random() * 0.3)
          : new THREE.BoxGeometry(
              0.08 + Math.random() * 0.18,
              0.04 + Math.random() * 0.08,
              0.12 + Math.random() * 0.28,
            ),
        mat,
      );
      const ang = Math.random() * Math.PI * 2;
      const out = 2.2 + Math.random() * 6.5;
      mesh.position.set(x, y + 0.4, z);
      fxGroup.add(mesh);
      boatDebris.push({
        mesh,
        vx: Math.cos(ang) * out,
        vy: 5 + Math.random() * 11,
        vz: Math.sin(ang) * out,
        spinX: (Math.random() - 0.5) * 14,
        spinY: (Math.random() - 0.5) * 16,
        spinZ: (Math.random() - 0.5) * 14,
        life: 1.4 + Math.random() * 1.2,
      });
    }
  }

  function killSailboat(boat: Sailboat, waterY: number) {
    if (boat.dead) return;
    boat.dead = true;
    spawnBoatExplosion(boat.x, boat.y, boat.z, waterY);
    boat.group.visible = false;
  }

  function updateBoatDebris(level: LevelData, dt: number) {
    const g = 22;
    for (let i = boatDebris.length - 1; i >= 0; i--) {
      const bit = boatDebris[i]!;
      bit.life -= dt;
      bit.vy -= g * dt;
      bit.vx *= Math.exp(-0.55 * dt);
      bit.vz *= Math.exp(-0.55 * dt);
      bit.mesh.position.x += bit.vx * dt;
      bit.mesh.position.y += bit.vy * dt;
      bit.mesh.position.z += bit.vz * dt;
      bit.mesh.rotation.x += bit.spinX * dt;
      bit.mesh.rotation.y += bit.spinY * dt;
      bit.mesh.rotation.z += bit.spinZ * dt;

      const ground = sampleTerrain(level, bit.mesh.position.x, bit.mesh.position.z);
      const floorY = Math.max(ground.height, level.waterY) + 0.02;
      if (bit.life <= 0 || (bit.mesh.position.y <= floorY && bit.vy <= 0)) {
        fxGroup.remove(bit.mesh);
        bit.mesh.geometry.dispose();
        (bit.mesh.material as THREE.MeshLambertMaterial).dispose();
        boatDebris.splice(i, 1);
      }
    }
  }

  function updateSailboats(level: LevelData, snap: RoundSnapshot, dt: number) {
    const t = performance.now() * 0.001;
    for (const b of sailboats) {
      if (b.dead) continue;

      if (snap.ball.moving) {
        const dx = snap.ball.pos.x - b.x;
        const dz = snap.ball.pos.z - b.z;
        const horiz = Math.hypot(dx, dz);
        const ballY = snap.ball.pos.y;
        // Tall hit volume covering hull + sail
        if (
          horiz < 1.25 + BALL_RADIUS &&
          ballY > level.waterY - 0.3 &&
          ballY < level.waterY + 2.4
        ) {
          killSailboat(b, level.waterY);
          continue;
        }
      }

      b.turnTimer -= dt;
      if (b.turnTimer <= 0) {
        b.yaw += (Math.random() - 0.5) * 1.1;
        b.turnTimer = 5 + Math.random() * 9;
      }

      const nx = b.x + Math.sin(b.yaw) * b.speed * 1.6;
      const nz = b.z + Math.cos(b.yaw) * b.speed * 1.6;
      const ahead = sampleTerrain(level, nx, nz);
      if (ahead.height > level.waterY + 0.12) {
        // Steer away from shore
        b.yaw += Math.PI * 0.55 + (Math.random() - 0.5) * 0.6;
        b.turnTimer = 2 + Math.random() * 3;
      } else {
        b.x += Math.sin(b.yaw) * b.speed * dt;
        b.z += Math.cos(b.yaw) * b.speed * dt;
      }

      const here = sampleTerrain(level, b.x, b.z);
      if (here.height > level.waterY + 0.1) {
        // Nudged onto land — reverse
        b.yaw += Math.PI;
        b.x += Math.sin(b.yaw) * 1.2;
        b.z += Math.cos(b.yaw) * 1.2;
      }

      const bob = Math.sin(t * 1.3 + b.bobPhase) * 0.07;
      const roll = Math.sin(t * 1.1 + b.bobPhase * 1.3) * 0.05;
      const pitch = Math.sin(t * 0.9 + b.bobPhase * 0.7) * 0.035;
      b.y = level.waterY + bob;
      b.group.position.set(b.x, b.y, b.z);
      b.group.rotation.set(pitch, b.yaw, roll);
    }
  }

  function updateSeagulls(level: LevelData, snap: RoundSnapshot, dt: number) {
    for (const g of seagulls) {
      if (g.dead) continue;

      if (snap.ball.moving) {
        const d = Math.hypot(
          snap.ball.pos.x - g.x,
          snap.ball.pos.y - g.y,
          snap.ball.pos.z - g.z,
        );
        if (d < 0.3 + BALL_RADIUS) {
          killSeagull(g);
          continue;
        }
      }

      g.timer -= dt;
      const flapping = g.mode === "fly" || g.mode === "ascend" || g.mode === "descend";
      g.wingPhase += dt * (flapping ? 16 : 1.5);

      if (g.mode === "fly") {
        g.flyAngle += (g.speed * dt) / Math.max(5, g.flyRadius);
        g.x = g.flyCenterX + Math.cos(g.flyAngle) * g.flyRadius;
        g.z = g.flyCenterZ + Math.sin(g.flyAngle) * g.flyRadius;
        g.y = g.flyHeight + Math.sin(g.flyAngle * 2.2) * 0.4;
        g.yaw = g.flyAngle + Math.PI / 2;
        if (g.timer <= 0) {
          g.mode = "descend";
          g.timer = 3;
        }
      } else if (g.mode === "descend") {
        const ground = sampleTerrain(level, g.x, g.z);
        const landY = ground.height + 0.08;
        g.y += (landY - g.y) * Math.min(1, 2.1 * dt);
        g.x += Math.sin(g.yaw) * 0.35 * dt;
        g.z += Math.cos(g.yaw) * 0.35 * dt;
        if (ground.surface === "water" || ground.height <= level.waterY + 0.12) {
          g.mode = "ascend";
          g.timer = 2;
        } else if (g.y <= landY + 0.06 || g.timer <= 0) {
          g.y = landY;
          g.mode = "stand";
          g.timer = 1.4 + Math.random() * 3.2;
        }
      } else if (g.mode === "stand") {
        const ground = sampleTerrain(level, g.x, g.z);
        g.y = ground.height + 0.08;
        if (g.timer <= 0) {
          if (Math.random() < 0.6) {
            g.mode = "walk";
            g.timer = 1.1 + Math.random() * 2.2;
            g.yaw += (Math.random() - 0.5) * 1.4;
          } else {
            g.mode = "ascend";
            g.timer = 2;
            g.flyHeight = 2.4 + Math.random() * 2.2;
          }
        }
      } else if (g.mode === "walk") {
        const ground = sampleTerrain(level, g.x, g.z);
        g.x += Math.sin(g.yaw) * 0.5 * dt;
        g.z += Math.cos(g.yaw) * 0.5 * dt;
        g.y = ground.height + 0.08;
        if (ground.surface === "water" || ground.height <= level.waterY + 0.15) {
          g.mode = "ascend";
          g.timer = 2;
          g.flyHeight = 2.5 + Math.random() * 2;
        } else if (g.timer <= 0) {
          if (Math.random() < 0.45) {
            g.mode = "stand";
            g.timer = 1 + Math.random() * 2.5;
          } else {
            g.mode = "ascend";
            g.timer = 2;
            g.flyHeight = 2.4 + Math.random() * 2.2;
          }
        }
      } else if (g.mode === "ascend") {
        g.y += 1.85 * dt;
        g.x += Math.sin(g.yaw) * 0.9 * dt;
        g.z += Math.cos(g.yaw) * 0.9 * dt;
        if (g.y >= g.flyHeight || g.timer <= 0) {
          g.mode = "fly";
          g.flyCenterX = g.x;
          g.flyCenterZ = g.z;
          g.flyAngle = g.yaw;
          g.flyHeight = Math.max(g.y, 2.5);
          g.flyRadius = 5 + Math.random() * 9;
          g.timer = 4 + Math.random() * 9;
        }
      }

      g.group.position.set(g.x, g.y, g.z);
      g.group.rotation.y = g.yaw;
      const flap = Math.sin(g.wingPhase) * (flapping ? 0.6 : 0.06);
      const left = g.group.userData.leftWing as THREE.Mesh;
      const right = g.group.userData.rightWing as THREE.Mesh;
      left.rotation.z = flap;
      right.rotation.z = -flap;
    }
  }

  function impulseTree(treeIndex: number, nx: number, nz: number, strength: number) {
    const sway = treeSwings[treeIndex];
    if (!sway) return;
    const kick = strength * 2.6;
    sway.velX += nx * kick;
    sway.velZ += nz * kick;
    sway.shudder = Math.min(1.8, sway.shudder + strength * 1.1);
  }

  function updateTreeSway(dt: number) {
    const spring = 68;
    const damp = 4.4;
    const maxLean = 0.58;
    const tSec = performance.now() * 0.001;
    for (const t of treeSwings) {
      t.velX += (-t.leanX * spring - t.velX * damp) * dt;
      t.velZ += (-t.leanZ * spring - t.velZ * damp) * dt;
      t.leanX += t.velX * dt;
      t.leanZ += t.velZ * dt;
      if (t.leanX > maxLean) t.leanX = maxLean;
      else if (t.leanX < -maxLean) t.leanX = -maxLean;
      if (t.leanZ > maxLean) t.leanZ = maxLean;
      else if (t.leanZ < -maxLean) t.leanZ = -maxLean;
      t.shudder *= Math.exp(-5.5 * dt);
      const shake =
        Math.sin(tSec * 38 + t.lean.id) * t.shudder * 0.09 +
        Math.sin(tSec * 61 + 2.1) * t.shudder * 0.05;
      // Tip away from the hit along XZ, plus a short shudder
      t.lean.rotation.x = -t.leanZ + shake * 0.65;
      t.lean.rotation.z = t.leanX + shake;
    }
  }

  function spawnSplash(x: number, y: number, z: number, strength: number) {
    const s = Math.max(0.35, Math.min(1.8, strength));
    for (let r = 0; r < 2; r++) {
      const mat = new THREE.MeshLambertMaterial({
        color: r === 0 ? 0xd8f4ff : 0xffffff,
        flatShading: true,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(splashRingGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y + 0.02 + r * 0.01, z);
      mesh.scale.setScalar(0.35 + r * 0.15);
      fxGroup.add(mesh);
      splashRings.push({
        mesh,
        age: 0,
        maxAge: 0.55 + r * 0.2,
        startScale: 0.4 + r * 0.2,
        endScale: (1.8 + s * 1.4) * (1 + r * 0.35),
      });
    }

    const drops = 10 + Math.round(s * 8);
    for (let i = 0; i < drops; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: i % 3 === 0 ? 0xffffff : COLORS.water,
        flatShading: true,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(splashDropGeo, mat);
      const ang = Math.random() * Math.PI * 2;
      const out = (0.6 + Math.random() * 2.2) * s;
      mesh.position.set(
        x + Math.cos(ang) * 0.08,
        y + 0.05 + Math.random() * 0.1,
        z + Math.sin(ang) * 0.08,
      );
      mesh.scale.setScalar(0.55 + Math.random() * 0.9);
      fxGroup.add(mesh);
      splashDrops.push({
        mesh,
        vx: Math.cos(ang) * out,
        vy: (3.5 + Math.random() * 5.5) * (0.55 + s * 0.35),
        vz: Math.sin(ang) * out,
        life: 0.55 + Math.random() * 0.45,
        waterY: y,
      });
    }
  }

  function updateSplashes(dt: number) {
    for (let i = splashRings.length - 1; i >= 0; i--) {
      const ring = splashRings[i]!;
      ring.age += dt;
      const u = Math.min(1, ring.age / ring.maxAge);
      const scale = ring.startScale + (ring.endScale - ring.startScale) * u;
      ring.mesh.scale.setScalar(scale);
      const mat = ring.mesh.material as THREE.MeshLambertMaterial;
      mat.opacity = 0.65 * (1 - u) * (1 - u);
      if (u >= 1) {
        fxGroup.remove(ring.mesh);
        mat.dispose();
        splashRings.splice(i, 1);
      }
    }

    const g = 22;
    for (let i = splashDrops.length - 1; i >= 0; i--) {
      const drop = splashDrops[i]!;
      drop.life -= dt;
      drop.vy -= g * dt;
      drop.mesh.position.x += drop.vx * dt;
      drop.mesh.position.y += drop.vy * dt;
      drop.mesh.position.z += drop.vz * dt;
      drop.vx *= Math.exp(-1.2 * dt);
      drop.vz *= Math.exp(-1.2 * dt);
      const mat = drop.mesh.material as THREE.MeshLambertMaterial;
      mat.opacity = Math.max(0, Math.min(0.95, drop.life * 1.6));
      if (drop.life <= 0 || drop.mesh.position.y <= drop.waterY) {
        fxGroup.remove(drop.mesh);
        mat.dispose();
        splashDrops.splice(i, 1);
      }
    }
  }

  function beginWaterCamSlide(x: number, y: number, z: number) {
    camSlide = { ax: x, ay: y, az: z, t: 0 };
  }

  function handleFx(events: WorkGolfFxEvent[]) {
    for (const ev of events) {
      if (ev.kind === "treeHit") {
        impulseTree(ev.treeIndex, ev.nx, ev.nz, ev.strength);
      } else if (ev.kind === "splash") {
        spawnSplash(ev.x, ev.y, ev.z, ev.strength);
        // Start slide from the splash; ball has already reset to last lie
        beginWaterCamSlide(ev.x, ev.y + 0.4, ev.z);
      } else if (ev.kind === "powerUp") {
        const g = powerUpGroups.get(ev.powerUpId);
        if (g) g.visible = false;
      }
    }
  }

  function updatePowerUps(snap: RoundSnapshot, nowMs: number) {
    const t = nowMs * 0.001;
    for (const pu of snap.powerUps) {
      const g = powerUpGroups.get(pu.id);
      if (!g) continue;
      g.visible = pu.active;
      if (!pu.active) continue;
      // Grounded can — tiny wobble, not a float
      g.position.y = pu.y + Math.sin(t * 3.2 + pu.id * 1.7) * 0.02;
      g.rotation.y = t * 0.85 + pu.id;
    }
  }

  function clearWorld(keepConfetti = false) {
    if (!keepConfetti) {
      clearConfetti();
      clearBlood();
    }
    clearSplashes();
    treeSwings.length = 0;
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
    powerUpGroups.clear();
    terrainMesh = null;
  }

  function rebuild(level: LevelData, keepConfetti = false) {
    clearWorld(keepConfetti);
    camSlide = null;
    water.position.y = level.waterY;
    terrainMesh = buildTerrainMesh(level, terrainDetailTex);
    world.add(terrainMesh);
    rebuildGrass(level);

    for (const tree of level.trees) {
      const lean = makeTree(tree);
      world.add(lean);
      treeSwings.push({ lean, leanX: 0, leanZ: 0, velX: 0, velZ: 0, shudder: 0 });
    }

    for (const pu of level.powerUps) {
      if (pu.kind !== "beer") continue;
      const can = makeBeerCan(pu);
      can.visible = pu.active;
      world.add(can);
      powerUpGroups.set(pu.id, can);
    }

    // Fresh flock / boats / cart only on new levels (hole advances keep them alive)
    if (!keepConfetti) {
      spawnSeagulls(level);
      spawnSailboats(level);
      spawnGolfCart(level);
    }

    const target = currentTargetHole(level.holes);
    for (const hole of level.holes) {
      const flag = makeFlag(hole);
      world.add(flag);
      flagGroups.set(hole.id, flag);

      const isTarget = target !== null && hole.id === target.id;
      const liner = flag.getObjectByName("cupLiner");
      const floor = flag.getObjectByName("cupFloor");
      if (liner) liner.visible = isTarget;
      if (floor) floor.visible = isTarget;

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
    builtTargetHoleId = target?.id ?? -1;
  }

  function updateLabels(snap: RoundSnapshot) {
    const target = currentTargetHole(snap.holes);
    for (const hole of snap.holes) {
      const sprite = labelSprites.get(hole.id);
      const flag = flagGroups.get(hole.id);
      if (!sprite || !flag) continue;

      // Remaining flags stay up as course landmarks; only the current cup shows distance
      flag.visible = hole.active;
      const isTarget = target !== null && hole.id === target.id;
      const liner = flag.getObjectByName("cupLiner");
      const floor = flag.getObjectByName("cupFloor");
      if (liner) liner.visible = isTarget;
      if (floor) floor.visible = isTarget;

      // Soften upcoming (non-target) flags so the next cup reads clearly
      flag.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (obj.name === "cupLiner" || obj.name === "cupFloor") return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if ("opacity" in m) {
            const mat = m as THREE.MeshLambertMaterial;
            mat.transparent = !isTarget;
            mat.opacity = isTarget ? 1 : 0.55;
          }
        }
      });

      if (!hole.active || !isTarget) {
        sprite.visible = false;
        continue;
      }

      const dx = hole.x - snap.ball.pos.x;
      const dz = hole.z - snap.ball.pos.z;
      const dist = Math.hypot(dx, dz);
      const yards = worldToYards(dist);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.map = makeDistanceTexture(`${yards}y`, hole.color);
      mat.needsUpdate = true;
      sprite.visible = true;
      sprite.position.set(hole.x, hole.y + 3.1, hole.z);
    }
  }

  function updateWayArrow(level: LevelData, snap: RoundSnapshot) {
    const target = currentTargetHole(snap.holes);
    if (
      !target ||
      snap.status === "complete" ||
      snap.ball.moving ||
      snap.status === "flying" ||
      snap.status === "holed"
    ) {
      wayArrow.visible = false;
      return;
    }

    const dx = target.x - snap.ball.pos.x;
    const dz = target.z - snap.ball.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.5) {
      wayArrow.visible = false;
      return;
    }

    const yaw = yawToward(snap.ball.pos.x, snap.ball.pos.z, target.x, target.z);
    const standOff = Math.min(3.2, dist * 0.22);
    const ax = snap.ball.pos.x + Math.sin(yaw) * standOff;
    const az = snap.ball.pos.z + Math.cos(yaw) * standOff;
    const ground = sampleTerrain(level, ax, az);
    wayArrow.visible = true;
    wayArrow.position.set(ax, ground.height + 0.08, az);
    // Shape tip lands on -Z after laying flat; +π aligns it with yawToward (+Z at 0)
    wayArrow.rotation.y = yaw + Math.PI;
    const mesh = wayArrow.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.color.set(target.color);
  }

  function setMenuPreview(active: boolean) {
    menuPreview = active;
    if (active) {
      camSlide = null;
      hideSpreadPreview();
      wayArrow.visible = false;
      ballMesh.visible = false;
    } else {
      ballMesh.visible = true;
    }
  }

  function updatePreviewCamera(level: LevelData, dt: number) {
    previewYaw += dt * 0.11;
    const tee = level.tee;
    const hole = level.holes[0];
    const cx = hole ? tee.x * 0.45 + hole.x * 0.55 : tee.x;
    const cz = hole ? tee.z * 0.45 + hole.z * 0.55 : tee.z;
    const cy = (hole ? Math.max(tee.y, hole.y) : tee.y) + 1.2;
    // Slow bob so the flyover feels alive
    const breathe = Math.sin(performance.now() * 0.00035) * 2.2;
    const dist = 36 + breathe;
    const height = 18 + Math.sin(previewYaw * 0.7) * 1.5;
    camera.position.set(
      cx - Math.sin(previewYaw) * dist,
      cy + height,
      cz - Math.cos(previewYaw) * dist,
    );
    camera.lookAt(cx, cy + 1.5, cz);
    updateGrass(cx, cz, performance.now() * 0.001);
  }

  function updateCamera(snap: RoundSnapshot, dt: number) {
    // Shot goes along cameraYaw; view sits ~3° off to the side so the arc is visible
    const aimYaw = snap.cameraYaw;
    const viewYaw = aimYaw + (3 * Math.PI) / 180;
    const z = snap.cameraZoom;
    // z=0 far, z=1 close — wide range so the slider feels dramatic
    const dist = 42 - z * 34;
    const height = 28 - z * 23;
    const lookAhead = 8.5 - z * 6.2;
    const lookUp = 3.4 - z * 2.2;

    let bx = snap.ball.pos.x;
    let by = snap.ball.pos.y;
    let bz = snap.ball.pos.z;

    // After water hazard: ease the follow point from splash → last lie (~1s)
    if (camSlide) {
      camSlide.t += dt;
      const u = Math.min(1, camSlide.t / WATER_CAM_SLIDE_DUR);
      const e = 1 - (1 - u) ** 3;
      bx = camSlide.ax + (snap.ball.pos.x - camSlide.ax) * e;
      by = camSlide.ay + (snap.ball.pos.y - camSlide.ay) * e;
      bz = camSlide.az + (snap.ball.pos.z - camSlide.az) * e;
      if (u >= 1) camSlide = null;
    }

    // Camera behind/beside follow point; look along the aim so ball stays bottom-center
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

  function hideSpreadPreview() {
    for (const ghost of ghostBalls) ghost.visible = false;
    for (const ghost of spreadLeftGhosts) ghost.visible = false;
    for (const ghost of spreadRightGhosts) ghost.visible = false;
    landRing.visible = false;
    sprayFan.visible = false;
  }

  function placeSpreadGhosts(ghosts: THREE.Mesh[], points: Vec3[]) {
    for (let i = 0; i < ghosts.length; i++) {
      const ghost = ghosts[i]!;
      const p = points[i];
      if (!p) {
        ghost.visible = false;
        continue;
      }
      const t = ghosts.length <= 1 ? 0 : i / (ghosts.length - 1);
      ghost.visible = true;
      ghost.position.set(p.x, p.y, p.z);
      (ghost.material as THREE.MeshLambertMaterial).opacity = 0.08 + 0.16 * (1 - t);
    }
  }

  function updateSprayFan(
    origin: { x: number; y: number; z: number },
    leftLand: { x: number; y: number; z: number },
    rightLand: { x: number; y: number; z: number },
    strength: number,
  ) {
    const y = Math.min(origin.y, leftLand.y, rightLand.y) - BALL_RADIUS + 0.05;
    const positions = new Float32Array([
      origin.x,
      y,
      origin.z,
      leftLand.x,
      y,
      leftLand.z,
      rightLand.x,
      y,
      rightLand.z,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    sprayFan.geometry.dispose();
    sprayFan.geometry = geo;
    sprayFanMat.opacity = 0.06 + strength * 0.16;
    sprayFan.visible = strength > 0.04;
  }

  function sync(engine: WorkGolfEngine, snap: RoundSnapshot) {
    const targetId = currentTargetHole(snap.holes)?.id ?? -1;
    if (builtLevel !== engine.level.levelNumber) {
      rebuild(engine.level, false);
    } else if (builtTargetHoleId !== targetId) {
      // New cup opens — keep confetti from the hole just sunk
      rebuild(engine.level, true);
    }

    const now = performance.now();
    const dt = Math.min(0.05, (now - confettiLastTs) / 1000);
    confettiLastTs = now;

    handleFx(engine.drainFx());
    updateTreeSway(dt);
    updateSplashes(dt);
    updateBlood(engine.level, dt);
    updateSeagulls(engine.level, snap, dt);
    updateSailboats(engine.level, snap, dt);
    updateBoatDebris(engine.level, dt);
    updateGolfCart(engine.level, snap, dt);

    // Celebrate newly sunk cups — confetti stays on the ground for the rest of the round
    for (const hole of snap.holes) {
      if (!hole.active && !celebratedHoles.has(hole.id)) {
        celebratedHoles.add(hole.id);
        spawnHoleConfetti(hole);
      }
    }
    updateConfetti(engine.level, dt);

    // Physics center sits a bit high visually — sink along the ground normal (render only)
    if (!menuPreview) {
      const ground = sampleTerrain(engine.level, snap.ball.pos.x, snap.ball.pos.z);
      const visualSink = -BALL_RADIUS * 0.5;
      ballMesh.position.set(
        snap.ball.pos.x + ground.normal.x * visualSink,
        snap.ball.pos.y + ground.normal.y * visualSink,
        snap.ball.pos.z + ground.normal.z * visualSink,
      );
      if (snap.ball.moving) {
        ballMesh.rotation.x += snap.ball.vel.z * 0.02;
        ballMesh.rotation.z -= snap.ball.vel.x * 0.02;
      }
    }

    if (!menuPreview && snap.aiming && snap.power > 0.02) {
      const aimArgs = {
        origin: snap.ball.pos,
        power: snap.power,
        club: snap.club,
        level: engine.level,
        speedMult: snap.speedMult,
      };
      const spread = aimSpreadHalfAngle(snap.power, snap.spreadMult);
      const ghosts = predictShotGhosts({ ...aimArgs, yaw: snap.cameraYaw });
      const leftGhosts = predictShotGhosts({
        ...aimArgs,
        yaw: snap.cameraYaw - spread,
      });
      const rightGhosts = predictShotGhosts({
        ...aimArgs,
        yaw: snap.cameraYaw + spread,
      });

      for (let i = 0; i < ghostBalls.length; i++) {
        const ghost = ghostBalls[i]!;
        const p = ghosts[i];
        if (!p) {
          ghost.visible = false;
          continue;
        }
        const t = ghostBalls.length <= 1 ? 0 : i / (ghostBalls.length - 1);
        ghost.visible = true;
        ghost.position.set(p.x, p.y, p.z);
        const isLand = i === ghostBalls.length - 1;
        (ghost.material as THREE.MeshLambertMaterial).opacity = isLand
          ? 0.72
          : 0.48 * (1 - t) + 0.12 * t;
        ghost.scale.setScalar(isLand ? 0.72 : 0.42 + 0.12 * (1 - t));
      }

      // Edge paths subsampled from full edge predictions
      const pickEdge = (pts: Vec3[]): Vec3[] => {
        const out: Vec3[] = [];
        for (let i = 0; i < SHOT_SPREAD_GHOST_COUNT; i++) {
          const t = (i + 1) / SHOT_SPREAD_GHOST_COUNT;
          const idx = Math.min(pts.length - 1, Math.round(t * (pts.length - 1)));
          const p = pts[idx];
          if (p) out.push(p);
        }
        return out;
      };
      placeSpreadGhosts(spreadLeftGhosts, pickEdge(leftGhosts));
      placeSpreadGhosts(spreadRightGhosts, pickEdge(rightGhosts));

      const land = ghosts[ghosts.length - 1];
      const landL = leftGhosts[leftGhosts.length - 1];
      const landR = rightGhosts[rightGhosts.length - 1];
      if (land && landL && landR) {
        const lateral = Math.hypot(landL.x - landR.x, landL.z - landR.z);
        // Bloom size tracks spray width at impact (FPS crosshair open)
        const bloom = Math.max(1, 0.85 + lateral * 0.5);
        landRing.visible = true;
        landRing.position.set(land.x, land.y - BALL_RADIUS + 0.04, land.z);
        landRing.rotation.set(-Math.PI / 2, 0, 0);
        landRing.scale.setScalar(bloom);
        landRingMat.opacity = 0.28 + snap.power * 0.4;
        updateSprayFan(snap.ball.pos, landL, landR, spread / 0.155);
      } else {
        landRing.visible = false;
        sprayFan.visible = false;
      }
    } else {
      hideSpreadPreview();
    }

    waterMat.uniforms.uTime!.value = now * 0.001;
    updatePowerUps(snap, now);

    if (menuPreview) {
      hideSpreadPreview();
      wayArrow.visible = false;
      for (const sprite of labelSprites.values()) sprite.visible = false;
      updatePreviewCamera(engine.level, dt);
    } else {
      updateGrass(snap.ball.pos.x, snap.ball.pos.z, now * 0.001);
      updateLabels(snap);
      updateWayArrow(engine.level, snap);
      updateCamera(snap, dt);
    }
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
    clearSeagulls();
    clearSailboats();
    clearGolfCart();
    clearBoatDebris();
    clearGrassCandidates();
    scene.remove(wayArrow);
    wayArrow.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    scene.remove(landRing);
    landRingGeo.dispose();
    landRingMat.dispose();
    scene.remove(sprayFan);
    sprayFan.geometry.dispose();
    sprayFanMat.dispose();
    scene.remove(ballMesh);
    ballGeo.dispose();
    ghostBallGeo.dispose();
    ballMat.dispose();
    scene.remove(fxGroup);
    splashDropGeo.dispose();
    splashRingGeo.dispose();
    clearBlood();
    bloodDropGeo.dispose();
    scene.remove(bloodGroup);
    scene.remove(seagullGroup);
    scene.remove(sailboatGroup);
    scene.remove(golfCartGroup);
    scene.remove(grassMesh);
    grassMesh.dispose();
    grassGeo.dispose();
    grassMat.dispose();
    grassTex.dispose();
    confettiGeo.dispose();
    water.geometry.dispose();
    waterMat.dispose();
    terrainDetailTex.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    dom: renderer.domElement,
    resize,
    sync,
    setMenuPreview,
    worldToScreen,
    pickBall,
    dispose,
  };
}
