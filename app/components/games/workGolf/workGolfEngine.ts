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
  driver: { label: "Driver", loftDeg: 30, speed: 0.5 },
  chipper: { label: "Chip", loftDeg: 70, speed: 0.72 },
  putter: { label: "Putt", loftDeg: 5, speed: 0.48 },
};

export type HoleDef = {
  id: number;
  x: number;
  z: number;
  /** Green / rim elevation (top of the cup). */
  y: number;
  color: string;
  active: boolean;
};

/** Physical cup opening (world units). Ball radius is ~0.22. */
export const CUP_RADIUS = 0.34;
/** How deep the cup is carved below the rim. */
export const CUP_DEPTH = 0.55;
/** Soft lip outside the opening. */
export const CUP_LIP = 0.12;

/**
 * Height band above water that may look like beach / cliff dirt.
 * Flat playable land in this band stays turf; only steep skirts read as beach.
 */
export const BEACH_BAND = 1.35;
/** Horizontal normal magnitude — steeper than this in the beach band = cliff skirt. */
export const BEACH_SLOPE = 0.38;

/** How deep sand bunkers sit below the surrounding turf. */
export const BUNKER_DEPTH = 0.45;
/** Steep inner wall thickness (hard lip, not a soft fade). */
export const BUNKER_WALL = 0.3;

/**
 * Irregular bunker footprint: rotated ellipse with angular edge warp
 * (kidney / scalloped / peanut-ish — not a perfect circle).
 */
export type BunkerDef = {
  x: number;
  z: number;
  /** Semi-axis along local X after rotation. */
  rx: number;
  /** Semi-axis along local Z after rotation. */
  rz: number;
  /** Ellipse rotation (radians). */
  rot: number;
  /** Edge irregularity strength (0 = smooth oval, ~0.45 = wild). */
  warp: number;
  /** Phase so each bunker warps differently. */
  warpPhase: number;
  /** Surrounding turf height at the lip. */
  rimY: number;
  /** Conservative outer reach for paint / mesh refine. */
  reach: number;
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
  bunkers: BunkerDef[];
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

/** One-frame visual cues consumed by the Three.js scene. */
export type WorkGolfFxEvent =
  | {
      kind: "treeHit";
      treeIndex: number;
      /** Outward normal from trunk toward ball (lean direction). */
      nx: number;
      nz: number;
      strength: number;
    }
  | { kind: "splash"; x: number; y: number; z: number; strength: number };

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
  /** Rough — heavy drag after bounce; short run-out only. */
  tall: 14,
  green: 1.85,
  sand: 18,
  water: 0,
  void: 0,
};

const STOP_SPEED = 0.35;
/** In tall grass, kill rolls sooner so rough actually holds the ball. */
const TALL_STOP_SPEED = 1.35;
const GRAVITY = 28;
/** Next bounce reaches this fraction of the previous airborne apex height. */
const BOUNCE_HEIGHT_FRAC = 0.2;
/** Below this bounce height, settle into a roll (or stop in tall/sand). */
const MIN_BOUNCE_HEIGHT = 0.07;
const MAX_HIT_SPEED = 42;
/** Max horizontal speed while already inside the cup opening to count as sunk. */
const CUP_CATCH_SPEED = 6.5;
/** Ball must drop this far below the rim to start finishing. */
const CUP_CATCH_DROP = 0.22;
/** Extra time the ball swirls/settles in the cup before the hole completes. */
const CUP_SETTLE_TIME = 0.55;
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

/**
 * FPS-style bloom: half-angle (radians) of aim spray at this power.
 * Quiet at soft taps, opens hard toward full power.
 */
export function aimSpreadHalfAngle(power: number): number {
  const u = Math.max(0, Math.min(1, power));
  // ~0° soft → ~9° at full power
  return 0.155 * u * u;
}

export const SHOT_GHOST_COUNT = 10;
/** Ghost samples along each spray edge (±spread). */
export const SHOT_SPREAD_GHOST_COUNT = 6;

/** World units → display yards (matches hole distance labels). */
export function worldToYards(dist: number): number {
  return Math.round(dist * 1.2);
}

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

/** Rough carry to first bounce, in display yards (no path wobble). */
export function estimateCarryYards(args: {
  origin: Vec3;
  power: number;
  yaw: number;
  club: ClubId;
  level: LevelData;
}): number {
  if (args.power < 0.02) return 0;
  const ghosts = predictShotGhosts(args);
  const land = ghosts[ghosts.length - 1];
  if (!land) return 0;
  return worldToYards(Math.hypot(land.x - args.origin.x, land.z - args.origin.z));
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

/** Next cup to play — holes are ordered by id along the fairway spine. */
export function currentTargetHole(holes: HoleDef[]): HoleDef | null {
  let cur: HoleDef | null = null;
  for (const h of holes) {
    if (!h.active) continue;
    if (!cur || h.id < cur.id) cur = h;
  }
  return cur;
}

/** Yaw from (fromX, fromZ) toward (toX, toZ), matching shot / camera convention. */
export function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** Shortest signed delta from one yaw to another in (−π, π]. */
export function shortestYawDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Camera yaw pan speed (rad/s) when auto-facing the next cup. */
const YAW_PAN_SPEED = 1.45;
/** If |Δyaw| to the cup is within this, treat it as already on-screen. */
const HOLE_IN_VIEW_HALF = 0.58;

/** Carve only the current target cup (rim funnel → deep cylinder). */
export function applyCupCarve(
  baseHeight: number,
  x: number,
  z: number,
  holes: HoleDef[],
): { height: number; inCup: boolean; hole: HoleDef | null } {
  const hole = currentTargetHole(holes);
  if (!hole) return { height: baseHeight, inCup: false, hole: null };

  const d = Math.hypot(x - hole.x, z - hole.z);
  const lipOuter = CUP_RADIUS + CUP_LIP;
  if (d >= lipOuter) return { height: baseHeight, inCup: false, hole: null };

  const rim = hole.y;
  if (d <= CUP_RADIUS) {
    // Flat-ish cup floor with a tiny center well
    const t = d / CUP_RADIUS;
    return {
      height: rim - CUP_DEPTH + 0.06 * t * t,
      inCup: true,
      hole,
    };
  }
  // Beveled lip into the opening
  const u = (d - CUP_RADIUS) / CUP_LIP;
  const lipDrop = 0.1 * (1 - u) * (1 - u);
  return {
    height: Math.min(baseHeight, rim - lipDrop),
    inCup: false,
    hole,
  };
}

/**
 * Normalized distance to bunker lip: < 1 inside, == 1 on edge.
 * Uses a rotated ellipse with multi-harmonic radius warp for organic outlines.
 */
export function bunkerNormDist(b: BunkerDef, x: number, z: number): number {
  const dx = x - b.x;
  const dz = z - b.z;
  if (dx * dx + dz * dz > b.reach * b.reach) return 2;

  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const ang = Math.atan2(lz, lx);
  // Scallops + kidney pinch — keeps edge hard, never a circle
  const edge =
    1 +
    b.warp *
      (0.55 * Math.sin(ang * 2 + b.warpPhase) +
        0.32 * Math.sin(ang * 3 - b.warpPhase * 0.7) +
        0.22 * Math.sin(ang * 5 + b.warpPhase * 1.4));
  const e = Math.max(0.52, edge);
  const nx = lx / (b.rx * e);
  const nz = lz / (b.rz * e);
  return Math.hypot(nx, nz);
}

/** Normalized inner radius where the flat sand floor starts (outside = wall). */
function bunkerFloorNorm(b: BunkerDef): number {
  const meanR = (b.rx + b.rz) * 0.5;
  const wallU = Math.min(0.55, BUNKER_WALL / Math.max(0.4, meanR));
  return Math.max(0.08, 1 - wallU);
}

/**
 * Carve a sand bunker: flat recessed floor + steep wall, hard irregular lip.
 * Never raises terrain — cliff/water verts stay put so we don't grow sand shelves.
 * `onSandFloor` is only the bowl bottom (for sand vertex color — not rim/walls).
 */
export function applyBunkerCarve(
  baseHeight: number,
  x: number,
  z: number,
  bunkers: BunkerDef[],
): { height: number; inBunker: boolean; onSandFloor: boolean } {
  let height = baseHeight;
  let inBunker = false;
  let onSandFloor = false;

  for (const b of bunkers) {
    const d = bunkerNormDist(b, x, z);
    if (d >= 1) continue;
    // Already on a cliff face / below the pit — skip (avoids floating platforms)
    if (baseHeight < b.rimY - BUNKER_DEPTH - 0.2) continue;
    if (baseHeight < b.rimY - 0.85) continue;

    const floor = b.rimY - BUNKER_DEPTH;
    const inner = bunkerFloorNorm(b);
    let carved: number;
    if (d <= inner) {
      const t = d / inner;
      carved = floor + 0.05 * t * t;
    } else {
      // Steep face: stay low most of the wall, rise hard at the lip
      const u = (d - inner) / (1 - inner);
      const rise = u * u * u;
      carved = floor + (b.rimY - floor) * rise;
    }
    // Recess only — never inflate a cliff into a sand shelf
    if (carved < baseHeight - 0.01) {
      height = Math.min(height, carved);
      inBunker = true;
      // Sand color only on the flat bowl floor — walls/lip keep turf color
      if (d <= inner) onSandFloor = true;
    }
  }

  return { height, inBunker, onSandFloor };
}

/** Base height → bunker pit → cup (cups win if they ever overlap). */
function applyAllCarves(
  baseHeight: number,
  x: number,
  z: number,
  level: Pick<LevelData, "holes" | "bunkers">,
): { height: number; inCup: boolean; inBunker: boolean; onSandFloor: boolean } {
  const bunker = applyBunkerCarve(baseHeight, x, z, level.bunkers);
  const cup = applyCupCarve(bunker.height, x, z, level.holes);
  return {
    height: cup.height,
    inCup: cup.inCup,
    inBunker: bunker.inBunker && !cup.inCup,
    onSandFloor: bunker.onSandFloor && !cup.inCup,
  };
}

export function sampleTerrain(
  level: LevelData,
  x: number,
  z: number,
): {
  height: number;
  surface: SurfaceType;
  normal: Vec3;
  inCup: boolean;
  inBunker: boolean;
  onSandFloor: boolean;
} {
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
  const baseHeight =
    (1 - tx) * (1 - tz) * h00 + tx * (1 - tz) * h10 + (1 - tx) * tz * h01 + tx * tz * h11;

  const carved = applyAllCarves(baseHeight, x, z, level);
  const height = carved.height;

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

  // Normal from fine samples so cup / bunker walls have real slope
  const eps = 0.08;
  const hL = applyAllCarves(sampleTerrainBase(level, x - eps, z), x - eps, z, level).height;
  const hR = applyAllCarves(sampleTerrainBase(level, x + eps, z), x + eps, z, level).height;
  const hD = applyAllCarves(sampleTerrainBase(level, x, z - eps), x, z - eps, level).height;
  const hU = applyAllCarves(sampleTerrainBase(level, x, z + eps), x, z + eps, level).height;
  const nx = -(hR - hL) / (2 * eps);
  const nz = -(hU - hD) / (2 * eps);
  const ny = 1;
  const len = Math.hypot(nx, ny, nz) || 1;

  const normal = { x: nx / len, y: ny / len, z: nz / len };

  let surface = surfaceFromCode(bestS);
  // Physics: whole pit plays as sand; vertex sand color uses onSandFloor only
  if (carved.inBunker) surface = "sand";
  if (height <= level.waterY + 0.05) surface = "water";
  // Cliff / wet shore that looks like beach must play as sand (not fairway turf)
  else if (
    surface !== "green" &&
    surface !== "sand" &&
    isBeachSkirt(height, level.waterY, normal)
  ) {
    surface = "sand";
  }

  return {
    height,
    surface,
    normal,
    inCup: carved.inCup,
    inBunker: carved.inBunker,
    onSandFloor: carved.onSandFloor,
  };
}

/** True for wet shoreline or steep cliff dirt in the beach height band. */
export function isBeachSkirt(
  height: number,
  waterY: number,
  normal: Vec3,
): boolean {
  if (height <= waterY + 0.05) return false;
  if (height <= waterY + 0.14) return true;
  if (height >= waterY + BEACH_BAND) return false;
  return Math.hypot(normal.x, normal.z) >= BEACH_SLOPE;
}

/** Bilinear height only (no cup carve) — used for cup normal sampling. */
function sampleTerrainBase(level: LevelData, x: number, z: number): number {
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
  const h00 = hAt(ix0, iz0);
  const h10 = hAt(ix0 + 1, iz0);
  const h01 = hAt(ix0, iz0 + 1);
  const h11 = hAt(ix0 + 1, iz0 + 1);
  return (1 - tx) * (1 - tz) * h00 + tx * (1 - tz) * h10 + (1 - tx) * tz * h01 + tx * tz * h11;
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

/** Sample heightfield height (nearest vert) — used for bunker site checks. */
function heightNear(level: LevelData, x: number, z: number): number {
  return sampleTerrainBase(level, x, z);
}

/**
 * True if a bunker footprint sits on stable plateau (not cliff / water shelf).
 * Samples the center + a ring at ~reach so edge-hanging bunkers get rejected.
 */
function bunkerSiteOk(
  level: LevelData,
  cx: number,
  cz: number,
  reach: number,
  rimY: number,
): boolean {
  const minH = level.waterY + 1.45;
  const maxDrop = 0.5;
  const maxRise = 0.55;
  const pts: Array<[number, number]> = [[0, 0]];
  const ring = 8;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    pts.push([Math.cos(a) * reach * 0.92, Math.sin(a) * reach * 0.92]);
    pts.push([Math.cos(a) * reach * 0.55, Math.sin(a) * reach * 0.55]);
  }
  for (const [ox, oz] of pts) {
    const h = heightNear(level, cx + ox, cz + oz);
    if (h <= minH) return false;
    if (h < rimY - maxDrop) return false;
    if (h > rimY + maxRise) return false;
  }
  return true;
}

/** Paint sand only on the bowl floor — not the rim / surrounding turf. */
function paintBunkerSurface(level: LevelData, bunker: BunkerDef) {
  const code = surfaceCode("sand");
  const r = bunker.reach;
  const floorInner = bunkerFloorNorm(bunker);
  const cliffBand = level.waterY + 1.4;
  for (let iz = 0; iz < level.size; iz++) {
    for (let ix = 0; ix < level.size; ix++) {
      const { x, z } = vertWorld(level, ix, iz);
      if (dist2(x, z, bunker.x, bunker.z) > r * r) continue;
      // Strict floor only — keeps grass color on the lip and outside
      if (bunkerNormDist(bunker, x, z) > floorInner) continue;
      const i = idx(level.size, ix, iz);
      const h = level.heights[i]!;
      if (h <= cliffBand) continue;
      if (h < bunker.rimY - 0.55) continue;
      level.surfaces[i] = code;
    }
  }
}

function makeBunkerShape(
  cx: number,
  cz: number,
  scale: number,
  rimY: number,
  rng: () => number,
): BunkerDef | null {
  if (scale < 0.6) return null;

  // Elongated oval more often than round
  let rx = scale * (0.75 + rng() * 0.55);
  let rz = scale * (0.45 + rng() * 0.55);
  if (rng() < 0.35) {
    const t = rx;
    rx = rz;
    rz = t;
  }
  // Occasional fat/round-ish, occasional skinny finger bunker
  if (rng() < 0.2) {
    rx = scale * (0.95 + rng() * 0.25);
    rz = scale * (0.9 + rng() * 0.25);
  } else if (rng() < 0.25) {
    rx = scale * (1.15 + rng() * 0.45);
    rz = scale * (0.35 + rng() * 0.25);
  }

  const rot = rng() * Math.PI * 2;
  const warp = 0.2 + rng() * 0.38;
  const warpPhase = rng() * Math.PI * 2;
  const reach = Math.max(rx, rz) * (1 + warp * 0.95) + 0.15;

  return {
    x: cx,
    z: cz,
    rx,
    rz,
    rot,
    warp,
    warpPhase,
    rimY,
    reach,
  };
}

/**
 * Hard-edged irregular sand pit. Returns false if the site would hang off a
 * cliff / water edge (caller may retry another spot).
 */
function placeBunker(
  level: LevelData,
  cx: number,
  cz: number,
  scale: number,
  rimY: number,
  rng: () => number,
): boolean {
  const bunker = makeBunkerShape(cx, cz, scale, rimY, rng);
  if (!bunker) return false;
  if (!bunkerSiteOk(level, cx, cz, bunker.reach, rimY)) return false;

  paintBunkerSurface(level, bunker);
  level.bunkers.push(bunker);

  // Sometimes a second overlapping lobe → compound / amoeba bunker
  if (rng() < 0.4) {
    const lobeAng = bunker.rot + (rng() - 0.5) * 0.8;
    const lobeDist = (bunker.rx * 0.45 + bunker.rz * 0.35) * (0.55 + rng() * 0.55);
    const lx = cx + Math.cos(lobeAng) * lobeDist;
    const lz = cz + Math.sin(lobeAng) * lobeDist;
    const lScale = scale * (0.45 + rng() * 0.4);
    const lobe = makeBunkerShape(lx, lz, lScale, rimY, rng);
    if (lobe && bunkerSiteOk(level, lx, lz, lobe.reach, rimY)) {
      // Keep lobe warp a bit milder
      lobe.warp = Math.min(lobe.warp, 0.35);
      lobe.rot = lobeAng + rng() * Math.PI;
      paintBunkerSurface(level, lobe);
      level.bunkers.push(lobe);
    }
  }
  return true;
}

type SpinePoint = { x: number; z: number; bendSign: number };

/** Distance from point to nearest segment of a polyline. */
function distToPolyline(px: number, pz: number, path: SpinePoint[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((px - a.x) * dx + (pz - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + dx * t;
    const qz = a.z + dz * t;
    best = Math.min(best, Math.hypot(px - qx, pz - qz));
  }
  return best;
}

function paintCorridorSurface(
  level: LevelData,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  halfWidth: number,
  surface: SurfaceType,
  overwriteWater = false,
) {
  const code = surfaceCode(surface);
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
      if (along < -0.5 || along > len + 0.5) continue;
      const side = Math.abs(vx * px + vz * pz);
      if (side > halfWidth) continue;
      const i = idx(level.size, ix, iz);
      if (!overwriteWater && level.surfaces[i]! === SURFACE_WATER) continue;
      if (level.heights[i]! <= level.waterY + 0.06 && !overwriteWater) continue;
      level.surfaces[i] = code;
    }
  }
}

function depressPond(
  level: LevelData,
  cx: number,
  cz: number,
  radius: number,
) {
  for (let iz = 0; iz < level.size; iz++) {
    for (let ix = 0; ix < level.size; ix++) {
      const { x, z } = vertWorld(level, ix, iz);
      const d = Math.hypot(x - cx, z - cz);
      if (d > radius * 1.35) continue;
      const wgt = smoothstep(radius * 1.35, radius * 0.3, d);
      const i = idx(level.size, ix, iz);
      level.heights[i] = level.heights[i]! * (1 - wgt) + (level.waterY - 0.9) * wgt;
      if (level.heights[i]! <= level.waterY + 0.06) level.surfaces[i] = SURFACE_WATER;
    }
  }
}

/** Distance from point to segment (for fjord capsules). */
function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

type IslandLobe = { x: number; z: number; rx: number; rz: number };
type IslandFjord = { ax: number; az: number; bx: number; bz: number; width: number };

/**
 * Scotland-ish land field: >0 on plateau, ~0 at cliffs, <0 in ocean.
 * Union of irregular lobes, minus fjord cuts, plus coastal domain warp.
 */
function islandLandField(
  x: number,
  z: number,
  lobes: IslandLobe[],
  fjords: IslandFjord[],
  seed: number,
): number {
  // Domain warp so the coastline isn't radially smooth
  const warpAmp = 5.5;
  const wx = x + fbm2(x * 0.028, z * 0.028, seed + 3, 3) * warpAmp;
  const wz = z + fbm2(x * 0.028 + 9, z * 0.028 - 4, seed + 9, 3) * warpAmp;

  let land = -1e9;
  for (const lobe of lobes) {
    const er = Math.hypot((wx - lobe.x) / lobe.rx, (wz - lobe.z) / lobe.rz);
    land = Math.max(land, 1 - er);
  }

  // Rocky high-frequency bite along the shore
  land -= fbm2(wx * 0.07, wz * 0.07, seed + 21, 4) * 0.18;
  land -= fbm2(wx * 0.16 + 2, wz * 0.16, seed + 27, 2) * 0.08;

  // Fjord / sea-loch cuts — deep inlets from the coast
  for (const f of fjords) {
    const d = distToSegment(wx, wz, f.ax, f.az, f.bx, f.bz);
    const carve = 1 - d / f.width; // >0 inside the inlet corridor
    if (carve > 0) {
      land = Math.min(land, 0.12 - carve * 1.35);
    }
  }

  return land;
}

/** Pull a point onto the interior plateau (land field above margin). */
function clampToPlateau(
  x: number,
  z: number,
  landAt: (x: number, z: number) => number,
  margin = 0.22,
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let i = 0; i < 10; i++) {
    if (landAt(px, pz) >= margin) return { x: px, z: pz };
    // Step toward origin (island roughly centered)
    px *= 0.72;
    pz *= 0.72;
  }
  return { x: px, z: pz };
}

/** Greens are ~4.1r — keep cups (and tee) far enough that greens don't overlap. */
const MIN_HOLE_SEPARATION = 16;

function spinePointTooClose(
  x: number,
  z: number,
  path: SpinePoint[],
  minDist = MIN_HOLE_SEPARATION,
): boolean {
  const min2 = minDist * minDist;
  for (const p of path) {
    if (dist2(x, z, p.x, p.z) < min2) return true;
  }
  return false;
}

/** Push a candidate away from any existing spine points that are too near. */
function separateFromSpine(
  x: number,
  z: number,
  path: SpinePoint[],
  minDist = MIN_HOLE_SEPARATION,
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const p of path) {
      const d = Math.hypot(px - p.x, pz - p.z);
      if (d < 1e-4 || d >= minDist) continue;
      const push = (minDist - d) / d;
      px += (px - p.x) * push;
      pz += (pz - p.z) * push;
      moved = true;
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/**
 * Seeded tee → cups spine with doglegs. Points stay on the island plateau
 * and keep a minimum separation so greens don't stack.
 * bendSign: -1 left / +1 right turn into the next segment (0 = straight-ish).
 */
function buildCourseSpine(
  rng: () => number,
  landAt: (x: number, z: number) => number,
  span: number,
): SpinePoint[] {
  const heading0 = rng() * Math.PI * 2;
  const stepMin = 16;
  const stepMax = 23;

  let x = (rng() - 0.5) * span * 0.3;
  let z = (rng() - 0.5) * span * 0.3;
  ({ x, z } = clampToPlateau(
    x - Math.sin(heading0) * span * 0.35,
    z - Math.cos(heading0) * span * 0.35,
    landAt,
  ));

  const path: SpinePoint[] = [{ x, z, bendSign: 0 }];
  let heading = heading0;

  for (let i = 0; i < HOLES_PER_LEVEL; i++) {
    const dogleg = rng() > 0.28;
    let bendSign = 0;
    if (dogleg) {
      bendSign = rng() < 0.5 ? -1 : 1;
      const bend = ((25 + rng() * 30) * Math.PI) / 180;
      heading += bendSign * bend;
    } else {
      heading += ((rng() - 0.5) * 12 * Math.PI) / 180;
    }

    const step = stepMin + rng() * (stepMax - stepMin);
    let nx = x + Math.sin(heading) * step;
    let nz = z + Math.cos(heading) * step;

    for (let attempt = 0; attempt < 18; attempt++) {
      const landOk = landAt(nx, nz) >= 0.22;
      const sepOk = !spinePointTooClose(nx, nz, path);
      if (landOk && sepOk) break;
      heading += ((rng() < 0.5 ? 1 : -1) * (35 + rng() * 45) * Math.PI) / 180;
      const tryStep = stepMin + rng() * (stepMax - stepMin) + attempt * 0.7;
      nx = x + Math.sin(heading) * tryStep;
      nz = z + Math.cos(heading) * tryStep;
      ({ x: nx, z: nz } = clampToPlateau(nx, nz, landAt));
    }

    ({ x: nx, z: nz } = clampToPlateau(nx, nz, landAt));
    if (spinePointTooClose(nx, nz, path)) {
      ({ x: nx, z: nz } = separateFromSpine(nx, nz, path));
      ({ x: nx, z: nz } = clampToPlateau(nx, nz, landAt));
      // Last resort: step away from previous along current heading
      if (spinePointTooClose(nx, nz, path)) {
        nx = x + Math.sin(heading) * (stepMin + 4);
        nz = z + Math.cos(heading) * (stepMin + 4);
        ({ x: nx, z: nz } = separateFromSpine(nx, nz, path));
        ({ x: nx, z: nz } = clampToPlateau(nx, nz, landAt));
      }
    }

    path.push({ x: nx, z: nz, bendSign });
    x = nx;
    z = nz;
  }

  return path;
}

export function generateLevel(levelNumber: number): LevelData {
  const seed = (levelNumber * 2654435761) >>> 0;
  const rng = makeRng(seed);
  const size = 104;
  const cell = 1.0;
  const waterY = 0;
  const heights = new Float32Array(size * size);
  const surfaces = new Uint8Array(size * size);
  surfaces.fill(SURFACE_WATER);

  const half = ((size - 1) * cell) / 2;

  // Scotland-ish silhouette: main mass + headlands/peninsulas + sea-loch cuts
  const mainRx = half * (0.52 + rng() * 0.1);
  const mainRz = half * (0.44 + rng() * 0.1);
  const lobes: IslandLobe[] = [
    { x: (rng() - 0.5) * 6, z: (rng() - 0.5) * 6, rx: mainRx, rz: mainRz },
  ];
  const headlandCount = 3 + Math.floor(rng() * 3);
  for (let h = 0; h < headlandCount; h++) {
    const ang = (h / headlandCount) * Math.PI * 2 + rng() * 0.5;
    const dist = half * (0.28 + rng() * 0.22);
    lobes.push({
      x: Math.sin(ang) * dist + (rng() - 0.5) * 4,
      z: Math.cos(ang) * dist + (rng() - 0.5) * 4,
      rx: half * (0.22 + rng() * 0.16),
      rz: half * (0.18 + rng() * 0.14),
    });
  }
  // One longer "arm" peninsula
  {
    const ang = rng() * Math.PI * 2;
    lobes.push({
      x: Math.sin(ang) * half * 0.38,
      z: Math.cos(ang) * half * 0.38,
      rx: half * (0.3 + rng() * 0.12),
      rz: half * (0.14 + rng() * 0.08),
    });
  }

  const fjords: IslandFjord[] = [];
  const fjordCount = 2 + Math.floor(rng() * 3);
  for (let f = 0; f < fjordCount; f++) {
    const ang = rng() * Math.PI * 2;
    const outer = half * (0.62 + rng() * 0.12);
    const inner = half * (0.18 + rng() * 0.16);
    fjords.push({
      ax: Math.sin(ang) * outer,
      az: Math.cos(ang) * outer,
      bx: Math.sin(ang) * inner + (rng() - 0.5) * 5,
      bz: Math.cos(ang) * inner + (rng() - 0.5) * 5,
      width: 3.2 + rng() * 3.5,
    });
  }

  const landAt = (x: number, z: number) => islandLandField(x, z, lobes, fjords, seed);

  // Irregular island — rugged cliffs into ocean
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const x = -half + ix * cell;
      const z = -half + iz * cell;
      const i = idx(size, ix, iz);

      const n1 = fbm2(x * 0.025, z * 0.025, seed, 5);
      const n2 = fbm2(x * 0.065 + 12, z * 0.065 - 5, seed + 17, 4);
      const n3 = fbm2(x * 0.16, z * 0.16, seed + 91, 3);
      const n4 = fbm2(x * 0.04 + 40, z * 0.04 - 22, seed + 203, 4);
      // Rolling highland + ridges — fairway corridor is flattened later
      const ridges = Math.abs(n4);
      const plateau =
        1.35 + n1 * 2.35 + n2 * 1.15 + n3 * 0.45 + ridges * 0.85;
      const oceanFloor = waterY - 1.85 + n2 * 0.12;
      const land = landAt(x, z);

      // land >> 0 deep inland, ~0 cliff, <0 ocean
      let h: number;
      if (land > 0.2) {
        h = plateau;
      } else if (land > -0.08) {
        const t = smoothstep(0.2, -0.05, land);
        const cliffT = t * t;
        h = plateau * (1 - cliffT) + oceanFloor * cliffT;
      } else {
        h = oceanFloor;
      }

      heights[i] = h;
      surfaces[i] = h > waterY + 0.08 ? SURFACE_MEDIUM : SURFACE_WATER;
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
    bunkers: [],
    trees: [],
    tee: { x: 0, y: 1, z: 0 },
    waterY,
  };

  // Discrete hills / knolls / shallow bowls on the plateau (fairway flattened later)
  const addHill = (px: number, pz: number, pr: number, lift: number) => {
    if (landAt(px, pz) < 0.22) return;
    for (let iz = 0; iz < size; iz++) {
      for (let ix = 0; ix < size; ix++) {
        const { x, z } = vertWorld(level, ix, iz);
        const i = idx(size, ix, iz);
        if (heights[i]! <= waterY + 0.25) continue;
        const d = Math.hypot(x - px, z - pz);
        if (d > pr) continue;
        // Slightly peaked falloff so hills read clearly
        const w = smoothstep(pr, 0, d);
        heights[i] += lift * w * w;
      }
    }
  };
  // A few larger hills
  for (let p = 0; p < 4; p++) {
    addHill(
      (rng() - 0.5) * half * 0.85,
      (rng() - 0.5) * half * 0.85,
      9 + rng() * 11,
      1.6 + rng() * 2.4,
    );
  }
  // More mid-size knolls / dips
  for (let p = 0; p < 10; p++) {
    addHill(
      (rng() - 0.5) * half * 0.95,
      (rng() - 0.5) * half * 0.95,
      4 + rng() * 8,
      (rng() < 0.22 ? -1 : 1) * (0.7 + rng() * 1.8),
    );
  }

  const spine = buildCourseSpine(rng, landAt, half * 0.7);
  const teePt = spine[0]!;
  const fairwayHalf = 3.4;
  const roughOuter = 9.5;

  // Average fairway elevation from samples along spine
  let elevSum = 0;
  for (const p of spine) elevSum += sampleTerrain(level, p.x, p.z).height;
  // Keep the playable strip above the beach/cliff color band so low islands aren't all dirt
  const fairwayY = Math.max(waterY + BEACH_BAND + 0.25, elevSum / spine.length);

  // Rough band first (tall grass), then fairway overwrites the center
  for (let s = 0; s < spine.length - 1; s++) {
    const a = spine[s]!;
    const b = spine[s + 1]!;
    paintCorridorSurface(level, a.x, a.z, b.x, b.z, roughOuter, "tall");
    flattenCorridor(level, a.x, a.z, b.x, b.z, roughOuter * 0.85, fairwayY + 0.08, 0.35);
  }
  for (let s = 0; s < spine.length - 1; s++) {
    const a = spine[s]!;
    const b = spine[s + 1]!;
    flattenCorridor(level, a.x, a.z, b.x, b.z, fairwayHalf + 0.4, fairwayY, 0.92);
    paintCorridorSurface(level, a.x, a.z, b.x, b.z, fairwayHalf, "medium", true);
  }

  // Sparse rough patches on the plateau (not on fairway / not on cliffs)
  for (let g = 0; g < 10; g++) {
    const gx = (rng() - 0.5) * half * 1.1;
    const gz = (rng() - 0.5) * half * 1.1;
    if (landAt(gx, gz) < 0.25) continue;
    if (distToPolyline(gx, gz, spine) < fairwayHalf + 2) continue;
    paintSurfaceDisk(level, gx, gz, 2.5 + rng() * 3, "tall");
  }

  // Hazards at doglegs — water outside the bend, sand inside
  for (let s = 1; s < spine.length; s++) {
    const prev = spine[s - 1]!;
    const cur = spine[s]!;
    const bend = cur.bendSign;
    if (bend === 0 && rng() > 0.35) continue;

    const dx = cur.x - prev.x;
    const dz = cur.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const midX = (prev.x + cur.x) * 0.5;
    const midZ = (prev.z + cur.z) * 0.5;
    const turn = bend === 0 ? (rng() < 0.5 ? -1 : 1) : bend;

    // Pond on the outside of the bend
    if (rng() > 0.25 || bend !== 0) {
      const pondDist = fairwayHalf + 5.5 + rng() * 2.5;
      const wx = midX - turn * px * pondDist;
      const wz = midZ - turn * pz * pondDist;
      if (distToPolyline(wx, wz, spine) > fairwayHalf + 2.5) {
        depressPond(level, wx, wz, 2.4 + rng() * 1.8);
      }
    }

    // Sand bunker on the inside of the bend (skip if it would hang off a cliff)
    const sandDist = fairwayHalf + 2.2 + rng() * 1.5;
    const sx = midX + turn * px * sandDist;
    const sz = midZ + turn * pz * sandDist;
    if (distToPolyline(sx, sz, spine) > fairwayHalf * 0.85) {
      if (!placeBunker(level, sx, sz, 1.55 + rng() * 1.15, fairwayY, rng)) {
        // Nudge inland along the fairway normal and retry once
        const ix = midX + turn * px * (fairwayHalf + 1.2);
        const iz = midZ + turn * pz * (fairwayHalf + 1.2);
        placeBunker(level, ix, iz, 1.25 + rng() * 0.8, fairwayY, rng);
      }
    }
  }

  // Tee pad
  const teeFlatY = fairwayY;
  flattenDisk(level, teePt.x, teePt.z, 3.4, teeFlatY, 1);
  paintSurfaceDisk(level, teePt.x, teePt.z, 3.4, "medium");
  level.tee = { x: teePt.x, y: teeFlatY + BALL_RADIUS, z: teePt.z };

  // Greens + cups at spine points 1..5
  const holes: HoleDef[] = [];
  for (let h = 0; h < HOLES_PER_LEVEL; h++) {
    const pt = spine[h + 1]!;
    const greenY = fairwayY;
    flattenDisk(level, pt.x, pt.z, 4.4, greenY, 1);
    paintSurfaceDisk(level, pt.x, pt.z, 4.1, "green");
    // Cup is carved at sample/render time (see applyCupCarve) — not a coarse height dip

    // Sand bunker beside green — try a few angles so we don't hang off cliffs
    const baseAng = rng() * Math.PI * 2;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = baseAng + (attempt / 8) * Math.PI * 2;
      const dist = 4.4 + (attempt % 3) * 0.35 + rng() * 0.4;
      const bx = pt.x + Math.cos(ang) * dist;
      const bz = pt.z + Math.sin(ang) * dist;
      if (placeBunker(level, bx, bz, 1.35 + rng() * 0.85, greenY, rng)) break;
    }

    holes.push({
      id: h,
      x: pt.x,
      z: pt.z,
      y: greenY,
      color: FLAG_COLORS[h % FLAG_COLORS.length]!,
      active: true,
    });
  }
  level.holes = holes;

  // Re-tag water after edits; restore fairway if ponds clipped it
  for (let i = 0; i < heights.length; i++) {
    if (heights[i]! <= waterY + 0.06) surfaces[i] = SURFACE_WATER;
  }
  for (let s = 0; s < spine.length - 1; s++) {
    const a = spine[s]!;
    const b = spine[s + 1]!;
    // Ensure fairway stays dry and medium
    for (let iz = 0; iz < size; iz++) {
      for (let ix = 0; ix < size; ix++) {
        const { x, z } = vertWorld(level, ix, iz);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const along = ((x - a.x) * dx + (z - a.z) * dz) / (len * len);
        if (along < 0 || along > 1) continue;
        const qx = a.x + dx * along;
        const qz = a.z + dz * along;
        if (Math.hypot(x - qx, z - qz) > fairwayHalf * 0.92) continue;
        const i = idx(size, ix, iz);
        if (surfaces[i]! === SURFACE_WATER) {
          heights[i] = fairwayY;
          surfaces[i] = SURFACE_MEDIUM;
        }
      }
    }
  }
  // Re-paint greens on top
  for (const hole of holes) {
    paintSurfaceDisk(level, hole.x, hole.z, 4.1, "green");
  }

  // Flanking tree belts along the fairway
  const trees: TreeDef[] = [];
  for (let s = 0; s < spine.length - 1; s++) {
    const a = spine[s]!;
    const b = spine[s + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const denser = b.bendSign !== 0 ? 1.35 : 1;
    const samples = Math.floor((6 + len * 0.55) * denser);

    for (let k = 0; k < samples; k++) {
      const t = (k + 0.5) / samples;
      const mx = a.x + dx * t;
      const mz = a.z + dz * t;
      for (const side of [-1, 1] as const) {
        // Heavier trees on the inside of doglegs
        const inside = b.bendSign !== 0 && side === b.bendSign;
        if (!inside && rng() > 0.72) continue;
        if (inside && rng() > 0.92) continue;

        const dist = fairwayHalf + 2.2 + rng() * (inside ? 3.5 : 5.5);
        const tx = mx + side * px * dist + (rng() - 0.5) * 1.4;
        const tz = mz + side * pz * dist + (rng() - 0.5) * 1.4;
        if (distToPolyline(tx, tz, spine) < fairwayHalf + 1.2) continue;
        if (dist2(tx, tz, teePt.x, teePt.z) < 16) continue;
        if (holes.some((o) => dist2(tx, tz, o.x, o.z) < 22)) continue;
        const sample = sampleTerrain(level, tx, tz);
        if (sample.height <= waterY + 0.25) continue;
        if (sample.surface === "green" || sample.surface === "sand" || sample.surface === "water") {
          continue;
        }
        trees.push({
          x: tx,
          z: tz,
          y: sample.height,
          radius: 0.42 + rng() * 0.28,
          height: 1.5 + rng() * 2.0,
        });
      }
    }
  }

  // A few scattered trees on the plateau rough
  for (let t = 0; t < 18; t++) {
    const tx = (rng() - 0.5) * half * 1.05;
    const tz = (rng() - 0.5) * half * 1.05;
    if (landAt(tx, tz) < 0.25) continue;
    if (distToPolyline(tx, tz, spine) < roughOuter + 1) continue;
    const sample = sampleTerrain(level, tx, tz);
    if (sample.height <= waterY + 0.45) continue;
    if (sample.surface === "water" || sample.surface === "sand" || sample.surface === "green") {
      continue;
    }
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
  /** Cup the ball is currently swirling into (before score pops). */
  private sinkingHole: HoleDef | null = null;
  private sinkSettleT = 0;
  private pendingFx: WorkGolfFxEvent[] = [];
  /** Strongest tree impact this tick (index → hit), flushed once per frame. */
  private frameTreeHits = new Map<number, { nx: number; nz: number; s: number }>();
  /** Smooth camera pan target; null when not auto-rotating. */
  private yawPanTarget: number | null = null;

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
    // Tee-off: snap once so the first view is correct
    const hole = currentTargetHole(this.level.holes);
    if (hole) {
      this.cameraYaw = yawToward(this.ball.pos.x, this.ball.pos.z, hole.x, hole.z);
    }
  }

  /** Smoothly pan camera toward the next cup (used after holing out). */
  faceCurrentHole() {
    this.ensureHoleInView(true);
  }

  /**
   * Start a yaw pan toward the current target if needed.
   * `force` always pans (e.g. after sinking); otherwise only when the cup is off-screen.
   */
  ensureHoleInView(force = false) {
    if (this.aiming) return;
    const hole = currentTargetHole(this.level.holes);
    if (!hole) {
      this.yawPanTarget = null;
      return;
    }
    const desired = yawToward(this.ball.pos.x, this.ball.pos.z, hole.x, hole.z);
    const delta = shortestYawDelta(this.cameraYaw, desired);
    if (!force && Math.abs(delta) <= HOLE_IN_VIEW_HALF) {
      this.yawPanTarget = null;
      return;
    }
    this.yawPanTarget = desired;
  }

  private tickYawPan(dt: number) {
    if (this.yawPanTarget == null || this.aiming) return;
    const delta = shortestYawDelta(this.cameraYaw, this.yawPanTarget);
    const step = YAW_PAN_SPEED * dt;
    if (Math.abs(delta) <= step) {
      this.cameraYaw = this.yawPanTarget;
      this.yawPanTarget = null;
    } else {
      this.cameraYaw += Math.sign(delta) * step;
    }
  }

  private cancelYawPan() {
    this.yawPanTarget = null;
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
    this.cancelYawPan();
    this.cameraYaw = yaw;
  }

  setZoom(zoom: number) {
    this.cameraZoom = Math.max(0, Math.min(1, zoom));
  }

  setClub(club: ClubId) {
    if (this.ball.moving || this.aiming) return;
    this.club = club;
  }

  /** Scene should call this once per frame after syncing. */
  drainFx(): WorkGolfFxEvent[] {
    if (this.pendingFx.length === 0) return [];
    const out = this.pendingFx;
    this.pendingFx = [];
    return out;
  }

  private flushTreeHits() {
    if (this.frameTreeHits.size === 0) return;
    for (const [treeIndex, hit] of this.frameTreeHits) {
      this.pendingFx.push({
        kind: "treeHit",
        treeIndex,
        nx: hit.nx,
        nz: hit.nz,
        strength: hit.s,
      });
    }
    this.frameTreeHits.clear();
  }

  beginAim() {
    if (this.status !== "ready" || this.ball.moving) return;
    this.cancelYawPan();
    this.aiming = true;
    this.power = 0;
  }

  updateAim(power: number, yawDelta: number) {
    if (!this.aiming) return;
    this.cancelYawPan();
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

    // Random point inside the bloom cone (uniform in angle, like spray)
    const spread = aimSpreadHalfAngle(power);
    const yawJitter = (Math.random() * 2 - 1) * spread;
    const vel = computeShotVelocity(power, this.cameraYaw + yawJitter, this.club);
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
    const speed = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);
    this.pendingFx.push({
      kind: "splash",
      x: this.ball.pos.x,
      y: this.level.waterY + 0.04,
      z: this.ball.pos.z,
      strength: Math.min(1.8, 0.45 + speed / 16),
    });
    this.strokesTotal += 1;
    this.strokesThisHole += 1;
    this.ball.pos = { ...this.lastShotPos };
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.ball.grounded = true;
    this.ball.moving = false;
    this.status = "ready";
    this.message = "Water · +1";
    this.messageT = 1.6;
    this.ensureHoleInView(false);
  }

  private beginCupSink(hole: HoleDef) {
    this.sinkingHole = hole;
    this.sinkSettleT = CUP_SETTLE_TIME;
    this.ball.moving = true;
    this.ball.grounded = false;
    // Seed a little swirl so the ball visibly spins while dropping
    const dx = this.ball.pos.x - hole.x;
    const dz = this.ball.pos.z - hole.z;
    const ang = Math.atan2(dz, dx);
    this.ball.vel = {
      x: -Math.sin(ang) * 2.2,
      y: -1.2,
      z: Math.cos(ang) * 2.2,
    };
  }

  private tickCupSink(dt: number) {
    const hole = this.sinkingHole;
    if (!hole) return;

    this.sinkSettleT -= dt;
    const life = Math.max(0, this.sinkSettleT / CUP_SETTLE_TIME);

    let dx = this.ball.pos.x - hole.x;
    let dz = this.ball.pos.z - hole.z;
    let rad = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx) + (5.5 + life * 4) * dt;
    rad = Math.max(0.02, rad * Math.exp(-3.8 * dt));
    this.ball.pos.x = hole.x + Math.cos(ang) * rad;
    this.ball.pos.z = hole.z + Math.sin(ang) * rad;

    const floorY = hole.y - CUP_DEPTH + BALL_RADIUS + 0.03;
    this.ball.pos.y += (floorY - this.ball.pos.y) * Math.min(1, 5.5 * dt);

    // Keep fake velocity for mesh spin in the scene
    const spin = 1.2 + life * 3.5;
    this.ball.vel.x = -Math.sin(ang) * spin;
    this.ball.vel.z = Math.cos(ang) * spin;
    this.ball.vel.y = (floorY - this.ball.pos.y) * 2;

    if (this.sinkSettleT <= 0) {
      this.sinkingHole = null;
      this.completeHole(hole);
    }
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
      this.message = `Hole ${hole.id + 1} · ${scored} · next cup ahead`;
      this.messageT = 1.8;
      this.faceCurrentHole(); // smooth pan toward next cup
    }
  }

  private collideTrees() {
    for (let ti = 0; ti < this.level.trees.length; ti++) {
      const tree = this.level.trees[ti]!;
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
        const s = Math.min(4.2, -vn * 0.32);
        if (s > 0.04) {
          const prev = this.frameTreeHits.get(ti);
          if (!prev || s > prev.s) this.frameTreeHits.set(ti, { nx, nz, s });
        }
      }
    }
  }

  tick(dt: number) {
    if (this.messageT > 0) {
      this.messageT -= dt;
      if (this.messageT <= 0) this.message = null;
    }

    this.tickYawPan(dt);

    if (this.sinkingHole) {
      this.tickCupSink(dt);
      return;
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
          this.flushTreeHits();
          this.resetFromWater();
          return;
        }
      }

      if (!this.ball.grounded) {
        this.arcApexY = Math.max(this.arcApexY, this.ball.pos.y);
      }

      // Over the current cup only: fall in — no bounce / magnetism. Fast balls can lip out.
      if (sample.inCup && this.launchGrace <= 0) {
        this.ball.grounded = false;
        const horizSpeed = Math.hypot(this.ball.vel.x, this.ball.vel.z);
        const hole = currentTargetHole(this.level.holes);
        if (hole) {
          const dx = this.ball.pos.x - hole.x;
          const dz = this.ball.pos.z - hole.z;
          const d = Math.hypot(dx, dz);
          if (d < CUP_RADIUS && d >= 1e-6) {
            // Soft walls only once the ball has slowed enough to drop (not a skim)
            if (horizSpeed < CUP_CATCH_SPEED * 1.15 && d > CUP_RADIUS - BALL_RADIUS * 0.35) {
              const nx = dx / d;
              const nz = dz / d;
              const push = CUP_RADIUS - BALL_RADIUS * 0.35;
              this.ball.pos.x = hole.x + nx * push;
              this.ball.pos.z = hole.z + nz * push;
              const vn = this.ball.vel.x * nx + this.ball.vel.z * nz;
              if (vn > 0) {
                this.ball.vel.x -= vn * nx;
                this.ball.vel.z -= vn * nz;
              }
            }

            const dropped = hole.y - this.ball.pos.y;
            if (dropped >= CUP_CATCH_DROP && horizSpeed < CUP_CATCH_SPEED) {
              this.flushTreeHits();
              this.beginCupSink(hole);
              return;
            }
          }
        }
        // Collide with cup floor so we don't fall forever
        if (this.ball.pos.y <= groundY) {
          this.ball.pos.y = groundY;
          this.ball.vel.y = Math.min(0, this.ball.vel.y) * 0.15;
          this.ball.vel.x *= 0.85;
          this.ball.vel.z *= 0.85;
        }
      } else {
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
            // Bounce (non-water). Rough eats more forward speed but still hops.
            const bounceSpeed = Math.sqrt(2 * GRAVITY * bounceHeight);
            const tanKeep = sample.surface === "tall" ? 0.62 : 0.92;
            tx *= tanKeep;
            ty *= tanKeep;
            tz *= tanKeep;
            this.ball.vel.x = tx + n.x * bounceSpeed;
            this.ball.vel.y = ty + n.y * bounceSpeed;
            this.ball.vel.z = tz + n.z * bounceSpeed;
            this.ball.pos.y = groundY + 0.03;
            this.ball.grounded = false;
            this.arcApexY = groundY;
          } else {
            // Settled — sand hard-stops; tall grass drags then stops at higher speed
            this.ball.vel.x = tx;
            this.ball.vel.y = ty;
            this.ball.vel.z = tz;

            if (sample.surface === "sand") {
              this.ball.vel = { x: 0, y: 0, z: 0 };
              this.ball.moving = false;
              this.ball.grounded = true;
              this.status = "ready";
              this.flushTreeHits();
              this.ensureHoleInView(false);
              return;
            }

            if (sample.surface === "tall") {
              const horiz = Math.hypot(tx, tz);
              if (horiz < TALL_STOP_SPEED) {
                this.ball.vel = { x: 0, y: 0, z: 0 };
                this.ball.moving = false;
                this.ball.grounded = true;
                this.status = "ready";
                this.flushTreeHits();
                this.ensureHoleInView(false);
                return;
              }
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
      }

      const speed = Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z);

      if (this.ball.grounded && speed < STOP_SPEED) {
        this.ball.vel = { x: 0, y: 0, z: 0 };
        this.ball.moving = false;
        this.status = "ready";
        this.flushTreeHits();
        this.ensureHoleInView(false);
        return;
      }
    }
    this.flushTreeHits();
  }
}
