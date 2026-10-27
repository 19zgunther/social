/** Work Golf — level gen, ball physics, and round state (no Three.js). */

export const WORK_GOLF_GAME = "work-golf";
export const HOLES_PER_LEVEL = 5;
export const HOLE_SCORE_BASE = 1000;
export const HOLE_SCORE_PER_STROKE = 50;

export type SurfaceType = "medium" | "tall" | "green" | "sand" | "water" | "void";

export type ClubId = "driver" | "chipper" | "putter";

export type Vec3 = { x: number; y: number; z: number };

/** Launch angle (degrees from horizontal) + speed scale per club. */
export const CLUBS: Record<
  ClubId,
  { label: string; loftDeg: number; speed: number }
> = {
  driver: { label: "Driver", loftDeg: 30, speed: 1 },
  chipper: { label: "Chip", loftDeg: 70, speed: 0.72 },
  putter: { label: "Putt", loftDeg: 5, speed: 0.48 },
};

export type HoleDef = {
  id: number;
  x: number;
  z: number;
  y: number;
  color: string;
  active: boolean;
};

export type TreeDef = { x: number; z: number; y: number; radius: number; height: number };

export type LevelData = {
  levelNumber: number;
  seed: number;
  size: number;
  cell: number;
  /** heights[iz * size + ix] — continuous vertex Y (may sit under waterY) */
  heights: Float32Array;
  surfaces: Uint8Array;
  holes: HoleDef[];
  trees: TreeDef[];
  tee: Vec3;
  waterY: number;
};

export type BallState = {
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  moving: boolean;
};

export type RoundSnapshot = {
  levelNumber: number;
  strokesTotal: number;
  strokesThisHole: number;
  holesRemaining: number;
  holesCompleted: number;
  holeScores: number[];
  scoreTotal: number;
  ball: BallState;
  holes: HoleDef[];
  aiming: boolean;
  power: number;
  club: ClubId;
  cameraYaw: number;
  /** 0 = far, 1 = close to the ball */
  cameraZoom: number;
  lastShotPos: Vec3;
  status: "ready" | "flying" | "holed" | "complete";
  message: string | null;
};

const SURFACE_MEDIUM = 0;
const SURFACE_TALL = 1;
const SURFACE_GREEN = 2;
const SURFACE_SAND = 3;
const SURFACE_WATER = 4;
const SURFACE_VOID = 5;

const FLAG_COLORS = ["#ef4444", "#eab308", "#22c55e", "#ec4899", "#f97316"];

const FRICTION: Record<SurfaceType, number> = {
  medium: 3.8,
  tall: 18,
  green: 1.85,
  sand: 18,
  water: 0,
  void: 0,
};

const STOP_SPEED = 0.35;
const GRAVITY = 28;
/** Next bounce reaches this fraction of the previous airborne apex height. */
const BOUNCE_HEIGHT_FRAC = 0.2;
/** Below this bounce height, settle into a roll (or stop in tall/sand). */
const MIN_BOUNCE_HEIGHT = 0.07;
const MAX_HIT_SPEED = 42;
const HOLE_RADIUS = 0.8;
/** Max speed that still drops into the cup (XZ + vertical). */
const HOLE_CATCH_SPEED = 12;
/** Soft pull toward the cup so rolls don't skip over. */
const HOLE_PULL_RADIUS = 1.45;
export const BALL_RADIUS = 0.22;
const TREE_PUSH = 1.05;
/** Ignore ground contact briefly after a hit so slopes don't eat the shot. */
const LAUNCH_GRACE = 0.18;

export function computeShotVelocity(
  power: number,
  yaw: number,
  club: ClubId,
): Vec3 {
  const clubDef = CLUBS[club];
  const speed = power * MAX_HIT_SPEED * clubDef.speed;
  const angle = (clubDef.loftDeg * Math.PI) / 180;
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const up = speed * Math.sin(angle);
  const horiz = speed * Math.cos(angle);
  return {
    x: forwardX * horiz,
    y: up,
    z: forwardZ * horiz,
  };
}

export const SHOT_GHOST_COUNT = 8;

/**
 * Pure ballistic parabola matching shot launch (same vel + gravity) until first ground hit.
 * Returns ~SHOT_GHOST_COUNT samples from just after launch through the impact site.
 */
export function predictShotGhosts(args: {
  origin: Vec3;
  power: number;
  yaw: number;
  club: ClubId;
  level: LevelData;
}): Vec3[] {
  const vel0 = computeShotVelocity(args.power, args.yaw, args.club);
  // Match releaseShot lift so preview lines up with the real launch
  const lift = 0.12 + Math.max(0, vel0.y) * 0.01;
  const dt = 1 / 120;
  const maxSteps = 360;
  const points: Vec3[] = [];
  let x = args.origin.x;
  let y = args.origin.y + lift;
  let z = args.origin.z;
  let vx = vel0.x;
  let vy = vel0.y;
  let vz = vel0.z;

  points.push({ x, y, z });
  for (let i = 0; i < maxSteps; i++) {
    vy -= GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    points.push({ x, y, z });
    const sample = sampleTerrain(args.level, x, z);
    const groundY = sample.height + BALL_RADIUS;
    // After leaving the tee, stop at first ground contact (impact site)
    if (i > 8 && y <= groundY) {
      points[points.length - 1] = { x, y: groundY, z };
      break;
    }
  }

  if (points.length < 2) return [];

  const ghosts: Vec3[] = [];
  for (let g = 0; g < SHOT_GHOST_COUNT; g++) {
    // Spread from near the ball to the final impact point (inclusive)
    const t = (g + 1) / SHOT_GHOST_COUNT;
    const idx = Math.min(points.length - 1, Math.round(t * (points.length - 1)));
    ghosts.push(points[idx]!);
  }
  return ghosts;
}

function surfaceFromCode(code: number): SurfaceType {
  switch (code) {
    case SURFACE_TALL:
      return "tall";
    case SURFACE_GREEN:
      return "green";
    case SURFACE_SAND:
      return "sand";
    case SURFACE_WATER:
      return "water";
    case SURFACE_VOID:
      return "void";
    default:
      return "medium";
  }
}

function surfaceCode(s: SurfaceType): number {
  switch (s) {
    case "tall":
      return SURFACE_TALL;
    case "green":
      return SURFACE_GREEN;
    case "sand":
      return SURFACE_SAND;
    case "water":
      return SURFACE_WATER;
    case "void":
      return SURFACE_VOID;
    default:
      return SURFACE_MEDIUM;
  }
}

/** Mulberry32 */
function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function idx(size: number, ix: number, iz: number): number {
  return iz * size + ix;
}

function inBounds(size: number, ix: number, iz: number): boolean {
  return ix >= 0 && iz >= 0 && ix < size && iz < size;
}

/** Vertex grid: world XZ of height sample at (ix, iz). */
function vertWorld(level: Pick<LevelData, "size" | "cell">, ix: number, iz: number): { x: number; z: number } {
  const half = ((level.size - 1) * level.cell) / 2;
  return { x: -half + ix * level.cell, z: -half + iz * level.cell };
}

export function sampleTerrain(
  level: LevelData,
  x: number,
  z: number,
): { height: number; surface: SurfaceType; normal: Vec3 } {
  const half = ((level.size - 1) * level.cell) / 2;
  const fx = (x + half) / level.cell;
  const fz = (z + half) / level.cell;
  const ix0 = Math.floor(fx);
  const iz0 = Math.floor(fz);
  const tx = Math.min(1, Math.max(0, fx - ix0));
  const tz = Math.min(1, Math.max(0, fz - iz0));

  const hAt = (ix: number, iz: number) => {
    if (!inBounds(level.size, ix, iz)) return level.waterY - 1;
    return level.heights[idx(level.size, ix, iz)]!;
  };
  const sAt = (ix: number, iz: number) => {
    if (!inBounds(level.size, ix, iz)) return SURFACE_WATER;
    return level.surfaces[idx(level.size, ix, iz)]!;
  };

  const h00 = hAt(ix0, iz0);
  const h10 = hAt(ix0 + 1, iz0);
  const h01 = hAt(ix0, iz0 + 1);
  const h11 = hAt(ix0 + 1, iz0 + 1);
  const height =
    (1 - tx) * (1 - tz) * h00 + tx * (1 - tz) * h10 + (1 - tx) * tz * h01 + tx * tz * h11;

  let bestD = Infinity;
  let bestS = SURFACE_MEDIUM;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dx = 0; dx <= 1; dx++) {
      const ix = ix0 + dx;
      const iz = iz0 + dz;
      const d = (dx - tx) ** 2 + (dz - tz) ** 2;
      if (d < bestD) {
        bestD = d;
        bestS = sAt(ix, iz);
      }
    }
  }

  const hx = (h10 - h00 + (h11 - h01)) * 0.5;
  const hz = (h01 - h00 + (h11 - h10)) * 0.5;
  const nx = -hx / level.cell;
  const nz = -hz / level.cell;
  const ny = 1;
  const len = Math.hypot(nx, ny, nz) || 1;

  let surface = surfaceFromCode(bestS);
  if (height <= level.waterY + 0.05) surface = "water";

  return {
    height,
    surface,
    normal: { x: nx / len, y: ny / len, z: nz / len },
  };
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic 2D value noise in [0,1). */
function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);

  const corner = (ix: number, iz: number) => {
    let n = Math.imul(ix + seed * 374761393, 668265263) ^ Math.imul(iz + seed * 1274126177, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  const n00 = corner(x0, z0);
  const n10 = corner(x0 + 1, z0);
  const n01 = corner(x0, z0 + 1);
  const n11 = corner(x0 + 1, z0 + 1);
  const nx0 = n00 * (1 - sx) + n10 * sx;
  const nx1 = n01 * (1 - sx) + n11 * sx;
  return nx0 * (1 - sz) + nx1 * sz;
}

/** Layered (fBm-ish) noise centered around 0. */
function fbm2(x: number, z: number, seed: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise2(x * freq, z * freq, seed + o * 1013) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

function flattenDisk(
  level: LevelData,
  cx: number,
  cz: number,
  radius: number,
  targetY: number,
  strength = 1,
) {
  for (let iz = 0; iz < level.size; iz++) {
    for (let ix = 0; ix < level.size; ix++) {
      const { x, z } = vertWorld(level, ix, iz);
      const d = Math.hypot(x - cx, z - cz);
      if (d > radius) continue;
      const w = smoothstep(radius, radius * 0.25, d) * strength;
      const i = idx(level.size, ix, iz);
      level.heights[i] = level.heights[i]! * (1 - w) + targetY * w;
    }
  }
}

function flattenCorridor(
  level: LevelData,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  halfWidth: number,
  targetY: number,
  strength = 0.85,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const px = -uz;
  const pz = ux;

  for (let iz = 0; iz < level.size; iz++) {
    for (let ix = 0; ix < level.size; ix++) {
      const { x, z } = vertWorld(level, ix, iz);
      const vx = x - ax;
      const vz = z - az;
      const along = vx * ux + vz * uz;
      if (along < -1 || along > len + 1) continue;
      const side = Math.abs(vx * px + vz * pz);
      if (side > halfWidth) continue;
      const w =
        smoothstep(halfWidth, halfWidth * 0.35, side) *
        smoothstep(-1, 1.5, along) *
        smoothstep(len + 1, len - 1.5, along) *
        strength;
      const i = idx(level.size, ix, iz);
      level.heights[i] = level.heights[i]! * (1 - w) + targetY * w;
    }
  }
}

function paintSurfaceDisk(
  level: LevelData,
  cx: number,
  cz: number,
  radius: number,
  surface: SurfaceType,
  onlyAboveWater = true,
) {
  const code = surfaceCode(surface);
  for (let iz = 0; iz < level.size; iz++) {
    for (let ix = 0; ix < level.size; ix++) {
      const { x, z } = vertWorld(level, ix, iz);
      if (dist2(x, z, cx, cz) > radius * radius) continue;
      const i = idx(level.size, ix, iz);
      if (onlyAboveWater && level.heights[i]! <= level.waterY + 0.08) continue;
      level.surfaces[i] = code;
    }
  }
}

export function generateLevel(levelNumber: number): LevelData {
  const seed = (levelNumber * 2654435761) >>> 0;
  const rng = makeRng(seed);
  const size = 72;
  const cell = 0.95;
  const waterY = 0;
  const heights = new Float32Array(size * size);
  const surfaces = new Uint8Array(size * size);
  surfaces.fill(SURFACE_MEDIUM);

  const half = ((size - 1) * cell) / 2;
  const islandR = 20 + rng() * 5;
  const cx = (rng() - 0.5) * 3;
  const cz = (rng() - 0.5) * 3;

  const lobes = [
    { x: cx, z: cz, r: islandR },
    { x: cx + (rng() - 0.5) * 16, z: cz + (rng() - 0.5) * 16, r: 11 + rng() * 5 },
    { x: cx + (rng() - 0.5) * 18, z: cz + (rng() - 0.5) * 18, r: 9 + rng() * 4 },
  ];

  // Continuous welded grid: noise height + soft island falloff into water
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const x = -half + ix * cell;
      const z = -half + iz * cell;
      const i = idx(size, ix, iz);

      let island = 0;
      for (const lobe of lobes) {
        const d = Math.hypot(x - lobe.x, z - lobe.z);
        island = Math.max(island, 1 - smoothstep(lobe.r * 0.72, lobe.r, d));
      }

      const n1 = fbm2(x * 0.045, z * 0.045, seed, 4);
      const n2 = fbm2(x * 0.11 + 20, z * 0.11 - 7, seed + 17, 3);
      const n3 = fbm2(x * 0.28, z * 0.28, seed + 91, 2);
      const terrain = 1.15 + n1 * 2.1 + n2 * 0.85 + n3 * 0.28;

      // Outside the island, sink smoothly under water (no torn voids)
      const h = terrain * island + (waterY - 1.8) * (1 - island);
      heights[i] = h;
      surfaces[i] = h > waterY + 0.06 ? SURFACE_MEDIUM : SURFACE_WATER;
    }
  }

  const level: LevelData = {
    levelNumber,
    seed,
    size,
    cell,
    heights,
    surfaces,
    holes: [],
    trees: [],
    tee: { x: 0, y: 1, z: 0 },
    waterY,
  };

  // Soft hills / bowls (still continuous)
  for (let p = 0; p < 3; p++) {
    const px = cx + (rng() - 0.5) * 22;
    const pz = cz + (rng() - 0.5) * 22;
    const pr = 5 + rng() * 6;
    const lift = (rng() - 0.35) * 2.2;
    for (let iz = 0; iz < size; iz++) {
      for (let ix = 0; ix < size; ix++) {
        const { x, z } = vertWorld(level, ix, iz);
        const d = Math.hypot(x - px, z - pz);
        if (d > pr) continue;
        const w = smoothstep(pr, 0, d);
        const i = idx(size, ix, iz);
        if (heights[i]! <= waterY) continue;
        heights[i] += lift * w;
      }
    }
  }

  // Water hazards: depress the mesh under water instead of deleting verts
  const waterHazards: { x: number; z: number; r: number }[] = [];
  for (let w = 0; w < 2 + Math.floor(rng() * 2); w++) {
    const wx = cx + (rng() - 0.5) * 20;
    const wz = cz + (rng() - 0.5) * 20;
    const wr = 2.2 + rng() * 2.4;
    waterHazards.push({ x: wx, z: wz, r: wr });
    for (let iz = 0; iz < size; iz++) {
      for (let ix = 0; ix < size; ix++) {
        const { x, z } = vertWorld(level, ix, iz);
        const d = Math.hypot(x - wx, z - wz);
        if (d > wr * 1.35) continue;
        const wgt = smoothstep(wr * 1.35, wr * 0.35, d);
        const i = idx(size, ix, iz);
        heights[i] = heights[i]! * (1 - wgt) + (waterY - 0.85) * wgt;
        if (heights[i]! <= waterY + 0.06) surfaces[i] = SURFACE_WATER;
      }
    }
  }

  // Tee
  let teeX = cx;
  let teeZ = cz - islandR * 0.5;
  for (let tries = 0; tries < 50; tries++) {
    const sample = sampleTerrain(level, teeX, teeZ);
    if (sample.height > waterY + 0.35 && sample.surface !== "water") break;
    teeX = cx + (rng() - 0.5) * 10;
    teeZ = cz + (rng() - 0.5) * 10;
  }
  const teeFlatY = Math.max(waterY + 0.55, sampleTerrain(level, teeX, teeZ).height);
  flattenDisk(level, teeX, teeZ, 3.2, teeFlatY, 1);
  paintSurfaceDisk(level, teeX, teeZ, 3.2, "medium");
  level.tee = { x: teeX, y: teeFlatY + BALL_RADIUS, z: teeZ };

  // Holes + greens
  const holes: HoleDef[] = [];
  for (let h = 0; h < HOLES_PER_LEVEL; h++) {
    let hx = 0;
    let hz = 0;
    let ok = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      hx = cx + (rng() - 0.5) * (islandR * 1.35);
      hz = cz + (rng() - 0.5) * (islandR * 1.35);
      const sample = sampleTerrain(level, hx, hz);
      if (sample.height <= waterY + 0.3 || sample.surface === "water") continue;
      if (waterHazards.some((w) => dist2(hx, hz, w.x, w.z) < (w.r + 3) ** 2)) continue;
      if (dist2(hx, hz, teeX, teeZ) < 36) continue;
      if (holes.some((o) => dist2(hx, hz, o.x, o.z) < 49)) continue;
      ok = true;
      break;
    }
    if (!ok) {
      const ang = (h / HOLES_PER_LEVEL) * Math.PI * 2 + rng() * 0.2;
      hx = cx + Math.cos(ang) * (islandR * 0.55);
      hz = cz + Math.sin(ang) * (islandR * 0.55);
    }

    const greenY = Math.max(waterY + 0.5, sampleTerrain(level, hx, hz).height);
    flattenDisk(level, hx, hz, 4.2, greenY, 1);
    flattenDisk(level, hx, hz, 1.1, greenY - 0.06, 1);
    paintSurfaceDisk(level, hx, hz, 4.0, "green");

    // Fairway corridor from tee (and lightly between holes)
    const fairwayY = (teeFlatY + greenY) * 0.5;
    flattenCorridor(level, teeX, teeZ, hx, hz, 2.4 + rng() * 1.2, fairwayY, 0.7);
    paintSurfaceDisk(level, hx, hz, 4.0, "green");

    holes.push({
      id: h,
      x: hx,
      z: hz,
      y: greenY,
      color: FLAG_COLORS[h % FLAG_COLORS.length]!,
      active: true,
    });
  }
  level.holes = holes;

  // Tall grass + sand on remaining rough
  for (let g = 0; g < 6; g++) {
    const gx = cx + (rng() - 0.5) * 26;
    const gz = cz + (rng() - 0.5) * 26;
    if (dist2(gx, gz, teeX, teeZ) < 25) continue;
    if (holes.some((o) => dist2(gx, gz, o.x, o.z) < 30)) continue;
    paintSurfaceDisk(level, gx, gz, 2.2 + rng() * 2.2, "tall");
  }
  for (let s = 0; s < 4; s++) {
    const sx = cx + (rng() - 0.5) * 24;
    const sz = cz + (rng() - 0.5) * 24;
    if (holes.some((o) => dist2(sx, sz, o.x, o.z) < 25)) continue;
    paintSurfaceDisk(level, sx, sz, 1.5 + rng() * 1.3, "sand");
    flattenDisk(level, sx, sz, 1.6, sampleTerrain(level, sx, sz).height - 0.1, 0.9);
  }

  // Re-tag submerged verts after edits
  for (let i = 0; i < heights.length; i++) {
    if (heights[i]! <= waterY + 0.06) surfaces[i] = SURFACE_WATER;
  }

  // Trees
  const trees: TreeDef[] = [];
  const treeCount = 20 + Math.floor(rng() * 14);
  for (let t = 0; t < treeCount; t++) {
    const tx = cx + (rng() - 0.5) * 30;
    const tz = cz + (rng() - 0.5) * 30;
    const sample = sampleTerrain(level, tx, tz);
    if (sample.height <= waterY + 0.25) continue;
    if (sample.surface === "green" || sample.surface === "sand" || sample.surface === "water") continue;
    if (dist2(tx, tz, teeX, teeZ) < 12) continue;
    if (holes.some((o) => dist2(tx, tz, o.x, o.z) < 20)) continue;
    trees.push({
      x: tx,
      z: tz,
      y: sample.height,
      radius: 0.45 + rng() * 0.25,
      height: 1.6 + rng() * 1.8,
    });
  }
  level.trees = trees;

  return level;
}

export function holeScoreForStrokes(strokes: number): number {
  return Math.max(0, HOLE_SCORE_BASE - HOLE_SCORE_PER_STROKE * strokes);
}

export function levelIdForNumber(n: number): string {
  return String(n);
}

export function parseLevelNumber(levelId: string): number | null {
  const n = Number(levelId);
  if (!Number.isInteger(n) || n < 1 || n > 100_000) return null;
  return n;
}

export class WorkGolfEngine {
  level: LevelData;
  ball: BallState;
  cameraYaw: number;
  /** 0 = far, 1 = close to the ball */
  cameraZoom = 0.45;
  club: ClubId = "driver";
  strokesTotal = 0;
  strokesThisHole = 0;
  holeScores: number[] = [];
  aiming = false;
  power = 0;
  lastShotPos: Vec3;
  status: RoundSnapshot["status"] = "ready";
  message: string | null = null;
  private messageT = 0;
  private launchGrace = 0;
  /** Highest Y of the current airborne arc (for bounce height). */
  private arcApexY = 0;

  constructor(levelNumber: number) {
    this.level = generateLevel(levelNumber);
    this.ball = {
      pos: { ...this.level.tee },
      vel: { x: 0, y: 0, z: 0 },
      grounded: true,
      moving: false,
    };
    this.lastShotPos = { ...this.level.tee };
    this.cameraYaw = 0;
    this.cameraZoom = 0.45;
    this.club = "driver";
  }

  get holesRemaining(): number {
    return this.level.holes.filter((h) => h.active).length;
  }

  get holesCompleted(): number {
    return HOLES_PER_LEVEL - this.holesRemaining;
  }

  get scoreTotal(): number {
    return this.holeScores.reduce((a, b) => a + b, 0);
  }

  snapshot(): RoundSnapshot {
    return {
      levelNumber: this.level.levelNumber,
      strokesTotal: this.strokesTotal,
      strokesThisHole: this.strokesThisHole,
      holesRemaining: this.holesRemaining,
      holesCompleted: this.holesCompleted,
      holeScores: [...this.holeScores],
      scoreTotal: this.scoreTotal,
      ball: {
        pos: { ...this.ball.pos },
        vel: { ...this.ball.vel },
        grounded: this.ball.grounded,
        moving: this.ball.moving,
      },
      holes: this.level.holes.map((h) => ({ ...h })),
      aiming: this.aiming,
      power: this.power,
      club: this.club,
      cameraYaw: this.cameraYaw,
      cameraZoom: this.cameraZoom,
      lastShotPos: { ...this.lastShotPos },
      status: this.status,
      message: this.message,
    };
  }

  setYaw(yaw: number) {
    this.cameraYaw = yaw;
  }

  setZoom(zoom: number) {
    this.cameraZoom = Math.max(0, Math.min(1, zoom));
  }

  setClub(club: ClubId) {
    if (this.ball.moving || this.aiming) return;
    this.club = club;
  }

  beginAim() {
    if (this.status !== "ready" || this.ball.moving) return;
    this.aiming = true;
    this.power = 0;
  }

  updateAim(power: number, yawDelta: number) {
    if (!this.aiming) return;
    this.power = Math.max(0, Math.min(1, power));
    this.cameraYaw += yawDelta;
  }

  cancelAim() {
    this.aiming = false;
    this.power = 0;
  }

  releaseShot() {
    if (!this.aiming || this.status !== "ready") {
      this.cancelAim();
      return;
    }
    const power = this.power;
    this.aiming = false;
    this.power = 0;
    if (power < 0.04) return;

    this.lastShotPos = { ...this.ball.pos };
    this.strokesTotal += 1;
    this.strokesThisHole += 1;

    const vel = computeShotVelocity(power, this.cameraYaw, this.club);
    this.ball.vel = vel;
    // Nudge off the surface so slope contact doesn't cancel the hit immediately
    this.ball.pos.y += 0.12 + Math.max(0, vel.y) * 0.01;
    this.ball.grounded = false;
    this.ball.moving = true;
    this.launchGrace = LAUNCH_GRACE;
    this.arcApexY = this.ball.pos.y;
    this.status = "flying";
  }

  private resetFromWater() {
    this.strokesTotal += 1;
    this.strokesThisHole += 1;
    this.ball.pos = { ...this.lastShotPos };
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.grounded = true;
    this.ball.moving = false;
    this.status = "ready";
    this.message = "Water · +1";
    this.messageT = 1.6;
  }

  private completeHole(hole: HoleDef) {
    hole.active = false;
    const scored = holeScoreForStrokes(this.strokesThisHole);
    this.holeScores.push(scored);
    this.strokesThisHole = 0;
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.moving = false;
    this.ball.grounded = true;
    // Sit just past the cup so player continues from here
    const sample = sampleTerrain(this.level, hole.x, hole.z);
    this.ball.pos = {
      x: hole.x,
      y: sample.height + BALL_RADIUS,
      z: hole.z,
    };
    this.lastShotPos = { ...this.ball.pos };

    if (this.holesRemaining === 0) {
      this.status = "complete";
      this.message = "Round complete!";
      this.messageT = 3;
    } else {
      this.status = "ready";
      this.message = `Hole scored · ${scored}`;
      this.messageT = 1.8;
    }
  }

  private collideTrees() {
    for (const tree of this.level.trees) {
      const dx = this.ball.pos.x - tree.x;
      const dz = this.ball.pos.z - tree.z;
      const r = tree.radius + BALL_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-8) continue;
      if (this.ball.pos.y > tree.y + tree.height) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      this.ball.pos.x = tree.x + nx * r * TREE_PUSH;
      this.ball.pos.z = tree.z + nz * r * TREE_PUSH;
      const vn = this.ball.vel.x * nx + this.ball.vel.z * nz;
      if (vn < 0) {
        this.ball.vel.x -= 1.6 * vn * nx;
        this.ball.vel.z -= 1.6 * vn * nz;
      }
    }
  }

  tick(dt: number) {
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.message = null;
    }

    if (!this.ball.moving) return;

    if (this.launchGrace > 0) {
      this.launchGrace = Math.max(0, this.launchGrace - dt);
    }

    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const stepDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      this.ball.vel.y -= GRAVITY * stepDt;
      this.ball.pos.x += this.ball.vel.x * stepDt;
      this.ball.pos.y += this.ball.vel.y * stepDt;
      this.ball.pos.z += this.ball.vel.z * stepDt;

      this.collideTrees();

      const sample = sampleTerrain(this.level, this.ball.pos.x, this.ball.pos.z);
      const groundY = sample.height + BALL_RADIUS;

      // Fell into water
      if (sample.surface === "water" || sample.height <= this.level.waterY + 0.05) {
        if (this.ball.pos.y <= this.level.waterY + BALL_RADIUS + 0.15) {
          this.resetFromWater();
          return;
        }
      }

      if (!this.ball.grounded) {
        this.arcApexY = Math.max(this.arcApexY, this.ball.pos.y);
      }

      const canGround =
        this.launchGrace <= 0 &&
        this.ball.vel.y <= 0.35 &&
        sample.height > this.level.waterY + 0.05;

      if (canGround && this.ball.pos.y <= groundY) {
        this.ball.pos.y = groundY;
        const n = sample.normal;

        // Split into normal / tangent
        const vn = this.ball.vel.x * n.x + this.ball.vel.y * n.y + this.ball.vel.z * n.z;
        let tx = this.ball.vel.x - vn * n.x;
        let ty = this.ball.vel.y - vn * n.y;
        let tz = this.ball.vel.z - vn * n.z;

        const fallHeight = Math.max(0, this.arcApexY - groundY);
        const bounceHeight = fallHeight * BOUNCE_HEIGHT_FRAC;

        if (bounceHeight >= MIN_BOUNCE_HEIGHT) {
          // Always bounce (non-water) — ~20% of previous arc height
          const bounceSpeed = Math.sqrt(2 * GRAVITY * bounceHeight);
          tx *= 0.92;
          ty *= 0.92;
          tz *= 0.92;
          this.ball.vel.x = tx + n.x * bounceSpeed;
          this.ball.vel.y = ty + n.y * bounceSpeed;
          this.ball.vel.z = tz + n.z * bounceSpeed;
          this.ball.pos.y = groundY + 0.03;
          this.ball.grounded = false;
          this.arcApexY = groundY;
        } else {
          // Settled — roll, except tall grass / sand kill short rolls
          this.ball.vel.x = tx;
          this.ball.vel.y = ty;
          this.ball.vel.z = tz;

          if (sample.surface === "tall" || sample.surface === "sand") {
            this.ball.vel = { x: 0, y: 0, z: 0 };
            this.ball.moving = false;
            this.ball.grounded = true;
            this.status = "ready";
            return;
          }

          const friction = FRICTION[sample.surface];
          const drag = Math.exp(-friction * stepDt);
          this.ball.vel.x *= drag;
          this.ball.vel.y *= drag;
          this.ball.vel.z *= drag;
          this.ball.vel.x += n.x * GRAVITY * 0.45 * stepDt;
          this.ball.vel.z += n.z * GRAVITY * 0.45 * stepDt;
          this.ball.grounded = true;
        }
      } else {
        this.ball.grounded = false;
        // Keep ball from tunneling deep into slopes during launch grace
        if (this.launchGrace > 0 && this.ball.pos.y < groundY) {
          this.ball.pos.y = groundY + 0.02;
        }
      }

      // Cup capture — pull + generous speed so rolls don't skip the hole
      const speed = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);
      const nearGround = this.ball.grounded || this.ball.pos.y <= groundY + 0.45;
      if (nearGround && this.launchGrace <= 0) {
        for (const hole of this.level.holes) {
          if (!hole.active) continue;
          const d2 = dist2(this.ball.pos.x, this.ball.pos.z, hole.x, hole.z);
          const d = Math.sqrt(d2);

          if (d < HOLE_PULL_RADIUS && d > 1e-5) {
            const falloff = 1 - d / HOLE_PULL_RADIUS;
            const pull = falloff * falloff * 28 * stepDt;
            this.ball.vel.x += ((hole.x - this.ball.pos.x) / d) * pull;
            this.ball.vel.z += ((hole.z - this.ball.pos.z) / d) * pull;
            // Bleed speed in the cup zone so you settle instead of skating over
            const damp = Math.exp(-2.8 * falloff * stepDt);
            this.ball.vel.x *= damp;
            this.ball.vel.z *= damp;
          }

          const catchSpeed =
            d <= HOLE_RADIUS * 0.4 ? HOLE_CATCH_SPEED * 1.75 : HOLE_CATCH_SPEED;
          if (d <= HOLE_RADIUS && speed < catchSpeed) {
            this.completeHole(hole);
            return;
          }
        }
      }

      if (this.ball.grounded && speed < STOP_SPEED) {
        this.ball.vel = { x: 0, y: 0, z: 0 };
        this.ball.moving = false;
        this.status = "ready";
        return;
      }
    }
  }
}
