import type { PoolBallState, PoolGameMessageData } from "@/app/types/interfaces";

const WALL_RESTITUTION = 0.92;
const BALL_RESTITUTION = 0.96;
/** Rolling resistance: velocity decay per second (exponential). */
const LINEAR_DRAG_PER_S = 2.4;
const STOP_SPEED = 0.02;
const MAX_SPEED = 22;
const SUBSTEPS = 16;
/**
 * Each round: velocity impulses for approaching pairs, then positional separation.
 * Order matters — separating first was skipping real bounces.
 */
const BALL_SOLVER_ROUNDS = 14;
/** Push centers slightly past touching so float error does not re-stick. */
const SEPARATION_SLOP = 0.0012;
/** Still resolve impulses when nearly touching (grazing / one frame late). */
const CONTACT_SKIN = 0.0028;
/** Deep penetration with ~zero closing speed: inject a small positive (va−vb)·n so impulse fires. */
const DEEP_OVERLAP = 0.88;
const STUCK_CLOSING_SPEED = 0.06;

/**
 * Six pockets: four corners + two on the long rails (top/bottom when landscape, left/right when portrait).
 */
export function getPoolPocketCenters(tableW: number, tableH: number): { x: number; y: number }[] {
  const inset = Math.min(tableW, tableH) * 0.065;
  const tl = { x: inset, y: inset };
  const tr = { x: tableW - inset, y: inset };
  const bl = { x: inset, y: tableH - inset };
  const br = { x: tableW - inset, y: tableH - inset };

  if (tableW >= tableH) {
    return [
      tl,
      { x: tableW / 2, y: inset * 0.45 },
      tr,
      bl,
      { x: tableW / 2, y: tableH - inset * 0.45 },
      br,
    ];
  }

  return [
    tl,
    { x: inset * 0.45, y: tableH / 2 },
    tr,
    bl,
    { x: tableW - inset * 0.45, y: tableH / 2 },
    br,
  ];
}

const POCKET_CATCH = 0.088;

function clampSpeed(ball: PoolBallState): void {
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > MAX_SPEED) {
    const s = MAX_SPEED / sp;
    ball.vx *= s;
    ball.vy *= s;
  }
}

function applyRollingFriction(ball: PoolBallState, dt: number): void {
  if (ball.pocketed) {
    return;
  }
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp < 1e-8) {
    ball.vx = 0;
    ball.vy = 0;
    return;
  }
  const factor = Math.exp(-LINEAR_DRAG_PER_S * dt);
  ball.vx *= factor;
  ball.vy *= factor;
  if (Math.hypot(ball.vx, ball.vy) < STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }
}

function resolveBallWall(ball: PoolBallState, tableW: number, tableH: number): void {
  const { r } = ball;
  const minX = r;
  const maxX = tableW - r;
  const minY = r;
  const maxY = tableH - r;

  let bounced = false;
  if (ball.x < minX) {
    ball.x = minX;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    bounced = true;
  } else if (ball.x > maxX) {
    ball.x = maxX;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    bounced = true;
  }

  if (ball.y < minY) {
    ball.y = minY;
    ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
    bounced = true;
  } else if (ball.y > maxY) {
    ball.y = maxY;
    ball.vy = -Math.abs(ball.vy) * WALL_RESTITUTION;
    bounced = true;
  }

  if (bounced) {
    clampSpeed(ball);
  }
}

function separateBalls(a: PoolBallState, b: PoolBallState): void {
  if (a.pocketed || b.pocketed) {
    return;
  }
  const minDist = a.r + b.r;
  const minDistSlop = minDist + SEPARATION_SLOP;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distSq = dx * dx + dy * dy;

  // Coincident or nearly coincident centers: pick an axis so we never skip separation.
  if (distSq < 1e-12) {
    dx = minDistSlop;
    dy = 0;
    distSq = dx * dx;
  }

  if (distSq >= minDistSlop * minDistSlop) {
    return;
  }

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDistSlop - dist;
  const push = overlap / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
}

function resolveBallBallVelocity(a: PoolBallState, b: PoolBallState): void {
  if (a.pocketed || b.pocketed) {
    return;
  }
  const minDist = a.r + b.r;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distSq = dx * dx + dy * dy;

  if (distSq < 1e-14) {
    dx = minDist + SEPARATION_SLOP;
    dy = 0;
    distSq = dx * dx;
  }

  const dist = Math.sqrt(distSq);
  if (dist > minDist + CONTACT_SKIN) {
    return;
  }

  const nx = dx / dist;
  const ny = dy / dist;

  // Closing speed along n (a→b): positive when a and b are moving toward each other.
  let uRel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;

  // Separating along n — skip impulse (separation pass handles overlap).
  if (uRel < -1e-7) {
    return;
  }

  // Penetrating but numerically stuck (no closing speed) — synthetic bounce so stacks un-stick.
  if (dist < minDist * DEEP_OVERLAP && Math.abs(uRel) < 1e-5) {
    uRel = STUCK_CLOSING_SPEED;
  }

  if (uRel < 1e-9) {
    return;
  }

  const J = ((1 + BALL_RESTITUTION) * uRel) / 2;
  a.vx -= J * nx;
  a.vy -= J * ny;
  b.vx += J * nx;
  b.vy += J * ny;
  clampSpeed(a);
  clampSpeed(b);
}

function checkPockets(balls: PoolBallState[], tableW: number, tableH: number): void {
  const pockets = getPoolPocketCenters(tableW, tableH);
  for (const ball of balls) {
    if (ball.pocketed) {
      continue;
    }
    for (const p of pockets) {
      if (Math.hypot(ball.x - p.x, ball.y - p.y) < POCKET_CATCH + ball.r * 0.35) {
        ball.pocketed = true;
        ball.vx = 0;
        ball.vy = 0;
        break;
      }
    }
  }
}

function integrate(balls: PoolBallState[], dt: number, tableW: number, tableH: number): void {
  for (const ball of balls) {
    if (ball.pocketed) {
      continue;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
  }

  for (let round = 0; round < BALL_SOLVER_ROUNDS; round += 1) {
    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        resolveBallBallVelocity(balls[i], balls[j]);
      }
    }
    for (let i = 0; i < balls.length; i += 1) {
      for (let j = i + 1; j < balls.length; j += 1) {
        separateBalls(balls[i], balls[j]);
      }
    }
  }

  for (const ball of balls) {
    if (!ball.pocketed) {
      resolveBallWall(ball, tableW, tableH);
    }
  }

  for (const ball of balls) {
    applyRollingFriction(ball, dt);
  }

  checkPockets(balls, tableW, tableH);
}

export function allBallsAtRest(balls: PoolBallState[]): boolean {
  return balls.every((b) => b.pocketed || Math.hypot(b.vx, b.vy) < STOP_SPEED);
}

export function cloneBalls(balls: PoolBallState[]): PoolBallState[] {
  return balls.map((b) => ({ ...b }));
}

export function stepSimulation(game: PoolGameMessageData, dt: number): void {
  const clampedDt = Math.min(0.04, Math.max(0, dt));
  const subDt = clampedDt / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s += 1) {
    integrate(game.balls, subDt, game.table_w, game.table_h);
  }
}

export function applyCueImpulse(game: PoolGameMessageData, angleRad: number, power: number): void {
  const cue = game.balls.find((b) => b.id === 0 && !b.pocketed);
  if (!cue) {
    return;
  }
  const speed = 3.5 + power * 12;
  cue.vx = Math.cos(angleRad) * speed;
  cue.vy = Math.sin(angleRad) * speed;
}
